import { useState, useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Modal, TextInput, Alert } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import {
  collection, doc, onSnapshot, query, where, getDoc, setDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { goBack } from '@/lib/navigation';
import type { Match, MatchGame, GameType, MatchSide, HighCheckout } from '@/types';
import * as S from '@/styles/common';

interface Player { id: string; name: string; teamId: string }

interface DraftGame {
  order: number;
  type: GameType;
  homePlayerIds: string[];
  awayPlayerIds: string[];
  // Legs won, home–away. Always sums to 3 (all 3 legs are always played).
  score: { home: number; away: number } | null;
  oneEighties: string[]; // playerId per 180 thrown (a player can appear more than once)
  highCheckouts: { playerId: string; value: string }[]; // at most one per leg, so max 3
}

function blankGames(): DraftGame[] {
  return Array.from({ length: 7 }, (_, i) => ({
    order: i + 1,
    type: (i < 5 ? 'singles' : 'pairs') as GameType,
    homePlayerIds: [],
    awayPlayerIds: [],
    score: null,
    oneEighties: [],
    highCheckouts: [],
  }));
}

function toDraft(games: MatchGame[]): DraftGame[] {
  return games.map((g) => ({
    order: g.order,
    type: g.type,
    homePlayerIds: [...g.homePlayerIds],
    awayPlayerIds: [...g.awayPlayerIds],
    score: {
      home: g.legs.filter((l) => l.winner === 'home').length,
      away: g.legs.filter((l) => l.winner === 'away').length,
    },
    oneEighties: g.legs.flatMap((l) => l.oneEighties),
    highCheckouts: g.legs
      .map((l) => l.highCheckout)
      .filter((hc): hc is HighCheckout => hc !== null)
      .map((hc) => ({ ...hc })),
  }));
}

function toMatchGame(g: DraftGame): MatchGame {
  const score = g.score as { home: number; away: number };
  const winners: MatchSide[] = [
    ...Array(score.home).fill('home' as MatchSide),
    ...Array(score.away).fill('away' as MatchSide),
  ];
  return {
    order: g.order,
    type: g.type,
    homePlayerIds: g.homePlayerIds,
    awayPlayerIds: g.awayPlayerIds,
    legs: winners.map((winner, i) => ({
      winner,
      oneEighties: i === 0 ? g.oneEighties : [],
      highCheckout: g.highCheckouts[i] ?? null,
    })),
  };
}

function slotsFor(type: GameType) {
  return type === 'singles' ? 1 : 2;
}

function isGameComplete(game: DraftGame): boolean {
  const need = slotsFor(game.type);
  return (
    game.homePlayerIds.length === need
    && game.awayPlayerIds.length === need
    && game.score !== null
  );
}

function normalizeGameForCompare(g: DraftGame): string {
  return JSON.stringify({
    homePlayerIds: [...g.homePlayerIds].sort(),
    awayPlayerIds: [...g.awayPlayerIds].sort(),
    score: g.score,
    oneEighties: [...g.oneEighties].sort(),
    highCheckouts: [...g.highCheckouts]
      .map((hc) => `${hc.playerId}:${hc.value}`)
      .sort(),
  });
}

export default function ResultsEntryScreen() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const { appUser } = useAuthStore();

  const [match, setMatch] = useState<Match | null>(null);
  const [homeTeamName, setHomeTeamName] = useState('');
  const [awayTeamName, setAwayTeamName] = useState('');
  const [players, setPlayers] = useState<Player[]>([]);
  const [mySubmission, setMySubmission] = useState<MatchGame[] | null>(null);
  const [otherSubmission, setOtherSubmission] = useState<MatchGame[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
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

  function addOneEighty(gameIndex: number, playerId: string) {
    updateGame(gameIndex, { oneEighties: [...games[gameIndex].oneEighties, playerId] });
  }

  function removeOneEighty(gameIndex: number, playerId: string) {
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

  const canEnterResult = (isHome || isAway) && match && match.status !== 'confirmed';

  return (
    <LinearGradient colors={S.GRADIENT} style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          title: 'Enter Result',
          headerLeft: () => (
            <TouchableOpacity onPress={() => goBack()} hitSlop={12} style={{ paddingRight: 12 }}>
              <Text style={{ color: S.WHITE, fontSize: 16 }}>‹ Back</Text>
            </TouchableOpacity>
          ),
        }}
      />

      {loadError ? (
        <View style={{ padding: 20 }}>
          <View style={S.errorBox}>
            <Text style={{ color: S.RED }}>{loadError}</Text>
          </View>
        </View>
      ) : isLoading ? (
        <ActivityIndicator color={S.BLUE} style={{ marginTop: 60 }} />
      ) : !canEnterResult ? (
        <View style={{ padding: 20 }}>
          <BlurView intensity={20} tint="dark" style={{ borderRadius: 16, overflow: 'hidden' }}>
            <View style={[S.glassCard, { alignItems: 'center', paddingVertical: 32 }]}>
              <Text style={{ color: S.WHITE, fontWeight: '600', marginBottom: 4 }}>
                {match?.status === 'confirmed' ? 'Result already confirmed' : "You can't submit this result"}
              </Text>
            </View>
          </BlurView>
        </View>
      ) : !editing ? (
        <ScrollView contentContainerStyle={{ padding: 20 }}>
          <BlurView intensity={20} tint="dark" style={{ borderRadius: 16, overflow: 'hidden', marginBottom: 20 }}>
            <View style={[S.glassCard, { padding: 20 }]}>
              <Text style={{ color: S.WHITE, fontSize: 18, fontWeight: '700', marginBottom: 6 }}>
                {homeTeamName} vs {awayTeamName}
              </Text>
              <Text style={{ color: S.WHITE_50, fontSize: 13, marginBottom: 16 }}>
                7 games · 5 singles, 2 pairs · enter the legs score for each
              </Text>
              {mode === 'reconcile' && diffGameIndexes.length > 0 && (
                <View style={[S.errorBox, { marginBottom: 4 }]}>
                  <Text style={{ color: S.RED, fontSize: 13 }}>
                    {diffGameIndexes.length} game{diffGameIndexes.length > 1 ? 's' : ''} don't match the other team's submission.
                    Check each one — adopt their version if they're right, or leave it for the admin to resolve.
                  </Text>
                </View>
              )}
              {mode === 'reconcile' && diffGameIndexes.length === 0 && (
                <Text style={{ color: S.WHITE_60, fontSize: 13, marginBottom: 4 }}>
                  Both submissions match — this should confirm automatically any moment.
                </Text>
              )}
              {mode === 'review' && (
                <Text style={{ color: S.WHITE_60, fontSize: 13, marginBottom: 4 }}>
                  The other team has submitted a result. Review it below — anything you don't flag is treated as agreed.
                </Text>
              )}
              {mode === 'waiting' && (
                <Text style={{ color: S.WHITE_60, fontSize: 13, marginBottom: 4 }}>
                  You have a saved draft/submission for this match. Waiting on the other team to submit theirs.
                </Text>
              )}
            </View>
          </BlurView>
          <TouchableOpacity
            onPress={() => setEditing(true)}
            style={S.primaryButton}
            activeOpacity={0.8}
          >
            <Text style={S.primaryButtonText}>
              {mode === 'review' ? 'Review Result' : mode === 'reconcile' ? 'Resolve Differences' : mode === 'waiting' ? 'Edit Result' : 'Enter Result'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      ) : mode === 'reconcile' ? (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 8 }}>
          <TouchableOpacity onPress={() => setEditing(false)} style={{ marginBottom: 12 }}>
            <Text style={{ color: S.WHITE_50, fontSize: 13 }}>‹ Back to summary</Text>
          </TouchableOpacity>
          <Text style={{ color: S.WHITE, fontSize: 15, marginBottom: 16 }}>
            {homeTeamName} vs {awayTeamName}
          </Text>
          {diffGameIndexes.length === 0 ? (
            <Text style={{ color: S.WHITE_60 }}>Everything matches — this should confirm automatically any moment.</Text>
          ) : (
            diffGameIndexes.map((gameIndex) => {
              const mine = toDraft([mySubmission![gameIndex]])[0];
              const theirs = toDraft([otherSubmission![gameIndex]])[0];
              return (
                <View
                  key={gameIndex}
                  style={{
                    padding: 14, borderRadius: 12, marginBottom: 14,
                    backgroundColor: 'rgba(255,59,48,0.06)',
                    borderWidth: 1, borderColor: 'rgba(255,59,48,0.3)',
                  }}
                >
                  <Text style={{ color: S.WHITE_50, fontSize: 11, fontWeight: '700', marginBottom: 10 }}>
                    GAME {gameIndex + 1} · {mine.type === 'singles' ? 'SINGLES' : 'PAIRS'}
                  </Text>
                  {[{ label: 'YOUR VERSION', g: mine }, { label: 'THEIR VERSION', g: theirs }].map(({ label, g }) => (
                    <View key={label} style={{ padding: 10, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.05)', marginBottom: 8 }}>
                      <Text style={{ color: S.WHITE_50, fontSize: 10, fontWeight: '700', marginBottom: 4 }}>{label}</Text>
                      <Text style={{ color: S.WHITE, fontSize: 13, marginBottom: 2 }}>
                        {g.homePlayerIds.map(playerName).join(' & ') || '—'} vs {g.awayPlayerIds.map(playerName).join(' & ') || '—'}
                      </Text>
                      <Text style={{ color: S.WHITE_60, fontSize: 12 }}>
                        Legs: {g.score ? `${g.score.home}-${g.score.away}` : '—'}
                        {g.oneEighties.length ? ` · 180s: ${g.oneEighties.map(playerName).join(', ')}` : ''}
                        {g.highCheckouts.length ? ` · Checkouts: ${g.highCheckouts.map((hc) => `${playerName(hc.playerId)} ${hc.value}`).join(', ')}` : ''}
                      </Text>
                    </View>
                  ))}
                  <TouchableOpacity
                    onPress={() => adoptTheirVersion(gameIndex)}
                    style={[S.primaryButton, { paddingVertical: 10 }]}
                  >
                    <Text style={S.primaryButtonText}>Adopt Their Version</Text>
                  </TouchableOpacity>
                </View>
              );
            })
          )}
        </ScrollView>
      ) : (
        <>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 8 }}>
            <Text style={{ color: S.WHITE, fontSize: 15, marginBottom: 16 }}>
              {homeTeamName} vs {awayTeamName}
            </Text>

            {games.map((game, gameIndex) => {
              const participants = [...game.homePlayerIds, ...game.awayPlayerIds];

              if (mode === 'review' && !editedGameIndexes.has(gameIndex)) {
                return (
                  <View
                    key={gameIndex}
                    style={{
                      padding: 14, borderRadius: 12, marginBottom: 14,
                      backgroundColor: 'rgba(52,199,89,0.05)',
                      borderWidth: 1, borderColor: 'rgba(52,199,89,0.3)',
                    }}
                  >
                    <Text style={{ color: S.WHITE_50, fontSize: 11, fontWeight: '700', marginBottom: 8 }}>
                      GAME {gameIndex + 1} · {game.type === 'singles' ? 'SINGLES' : 'PAIRS'}
                    </Text>
                    <Text style={{ color: S.WHITE, fontSize: 14, marginBottom: 2 }}>
                      {game.homePlayerIds.map(playerName).join(' & ') || '—'} vs {game.awayPlayerIds.map(playerName).join(' & ') || '—'}
                    </Text>
                    <Text style={{ color: S.WHITE_80, fontSize: 13, marginBottom: 14 }}>
                      Legs: {game.score ? `${game.score.home}-${game.score.away}` : '—'}
                      {game.oneEighties.length ? ` · 180s: ${game.oneEighties.map(playerName).join(', ')}` : ''}
                      {game.highCheckouts.length ? ` · Checkouts: ${game.highCheckouts.map((hc) => `${playerName(hc.playerId)} ${hc.value}`).join(', ')}` : ''}
                    </Text>
                    <TouchableOpacity
                      onPress={() => setEditedGameIndexes((prev) => new Set(prev).add(gameIndex))}
                      style={{
                        alignSelf: 'flex-start', paddingHorizontal: 14, minHeight: 44, justifyContent: 'center',
                        borderRadius: 10, borderWidth: 1.5, borderColor: S.RED, backgroundColor: 'rgba(255,107,107,0.12)',
                      }}
                    >
                      <Text style={{ color: S.RED, fontSize: 13, fontWeight: '700' }}>This isn't right — edit this game</Text>
                    </TouchableOpacity>
                  </View>
                );
              }

              return (
                <View
                  key={gameIndex}
                  style={{
                    padding: 14, borderRadius: 12, marginBottom: 14,
                    backgroundColor: 'rgba(255,255,255,0.05)',
                    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                    <Text style={{ color: S.WHITE_50, fontSize: 11, fontWeight: '700', flex: 1 }}>
                      GAME {gameIndex + 1} · {game.type === 'singles' ? 'SINGLES' : 'PAIRS'}
                    </Text>
                    {mode === 'review' && editedGameIndexes.has(gameIndex) && (
                      <TouchableOpacity
                        onPress={() => revertGame(gameIndex)}
                        style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.08)' }}
                      >
                        <Text style={{ color: S.WHITE_80, fontSize: 12, fontWeight: '600' }}>Undo</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Lineup: boxed, clearly tappable name pickers */}
                  <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
                    <TouchableOpacity
                      onPress={() => setPicker({ gameIndex, side: 'home' })}
                      style={[S.tapBox, { flex: 1, alignItems: 'flex-start', paddingHorizontal: 12, paddingVertical: 10 }]}
                    >
                      <Text style={{ color: S.WHITE_60, fontSize: 11, fontWeight: '700', marginBottom: 4 }}>HOME</Text>
                      {game.homePlayerIds.length === 0 ? (
                        <Text style={{ color: S.WHITE_80, fontSize: 14 }}>Tap to pick</Text>
                      ) : (
                        game.homePlayerIds.map((id) => (
                          <Text key={id} style={{ color: S.WHITE, fontSize: 14, fontWeight: '600' }}>{playerName(id)}</Text>
                        ))
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => setPicker({ gameIndex, side: 'away' })}
                      style={[S.tapBox, { flex: 1, alignItems: 'flex-start', paddingHorizontal: 12, paddingVertical: 10 }]}
                    >
                      <Text style={{ color: S.WHITE_60, fontSize: 11, fontWeight: '700', marginBottom: 4 }}>AWAY</Text>
                      {game.awayPlayerIds.length === 0 ? (
                        <Text style={{ color: S.WHITE_80, fontSize: 14 }}>Tap to pick</Text>
                      ) : (
                        game.awayPlayerIds.map((id) => (
                          <Text key={id} style={{ color: S.WHITE, fontSize: 14, fontWeight: '600' }}>{playerName(id)}</Text>
                        ))
                      )}
                    </TouchableOpacity>
                  </View>

                  {/* Score: big, high-contrast tap boxes */}
                  <Text style={{ color: S.WHITE_60, fontSize: 11, fontWeight: '700', marginBottom: 6 }}>LEGS (TAP TO CHANGE)</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
                    <TouchableOpacity
                      onPress={() => cycleScore(gameIndex, 'home')}
                      style={[S.tapBox, { width: 56, height: 48 }, !!game.score && { borderColor: S.GREEN, backgroundColor: 'rgba(52,199,89,0.18)' }]}
                    >
                      <Text style={{ color: game.score ? S.GREEN : S.WHITE_80, fontWeight: '700', fontSize: 20 }}>
                        {game.score ? game.score.home : '–'}
                      </Text>
                    </TouchableOpacity>
                    <Text style={{ color: S.WHITE_50, marginHorizontal: 10, fontSize: 16 }}>–</Text>
                    <TouchableOpacity
                      onPress={() => cycleScore(gameIndex, 'away')}
                      style={[S.tapBox, { width: 56, height: 48 }, !!game.score && { borderColor: S.GREEN, backgroundColor: 'rgba(52,199,89,0.18)' }]}
                    >
                      <Text style={{ color: game.score ? S.GREEN : S.WHITE_80, fontWeight: '700', fontSize: 20 }}>
                        {game.score ? game.score.away : '–'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* 180s */}
                  {participants.length > 0 && (
                    <>
                      <Text style={{ color: S.WHITE_60, fontSize: 11, fontWeight: '700', marginBottom: 6 }}>180s (tap to add, tap − to remove)</Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                        {participants.map((id) => {
                          const count = game.oneEighties.filter((x) => x === id).length;
                          const active = count > 0;
                          return (
                            <View
                              key={id}
                              style={[
                                S.tapBox,
                                { flexDirection: 'row', minHeight: 44, paddingLeft: 4 },
                                active && S.tapBoxSelected,
                              ]}
                            >
                              <TouchableOpacity
                                onPress={() => addOneEighty(gameIndex, id)}
                                style={{ paddingHorizontal: 10, paddingVertical: 10 }}
                              >
                                <Text style={{ color: active ? S.WHITE : S.WHITE_80, fontSize: 13, fontWeight: '600' }}>
                                  {playerName(id)}{active ? ` × ${count}` : ''}
                                </Text>
                              </TouchableOpacity>
                              {active && (
                                <TouchableOpacity
                                  onPress={() => removeOneEighty(gameIndex, id)}
                                  hitSlop={8}
                                  style={{ paddingHorizontal: 12, paddingVertical: 10, borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.2)' }}
                                >
                                  <Text style={{ color: S.WHITE, fontSize: 14, fontWeight: '700' }}>−</Text>
                                </TouchableOpacity>
                              )}
                            </View>
                          );
                        })}
                      </View>
                    </>
                  )}

                  {/* High checkouts */}
                  <Text style={{ color: S.WHITE_60, fontSize: 11, fontWeight: '700', marginBottom: 6 }}>HIGH CHECKOUTS</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {game.highCheckouts.map((hc, i) => (
                      <TouchableOpacity
                        key={i}
                        onPress={() => openEditCheckout(gameIndex, i)}
                        style={[S.tapBox, { paddingHorizontal: 12, borderColor: S.ORANGE, backgroundColor: 'rgba(255,149,0,0.16)' }]}
                      >
                        <Text style={{ color: S.ORANGE, fontSize: 13, fontWeight: '600' }}>
                          {playerName(hc.playerId)} — {hc.value}
                        </Text>
                      </TouchableOpacity>
                    ))}
                    {participants.length > 0 && game.highCheckouts.length < 3 && (
                      <TouchableOpacity
                        onPress={() => openAddCheckout(gameIndex)}
                        style={[S.tapBox, { paddingHorizontal: 12 }]}
                      >
                        <Text style={{ color: S.WHITE_80, fontSize: 13, fontWeight: '600' }}>+ Add high checkout</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}
          </ScrollView>

          {/* Bottom bar */}
          <View style={{ flexDirection: 'row', gap: 10, padding: 20, paddingTop: 8 }}>
            <TouchableOpacity
              onPress={() => setEditing(false)}
              style={{
                flex: 1, padding: 14, borderRadius: 12, alignItems: 'center',
                backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)',
              }}
            >
              <Text style={{ color: S.WHITE_80, fontWeight: '600' }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={submit}
              disabled={!allComplete || isSubmitting}
              style={[allComplete && !isSubmitting ? S.primaryButton : S.primaryButtonDisabled, { flex: 1 }]}
            >
              {isSubmitting ? <ActivityIndicator color={S.WHITE} /> : <Text style={S.primaryButtonText}>Submit Result</Text>}
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* Player picker modal */}
      <Modal visible={!!picker} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', padding: 24 }}>
          <BlurView intensity={30} tint="dark" style={{ borderRadius: 20, overflow: 'hidden', maxHeight: '75%' }}>
            <View style={S.glassCard}>
              <Text style={{ color: S.WHITE, fontSize: 18, fontWeight: '700', marginBottom: 4 }}>
                {picker?.side === 'home' ? homeTeamName : awayTeamName}
              </Text>
              <Text style={{ color: S.WHITE_50, fontSize: 12, marginBottom: 16 }}>
                {picker && games[picker.gameIndex].type === 'singles' ? 'Pick 1 player' : 'Pick 2 players'}
              </Text>
              <ScrollView style={{ maxHeight: 320 }}>
                {picker && (picker.side === 'home' ? homePlayers : awayPlayers).map((p) => {
                  const game = games[picker.gameIndex];
                  const selected = (picker.side === 'home' ? game.homePlayerIds : game.awayPlayerIds).includes(p.id);
                  const lockedInGame = !selected && game.type === 'singles'
                    ? singlesGameIndexFor(picker.side, p.id, picker.gameIndex)
                    : -1;
                  const disabled = lockedInGame !== -1;
                  return (
                    <TouchableOpacity
                      key={p.id}
                      onPress={() => togglePlayer(picker.gameIndex, picker.side, p.id)}
                      disabled={disabled}
                      style={{
                        flexDirection: 'row', alignItems: 'center', minHeight: 48, padding: 14, borderRadius: 10, marginBottom: 8,
                        backgroundColor: selected ? 'rgba(0,122,255,0.2)' : 'rgba(255,255,255,0.08)',
                        borderWidth: 1.5, borderColor: selected ? S.BLUE : 'rgba(255,255,255,0.22)',
                        opacity: disabled ? 0.4 : 1,
                      }}
                    >
                      <Text style={{ color: S.WHITE, fontWeight: '600', fontSize: 15, flex: 1 }}>{p.name}</Text>
                      {disabled && (
                        <Text style={{ color: S.WHITE_50, fontSize: 11 }}>Playing Game {lockedInGame + 1}</Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              <TouchableOpacity
                onPress={() => setPicker(null)}
                style={[S.primaryButton, { marginTop: 16 }]}
              >
                <Text style={S.primaryButtonText}>Done</Text>
              </TouchableOpacity>
            </View>
          </BlurView>
        </View>
      </Modal>

      {/* High checkout modal */}
      <Modal visible={!!checkoutModal} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', padding: 24 }}>
          <BlurView intensity={30} tint="dark" style={{ borderRadius: 20, overflow: 'hidden' }}>
            <View style={S.glassCard}>
              <Text style={{ color: S.WHITE, fontSize: 18, fontWeight: '700', marginBottom: 16 }}>High Checkout</Text>
              <Text style={S.label}>PLAYER</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
                {checkoutModal && [...games[checkoutModal.gameIndex].homePlayerIds, ...games[checkoutModal.gameIndex].awayPlayerIds].map((id) => {
                  const selected = checkoutPlayerId === id;
                  return (
                    <TouchableOpacity
                      key={id}
                      onPress={() => setCheckoutPlayerId(id)}
                      style={[S.tapBox, { paddingHorizontal: 14 }, selected && S.tapBoxSelected]}
                    >
                      <Text style={{ color: selected ? S.WHITE : S.WHITE_80, fontWeight: '600', fontSize: 14 }}>
                        {playerName(id)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={S.label}>CHECKOUT (FREE TEXT, E.G. "121")</Text>
              <TextInput
                value={checkoutValue}
                onChangeText={setCheckoutValue}
                placeholder="e.g. 121"
                placeholderTextColor={S.WHITE_30}
                autoFocus
                style={[S.input, { marginBottom: 20 }]}
              />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity
                  onPress={() => setCheckoutModal(null)}
                  style={{
                    flex: 1, padding: 14, borderRadius: 12, alignItems: 'center',
                    backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)',
                  }}
                >
                  <Text style={{ color: S.WHITE_80, fontWeight: '600' }}>Cancel</Text>
                </TouchableOpacity>
                {checkoutModal?.editIndex !== null && (
                  <TouchableOpacity
                    onPress={removeCheckout}
                    style={{ flex: 1, padding: 14, borderRadius: 12, backgroundColor: 'rgba(255,59,48,0.15)', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,59,48,0.4)' }}
                  >
                    <Text style={{ color: S.RED }}>Remove</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={saveCheckout}
                  disabled={!checkoutPlayerId || !checkoutValue.trim()}
                  style={[checkoutPlayerId && checkoutValue.trim() ? S.primaryButton : S.primaryButtonDisabled, { flex: 1 }]}
                >
                  <Text style={S.primaryButtonText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </BlurView>
        </View>
      </Modal>
    </LinearGradient>
  );
}
