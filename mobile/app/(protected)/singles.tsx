import { useState, useEffect, useMemo } from 'react';
import { View, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { Alert } from '@/lib/alert';
import { formatDate } from '@/lib/dates';
import { RAW, type SemanticTone } from '@/lib/theme';
import { Screen, Heading, Body, Caption, Badge, Button, Card, AppBar } from '@/components/ui';
import type { SinglesCompetition, SinglesTie, SinglesTieStatus, SinglesRegistration } from '@/types';

// Player-facing counterpart to admin-singles.tsx: any signed-in league
// member can browse competitions here, self-register while registration's
// open, and follow live results/board assignment once the draw's live — no
// admin controls, so no isDesktop/AdminShell split like the admin screen
// has, same as every other plain (non-admin) route in this app.

const TIE_STATUS_LABEL: Record<SinglesTieStatus, string> = {
  pending: 'Waiting',
  ready: 'Queued',
  active: 'On board',
  confirmed: 'Final',
  bye: 'Bye',
};

const TIE_STATUS_TONE: Record<SinglesTieStatus, SemanticTone | null> = {
  pending: null,
  ready: null,
  active: 'brand',
  confirmed: 'sage',
  bye: 'butter',
};

function roundName(entrantsInRound: number): string {
  return entrantsInRound === 2 ? 'Final' : entrantsInRound === 4 ? 'Semi-Final' : entrantsInRound === 8 ? 'Quarter-Final' : `Round of ${entrantsInRound}`;
}

export default function SinglesScreen() {
  const { appUser } = useAuthStore();
  const leagueId = appUser?.leagueId ?? null;
  const uid = appUser?.uid ?? null;

  const [competitions, setCompetitions] = useState<SinglesCompetition[]>([]);
  const [selectedCompId, setSelectedCompId] = useState<string | null>(null);
  const [ties, setTies] = useState<SinglesTie[]>([]);
  const [registrations, setRegistrations] = useState<SinglesRegistration[]>([]);
  const [playerNames, setPlayerNames] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);

  useEffect(() => {
    if (!leagueId) return;
    const onErr = (e: unknown) => { setLoadError((e as Error).message ?? 'Something went wrong'); setIsLoading(false); };
    const unsubCompetitions = onSnapshot(
      query(collection(db, 'singlesCompetitions'), where('leagueId', '==', leagueId)),
      (snap) => {
        setCompetitions(snap.docs.map((d) => ({
          id: d.id, ...d.data(), eventDate: d.data().eventDate?.toDate() ?? new Date(), createdAt: d.data().createdAt?.toDate() ?? new Date(),
        } as SinglesCompetition)).sort((a, b) => b.eventDate.getTime() - a.eventDate.getTime()));
        setIsLoading(false);
      },
      onErr,
    );
    const unsubPlayers = onSnapshot(
      query(collection(db, 'players'), where('leagueId', '==', leagueId)),
      (snap) => {
        const names: Record<string, string> = {};
        snap.docs.forEach((d) => { names[d.id] = d.data().name; });
        setPlayerNames(names);
      },
      onErr,
    );
    return () => { unsubCompetitions(); unsubPlayers(); };
  }, [leagueId]);

  useEffect(() => {
    setSelectedCompId((prev) => {
      if (prev && competitions.some((c) => c.id === prev)) return prev;
      return competitions.length === 1 ? competitions[0].id : null;
    });
  }, [competitions]);

  useEffect(() => {
    if (!leagueId || !selectedCompId) { setTies([]); return; }
    const unsub = onSnapshot(
      query(collection(db, 'singlesTies'), where('leagueId', '==', leagueId), where('competitionId', '==', selectedCompId)),
      (snap) => setTies(snap.docs.map((d) => ({ id: d.id, ...d.data() } as SinglesTie))),
      (e) => Alert.alert('Error', (e as Error).message ?? 'Something went wrong'),
    );
    return unsub;
  }, [leagueId, selectedCompId]);

  useEffect(() => {
    if (!leagueId || !selectedCompId) { setRegistrations([]); return; }
    const unsub = onSnapshot(
      query(collection(db, 'singlesRegistrations'), where('leagueId', '==', leagueId), where('competitionId', '==', selectedCompId)),
      (snap) => setRegistrations(snap.docs.map((d) => ({
        id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate() ?? new Date(),
      } as SinglesRegistration)).sort((a, b) => a.playerName.localeCompare(b.playerName))),
      (e) => Alert.alert('Error', (e as Error).message ?? 'Something went wrong'),
    );
    return unsub;
  }, [leagueId, selectedCompId]);

  const selectedComp = competitions.find((c) => c.id === selectedCompId) ?? null;
  const myRegistration = useMemo(
    () => registrations.find((r) => r.registeredByUserId === uid) ?? null,
    [registrations, uid],
  );

  function playerName(id: string | null): string {
    if (!id) return 'TBD';
    return playerNames[id] ?? '…';
  }
  function tieLabel(tie: SinglesTie): string {
    if (tie.status === 'bye') return `${playerName(tie.homePlayerId)} — bye`;
    return `${playerName(tie.homePlayerId)} vs ${playerName(tie.awayPlayerId)}`;
  }
  function boardLabel(boardId: number): string {
    return (selectedComp?.boardNames?.[boardId]) || `Board ${boardId + 1}`;
  }

  const roundsWithTies = useMemo(() => {
    const byRound = new Map<number, SinglesTie[]>();
    ties.forEach((t) => { if (!byRound.has(t.round)) byRound.set(t.round, []); byRound.get(t.round)!.push(t); });
    const rounds = [...byRound.keys()].sort((a, b) => a - b);
    const maxRound = rounds[rounds.length - 1] ?? 0;
    return rounds.map((round) => {
      const roundTies = byRound.get(round)!.sort((a, b) => a.id.localeCompare(b.id));
      const entrantsInRound = roundTies.length * 2;
      const name = round === maxRound && roundTies.length === 1 ? 'Final' : roundName(entrantsInRound);
      return { round, name, ties: roundTies };
    });
  }, [ties]);

  async function register() {
    if (!selectedComp) return;
    setIsRegistering(true);
    try {
      await httpsCallable(functions, 'registerForSinglesCompetition')({ competitionId: selectedComp.id });
    } catch (e: unknown) {
      Alert.alert("Can't register", (e as Error).message ?? 'Something went wrong');
    } finally {
      setIsRegistering(false);
    }
  }

  const body = (
    <>
      {loadError ? (
        <Card tone="coral"><Body tone="coral">{loadError}</Body></Card>
      ) : isLoading ? (
        <ActivityIndicator color={RAW.brand} style={{ marginTop: 40 }} />
      ) : competitions.length === 0 ? (
        <Card className="items-center py-8">
          <Body tone="strong" weight="semibold">No Singles Knockout scheduled yet</Body>
        </Card>
      ) : competitions.length > 1 && !selectedCompId ? (
        <View className="gap-2">
          {competitions.map((c) => (
            <TouchableOpacity
              key={c.id}
              activeOpacity={0.7}
              onPress={() => setSelectedCompId(c.id)}
              className="p-4 rounded-2xl bg-surface-2 dark:bg-surface-2-dark"
            >
              <Body tone="strong" weight="semibold">{c.name}</Body>
              <Body size="sm">{formatDate(c.eventDate)} · {c.status === 'registration' ? 'Registration open' : c.status}</Body>
            </TouchableOpacity>
          ))}
        </View>
      ) : selectedComp ? (
        <>
          {competitions.length > 1 && (
            <TouchableOpacity activeOpacity={0.7} onPress={() => setSelectedCompId(null)} className="mb-3">
              <Body size="sm" tone="brand">‹ All competitions</Body>
            </TouchableOpacity>
          )}

          <Card className="mb-4">
            <Heading size="lg">{selectedComp.name}</Heading>
            <Body size="sm" className="mb-1">{formatDate(selectedComp.eventDate)}</Body>
            {selectedComp.entryFeeCents != null && (
              <Body size="sm" className="mb-3">Entry fee: £{(selectedComp.entryFeeCents / 100).toFixed(2)}</Body>
            )}

            {selectedComp.status === 'registration' && (
              myRegistration ? (
                <Badge tone="sage">You're registered</Badge>
              ) : (
                <Button disabled={isRegistering} loading={isRegistering} onPress={register}>Register</Button>
              )
            )}
            {selectedComp.status === 'completed' && selectedComp.winnerPlayerId && (
              <Body tone="strong" weight="semibold">Winner: {playerName(selectedComp.winnerPlayerId)}</Body>
            )}
          </Card>

          {selectedComp.status === 'registration' && (
            <Card className="mb-4">
              <Heading size="sm" className="mb-2">Registered ({registrations.length})</Heading>
              {registrations.length === 0 ? (
                <Body size="sm">Nobody's registered yet — be the first!</Body>
              ) : (
                <View className="flex-row flex-wrap gap-2">
                  {registrations.map((r) => <Badge key={r.id} tone="brand">{r.playerName}</Badge>)}
                </View>
              )}
            </Card>
          )}

          {(selectedComp.status === 'active' || selectedComp.status === 'completed') && (
            <>
              {selectedComp.status === 'active' && selectedComp.boards.length > 0 && (
                <Card className="mb-4" padded={false}>
                  <View className="p-4 border-b border-border dark:border-border-dark">
                    <Heading size="sm">Live Boards</Heading>
                  </View>
                  {selectedComp.boards.map((tieId, boardId) => {
                    const tie = tieId ? ties.find((t) => t.id === tieId) : null;
                    return (
                      <View
                        key={boardId}
                        className={[
                          'flex-row items-center justify-between px-4 py-3',
                          boardId < selectedComp.boards.length - 1 ? 'border-b border-border dark:border-border-dark' : '',
                        ].join(' ')}
                      >
                        <Body size="sm" tone="dim">{boardLabel(boardId)}</Body>
                        <Body tone={tie ? 'strong' : 'dim'} weight={tie ? 'semibold' : 'normal'}>
                          {tie ? tieLabel(tie) : 'Free'}
                        </Body>
                      </View>
                    );
                  })}
                </Card>
              )}

              {roundsWithTies.map(({ round, name, ties: roundTies }) => (
                <Card key={round} className="mb-4" padded={false}>
                  <View className="p-4 border-b border-border dark:border-border-dark">
                    <Heading size="sm">{name}</Heading>
                  </View>
                  {roundTies.map((tie, i) => {
                    const tone = TIE_STATUS_TONE[tie.status];
                    return (
                      <View
                        key={tie.id}
                        className={[
                          'flex-row items-center justify-between px-4 py-3',
                          i < roundTies.length - 1 ? 'border-b border-border dark:border-border-dark' : '',
                        ].join(' ')}
                      >
                        <View className="flex-1 mr-2">
                          <Body tone="strong" weight="semibold" numberOfLines={1}>{tieLabel(tie)}</Body>
                          {tie.status === 'active' && tie.boardId != null && <Caption>{boardLabel(tie.boardId)}</Caption>}
                        </View>
                        {tie.status === 'confirmed' && (
                          <Body size="sm" className="mr-3">{tie.homeLegsWon}-{tie.awayLegsWon}</Body>
                        )}
                        {tone ? <Badge tone={tone}>{TIE_STATUS_LABEL[tie.status]}</Badge> : <Body size="sm">{TIE_STATUS_LABEL[tie.status]}</Body>}
                      </View>
                    );
                  })}
                </Card>
              ))}
            </>
          )}
        </>
      ) : null}
    </>
  );

  return (
    <Screen header={<AppBar title="Singles Knockout" />}>
      <Stack.Screen options={{ headerShown: false }} />
      {body}
    </Screen>
  );
}
