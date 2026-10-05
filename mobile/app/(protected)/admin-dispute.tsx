import { useState, useEffect, useMemo } from 'react';
import { View, ScrollView, TouchableOpacity, ActivityIndicator, Platform, useWindowDimensions } from 'react-native';
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
import { mergeGame } from '@/lib/matchResultDraft';
import type { Match, MatchGame, MatchSide } from '@/types';

const DESKTOP_BREAKPOINT = 768;

interface Player { id: string; name: string; teamId: string }

// SCORE ONLY (leg-winner sequence) — matches functions/src/index.ts's
// pairingsAndScoreAgree, the actual server-side reconciliation check. Under
// the own-team-only model there is no pairing to compare here at all: hg's
// awayPlayerIds and ag's homePlayerIds are always empty (neither captain's
// submission ever names the opponent's players), so a game can only ever
// disagree on the score. Stats (180s/checkouts) are likewise excluded: each
// team only ever reports its own players' stats, so they're expected to
// differ between the two submissions by construction — never a real
// disagreement, just complementary data mergeGame combines below.
function normalize(game: MatchGame) {
  return JSON.stringify(game.legs.map((l) => l.winner));
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
  // Alert.alert's success/error feedback for this action was a documented
  // no-op on web (see ConfirmDialog's own comment on this) — confirmResult
  // doesn't gate behind a confirmation prompt (the admin has already picked
  // a version for every conflicting game, so pressing Confirm Result IS the
  // confirmation), but its outcome still needs to be visible on web, so it's
  // shown inline instead.
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmedSuccessfully, setConfirmedSuccessfully] = useState(false);

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

        // Pre-resolve any games both teams already agree on (pairings/score)
        // — merged, not just home's copy: each side only ever reports its
        // OWN players' stats, so using hg wholesale here would silently
        // drop every one of away's 180s/checkouts for this game.
        if (hGames && aGames) {
          const initial: Record<number, MatchGame> = {};
          hGames.forEach((hg) => {
            const ag = aGames.find((g) => g.order === hg.order);
            if (ag && normalize(hg) === normalize(ag)) initial[hg.order] = mergeGame(hg, ag);
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

  // Picks whose SCORE (leg-winner sequence) to trust for a disagreeing
  // game — never "whose pairing": the real pairing always comes from each
  // side's own submission regardless (hg's home player, ag's away player),
  // via mergeGame's own-team-only merge. `side` just selects which
  // submission's legs sequence becomes authoritative.
  function pickScore(order: number, side: MatchSide) {
    const hg = homeGames?.find((g) => g.order === order);
    const ag = awayGames?.find((g) => g.order === order);
    if (!hg || !ag) return;
    setResolved((prev) => ({ ...prev, [order]: mergeGame(hg, ag, side === 'home' ? hg : ag) }));
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
    setConfirmError(null);
    try {
      const finalGames = gameOrders.map((o) => resolved[o]).sort((a, b) => a.order - b.order);
      await updateDoc(doc(db, 'matches', matchId), { status: 'confirmed', games: finalGames, confirmedVia: 'adminOverride' });
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setConfirmedSuccessfully(true);
    } catch (e: unknown) {
      setConfirmError((e as Error).message ?? 'Something went wrong');
    } finally {
      setIsConfirming(false);
    }
  }

  // showPairing: off for a per-side SCORE option (hg/ag each only carry
  // their own side's player, so showing "homePlayerIds vs awayPlayerIds"
  // from either alone would read as "Steve vs —" / "— vs Dave" — the real,
  // combined pairing is shown once, above, via pairingLine below, since it's
  // never itself in dispute (it always comes from each side's own
  // submission regardless of which score is chosen).
  function GameSummary({ game, showPairing = true }: { game: MatchGame; showPairing?: boolean }) {
    return (
      <View>
        {showPairing && (
          <Body size="sm" tone="strong" className="mb-1.5">
            {game.homePlayerIds.map(playerName).join(' & ') || '—'} vs {game.awayPlayerIds.map(playerName).join(' & ') || '—'}
          </Body>
        )}
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

  // The real, combined pairing — home player always from the home
  // submission, away player always from the away submission — never itself
  // in dispute under the own-team-only model.
  function pairingLine(hg: MatchGame, ag: MatchGame): string {
    return `${hg.homePlayerIds.map(playerName).join(' & ') || '—'} vs ${ag.awayPlayerIds.map(playerName).join(' & ') || '—'}`;
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
              // Which side's score (if either) the currently-chosen merged
              // game's leg sequence matches — purely for highlighting which
              // option button is selected.
              const chosenSide: MatchSide | null = !chosen || !hg || !ag ? null
                : JSON.stringify(chosen.legs.map((l) => l.winner)) === normalize(hg) ? 'home'
                  : JSON.stringify(chosen.legs.map((l) => l.winner)) === normalize(ag) ? 'away' : null;

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
                      {agree ? 'teams agree' : 'score conflict'}
                    </Caption>
                  </View>

                  {hg && ag && (
                    <Body size="sm" tone="strong" className="mb-1.5">{pairingLine(hg, ag)}</Body>
                  )}

                  {agree && chosen ? (
                    <Card tone="sage">
                      <GameSummary game={chosen} showPairing={false} />
                    </Card>
                  ) : (
                    <View className="gap-2">
                      {hg && (
                        <TouchableOpacity activeOpacity={0.7}
                          onPress={() => pickScore(order, 'home')}
                          className={[
                            'p-3.5 rounded-2xl',
                            chosenSide === 'home' ? 'bg-brand-fill dark:bg-brand-fill-dark' : 'bg-surface-2 dark:bg-surface-2-dark',
                          ].join(' ')}
                        >
                          <Caption className="mb-1.5">{homeTeamName} says</Caption>
                          <GameSummary game={hg} showPairing={false} />
                        </TouchableOpacity>
                      )}
                      {ag && (
                        <TouchableOpacity activeOpacity={0.7}
                          onPress={() => pickScore(order, 'away')}
                          className={[
                            'p-3.5 rounded-2xl',
                            chosenSide === 'away' ? 'bg-brand-fill dark:bg-brand-fill-dark' : 'bg-surface-2 dark:bg-surface-2-dark',
                          ].join(' ')}
                        >
                          <Caption className="mb-1.5">{awayTeamName} says</Caption>
                          <GameSummary game={ag} showPairing={false} />
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
            {confirmedSuccessfully ? (
              <>
                <Card tone="sage" className="mb-3">
                  <Body tone="sage" weight="semibold">Result confirmed</Body>
                  <Body size="sm" tone="sage">Standings and stats will update shortly.</Body>
                </Card>
                <Button onPress={() => goBack()}>Done</Button>
              </>
            ) : (
              <>
                {confirmError && (
                  <Card tone="coral" className="mb-3">
                    <Body size="sm" tone="coral">{confirmError}</Body>
                  </Card>
                )}
                <Button disabled={!allResolved || isConfirming} loading={isConfirming} onPress={confirmResult}>
                  {confirmError ? 'Try Again' : 'Confirm Result'}
                </Button>
              </>
            )}
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
