import { useState, useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { collection, doc, getDoc, onSnapshot, query, where, updateDoc } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { goBack } from '@/lib/navigation';
import type { Match, MatchGame, MatchSide } from '@/types';
import * as S from '@/styles/common';

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
        <Text style={{ color: S.WHITE, fontSize: 13, marginBottom: 6 }}>
          {game.homePlayerIds.map(playerName).join(' & ') || '—'} vs {game.awayPlayerIds.map(playerName).join(' & ') || '—'}
        </Text>
        {game.legs.map((leg, i) => (
          <Text key={i} style={{ color: S.WHITE_50, fontSize: 12, marginBottom: 2 }}>
            Leg {i + 1}: {leg.winner === 'home' ? homeTeamName : awayTeamName} won
            {leg.oneEighties.length ? ` · 180: ${leg.oneEighties.map(playerName).join(', ')}` : ''}
            {leg.highCheckout ? ` · High checkout: ${playerName(leg.highCheckout.playerId)} ${leg.highCheckout.value}` : ''}
          </Text>
        ))}
      </View>
    );
  }

  return (
    <LinearGradient colors={S.GRADIENT} style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          title: 'Resolve Dispute',
          headerLeft: () => (
            <TouchableOpacity onPress={() => goBack()} hitSlop={12} style={{ paddingRight: 12 }}>
              <Text style={{ color: S.WHITE, fontSize: 16 }}>‹ Back</Text>
            </TouchableOpacity>
          ),
        }}
      />
      {loadError ? (
        <View style={{ padding: 20 }}><View style={S.errorBox}><Text style={{ color: S.RED }}>{loadError}</Text></View></View>
      ) : isLoading ? (
        <ActivityIndicator color={S.BLUE} style={{ marginTop: 60 }} />
      ) : !homeGames || !awayGames ? (
        <View style={{ padding: 20 }}>
          <View style={S.errorBox}>
            <Text style={{ color: S.RED }}>Both teams haven't submitted a result yet — nothing to resolve.</Text>
          </View>
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={{ padding: 20 }}>
            <Text style={{ color: S.WHITE, fontSize: 18, fontWeight: '700', marginBottom: 4 }}>
              {homeTeamName} vs {awayTeamName}
            </Text>
            <Text style={{ color: S.WHITE_50, fontSize: 13, marginBottom: 20 }}>
              Pick or edit the correct version for each game where the two submissions disagree.
            </Text>

            {gameOrders.map((order) => {
              const hg = homeGames.find((g) => g.order === order);
              const ag = awayGames.find((g) => g.order === order);
              const agree = hg && ag && normalize(hg) === normalize(ag);
              const chosen = resolved[order];

              return (
                <View key={order} style={{ marginBottom: 20 }}>
                  <Text style={{ color: S.WHITE_50, fontSize: 12, fontWeight: '700', marginBottom: 8 }}>
                    GAME {order} · {hg?.type === 'pairs' || ag?.type === 'pairs' ? 'PAIRS' : 'SINGLES'}
                    {agree ? '  ·  ✓ teams agree' : '  ·  ⚠ conflict'}
                  </Text>

                  {agree && chosen ? (
                    <View style={{ padding: 12, borderRadius: 12, backgroundColor: 'rgba(52,199,89,0.08)', borderWidth: 1, borderColor: 'rgba(52,199,89,0.3)' }}>
                      <GameSummary game={chosen} />
                    </View>
                  ) : (
                    <View style={{ gap: 8 }}>
                      {hg && (
                        <TouchableOpacity
                          onPress={() => pick(order, hg)}
                          style={{
                            padding: 14, borderRadius: 12,
                            backgroundColor: chosen === hg ? 'rgba(0,122,255,0.18)' : 'rgba(255,255,255,0.08)',
                            borderWidth: 1.5, borderColor: chosen === hg ? S.BLUE : 'rgba(255,255,255,0.25)',
                          }}
                        >
                          <Text style={{ color: chosen === hg ? S.WHITE : S.WHITE_80, fontSize: 11, fontWeight: '700', marginBottom: 6 }}>
                            {homeTeamName.toUpperCase()}'S VERSION
                          </Text>
                          <GameSummary game={hg} />
                        </TouchableOpacity>
                      )}
                      {ag && (
                        <TouchableOpacity
                          onPress={() => pick(order, ag)}
                          style={{
                            padding: 14, borderRadius: 12,
                            backgroundColor: chosen === ag ? 'rgba(0,122,255,0.18)' : 'rgba(255,255,255,0.08)',
                            borderWidth: 1.5, borderColor: chosen === ag ? S.BLUE : 'rgba(255,255,255,0.25)',
                          }}
                        >
                          <Text style={{ color: chosen === ag ? S.WHITE : S.WHITE_80, fontSize: 11, fontWeight: '700', marginBottom: 6 }}>
                            {awayTeamName.toUpperCase()}'S VERSION
                          </Text>
                          <GameSummary game={ag} />
                        </TouchableOpacity>
                      )}
                    </View>
                  )}

                  {/* Leg-winner override on whichever version is currently chosen */}
                  {chosen && !agree && (
                    <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
                      {chosen.legs.map((leg, legIdx) => (
                        <View key={legIdx} style={{ flex: 1, flexDirection: 'row', gap: 4 }}>
                          {(['home', 'away'] as MatchSide[]).map((side) => {
                            const selected = leg.winner === side;
                            return (
                              <TouchableOpacity
                                key={side}
                                onPress={() => overrideLegWinner(order, legIdx, side)}
                                style={{
                                  flex: 1, minHeight: 40, justifyContent: 'center', borderRadius: 8, alignItems: 'center',
                                  backgroundColor: selected ? 'rgba(52,199,89,0.2)' : 'rgba(255,255,255,0.08)',
                                  borderWidth: 1.5, borderColor: selected ? S.GREEN : 'rgba(255,255,255,0.25)',
                                }}
                              >
                                <Text style={{ color: selected ? S.GREEN : S.WHITE_80, fontSize: 11, fontWeight: '600' }}>
                                  L{legIdx + 1}: {side === 'home' ? 'Home' : 'Away'}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>

          <View style={{ padding: 20, paddingTop: 8 }}>
            <TouchableOpacity
              onPress={confirmResult}
              disabled={!allResolved || isConfirming}
              style={allResolved && !isConfirming ? S.primaryButton : S.primaryButtonDisabled}
            >
              {isConfirming ? <ActivityIndicator color={S.WHITE} /> : <Text style={S.primaryButtonText}>Confirm Result</Text>}
            </TouchableOpacity>
          </View>
        </>
      )}
    </LinearGradient>
  );
}
