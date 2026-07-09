import { useState, useEffect, useMemo } from 'react';
import { View, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Platform, useWindowDimensions } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { collection, doc, getDoc, onSnapshot, query, where, updateDoc } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { goBack } from '@/lib/navigation';
import { RAW } from '@/lib/theme';
import { Screen, Body, Caption, Button, Card, Chip, AppBar, AppIcon } from '@/components/ui';
import { AdminShell } from '@/components/admin/AdminShell';
import type { Match, MatchGame, MatchSide } from '@/types';

const DESKTOP_BREAKPOINT = 768;

interface Player { id: string; name: string; teamId: string }

function normalize(game: MatchGame) {
  return JSON.stringify({
    homePlayerIds: [...game.homePlayerIds].sort(),
    awayPlayerIds: [...game.awayPlayerIds].sort(),
    legs: game.legs.map((l) => ({
      winner: l.winner,
      oneEighties: [...l.oneEighties].sort(),
      highCheckout: l.highCheckout,
    })),
  });
}

export default function AdminDisputeScreen() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const { appUser } = useAuthStore();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;

  const [match, setMatch] = useState<Match | null>(null);
  const [homeTeamName, setHomeTeamName] = useState('');
  const [awayTeamName, setAwayTeamName] = useState('');
  const [homeGames, setHomeGames] = useState<MatchGame[] | null>(null);
  const [awayGames, setAwayGames] = useState<MatchGame[] | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [resolved, setResolved] = useState<Record<number, MatchGame>>({});
  const [isConfirming, setIsConfirming] = useState(false);

  useEffect(() => {
    if (!matchId || !appUser?.leagueId) return;

    (async () => {
      try {
        const matchSnap = await getDoc(doc(db, 'matches', matchId));
        if (!matchSnap.exists()) { setLoadError('Fixture not found'); setIsLoading(false); return; }
        const d = matchSnap.data();
        const m: Match = { id: matchSnap.id, ...d, scheduledDate: d.scheduledDate?.toDate() ?? new Date() } as Match;
        setMatch(m);

        const [homeTeamSnap, awayTeamSnap, homeSubSnap, awaySubSnap] = await Promise.all([
          getDoc(doc(db, 'teams', m.homeTeamId)),
          getDoc(doc(db, 'teams', m.awayTeamId)),
          getDoc(doc(db, 'matches', matchId, 'submissions', m.homeTeamId)),
          getDoc(doc(db, 'matches', matchId, 'submissions', m.awayTeamId)),
        ]);
        setHomeTeamName(homeTeamSnap.data()?.name ?? 'Home');
        setAwayTeamName(awayTeamSnap.data()?.name ?? 'Away');
        const hGames = (homeSubSnap.data()?.games as MatchGame[] | undefined) ?? null;
        const aGames = (awaySubSnap.data()?.games as MatchGame[] | undefined) ?? null;
        setHomeGames(hGames);
        setAwayGames(aGames);

        // Pre-resolve any games both teams already agree on
        if (hGames && aGames) {
          const initial: Record<number, MatchGame> = {};
          hGames.forEach((hg) => {
            const ag = aGames.find((g) => g.order === hg.order);
            if (ag && normalize(hg) === normalize(ag)) initial[hg.order] = hg;
          });
          setResolved(initial);
        }
        setIsLoading(false);
      } catch (e: unknown) {
        setLoadError((e as Error).message ?? 'Something went wrong');
        setIsLoading(false);
      }
    })();

    const unsubPlayers = onSnapshot(
      query(collection(db, 'players'), where('leagueId', '==', appUser.leagueId)),
      (snap) => {
        setPlayers(snap.docs.map((p) => ({ id: p.id, name: p.data().name, teamId: p.data().teamId } as Player)));
      },
    );
    return () => unsubPlayers();
  }, [matchId, appUser?.leagueId]);

  const playerName = (id: string) => players.find((p) => p.id === id)?.name ?? '?';

  const gameOrders = useMemo(() => {
    const orders = new Set<number>();
    homeGames?.forEach((g) => orders.add(g.order));
    awayGames?.forEach((g) => orders.add(g.order));
    return [...orders].sort((a, b) => a - b);
  }, [homeGames, awayGames]);

  function pick(order: number, game: MatchGame) {
    setResolved((prev) => ({ ...prev, [order]: game }));
  }

  function overrideLegWinner(order: number, legIdx: number, winner: MatchSide) {
    setResolved((prev) => {
      const g = prev[order];
      if (!g) return prev;
      const legs = g.legs.map((l, i) => (i === legIdx ? { ...l, winner } : l));
      return { ...prev, [order]: { ...g, legs } };
    });
  }

  const allResolved = gameOrders.length > 0 && gameOrders.every((o) => resolved[o]);

  async function confirmResult() {
    if (!matchId || !allResolved) return;
    setIsConfirming(true);
    try {
      const finalGames = gameOrders.map((o) => resolved[o]).sort((a, b) => a.order - b.order);
      await updateDoc(doc(db, 'matches', matchId), { status: 'confirmed', games: finalGames });
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Result confirmed', 'Standings and stats will update shortly.');
      goBack();
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error).message ?? 'Something went wrong');
    } finally {
      setIsConfirming(false);
    }
  }

  function GameSummary({ game }: { game: MatchGame }) {
    return (
      <View>
        <Body size="sm" tone="strong" className="mb-1.5">
          {game.homePlayerIds.map(playerName).join(' & ') || '—'} vs {game.awayPlayerIds.map(playerName).join(' & ') || '—'}
        </Body>
        {game.legs.map((leg, i) => (
          <Body key={i} size="xs" className="mb-0.5">
            Leg {i + 1}: {leg.winner === 'home' ? homeTeamName : awayTeamName} won
            {leg.oneEighties.length ? ` · 180: ${leg.oneEighties.map(playerName).join(', ')}` : ''}
            {leg.highCheckout ? ` · High checkout: ${playerName(leg.highCheckout.playerId)} ${leg.highCheckout.value}` : ''}
          </Body>
        ))}
      </View>
    );
  }

  const body = (
    <>
      {loadError ? (
        <View className="p-5"><Card tone="coral"><Body tone="coral">{loadError}</Body></Card></View>
      ) : isLoading ? (
        <ActivityIndicator color={RAW.brand} style={{ marginTop: 60 }} />
      ) : !homeGames || !awayGames ? (
        <View className="p-5">
          <Card tone="coral">
            <Body tone="coral">Both teams haven't submitted a result yet — nothing to resolve.</Body>
          </Card>
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={{ padding: 20 }}>
            <Body tone="strong" className="mb-1">{homeTeamName} vs {awayTeamName}</Body>
            <Body size="sm" className="mb-5">
              Pick or edit the correct version for each game where the two submissions disagree.
            </Body>

            {gameOrders.map((order) => {
              const hg = homeGames.find((g) => g.order === order);
              const ag = awayGames.find((g) => g.order === order);
              const agree = hg && ag && normalize(hg) === normalize(ag);
              const chosen = resolved[order];

              return (
                <View key={order} className="mb-5">
                  <View className="flex-row items-center gap-1 mb-2">
                    <Caption>
                      Game {order} · {hg?.type === 'pairs' || ag?.type === 'pairs' ? 'Pairs' : 'Singles'} ·
                    </Caption>
                    <AppIcon
                      name={agree ? 'check' : 'warning'}
                      size={11}
                      color={agree ? (isDark ? RAW.textFaintDark : RAW.textFaint) : (isDark ? RAW.coralInkDark : RAW.coralInk)}
                    />
                    <Caption className={agree ? '' : 'text-coral-ink dark:text-coral-ink-dark'}>
                      {agree ? 'teams agree' : 'conflict'}
                    </Caption>
                  </View>

                  {agree && chosen ? (
                    <Card tone="sage">
                      <GameSummary game={chosen} />
                    </Card>
                  ) : (
                    <View className="gap-2">
                      {hg && (
                        <TouchableOpacity activeOpacity={0.7}
                          onPress={() => pick(order, hg)}
                          className={[
                            'p-3.5 rounded-2xl',
                            chosen === hg ? 'bg-brand-fill dark:bg-brand-fill-dark' : 'bg-surface-2 dark:bg-surface-2-dark',
                          ].join(' ')}
                        >
                          <Caption className="mb-1.5">{homeTeamName}'s version</Caption>
                          <GameSummary game={hg} />
                        </TouchableOpacity>
                      )}
                      {ag && (
                        <TouchableOpacity activeOpacity={0.7}
                          onPress={() => pick(order, ag)}
                          className={[
                            'p-3.5 rounded-2xl',
                            chosen === ag ? 'bg-brand-fill dark:bg-brand-fill-dark' : 'bg-surface-2 dark:bg-surface-2-dark',
                          ].join(' ')}
                        >
                          <Caption className="mb-1.5">{awayTeamName}'s version</Caption>
                          <GameSummary game={ag} />
                        </TouchableOpacity>
                      )}
                    </View>
                  )}

                  {/* Leg-winner override on whichever version is currently chosen */}
                  {chosen && !agree && (
                    <View className="flex-row gap-1.5 mt-2">
                      {chosen.legs.map((leg, legIdx) => (
                        <View key={legIdx} className="flex-1 flex-row gap-1">
                          {(['home', 'away'] as MatchSide[]).map((side) => (
                            <Chip
                              key={side}
                              tone="sage"
                              selected={leg.winner === side}
                              onPress={() => overrideLegWinner(order, legIdx, side)}
                              label={`L${legIdx + 1}: ${side === 'home' ? 'Home' : 'Away'}`}
                              className="flex-1 px-2"
                            />
                          ))}
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>

          <View className="p-5 pt-2">
            <Button disabled={!allResolved || isConfirming} loading={isConfirming} onPress={confirmResult}>
              Confirm Result
            </Button>
          </View>
        </>
      )}
    </>
  );

  if (isDesktop) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <AdminShell title="Resolve Dispute" breadcrumb={[{ label: 'Dashboard', path: '/(protected)/(tabs)/admin' }, { label: 'Inbox', path: '/(protected)/admin-inbox' }, { label: 'Resolve Dispute' }]}>
          <View style={{ maxWidth: 780 }}>{body}</View>
        </AdminShell>
      </>
    );
  }

  return (
    <Screen scroll={false} header={<AppBar title="Resolve Dispute" />}>
      <Stack.Screen options={{ headerShown: false }} />
      {body}
    </Screen>
  );
}
