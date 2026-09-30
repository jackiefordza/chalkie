import { useState, useEffect, useMemo } from 'react';
import { View, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Platform, useWindowDimensions } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import {
  collection, doc, onSnapshot, query, where, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { goBack } from '@/lib/navigation';
import { canSignOffMatch, canResetMatch } from '@/lib/matchPermissions';
import { RAW } from '@/lib/theme';
import {
  Screen, Heading, Body, Caption, Stat, Badge, Button, Card, Chip, Input, Label, Sheet, AppBar,
} from '@/components/ui';
import { AdminShell } from '@/components/admin/AdminShell';
import { MatchHeader, MatchSummary, GameRow, ActionBanner } from '@/components/MatchCentre';
import {
  LEGS_PER_GAME, blankGames, toDraft, toMatchGame, slotsFor, isGameComplete, normalizeGameForCompare,
  type DraftGame,
} from '@/lib/matchResultDraft';
import type { Match, MatchGame, MatchSide } from '@/types';

const DESKTOP_BREAKPOINT = 768;

interface Player { id: string; name: string; teamId: string }

export default function ResultsEntryScreen() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const { appUser } = useAuthStore();
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;

  const [match, setMatch] = useState<Match | null>(null);
  const [homeTeamName, setHomeTeamName] = useState('');
  const [awayTeamName, setAwayTeamName] = useState('');
  const [players, setPlayers] = useState<Player[]>([]);
  const [mySubmission, setMySubmission] = useState<MatchGame[] | null>(null);
  const [otherSubmission, setOtherSubmission] = useState<MatchGame[] | null>(null);
  // The single team submission an admin is being asked to sign off on
  // (awaiting_confirmation means exactly one side has submitted). Loaded
  // separately from mySubmission/otherSubmission above, which only ever
  // populate for a viewer on one of the two teams — a pure admin (no team)
  // never triggers that effect, so this match's submission was previously
  // never fetched for them at all.
  const [awaitingSubmission, setAwaitingSubmission] = useState<{ teamId: string; games: MatchGame[] } | null>(null);
  const [isLoadingAwaitingSubmission, setIsLoadingAwaitingSubmission] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [adminCorrecting, setAdminCorrecting] = useState(false);
  const [games, setGames] = useState<DraftGame[]>(blankGames());
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Review mode: games flagged as "not right, let me fix this" — everything else
  // is treated as agreed-with, copied straight from the other team's submission.
  const [editedGameIndexes, setEditedGameIndexes] = useState<Set<number>>(new Set());

  // player-picker modal
  const [picker, setPicker] = useState<{ gameIndex: number; side: MatchSide } | null>(null);

  // high-checkout modal (add new, or edit an existing entry) for a given game
  const [checkoutModal, setCheckoutModal] = useState<{ gameIndex: number; editIndex: number | null } | null>(null);
  const [checkoutPlayerId, setCheckoutPlayerId] = useState<string | null>(null);
  const [checkoutValue, setCheckoutValue] = useState('');

  const teamId = appUser?.teamId ?? null;
  const isHome = match ? teamId === match.homeTeamId : false;
  const isAway = match ? teamId === match.awayTeamId : false;
  const myTeamId = isHome ? match?.homeTeamId : isAway ? match?.awayTeamId : null;
  // A global admin can already read any league's matches (firestore.rules'
  // isAdminFor()), but this screen's own view/correction gate only checked
  // isLeagueAdmin — a global admin with no team relation and no per-league
  // admin flag would be told "You can't view this result" despite the read
  // actually succeeding. Recognizing both matches what the rules already grant.
  const isAdmin = !!appUser?.isLeagueAdmin || !!appUser?.isGlobalAdmin;
  const isCaptainOrVC = appUser?.role === 'captain' || appUser?.role === 'viceCaptain';
  // Whether this viewer can actually submit/edit a result for THIS match —
  // an ordinary player on the team (or anyone not on either team) can view,
  // but only that team's captain/VC can act. This was previously unchecked:
  // any viewer who could see the match could open the full entry form, and
  // would only discover they lacked permission when the write itself failed.
  const canAct = isCaptainOrVC && (isHome || isAway);

  useEffect(() => {
    if (!matchId || !appUser?.leagueId) return;

    const unsubMatch = onSnapshot(
      doc(db, 'matches', matchId),
      async (snap) => {
        if (!snap.exists()) { setLoadError('Fixture not found'); setIsLoading(false); return; }
        const d = snap.data();
        const m: Match = {
          id: snap.id,
          ...d,
          scheduledDate: d.scheduledDate?.toDate() ?? new Date(),
        } as Match;
        setMatch(m);

        const [homeSnap, awaySnap] = await Promise.all([
          getDoc(doc(db, 'teams', m.homeTeamId)),
          getDoc(doc(db, 'teams', m.awayTeamId)),
        ]);
        setHomeTeamName(homeSnap.data()?.name ?? 'Home');
        setAwayTeamName(awaySnap.data()?.name ?? 'Away');
        setIsLoading(false);
      },
      (e) => { setLoadError(e.message); setIsLoading(false); },
    );

    const unsubPlayers = onSnapshot(
      query(collection(db, 'players'), where('leagueId', '==', appUser.leagueId)),
      (snap) => {
        setPlayers(
          snap.docs
            .map((d) => ({ id: d.id, name: d.data().name, teamId: d.data().teamId } as Player))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      },
    );

    return () => { unsubMatch(); unsubPlayers(); };
  }, [matchId, appUser?.leagueId]);

  // Load our own existing submission (for edit) + the other team's (to review/reconcile)
  useEffect(() => {
    if (!matchId || !myTeamId || !match) return;
    const otherTeamId = isHome ? match.awayTeamId : match.homeTeamId;

    getDoc(doc(db, 'matches', matchId, 'submissions', myTeamId)).then((mySnap) => {
      const myGames = mySnap.exists() ? (mySnap.data().games as MatchGame[]) : null;
      if (myGames) { setMySubmission(myGames); setGames(toDraft(myGames)); }

      getDoc(doc(db, 'matches', matchId, 'submissions', otherTeamId)).then((otherSnap) => {
        const otherGames = otherSnap.exists() ? (otherSnap.data().games as MatchGame[]) : null;
        setOtherSubmission(otherGames);
        // Nobody's submitted on our side yet, but the other team has — start
        // from their entry (review mode) instead of a blank form.
        if (!myGames && otherGames) setGames(toDraft(otherGames));
      });
    });
  }, [matchId, myTeamId, match, isHome]);

  // Load the single submitted team's result for an admin who can sign this
  // match off — gated by the same helper firestore.rules enforces, so this
  // never fetches (or offers sign-off) for a match outside the admin's league
  // or one that isn't actually awaiting confirmation.
  useEffect(() => {
    if (!matchId || !match || !canSignOffMatch(appUser, match)) { setAwaitingSubmission(null); return; }
    setIsLoadingAwaitingSubmission(true);
    Promise.all([
      getDoc(doc(db, 'matches', matchId, 'submissions', match.homeTeamId)),
      getDoc(doc(db, 'matches', matchId, 'submissions', match.awayTeamId)),
    ]).then(([homeSnap, awaySnap]) => {
      const submitted = homeSnap.exists()
        ? { teamId: match.homeTeamId, games: homeSnap.data().games as MatchGame[] }
        : awaySnap.exists()
          ? { teamId: match.awayTeamId, games: awaySnap.data().games as MatchGame[] }
          : null;
      setAwaitingSubmission(submitted);
      setIsLoadingAwaitingSubmission(false);
    });
  }, [matchId, match, appUser]);

  type Mode = 'blank' | 'review' | 'waiting' | 'reconcile';
  const mode: Mode = otherSubmission && !mySubmission
    ? 'review'
    : mySubmission && !otherSubmission
      ? 'waiting'
      : mySubmission && otherSubmission
        ? 'reconcile'
        : 'blank';

  const diffGameIndexes = useMemo(() => {
    if (!mySubmission || !otherSubmission) return [];
    const mine = toDraft(mySubmission);
    const theirs = toDraft(otherSubmission);
    return mine
      .map((g, i) => (normalizeGameForCompare(g) !== normalizeGameForCompare(theirs[i]) ? i : -1))
      .filter((i) => i !== -1);
  }, [mySubmission, otherSubmission]);

  async function adoptTheirVersion(gameIndex: number) {
    if (!matchId || !myTeamId || !appUser || !mySubmission || !otherSubmission) return;
    const updated = mySubmission.map((g, i) => (i === gameIndex ? otherSubmission[i] : g));
    try {
      await setDoc(doc(db, 'matches', matchId, 'submissions', myTeamId), {
        submittedByTeamId: myTeamId,
        submittedByUserId: appUser.uid,
        games: updated,
        createdAt: serverTimestamp(),
      });
      setMySubmission(updated);
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error).message ?? 'Something went wrong');
    }
  }

  function revertGame(gameIndex: number) {
    if (!otherSubmission) return;
    updateGame(gameIndex, toDraft([otherSubmission[gameIndex]])[0]);
    setEditedGameIndexes((prev) => {
      const next = new Set(prev);
      next.delete(gameIndex);
      return next;
    });
  }

  const homePlayers = useMemo(
    () => (match ? players.filter((p) => p.teamId === match.homeTeamId) : []),
    [players, match],
  );
  const awayPlayers = useMemo(
    () => (match ? players.filter((p) => p.teamId === match.awayTeamId) : []),
    [players, match],
  );
  const playerName = (id: string) => players.find((p) => p.id === id)?.name ?? '?';

  const allComplete = games.every(isGameComplete);

  function updateGame(index: number, patch: Partial<DraftGame>) {
    setGames((prev) => prev.map((g, i) => (i === index ? { ...g, ...patch } : g)));
  }

  // Which other singles game (if any) a player is already locked into on this side —
  // a player can only appear in one singles game, but can also play in a pairs game.
  function singlesGameIndexFor(side: MatchSide, playerId: string, excludeGameIndex: number): number {
    const key = side === 'home' ? 'homePlayerIds' : 'awayPlayerIds';
    return games.findIndex((g, i) => i !== excludeGameIndex && g.type === 'singles' && g[key].includes(playerId));
  }

  function togglePlayer(gameIndex: number, side: MatchSide, playerId: string) {
    const game = games[gameIndex];
    const key = side === 'home' ? 'homePlayerIds' : 'awayPlayerIds';
    const current = game[key];
    const max = slotsFor(game.type);

    if (!current.includes(playerId) && game.type === 'singles' && singlesGameIndexFor(side, playerId, gameIndex) !== -1) {
      return; // already playing another singles game on this side
    }

    let next: string[];
    if (current.includes(playerId)) {
      next = current.filter((id) => id !== playerId);
    } else if (current.length < max) {
      next = [...current, playerId];
    } else if (max === 1) {
      next = [playerId];
    } else {
      return; // pairs already has 2 selected — must deselect first
    }
    updateGame(gameIndex, { [key]: next } as Partial<DraftGame>);
  }

  function setScore(gameIndex: number, score: { home: number; away: number }) {
    updateGame(gameIndex, { score });
  }

  // Legs always sum to 3, so cycling one side 0→1→2→3→0 derives the other.
  function cycleScore(gameIndex: number, side: MatchSide) {
    const current = games[gameIndex].score;
    if (side === 'home') {
      const next = ((current?.home ?? -1) + 1) % 4;
      setScore(gameIndex, { home: next, away: 3 - next });
    } else {
      const next = ((current?.away ?? -1) + 1) % 4;
      setScore(gameIndex, { home: 3 - next, away: next });
    }
  }

  // 180s are a plain per-player count — see Issue 6: which leg it happened
  // in was never something any consumer of this data actually needed (see
  // matchResultDraft.ts), just an unnecessary extra decision for the person
  // entering the result. Incrementing adds one entry for this player;
  // decrementing removes the last one — order among a single player's own
  // entries has no meaning, only the count does.
  function incrementOneEighty(gameIndex: number, playerId: string) {
    updateGame(gameIndex, { oneEighties: [...games[gameIndex].oneEighties, playerId] });
  }

  function decrementOneEighty(gameIndex: number, playerId: string) {
    const list = [...games[gameIndex].oneEighties];
    const idx = list.lastIndexOf(playerId);
    if (idx !== -1) list.splice(idx, 1);
    updateGame(gameIndex, { oneEighties: list });
  }

  function openAddCheckout(gameIndex: number) {
    setCheckoutPlayerId(null);
    setCheckoutValue('');
    setCheckoutModal({ gameIndex, editIndex: null });
  }

  function openEditCheckout(gameIndex: number, editIndex: number) {
    const existing = games[gameIndex].highCheckouts[editIndex];
    setCheckoutPlayerId(existing.playerId);
    setCheckoutValue(existing.value);
    setCheckoutModal({ gameIndex, editIndex });
  }

  function saveCheckout() {
    if (!checkoutModal || !checkoutPlayerId || !checkoutValue.trim()) return;
    const { gameIndex, editIndex } = checkoutModal;
    const entry = { playerId: checkoutPlayerId, value: checkoutValue.trim() };
    const list = [...games[gameIndex].highCheckouts];
    if (editIndex === null) list.push(entry); else list[editIndex] = entry;
    updateGame(gameIndex, { highCheckouts: list });
    setCheckoutModal(null);
  }

  function removeCheckout() {
    if (!checkoutModal || checkoutModal.editIndex === null) return;
    const { gameIndex, editIndex } = checkoutModal;
    const list = games[gameIndex].highCheckouts.filter((_, i) => i !== editIndex);
    updateGame(gameIndex, { highCheckouts: list });
    setCheckoutModal(null);
  }

  async function submit() {
    if (!matchId || !myTeamId || !appUser || !allComplete) return;
    setIsSubmitting(true);
    try {
      const finalGames: MatchGame[] = games.map(toMatchGame);
      await setDoc(doc(db, 'matches', matchId, 'submissions', myTeamId), {
        submittedByTeamId: myTeamId,
        submittedByUserId: appUser.uid,
        games: finalGames,
        createdAt: serverTimestamp(),
      });
      setEditing(false);
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Result submitted',
        otherSubmission
          ? "Both teams have now submitted — this will confirm automatically if they match, or go to the admin if they don't."
          : 'Waiting on the other team to submit their result too.',
      );
      goBack();
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error).message ?? 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  }

  function openAdminCorrection() {
    if (!match) return;
    setGames(toDraft(match.games ?? []));
    setAdminCorrecting(true);
    setEditing(true);
  }

  async function saveAdminCorrection() {
    if (!matchId || !allComplete) return;
    setIsSubmitting(true);
    try {
      const finalGames: MatchGame[] = games.map(toMatchGame);
      await updateDoc(doc(db, 'matches', matchId), { games: finalGames });
      setAdminCorrecting(false);
      setEditing(false);
      Alert.alert('Result updated', 'Standings and player stats have been recalculated.');
      goBack();
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error).message ?? 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  }

  // Signs off an awaiting-confirmation match on the teams' behalf, using the
  // already-submitted games unchanged. This goes through the exact same
  // write (status → 'confirmed') a normal auto-confirmation makes, so
  // onMatchConfirmed picks it up and recalculates standings/stats through
  // the normal pipeline — no separate stats path, nothing duplicated here.
  function confirmSignOff() {
    if (!awaitingSubmission) return;
    Alert.alert(
      'Sign off this result?',
      'This confirms the result the team submitted, on their behalf. Standings and player stats will update immediately, the same as if both teams had submitted matching results.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign Off', onPress: signOffMatch },
      ],
    );
  }

  async function signOffMatch() {
    if (!matchId || !awaitingSubmission) return;
    setIsSubmitting(true);
    try {
      await updateDoc(doc(db, 'matches', matchId), { status: 'confirmed', games: awaitingSubmission.games });
      Alert.alert('Result confirmed', 'Standings and player stats have been updated.');
      goBack();
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error).message ?? 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  }

  // Returns a fixture to its original unplayed state — distinct from
  // deleting it (confirmDeleteMatch/deleteMatch below): the fixture itself
  // (teams, date, venue, league/season/division) stays, only the result/
  // submission state and its stats/standings contribution are cleared. Goes
  // through the adminResetMatchResult callable rather than a plain client
  // write, since only that callable actually reverses the derived stats —
  // see functions/src/index.ts for why a raw status flip can't safely do it.
  function confirmResetMatch() {
    Alert.alert(
      'Reset this result?',
      "This clears the submitted or confirmed result and any 180/checkout data, reverses its contribution to standings and player stats, and returns the fixture to scheduled with no result. The fixture itself — teams, date, venue — stays exactly as it is. This can't be undone.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset Result', style: 'destructive', onPress: resetMatch },
      ],
    );
  }

  async function resetMatch() {
    if (!matchId) return;
    setIsSubmitting(true);
    try {
      await httpsCallable(functions, 'adminResetMatchResult')({ matchId });
      Alert.alert('Result reset', 'This fixture is back to scheduled with no result.');
      goBack();
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error).message ?? 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  }

  function confirmDeleteMatch() {
    Alert.alert(
      'Delete this fixture',
      "This removes the fixture and its result completely, and reverses its contribution to standings and player stats. This can't be undone.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: deleteMatch },
      ],
    );
  }

  async function deleteMatch() {
    if (!matchId) return;
    try {
      await deleteDoc(doc(db, 'matches', matchId));
      goBack();
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error).message ?? 'Something went wrong');
    }
  }

  // Anyone on either team can view a confirmed match's score card; admins can
  // view (and correct) any match regardless of team.
  const canView = (isHome || isAway || isAdmin) && !!match;
  const title = adminCorrecting ? 'Edit Result' : match?.status === 'confirmed' ? 'Result' : canAct ? 'Enter Result' : 'Match Centre';

  const body = (
    <>

      {loadError ? (
        <View className="p-5">
          <Card tone="coral"><Body tone="coral">{loadError}</Body></Card>
        </View>
      ) : isLoading ? (
        <ActivityIndicator color={RAW.brand} style={{ marginTop: 60 }} />
      ) : !canView ? (
        <View className="p-5">
          <Card className="items-center py-8">
            <Body tone="strong" weight="semibold">You can't view this result</Body>
          </Card>
        </View>
      ) : match!.status === 'confirmed' && !adminCorrecting ? (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 8 }}>
          <MatchHeader match={match!} homeTeamName={homeTeamName} awayTeamName={awayTeamName} />
          <MatchSummary match={match!} playerName={playerName} />
          {isAdmin && (
            <View className="flex-row flex-wrap gap-2.5 mb-4">
              <Button variant="secondary" size="sm" onPress={openAdminCorrection}>Edit Result</Button>
              {canResetMatch(appUser, match) && (
                <Button variant="secondary" size="sm" disabled={isSubmitting} onPress={confirmResetMatch}>Reset Result</Button>
              )}
              <Button variant="danger" size="sm" onPress={confirmDeleteMatch}>Delete Fixture</Button>
            </View>
          )}
          {(match!.games ?? []).map((game, gameIndex) => (
            <GameRow key={gameIndex} game={game} gameIndex={gameIndex} playerName={playerName} />
          ))}
        </ScrollView>
      ) : !editing ? (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 8 }}>
          <MatchHeader match={match!} homeTeamName={homeTeamName} awayTeamName={awayTeamName} />

          {canAct ? (
            <ActionBanner
              eyebrow={
                mode === 'reconcile' ? 'SUBMISSIONS DON\'T MATCH'
                  : mode === 'review' ? 'RESULT SUBMITTED BY THE OTHER TEAM'
                    : mode === 'waiting' ? 'WAITING ON THE OTHER TEAM'
                      : 'RESULT NOT YET SUBMITTED'
              }
              description={
                mode === 'reconcile'
                  ? (diffGameIndexes.length > 0
                    ? `${diffGameIndexes.length} game${diffGameIndexes.length > 1 ? 's' : ''} don't match the other team's submission. Check each one — adopt their version if they're right, or leave it for the admin to resolve.`
                    : 'Both submissions match — this should confirm automatically any moment.')
                  : mode === 'review'
                    ? 'Review it below — anything you don\'t flag is treated as agreed.'
                    : mode === 'waiting'
                      ? 'You have a saved submission for this match.'
                      : '7 games · 5 singles, 2 pairs · enter the legs score for each.'
              }
              buttonLabel={mode === 'review' ? 'Review Result' : mode === 'reconcile' ? 'Resolve Differences' : mode === 'waiting' ? 'Edit Result' : 'Enter Result'}
              onPress={() => setEditing(true)}
              tone={mode === 'reconcile' ? 'coral' : mode === 'review' ? 'butter' : 'brand'}
            />
          ) : canSignOffMatch(appUser, match) ? (
            isLoadingAwaitingSubmission ? (
              <ActivityIndicator color={RAW.brand} style={{ marginTop: 20 }} />
            ) : !awaitingSubmission ? (
              <Card tone="coral" className="mb-4">
                <Body size="sm">No submission found for this match yet.</Body>
              </Card>
            ) : (
              <>
                <Card tone="butter" className="mb-4">
                  <Caption className="mb-1">Admin Sign-Off</Caption>
                  <Body size="sm">
                    {awaitingSubmission.teamId === match!.homeTeamId ? homeTeamName : awayTeamName} submitted this
                    result and the other team hasn't responded. As a league admin, you can sign off on their behalf
                    to confirm it.
                  </Body>
                </Card>
                {awaitingSubmission.games.map((game, gameIndex) => (
                  <GameRow key={gameIndex} game={game} gameIndex={gameIndex} playerName={playerName} />
                ))}
                <Button
                  className="mb-2"
                  disabled={isSubmitting}
                  loading={isSubmitting}
                  onPress={confirmSignOff}
                >
                  Sign Off Result (Admin)
                </Button>
                {/* Covers the common real case behind Issue 5: a captain
                    submitted this result against the WRONG fixture. */}
                <Button variant="ghost" size="sm" disabled={isSubmitting} onPress={confirmResetMatch}>
                  Reset Result Instead
                </Button>
              </>
            )
          ) : isAdmin && match!.status === 'disputed' ? (
            <>
              <ActionBanner
                eyebrow="DISPUTED — ADMIN REVIEW NEEDED"
                description="The two submitted results don't match. Resolve it to confirm the final result."
                buttonLabel="Resolve Dispute"
                onPress={() => router.push(`/(protected)/admin-dispute?matchId=${matchId}`)}
                tone="coral"
              />
              {canResetMatch(appUser, match) && (
                <Button variant="ghost" size="sm" disabled={isSubmitting} onPress={confirmResetMatch}>
                  Reset Result Instead
                </Button>
              )}
            </>
          ) : match!.status === 'disputed' ? (
            // A viewer with no way to act (not this match's captain/VC, not
            // an admin) — still worth telling them something is happening,
            // rather than leaving the "Disputed" badge above unexplained.
            <Card tone="coral" className="mb-4">
              <Caption className="mb-1">Disputed</Caption>
              <Body size="sm">Both teams' submitted results don't match. Their captains or a league admin will sort this out.</Body>
            </Card>
          ) : null}
        </ScrollView>
      ) : mode === 'reconcile' ? (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 8 }}>
          <TouchableOpacity activeOpacity={0.7} onPress={() => setEditing(false)} className="mb-3">
            <Body size="sm">‹ Back to summary</Body>
          </TouchableOpacity>
          <View className="flex-row items-center justify-between mb-4">
            <Body tone="strong" weight="semibold" className="flex-1" numberOfLines={1}>{homeTeamName} vs {awayTeamName}</Body>
            {(isHome || isAway) && <Body size="sm" tone="brand" weight="semibold">You're {isHome ? 'Home' : 'Away'}</Body>}
          </View>
          {diffGameIndexes.length === 0 ? (
            <Body>Everything matches — this should confirm automatically any moment.</Body>
          ) : (
            diffGameIndexes.map((gameIndex) => (
              <View key={gameIndex} className="mb-2">
                <GameRow game={mySubmission![gameIndex]} gameIndex={gameIndex} playerName={playerName} label={`Game ${gameIndex + 1} · Your version`} tone="coral" />
                <GameRow game={otherSubmission![gameIndex]} gameIndex={gameIndex} playerName={playerName} label={`Game ${gameIndex + 1} · Their version`} tone="coral" />
                <Button variant="good" size="sm" className="-mt-1 mb-3.5" onPress={() => adoptTheirVersion(gameIndex)}>Adopt Their Version</Button>
              </View>
            ))
          )}
        </ScrollView>
      ) : (
        <>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 8 }}>
            <View className="flex-row items-center justify-between mb-1">
              <Body tone="strong" className="flex-1" numberOfLines={1}>{homeTeamName} vs {awayTeamName}</Body>
              {(isHome || isAway) && <Body size="sm" tone="brand" weight="semibold">You're {isHome ? 'Home' : 'Away'}</Body>}
            </View>
            <Body size="sm" className="mb-4">
              {games.filter(isGameComplete).length} of {games.length} games complete
            </Body>

            {games.map((game, gameIndex) => {
              const participants = [...game.homePlayerIds, ...game.awayPlayerIds];

              if (mode === 'review' && !editedGameIndexes.has(gameIndex)) {
                return (
                  <View key={gameIndex} className="mb-3.5">
                    <GameRow game={otherSubmission![gameIndex]} gameIndex={gameIndex} playerName={playerName} tone="sage" />
                    <Button
                      variant="danger" size="sm" className="-mt-1.5"
                      onPress={() => setEditedGameIndexes((prev) => new Set(prev).add(gameIndex))}
                    >
                      This isn't right — edit this game
                    </Button>
                  </View>
                );
              }

              return (
                <Card key={gameIndex} className="mb-3.5">
                  <View className="flex-row items-center mb-2.5">
                    <Caption className="flex-1">Game {gameIndex + 1} of {games.length} · {game.type === 'singles' ? 'Singles' : 'Pairs'}</Caption>
                    {isGameComplete(game) && <Badge tone="sage" className="mr-2">Complete</Badge>}
                    {mode === 'review' && editedGameIndexes.has(gameIndex) && (
                      <TouchableOpacity activeOpacity={0.7}
                        onPress={() => revertGame(gameIndex)}
                        className="px-3 py-2 rounded-lg bg-surface-2 dark:bg-surface-2-dark"
                      >
                        <Body size="xs" weight="semibold">Undo</Body>
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Lineup: boxed, clearly tappable name pickers */}
                  <View className="flex-row gap-2.5 mb-3">
                    <TouchableOpacity activeOpacity={0.7}
                      onPress={() => setPicker({ gameIndex, side: 'home' })}
                      className="flex-1 items-start px-3 py-2.5 rounded-xl border border-border dark:border-border-dark bg-surface-2 dark:bg-surface-2-dark"
                    >
                      <Caption className="mb-1">Home</Caption>
                      {game.homePlayerIds.length === 0 ? (
                        <Body size="sm">Tap to pick</Body>
                      ) : (
                        game.homePlayerIds.map((id) => (
                          <Body key={id} tone="strong" weight="semibold">{playerName(id)}</Body>
                        ))
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity activeOpacity={0.7}
                      onPress={() => setPicker({ gameIndex, side: 'away' })}
                      className="flex-1 items-start px-3 py-2.5 rounded-xl border border-border dark:border-border-dark bg-surface-2 dark:bg-surface-2-dark"
                    >
                      <Caption className="mb-1">Away</Caption>
                      {game.awayPlayerIds.length === 0 ? (
                        <Body size="sm">Tap to pick</Body>
                      ) : (
                        game.awayPlayerIds.map((id) => (
                          <Body key={id} tone="strong" weight="semibold">{playerName(id)}</Body>
                        ))
                      )}
                    </TouchableOpacity>
                  </View>

                  {/* Score: big, high-contrast tap boxes */}
                  <Caption className="mb-1.5">Legs (tap to change)</Caption>
                  <View className="flex-row items-center mb-3.5">
                    <Chip selected={!!game.score} tone="sage" onPress={() => cycleScore(gameIndex, 'home')} className="w-14 h-12">
                      <Stat size="md" tone={game.score ? 'sage' : undefined}>{game.score ? game.score.home : '–'}</Stat>
                    </Chip>
                    <Body className="mx-2.5">–</Body>
                    <Chip selected={!!game.score} tone="sage" onPress={() => cycleScore(gameIndex, 'away')} className="w-14 h-12">
                      <Stat size="md" tone={game.score ? 'sage' : undefined}>{game.score ? game.score.away : '–'}</Stat>
                    </Chip>
                  </View>

                  {/* 180s — a plain per-player count (see Issue 6): nothing
                      implies one happened until it's actually recorded, and
                      which leg it happened in is never asked — the persisted
                      data still supports player/season stats correctly (see
                      matchResultDraft.ts's toMatchGame). */}
                  {participants.length > 0 && (
                    <>
                      <Caption className="mb-1.5">180s</Caption>
                      <View className="gap-2 mb-3.5">
                        {participants.map((id) => {
                          const count = game.oneEighties.filter((playerId) => playerId === id).length;
                          return (
                            <View
                              key={id}
                              className="flex-row items-center justify-between px-3.5 py-2.5 rounded-xl bg-surface-2 dark:bg-surface-2-dark"
                            >
                              <Body tone={count > 0 ? 'brand' : 'strong'} weight="semibold" className="flex-1" numberOfLines={1}>
                                {playerName(id)}
                              </Body>
                              <View className="flex-row items-center gap-3">
                                <TouchableOpacity
                                  activeOpacity={0.7}
                                  disabled={count === 0}
                                  onPress={() => decrementOneEighty(gameIndex, id)}
                                  hitSlop={8}
                                  className={[
                                    'w-8 h-8 rounded-full items-center justify-center bg-surface dark:bg-surface-dark',
                                    count === 0 ? 'opacity-30' : '',
                                  ].join(' ')}
                                >
                                  <Body tone="dim" weight="bold">−</Body>
                                </TouchableOpacity>
                                <Stat size="sm" tone={count > 0 ? 'brand' : undefined} className="w-5 text-center">{count}</Stat>
                                <TouchableOpacity
                                  activeOpacity={0.7}
                                  onPress={() => incrementOneEighty(gameIndex, id)}
                                  hitSlop={8}
                                  className="w-8 h-8 rounded-full items-center justify-center bg-brand-fill dark:bg-brand-fill-dark"
                                >
                                  <Body tone="brand" weight="bold">+</Body>
                                </TouchableOpacity>
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    </>
                  )}

                  {/* High checkouts — who and how much, no leg to pick (see
                      Issue 6). Still capped at LEGS_PER_GAME entries, since a
                      game only has that many legs to check out in. */}
                  <Caption className="mb-1.5">High checkouts</Caption>
                  <View className="flex-row flex-wrap gap-2">
                    {/* Selected/recorded state — Chip's default tone
                        (brand) already gives the same "selected = accent"
                        treatment as the 180 counter above, not amber. */}
                    {game.highCheckouts.map((hc, i) => (
                      <Chip
                        key={i}
                        selected
                        onPress={() => openEditCheckout(gameIndex, i)}
                        label={`${playerName(hc.playerId)} — ${hc.value}`}
                      />
                    ))}
                    {participants.length > 0 && game.highCheckouts.length < LEGS_PER_GAME && (
                      <Chip onPress={() => openAddCheckout(gameIndex)} label="+ Add high checkout" />
                    )}
                  </View>
                </Card>
              );
            })}
          </ScrollView>

          {/* Bottom bar */}
          <View className="flex-row gap-2.5 p-5 pt-2">
            <Button variant="ghost" className="flex-1" onPress={() => { setEditing(false); setAdminCorrecting(false); }}>Cancel</Button>
            <Button
              className="flex-1"
              disabled={!allComplete || isSubmitting}
              loading={isSubmitting}
              onPress={adminCorrecting ? saveAdminCorrection : submit}
            >
              {adminCorrecting ? 'Save Correction' : 'Submit Result'}
            </Button>
          </View>
        </>
      )}

      {/* Player picker modal */}
      <Sheet visible={!!picker} onClose={() => setPicker(null)}>
        <Heading className="mb-1">{picker?.side === 'home' ? homeTeamName : awayTeamName}</Heading>
        <Body size="sm" className="mb-4">
          {picker && games[picker.gameIndex].type === 'singles' ? 'Pick 1 player' : 'Pick 2 players'}
        </Body>
        <ScrollView style={{ maxHeight: 320 }}>
          {picker && (picker.side === 'home' ? homePlayers : awayPlayers).map((p) => {
            const game = games[picker.gameIndex];
            const selected = (picker.side === 'home' ? game.homePlayerIds : game.awayPlayerIds).includes(p.id);
            const lockedInGame = !selected && game.type === 'singles'
              ? singlesGameIndexFor(picker.side, p.id, picker.gameIndex)
              : -1;
            const disabled = lockedInGame !== -1;
            return (
              <TouchableOpacity activeOpacity={0.7}
                key={p.id}
                onPress={() => togglePlayer(picker.gameIndex, picker.side, p.id)}
                disabled={disabled}
                className={[
                  'flex-row items-center min-h-[48px] p-3.5 rounded-xl mb-2',
                  selected ? 'bg-brand-fill dark:bg-brand-fill-dark' : 'bg-surface-2 dark:bg-surface-2-dark',
                  disabled ? 'opacity-40' : '',
                ].join(' ')}
              >
                <Body tone={selected ? 'brand' : 'strong'} weight="semibold" className="flex-1">{p.name}</Body>
                {disabled && <Body size="xs">Playing Game {lockedInGame + 1}</Body>}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <Button className="mt-4" onPress={() => setPicker(null)}>Done</Button>
      </Sheet>

      {/* High checkout modal */}
      <Sheet visible={!!checkoutModal} onClose={() => setCheckoutModal(null)}>
        <Heading className="mb-4">High Checkout</Heading>
        <Label>Player</Label>
        <View className="flex-row flex-wrap gap-1.5 mb-4">
          {checkoutModal && [...games[checkoutModal.gameIndex].homePlayerIds, ...games[checkoutModal.gameIndex].awayPlayerIds].map((id) => (
            <Chip
              key={id}
              label={playerName(id)}
              selected={checkoutPlayerId === id}
              onPress={() => setCheckoutPlayerId(id)}
            />
          ))}
        </View>
        {!checkoutPlayerId && (
          <Body size="sm" tone="dim" className="mb-3 -mt-2">Pick who hit this checkout before saving.</Body>
        )}
        <Label>Checkout (free text, e.g. "121")</Label>
        <Input
          value={checkoutValue}
          onChangeText={setCheckoutValue}
          placeholder="e.g. 121"
          className="mb-5"
        />
        <View className="flex-row gap-2.5">
          <Button variant="ghost" className="flex-1" onPress={() => setCheckoutModal(null)}>Cancel</Button>
          {checkoutModal?.editIndex !== null && (
            <Button variant="danger" className="flex-1" onPress={removeCheckout}>Remove</Button>
          )}
          <Button className="flex-1" disabled={!checkoutPlayerId || !checkoutValue.trim()} onPress={saveCheckout}>Save</Button>
        </View>
      </Sheet>
    </>
  );

  if (isAdmin && isDesktop) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <AdminShell
          title={title}
          breadcrumb={[
            { label: 'Dashboard', path: '/(protected)/(tabs)/admin' },
            { label: 'Results' },
          ]}
        >
          <View style={{ maxWidth: 900 }}>{body}</View>
        </AdminShell>
      </>
    );
  }

  return (
    <Screen scroll={false} header={<AppBar title={title} />}>
      <Stack.Screen options={{ headerShown: false }} />
      {body}
    </Screen>
  );
}
