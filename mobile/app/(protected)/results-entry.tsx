import { useState, useEffect, useMemo } from 'react';
import { View, TouchableOpacity, ScrollView, ActivityIndicator, Platform, useWindowDimensions } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import {
  collection, doc, onSnapshot, query, where, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, runTransaction,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { goBack } from '@/lib/navigation';
import { canSignOffMatch, canResetMatch, canActOnPendingConfirmation } from '@/lib/matchPermissions';
import { DuplicatePlayerNameError, playerDocId } from '@/lib/players';
import { RAW } from '@/lib/theme';
import {
  Screen, Heading, Body, Caption, Stat, Badge, Button, Card, Chip, Input, Label, Sheet, AppBar, ConfirmDialog,
} from '@/components/ui';
import { AdminShell } from '@/components/admin/AdminShell';
import {
  MatchHeader, MatchSummary, GameRow, ActionBanner, VenueCard, OppositionCard, TeamContactsCard,
} from '@/components/MatchCentre';
import {
  LEGS_PER_GAME, blankGames, toDraft, toMatchGame, slotsFor, isGameComplete, scoresAgree, mergeSubmissionGames,
  type DraftGame,
} from '@/lib/matchResultDraft';
import type { Match, MatchGame, MatchSide, Team } from '@/types';

// The subset of Team fields the Matchday Details venue/contacts cards need —
// address/captain/VC reference info an admin seeds (scripts/real-team-
// contacts-seed), distinct from the self-reported AppUser.phone/
// phoneVisibility NextMatchHero already shows elsewhere.
type TeamContactInfo = Pick<Team, 'address' | 'captainName' | 'captainPhone' | 'viceCaptainName' | 'viceCaptainPhone'>;

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
  // Matchday Details — venue/address + captain/VC reference contact info for
  // both teams, loaded alongside the names above from the same two reads.
  const [homeTeamInfo, setHomeTeamInfo] = useState<TeamContactInfo | null>(null);
  const [awayTeamInfo, setAwayTeamInfo] = useState<TeamContactInfo | null>(null);
  const [divisionName, setDivisionName] = useState<string | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [mySubmission, setMySubmission] = useState<MatchGame[] | null>(null);
  // Existence only — under the own-team-only model a captain never reads or
  // displays the OTHER team's submitted players/stats at all, only whether
  // they've submitted yet (for the "waiting on them" vs "not yet submitted"
  // messaging below).
  const [otherTeamHasSubmitted, setOtherTeamHasSubmitted] = useState(false);
  // The single team submission an admin is being asked to sign off on
  // (awaiting_confirmation means exactly one side has submitted). Loaded
  // separately from mySubmission above, which only ever populates for a
  // viewer on one of the two teams — a pure admin (no team) never triggers
  // that effect, so this match's submission was previously never fetched for
  // them at all.
  const [awaitingSubmission, setAwaitingSubmission] = useState<{ teamId: string; games: MatchGame[] } | null>(null);
  // Set instead of awaitingSubmission when BOTH teams' raw submissions
  // already exist while the match doc still reads 'awaiting_confirmation' —
  // an invariant the server's own onSubmissionWrite is supposed to prevent
  // (it should have already merged both into match.games and moved the
  // status on to pending_confirmation), but one a client load can still
  // observe for a moment (trigger latency) or, if that trigger run ever
  // failed, indefinitely. Either way, a raw single-sided submission must
  // never be shown once both sides are actually in — see bug report: the
  // admin-override view was unconditionally preferring homeSnap's raw data
  // whenever it existed, even when awaySnap existed too.
  const [bothSubmittedPreview, setBothSubmittedPreview] = useState<{ agree: true; games: MatchGame[] } | { agree: false } | null>(null);
  const [isLoadingAwaitingSubmission, setIsLoadingAwaitingSubmission] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [adminCorrecting, setAdminCorrecting] = useState(false);
  const [games, setGames] = useState<DraftGame[]>(blankGames());
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Inline error for Submit Result / Save Correction (shown in the bottom
  // bar) — these share one state since only one of the two is ever active
  // at a time (adminCorrecting gates which).
  const [editingError, setEditingError] = useState<string | null>(null);
  // Post-submit acknowledgment: Alert.alert's success message was a no-op on
  // web (and raced with the goBack() that followed it even on native) — this
  // Sheet replaces both, waiting for the user to tap Done before navigating
  // away.
  const [postSubmitSuccess, setPostSubmitSuccess] = useState<{ title: string; message: string } | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  // player-picker modal
  const [picker, setPicker] = useState<{ gameIndex: number; side: MatchSide } | null>(null);

  // "+ Add Player" inline within the picker modal — own team's roster only
  // (see firestore.rules' players/{playerId} create rule: a captain/VC may
  // only ever create a player on their OWN team).
  const [showAddPlayerInPicker, setShowAddPlayerInPicker] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [isAddingPlayer, setIsAddingPlayer] = useState(false);
  const [addPlayerError, setAddPlayerError] = useState<string | null>(null);

  // high-checkout modal (add new, or edit an existing entry) for a given game
  const [checkoutModal, setCheckoutModal] = useState<{ gameIndex: number; editIndex: number | null } | null>(null);
  const [checkoutPlayerId, setCheckoutPlayerId] = useState<string | null>(null);
  const [checkoutValue, setCheckoutValue] = useState('');

  // Per-team confirmation state, once pending_confirmation.
  const [homeConfirmed, setHomeConfirmed] = useState(false);
  const [awayConfirmed, setAwayConfirmed] = useState(false);

  // Confirmation-dialog visibility for the four Alert.alert-based confirm
  // flows on this screen (Dispute, Admin Override, Reset Result, Delete
  // Fixture) — see ConfirmDialog for why these can no longer be plain
  // Alert.alert calls.
  const [disputeDialogOpen, setDisputeDialogOpen] = useState(false);
  const [overrideDialogOpen, setOverrideDialogOpen] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  // Captured when the Admin Override dialog opens, rather than read live from
  // awaitingSubmission/match at render time — a successful override write
  // flips match.status away from awaiting_confirmation almost immediately
  // (live onSnapshot), which clears awaitingSubmission while the dialog's own
  // success screen is still meant to be showing.
  const [overrideMissingTeamName, setOverrideMissingTeamName] = useState('');

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
  // Which side of the game board is "mine" for scoping stat entry (180s/
  // checkouts) and Add Player to my own team only — see MatchSide usages
  // below. Undefined for a viewer on neither team (they never reach the
  // entry form at all — canAct is false — so this only matters when set).
  const myTeamSide: MatchSide | null = isHome ? 'home' : isAway ? 'away' : null;
  const myConfirmed = isHome ? homeConfirmed : isAway ? awayConfirmed : false;

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
        setHomeTeamInfo(homeSnap.exists() ? (homeSnap.data() as TeamContactInfo) : null);
        setAwayTeamInfo(awaySnap.exists() ? (awaySnap.data() as TeamContactInfo) : null);
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

  // Division name for the Matchday Details "Match" section — one-time read,
  // same pattern team-profile.tsx already uses (this data essentially never
  // changes).
  useEffect(() => {
    if (!match?.divisionId) { setDivisionName(null); return; }
    getDoc(doc(db, 'divisions', match.divisionId)).then((s) => setDivisionName(s.exists() ? s.data().name : null));
  }, [match?.divisionId]);

  // Load our own existing submission (for edit) — own-team-only model, so
  // the other team's submission content is never fetched or displayed here,
  // only whether it exists yet (for the "waiting on them" messaging below).
  useEffect(() => {
    if (!matchId || !myTeamId || !match) return;
    const otherTeamId = isHome ? match.awayTeamId : match.homeTeamId;

    getDoc(doc(db, 'matches', matchId, 'submissions', myTeamId)).then((mySnap) => {
      const myGames = mySnap.exists() ? (mySnap.data().games as MatchGame[]) : null;
      if (myGames) { setMySubmission(myGames); setGames(toDraft(myGames)); }

      getDoc(doc(db, 'matches', matchId, 'submissions', otherTeamId)).then((otherSnap) => {
        setOtherTeamHasSubmitted(otherSnap.exists());
      });
    });
  }, [matchId, myTeamId, match, isHome]);

  // Live per-team confirmation status once the match has reconciled. Gated
  // to viewers who are actually allowed to read this subcollection
  // (firestore.rules: admin, or a member of one of the two teams) — a
  // player on an unrelated team never attempts this read at all, matching
  // the same gating the submissions effect above already uses.
  useEffect(() => {
    if (!matchId || !match || match.status !== 'pending_confirmation' || !(myTeamId || isAdmin)) {
      setHomeConfirmed(false);
      setAwayConfirmed(false);
      return;
    }
    const unsubHome = onSnapshot(
      doc(db, 'matches', matchId, 'confirmations', match.homeTeamId),
      (snap) => setHomeConfirmed(snap.exists()),
    );
    const unsubAway = onSnapshot(
      doc(db, 'matches', matchId, 'confirmations', match.awayTeamId),
      (snap) => setAwayConfirmed(snap.exists()),
    );
    return () => { unsubHome(); unsubAway(); };
  }, [matchId, match?.status, match?.homeTeamId, match?.awayTeamId, myTeamId, isAdmin]);

  // Load the single submitted team's result for an admin who can sign this
  // match off — gated by the same helper firestore.rules enforces, so this
  // never fetches (or offers sign-off) for a match outside the admin's league
  // or one that isn't actually awaiting confirmation.
  useEffect(() => {
    if (!matchId || !match || !canSignOffMatch(appUser, match)) {
      setAwaitingSubmission(null);
      setBothSubmittedPreview(null);
      return;
    }
    setIsLoadingAwaitingSubmission(true);
    Promise.all([
      getDoc(doc(db, 'matches', matchId, 'submissions', match.homeTeamId)),
      getDoc(doc(db, 'matches', matchId, 'submissions', match.awayTeamId)),
    ]).then(([homeSnap, awaySnap]) => {
      if (homeSnap.exists() && awaySnap.exists()) {
        // Both teams have genuinely submitted — never show either one's raw
        // submission (this is no longer the single-missing-side case Admin
        // Override exists for). Show the same merged record
        // pending_confirmation would, read-only, so an admin can never sign
        // off an incomplete one-sided record while both sides are actually
        // in.
        const homeGames = homeSnap.data().games as MatchGame[];
        const awayGames = awaySnap.data().games as MatchGame[];
        setAwaitingSubmission(null);
        setBothSubmittedPreview(
          scoresAgree(homeGames, awayGames)
            ? { agree: true, games: mergeSubmissionGames(homeGames, awayGames) }
            : { agree: false },
        );
      } else {
        const submitted = homeSnap.exists()
          ? { teamId: match.homeTeamId, games: homeSnap.data().games as MatchGame[] }
          : awaySnap.exists()
            ? { teamId: match.awayTeamId, games: awaySnap.data().games as MatchGame[] }
            : null;
        setAwaitingSubmission(submitted);
        setBothSubmittedPreview(null);
      }
      setIsLoadingAwaitingSubmission(false);
    });
  }, [matchId, match, appUser]);

  // Own-team-only model: there's nothing to "review" or "reconcile" against
  // on this screen anymore — the server does all pairing/score comparison
  // once both own-side submissions exist (handleSubmissionWrite), and a
  // captain only ever sees their OWN side, whether they're entering it for
  // the first time or editing an existing submission.
  const hasSubmitted = !!mySubmission;

  const homePlayers = useMemo(
    () => (match ? players.filter((p) => p.teamId === match.homeTeamId) : []),
    [players, match],
  );
  const awayPlayers = useMemo(
    () => (match ? players.filter((p) => p.teamId === match.awayTeamId) : []),
    [players, match],
  );
  const playerName = (id: string) => players.find((p) => p.id === id)?.name ?? '?';

  // Admin correction edits the full merged record (both sides); a captain's
  // own submission only ever needs their own side filled in.
  const allComplete = games.every((g) => isGameComplete(g, adminCorrecting ? undefined : myTeamSide ?? undefined));

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
    // Defense in depth — the picker itself is already disabled for the
    // opponent's side (own-team-only model), but this must never silently
    // let a captain's own submission populate the other side even if called
    // some other way.
    if (!adminCorrecting && side !== myTeamSide) return;
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

  // Same write captains.tsx's own "+ Add Player" makes, verbatim — a real,
  // permanent, unclaimed roster player (never a temporary match-only one),
  // which later becomes selectable and, separately, claimable by a real
  // account through the existing join/claim flow. firestore.rules already
  // permits this exact write for a captain/VC on their OWN team only — see
  // the picker Sheet's own myTeamSide gate above for the client-side half.
  async function addPlayerFromPicker() {
    const trimmedName = newPlayerName.trim();
    if (!trimmedName || !myTeamId || !appUser?.leagueId || !picker) return;
    setIsAddingPlayer(true);
    setAddPlayerError(null);
    try {
      const ref = doc(db, 'players', playerDocId(myTeamId, trimmedName));
      // Transaction (not a plain create) so the same-name check and the
      // write are atomic — see players.ts: two concurrent adds for the same
      // normalized name resolve to the identical document, so Firestore
      // itself rejects whichever transaction loses the race, rather than a
      // separate query-then-write that both could pass.
      await runTransaction(db, async (tx) => {
        const existing = await tx.get(ref);
        if (existing.exists()) throw new DuplicatePlayerNameError(trimmedName);
        tx.set(ref, {
          name: trimmedName,
          leagueId: appUser.leagueId,
          teamId: myTeamId,
          claimedByUserId: null,
          claimedAt: null,
          createdAt: serverTimestamp(),
          createdByUserId: appUser.uid,
        });
      });
      // Optimistic insert so the new player is selectable immediately,
      // without waiting on the players onSnapshot round-trip — it gets
      // superseded by that listener's next (identical) update regardless.
      setPlayers((prev) => [...prev, { id: ref.id, name: trimmedName, teamId: myTeamId }]
        .sort((a, b) => a.name.localeCompare(b.name)));
      togglePlayer(picker.gameIndex, picker.side, ref.id);
      setNewPlayerName('');
      setShowAddPlayerInPicker(false);
    } catch (e: unknown) {
      setAddPlayerError(e instanceof DuplicatePlayerNameError ? e.message : (e as Error).message ?? 'Something went wrong');
    } finally {
      setIsAddingPlayer(false);
    }
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
    setEditingError(null);
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
      setPostSubmitSuccess({
        title: 'Result submitted',
        message: otherTeamHasSubmitted
          ? "Both teams have now submitted — if the scores match, you'll both be asked to confirm the reconciled sheet. If they don't, it'll be flagged for the admin."
          : 'Waiting on the other team to submit their result too.',
      });
    } catch (e: unknown) {
      setEditingError((e as Error).message ?? 'Something went wrong');
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
    setEditingError(null);
    try {
      const finalGames: MatchGame[] = games.map(toMatchGame);
      await updateDoc(doc(db, 'matches', matchId), { games: finalGames, confirmedVia: 'adminOverride' });
      setAdminCorrecting(false);
      setEditing(false);
      setPostSubmitSuccess({ title: 'Result updated', message: 'Standings and player stats have been recalculated.' });
    } catch (e: unknown) {
      setEditingError((e as Error).message ?? 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  }

  // Admin Override: confirms an awaiting-confirmation match using only ONE
  // team's submitted sheet — the other team never submitted at all, so
  // there's no reconciliation to do (that's the whole reason this exists:
  // real-world practicality when a captain has no app access or forgets).
  // This is UNILATERAL by nature — the opposite of the normal two-captain
  // Confirm flow — which is exactly why it's labeled Admin Override in the
  // UI and stamped confirmedVia:'adminOverride' for the audit trail, rather
  // than going through matches/{matchId}/confirmations at all. Under the new
  // model this also means the record will have NO stats at all for whichever
  // team never submitted (each submission only ever carries its own team's
  // 180s/checkouts) — the confirmation dialog below says so plainly rather
  // than silently producing an incomplete-looking result. Goes through the
  // exact same write (status → 'confirmed') the two-captain path makes, so
  // onMatchConfirmed picks it up and recalculates standings/stats through
  // the normal pipeline — no separate stats path, nothing duplicated here.
  async function signOffMatch() {
    if (!matchId || !awaitingSubmission) return;
    setIsSubmitting(true);
    try {
      await updateDoc(doc(db, 'matches', matchId), {
        status: 'confirmed', games: awaitingSubmission.games, confirmedVia: 'adminOverride',
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  // Returns a fixture to its original unplayed state — distinct from
  // deleting it (deleteMatch below): the fixture itself
  // (teams, date, venue, league/season/division) stays, only the result/
  // submission state and its stats/standings contribution are cleared. Goes
  // through the adminResetMatchResult callable rather than a plain client
  // write, since only that callable actually reverses the derived stats —
  // see functions/src/index.ts for why a raw status flip can't safely do it.
  async function resetMatch() {
    if (!matchId) return;
    setIsSubmitting(true);
    try {
      await httpsCallable(functions, 'adminResetMatchResult')({ matchId });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function deleteMatch() {
    if (!matchId) return;
    await deleteDoc(doc(db, 'matches', matchId));
  }

  async function confirmMyTeam() {
    if (!matchId || !myTeamId || !appUser) return;
    setIsSubmitting(true);
    setConfirmError(null);
    try {
      await setDoc(doc(db, 'matches', matchId, 'confirmations', myTeamId), {
        confirmedByTeamId: myTeamId,
        confirmedByUserId: appUser.uid,
        createdAt: serverTimestamp(),
      });
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: unknown) {
      setConfirmError((e as Error).message ?? 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function disputeMatchNow() {
    if (!matchId) return;
    setIsSubmitting(true);
    try {
      await httpsCallable(functions, 'disputeMatch')({ matchId });
    } finally {
      setIsSubmitting(false);
    }
  }

  // The 180/checkout entry section for one game, scoped to `ownIds` (my own
  // team's players in this game — see ownParticipants at the call site).
  function renderStatsEntry(gameIndex: number, game: DraftGame, ownIds: string[]) {
    return (
      <>
        {ownIds.length > 0 && (
          <>
            <Caption className="mb-1.5">180s</Caption>
            <View className="gap-2 mb-3.5">
              {ownIds.map((id) => {
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

        <Caption className="mb-1.5">High checkouts</Caption>
        <View className="flex-row flex-wrap gap-2">
          {game.highCheckouts.filter((hc) => ownIds.includes(hc.playerId)).map((hc) => {
            const i = game.highCheckouts.indexOf(hc);
            return (
              <Chip
                key={i}
                selected
                onPress={() => openEditCheckout(gameIndex, i)}
                label={`${playerName(hc.playerId)} — ${hc.value}`}
              />
            );
          })}
          {ownIds.length > 0 && game.highCheckouts.length < LEGS_PER_GAME && (
            <Chip onPress={() => openAddCheckout(gameIndex)} label="+ Add high checkout" />
          )}
        </View>
      </>
    );
  }

  // Anyone on either team can view a confirmed match's score card; admins can
  // view (and correct) any match regardless of team.
  const canView = (isHome || isAway || isAdmin) && !!match;
  const title = adminCorrecting
    ? 'Edit Result'
    : match?.status === 'confirmed' ? 'Result'
      : match?.status === 'pending_confirmation' ? 'Confirm Result'
        : canAct ? 'Enter Result' : 'Match Centre';

  // Matchday Details — Venue/Opposition/Contacts, shown once above whichever
  // status-dependent action area the branches below already render. Venue is
  // always the HOME team's own ground (a fact about the fixture, not the
  // viewer). Opposition/Contacts are relative to the viewer's own side when
  // they have one; a league admin with no team on this match sees both
  // teams' contacts instead of a single "opposition", since there's no
  // natural opponent from a neutral seat — ordinary players never reach this
  // at all (gated by canSeeContacts below).
  const opponentTeamId = isHome ? match?.awayTeamId : isAway ? match?.homeTeamId : null;
  const opponentTeamName = isHome ? awayTeamName : isAway ? homeTeamName : null;
  const opponentTeamInfo = isHome ? awayTeamInfo : isAway ? homeTeamInfo : null;
  const canSeeContacts = canAct || isAdmin;
  const showBothTeamsContacts = isAdmin && !isHome && !isAway;

  const matchdayExtras = match ? (
    <>
      <VenueCard teamName={homeTeamName} address={homeTeamInfo?.address ?? null} />
      {opponentTeamId && opponentTeamName && (
        <OppositionCard teamId={opponentTeamId} teamName={opponentTeamName} address={opponentTeamInfo?.address ?? null} />
      )}
      {canSeeContacts && (
        showBothTeamsContacts ? (
          <>
            <TeamContactsCard
              label={`${homeTeamName} Contacts`}
              captainName={homeTeamInfo?.captainName} captainPhone={homeTeamInfo?.captainPhone}
              viceCaptainName={homeTeamInfo?.viceCaptainName} viceCaptainPhone={homeTeamInfo?.viceCaptainPhone}
            />
            <TeamContactsCard
              label={`${awayTeamName} Contacts`}
              captainName={awayTeamInfo?.captainName} captainPhone={awayTeamInfo?.captainPhone}
              viceCaptainName={awayTeamInfo?.viceCaptainName} viceCaptainPhone={awayTeamInfo?.viceCaptainPhone}
            />
          </>
        ) : opponentTeamInfo && (
          <TeamContactsCard
            label="Opposition Contacts"
            captainName={opponentTeamInfo.captainName} captainPhone={opponentTeamInfo.captainPhone}
            viceCaptainName={opponentTeamInfo.viceCaptainName} viceCaptainPhone={opponentTeamInfo.viceCaptainPhone}
          />
        )
      )}
    </>
  ) : null;

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
          <MatchHeader match={match!} homeTeamName={homeTeamName} awayTeamName={awayTeamName} divisionName={divisionName} viewerSide={myTeamSide} />
          {matchdayExtras}
          <View className="flex-row items-center gap-1.5 mb-3">
            <Body tone="sage" weight="bold">✓ MATCH CONFIRMED</Body>
            {match!.confirmedVia === 'adminOverride' && (
              <Badge tone="butter">Admin Override</Badge>
            )}
          </View>
          <MatchSummary match={match!} playerName={playerName} />
          {isAdmin && (
            <View className="flex-row flex-wrap gap-2.5 mb-4">
              <Button variant="secondary" size="sm" onPress={openAdminCorrection}>Edit Result</Button>
              {canResetMatch(appUser, match) && (
                <Button variant="secondary" size="sm" disabled={isSubmitting} onPress={() => setResetDialogOpen(true)}>Reset Result</Button>
              )}
              <Button variant="danger" size="sm" onPress={() => setDeleteDialogOpen(true)}>Delete Fixture</Button>
            </View>
          )}
          {(match!.games ?? []).map((game, gameIndex) => (
            <GameRow key={gameIndex} game={game} gameIndex={gameIndex} playerName={playerName} />
          ))}
        </ScrollView>
      ) : match!.status === 'pending_confirmation' ? (
        // Both teams' submissions reconciled (pairings + scores agree) and
        // their own-team stats are already merged into match.games — this is
        // the "complete reconciled match sheet" both captains must see before
        // the match becomes officially confirmed. Neither captain's write
        // can set status:'confirmed' directly (see firestore.rules) — this
        // screen only ever creates THIS team's own confirmations doc; the
        // Cloud Function (onConfirmationWrite) is what actually confirms the
        // match once both exist, which then re-renders this same screen into
        // the 'confirmed' branch above via the live match subscription.
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 8 }}>
          <MatchHeader match={match!} homeTeamName={homeTeamName} awayTeamName={awayTeamName} divisionName={divisionName} viewerSide={myTeamSide} />
          {matchdayExtras}
          <MatchSummary match={match!} playerName={playerName} />
          {(match!.games ?? []).map((game, gameIndex) => (
            <GameRow key={gameIndex} game={game} gameIndex={gameIndex} playerName={playerName} />
          ))}

          <Card className="mb-4">
            <Caption className="mb-3">Confirmation</Caption>
            <View className="gap-3">
              {([
                { name: homeTeamName, confirmed: homeConfirmed, mine: isHome },
                { name: awayTeamName, confirmed: awayConfirmed, mine: isAway },
              ] as const).map((team) => (
                <View key={team.name} className="flex-row items-center justify-between">
                  <View className="flex-1">
                    <Body tone="strong" weight="semibold">{team.name}{team.mine ? ' (you)' : ''}</Body>
                    <Body size="xs" tone="dim">✓ Submitted</Body>
                  </View>
                  {team.confirmed ? (
                    <Badge tone="sage">✓ Confirmed</Badge>
                  ) : team.mine && canActOnPendingConfirmation(appUser, match) ? (
                    <Button size="sm" disabled={isSubmitting} loading={isSubmitting} onPress={confirmMyTeam}>
                      Confirm
                    </Button>
                  ) : (
                    <Body size="sm" tone="dim">Awaiting confirmation</Body>
                  )}
                </View>
              ))}
            </View>
            {confirmError && (
              <Card tone="coral" className="mt-3" padded={false}>
                <Body tone="coral" size="sm" className="p-3">{confirmError}</Body>
              </Card>
            )}
          </Card>

          {canActOnPendingConfirmation(appUser, match) && !myConfirmed && (
            <Button variant="ghost" size="sm" disabled={isSubmitting} onPress={() => setDisputeDialogOpen(true)}>
              Something's not right — Dispute
            </Button>
          )}
        </ScrollView>
      ) : !editing ? (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 8 }}>
          <MatchHeader match={match!} homeTeamName={homeTeamName} awayTeamName={awayTeamName} divisionName={divisionName} viewerSide={myTeamSide} />
          {matchdayExtras}

          {canAct ? (
            <ActionBanner
              eyebrow={hasSubmitted ? 'WAITING ON THE OTHER TEAM' : 'RESULT NOT YET SUBMITTED'}
              description={
                hasSubmitted
                  ? (otherTeamHasSubmitted
                    ? "You've both submitted — this'll move to Confirm any moment if the scores match."
                    : 'You have a saved submission for this match.')
                  : '7 games · 5 singles, 2 pairs · enter your own team\'s side and the legs score for each.'
              }
              buttonLabel={hasSubmitted ? 'Edit Result' : 'Enter Result'}
              onPress={() => setEditing(true)}
              tone="brand"
            />
          ) : canSignOffMatch(appUser, match) ? (
            isLoadingAwaitingSubmission ? (
              <ActivityIndicator color={RAW.brand} style={{ marginTop: 20 }} />
            ) : bothSubmittedPreview?.agree ? (
              <>
                {/* Both teams have genuinely submitted and their scores
                    agree — this is the reconciled record, not either side's
                    raw submission (see bothSubmittedPreview above). Read-only:
                    this will finish moving to Pending Confirmation on its own
                    once the backend catches up; refresh if it doesn't. */}
                <Card tone="butter" className="mb-4">
                  <Caption className="mb-1">Both Teams Submitted</Caption>
                  <Body size="sm">
                    Both teams have already submitted and their results match. This reconciled sheet should move to
                    Pending Confirmation automatically — refresh in a moment if it hasn't yet.
                  </Body>
                </Card>
                {bothSubmittedPreview.games.map((game, gameIndex) => (
                  <GameRow key={gameIndex} game={game} gameIndex={gameIndex} playerName={playerName} />
                ))}
              </>
            ) : bothSubmittedPreview ? (
              <Card tone="coral" className="mb-4">
                <Caption className="mb-1">Both Teams Submitted — Scores Don't Match</Caption>
                <Body size="sm">
                  Both teams have submitted, but their reported scores disagree. This should move to Disputed
                  automatically — refresh in a moment if it hasn't yet, or resolve it from there once it does.
                </Body>
              </Card>
            ) : !awaitingSubmission ? (
              <Card tone="coral" className="mb-4">
                <Body size="sm">No submission found for this match yet.</Body>
              </Card>
            ) : (
              <>
                {/* Explicitly labeled Admin Override, not just "confirm" —
                    this is a unilateral admin action using only ONE team's
                    submission, distinct from the normal two-captain Confirm
                    flow (see confirmSignOff/signOffMatch, which stamp
                    confirmedVia:'adminOverride' for the audit trail). */}
                <Card tone="butter" className="mb-4">
                  <Caption className="mb-1">Admin Override</Caption>
                  <Body size="sm">
                    {awaitingSubmission.teamId === match!.homeTeamId ? homeTeamName : awayTeamName} submitted this
                    result and the other team hasn't responded. As a league admin, you can confirm it on their
                    behalf — but since each team only ever submits its own side,
                    {' '}{awaitingSubmission.teamId === match!.homeTeamId ? awayTeamName : homeTeamName}'s players
                    won't appear at all, and they'll have no 180s/checkouts recorded, since they never submitted
                    their own sheet.
                  </Body>
                </Card>
                {awaitingSubmission.games.map((game, gameIndex) => (
                  <GameRow key={gameIndex} game={game} gameIndex={gameIndex} playerName={playerName} />
                ))}
                <Button
                  className="mb-2"
                  disabled={isSubmitting}
                  loading={isSubmitting}
                  onPress={() => {
                    setOverrideMissingTeamName(awaitingSubmission.teamId === match!.homeTeamId ? awayTeamName : homeTeamName);
                    setOverrideDialogOpen(true);
                  }}
                >
                  Confirm (Admin Override)
                </Button>
                {/* Covers the common real case behind Issue 5: a captain
                    submitted this result against the WRONG fixture. */}
                <Button variant="ghost" size="sm" disabled={isSubmitting} onPress={() => setResetDialogOpen(true)}>
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
                <Button variant="ghost" size="sm" disabled={isSubmitting} onPress={() => setResetDialogOpen(true)}>
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
      ) : (
        <>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 8 }}>
            <View className="flex-row items-center justify-between mb-1">
              <Body tone="strong" className="flex-1" numberOfLines={1}>{homeTeamName} vs {awayTeamName}</Body>
              {(isHome || isAway) && <Body size="sm" tone="brand" weight="semibold">You're {isHome ? 'Home' : 'Away'}</Body>}
            </View>
            <Body size="sm" className="mb-4">
              {games.filter((g) => isGameComplete(g, adminCorrecting ? undefined : myTeamSide ?? undefined)).length} of {games.length} games complete
            </Body>

            {games.map((game, gameIndex) => {
              // Stat entry (180s/checkouts) is scoped to MY OWN team's
              // players only — never the opponent's (the server enforces
              // this too; the UI never even offers the control). Admin
              // correction of an already-confirmed match is the one
              // exception: there, the admin is editing the final merged
              // record for both sides, not submitting "as" one team.
              const ownParticipants = adminCorrecting
                ? [...game.homePlayerIds, ...game.awayPlayerIds]
                : myTeamSide === 'home' ? game.homePlayerIds
                  : myTeamSide === 'away' ? game.awayPlayerIds
                    : [];

              return (
                <Card key={gameIndex} className="mb-3.5">
                  <View className="flex-row items-center mb-2.5">
                    <Caption className="flex-1">Game {gameIndex + 1} of {games.length} · {game.type === 'singles' ? 'Singles' : 'Pairs'}</Caption>
                    {isGameComplete(game, adminCorrecting ? undefined : myTeamSide ?? undefined) && <Badge tone="sage" className="mr-2">Complete</Badge>}
                  </View>

                  {/* Lineup: boxed, clearly tappable name pickers. Own-team-
                      only model — a captain can only ever open/edit their OWN
                      side; the opponent's side is entered separately by
                      their own captain and never shown here, even as a
                      placeholder beyond "entered separately". Admin
                      correction is the one exception (editing the full
                      merged record for both sides). */}
                  <View className="flex-row gap-2.5 mb-3">
                    <TouchableOpacity activeOpacity={0.7}
                      disabled={!adminCorrecting && myTeamSide !== 'home'}
                      onPress={() => setPicker({ gameIndex, side: 'home' })}
                      className="flex-1 items-start px-3 py-2.5 rounded-xl border border-border dark:border-border-dark bg-surface-2 dark:bg-surface-2-dark"
                    >
                      <Caption className="mb-1">Home</Caption>
                      {game.homePlayerIds.length === 0 ? (
                        <Body size="sm" tone={!adminCorrecting && myTeamSide !== 'home' ? 'dim' : undefined}>
                          {!adminCorrecting && myTeamSide !== 'home' ? 'Entered separately' : 'Tap to pick'}
                        </Body>
                      ) : (
                        game.homePlayerIds.map((id) => (
                          <Body key={id} tone="strong" weight="semibold">{playerName(id)}</Body>
                        ))
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity activeOpacity={0.7}
                      disabled={!adminCorrecting && myTeamSide !== 'away'}
                      onPress={() => setPicker({ gameIndex, side: 'away' })}
                      className="flex-1 items-start px-3 py-2.5 rounded-xl border border-border dark:border-border-dark bg-surface-2 dark:bg-surface-2-dark"
                    >
                      <Caption className="mb-1">Away</Caption>
                      {game.awayPlayerIds.length === 0 ? (
                        <Body size="sm" tone={!adminCorrecting && myTeamSide !== 'away' ? 'dim' : undefined}>
                          {!adminCorrecting && myTeamSide !== 'away' ? 'Entered separately' : 'Tap to pick'}
                        </Body>
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

                  {/* 180s/checkouts — scoped to my own team's players only
                      (see ownParticipants above and Issue 6 for why no leg
                      is asked). */}
                  {renderStatsEntry(gameIndex, game, ownParticipants)}
                </Card>
              );
            })}
          </ScrollView>

          {/* Bottom bar */}
          {editingError && (
            <View className="px-5">
              <Card tone="coral" padded={false}>
                <Body tone="coral" size="sm" className="p-3">{editingError}</Body>
              </Card>
            </View>
          )}
          <View className="flex-row gap-2.5 p-5 pt-2">
            <Button variant="ghost" className="flex-1" onPress={() => { setEditing(false); setAdminCorrecting(false); setEditingError(null); }}>Cancel</Button>
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
      <Sheet visible={!!picker} onClose={() => { setPicker(null); setAddPlayerError(null); }}>
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

        {/* Add Player — own team's roster only (mirrors captains.tsx's own
            Add Player exactly: a real, permanent, unclaimed roster player,
            never a match-only placeholder — see addPlayerFromPicker). Never
            offered for the opponent's slot (a captain can't create a player
            on a roster that isn't theirs — firestore.rules already refuses
            it) or during admin correction (admin has admin-team.tsx for
            full roster management). */}
        {!adminCorrecting && picker?.side === myTeamSide && (
          showAddPlayerInPicker ? (
            <View className="mt-3">
              <Label>New player name</Label>
              <Input
                value={newPlayerName}
                onChangeText={(text) => { setNewPlayerName(text); setAddPlayerError(null); }}
                placeholder="e.g. Alex Turner"
                autoCapitalize="words"
                autoFocus
                className="mb-3"
              />
              {addPlayerError && (
                <Card tone="coral" className="mb-3">
                  <Body size="sm" tone="coral">{addPlayerError}</Body>
                </Card>
              )}
              <View className="flex-row gap-2.5">
                <Button
                  variant="ghost" className="flex-1"
                  disabled={isAddingPlayer}
                  onPress={() => { setShowAddPlayerInPicker(false); setNewPlayerName(''); setAddPlayerError(null); }}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  disabled={isAddingPlayer || !newPlayerName.trim()}
                  loading={isAddingPlayer}
                  onPress={addPlayerFromPicker}
                >
                  Add
                </Button>
              </View>
            </View>
          ) : (
            <Button variant="secondary" className="mt-3" onPress={() => setShowAddPlayerInPicker(true)}>
              + Add Player
            </Button>
          )
        )}

        <Button className="mt-4" onPress={() => { setPicker(null); setShowAddPlayerInPicker(false); setNewPlayerName(''); setAddPlayerError(null); }}>Done</Button>
      </Sheet>

      {/* High checkout modal */}
      <Sheet visible={!!checkoutModal} onClose={() => setCheckoutModal(null)}>
        <Heading className="mb-4">High Checkout</Heading>
        <Label>Player</Label>
        <View className="flex-row flex-wrap gap-1.5 mb-4">
          {checkoutModal && (
            adminCorrecting
              ? [...games[checkoutModal.gameIndex].homePlayerIds, ...games[checkoutModal.gameIndex].awayPlayerIds]
              : myTeamSide === 'home' ? games[checkoutModal.gameIndex].homePlayerIds
                : myTeamSide === 'away' ? games[checkoutModal.gameIndex].awayPlayerIds
                  : []
          ).map((id) => (
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

      <ConfirmDialog
        visible={disputeDialogOpen}
        title="Dispute this result?"
        message="This flags the match as disputed for a league admin to resolve. Use this if something on the reconciled sheet below doesn't look right."
        confirmLabel="Dispute"
        confirmVariant="danger"
        onConfirm={disputeMatchNow}
        onCancel={() => setDisputeDialogOpen(false)}
        onSuccess={() => setDisputeDialogOpen(false)}
      />

      <ConfirmDialog
        visible={overrideDialogOpen}
        title="Admin Override — confirm this result?"
        message={`This confirms the result on ${overrideMissingTeamName}'s behalf, without their own submission. Standings will update immediately, but any 180s or checkouts by ${overrideMissingTeamName}'s players won't be recorded, since only the other team ever submitted a sheet.`}
        confirmLabel="Yes, Confirm Override"
        successMessage="Standings and player stats have been updated."
        onConfirm={signOffMatch}
        onCancel={() => setOverrideDialogOpen(false)}
        onSuccess={() => { setOverrideDialogOpen(false); goBack(); }}
      />

      <ConfirmDialog
        visible={resetDialogOpen}
        title="Reset this result?"
        message="This clears the submitted or confirmed result and any 180/checkout data, reverses its contribution to standings and player stats, and returns the fixture to scheduled with no result. The fixture itself — teams, date, venue — stays exactly as it is. This can't be undone."
        confirmLabel="Yes, Reset Result"
        confirmVariant="danger"
        successMessage="This fixture is back to scheduled with no result."
        onConfirm={resetMatch}
        onCancel={() => setResetDialogOpen(false)}
        onSuccess={() => { setResetDialogOpen(false); goBack(); }}
      />

      <ConfirmDialog
        visible={deleteDialogOpen}
        title="Delete this fixture"
        message="This removes the fixture and its result completely, and reverses its contribution to standings and player stats. This can't be undone."
        confirmLabel="Yes, Delete Fixture"
        confirmVariant="danger"
        onConfirm={deleteMatch}
        onCancel={() => setDeleteDialogOpen(false)}
        onSuccess={() => { setDeleteDialogOpen(false); goBack(); }}
      />

      <Sheet visible={!!postSubmitSuccess} onClose={() => { setPostSubmitSuccess(null); goBack(); }}>
        <Heading size="lg" className="mb-2">{postSubmitSuccess?.title}</Heading>
        <Body size="sm" className="mb-5">{postSubmitSuccess?.message}</Body>
        <Button className="w-full" onPress={() => { setPostSubmitSuccess(null); goBack(); }}>Done</Button>
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
