import { useState, useEffect, useMemo, useContext } from 'react';
import { View, ScrollView, ActivityIndicator } from 'react-native';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useColorScheme } from 'nativewind';
import { router } from 'expo-router';
import { collection, doc, onSnapshot, query, where, type DocumentData } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { RAW } from '@/lib/theme';
import { Heading, Body, Caption, Stat, Chip, Card, AppIcon } from '@/components/ui';
import { compareLeaderboard } from '@/lib/leaderboard';
import type { PlayerSeasonStats } from '@/types';

interface PlayerInfo { id: string; name: string }

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// Firestore stores each highCheckouts[].date as a Timestamp — convert on read
function toStats(id: string, data: DocumentData): PlayerSeasonStats {
  return {
    id,
    ...data,
    highCheckouts: (data.highCheckouts ?? []).map((c: any) => ({ ...c, date: c.date?.toDate?.() ?? new Date() })),
  } as PlayerSeasonStats;
}

export default function StatsScreen() {
  const { appUser } = useAuthStore();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? 0;
  const [tab, setTab] = useState<'mine' | 'leaderboard'>('mine');

  const [myStats, setMyStats] = useState<PlayerSeasonStats | null>(null);
  const [divisionStats, setDivisionStats] = useState<PlayerSeasonStats[]>([]);
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!appUser?.leagueId || !appUser?.seasonId) { setIsLoading(false); return; }

    const unsubMine = appUser.playerId
      ? onSnapshot(
          doc(db, 'playerSeasonStats', `${appUser.seasonId}_${appUser.playerId}`),
          (snap) => setMyStats(snap.exists() ? toStats(snap.id, snap.data()) : null),
          (e) => setLoadError(e.message),
        )
      : undefined;

    const unsubDivision = appUser.divisionId
      ? onSnapshot(
          query(
            collection(db, 'playerSeasonStats'),
            where('leagueId', '==', appUser.leagueId),
            where('seasonId', '==', appUser.seasonId),
            where('divisionId', '==', appUser.divisionId),
          ),
          (snap) => {
            setDivisionStats(snap.docs.map((d) => toStats(d.id, d.data())));
            setIsLoading(false);
          },
          (e) => { setLoadError(e.message); setIsLoading(false); },
        )
      : undefined;

    if (!appUser.divisionId) setIsLoading(false);

    const unsubPlayers = onSnapshot(
      query(collection(db, 'players'), where('leagueId', '==', appUser.leagueId)),
      (snap) => setPlayers(snap.docs.map((d) => ({ id: d.id, name: d.data().name } as PlayerInfo))),
    );

    return () => { unsubMine?.(); unsubDivision?.(); unsubPlayers(); };
  }, [appUser?.leagueId, appUser?.seasonId, appUser?.divisionId, appUser?.playerId]);

  const playerName = (id: string) => players.find((p) => p.id === id)?.name ?? '?';

  const mostOneEighties = useMemo(
    () => [...divisionStats].filter((s) => s.oneEighties > 0).sort((a, b) => b.oneEighties - a.oneEighties).slice(0, 10),
    [divisionStats],
  );
  // Stats Rules audit (Season 1): legs won desc -> individual games won desc
  // -> leg win-% desc. Never win-percentage as the primary key — see
  // compareLeaderboard's own comment for the full rule.
  const leaderboard = useMemo(
    () => [...divisionStats]
      .filter((s) => s.played > 0)
      .sort(compareLeaderboard)
      .slice(0, 10),
    [divisionStats],
  );
  const notableCheckouts = useMemo(() => {
    const all = divisionStats.flatMap((s) => s.highCheckouts.map((c) => ({ ...c, playerId: s.playerId })));
    return all.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 10);
  }, [divisionStats]);

  const winPct = myStats && myStats.played > 0 ? Math.round((myStats.won / myStats.played) * 100) : null;

  const isPlaceholder = !!loadError || isLoading || (tab === 'mine' && !myStats) || (tab === 'leaderboard' && !appUser?.divisionId);

  return (
    <View className="flex-1 bg-bg dark:bg-bg-dark">
      <View className="flex-row gap-2 px-5 pt-5">
        <Chip label="My Stats" selected={tab === 'mine'} onPress={() => setTab('mine')} className="flex-1" />
        <Chip label="Leaderboard" selected={tab === 'leaderboard'} onPress={() => setTab('leaderboard')} className="flex-1" />
      </View>

      <ScrollView
        contentContainerStyle={[
          { padding: 20, paddingBottom: 20 + tabBarHeight },
          isPlaceholder && { flexGrow: 1, justifyContent: 'center' },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {loadError ? (
          <Card tone="coral"><Body tone="coral">{loadError}</Body></Card>
        ) : isLoading ? (
          <ActivityIndicator color={RAW.brand} style={{ marginTop: 40 }} />
        ) : tab === 'mine' ? (
          !myStats ? (
            <View className="items-center py-10">
              <View className="w-14 h-14 rounded-full items-center justify-center bg-brand-fill dark:bg-brand-fill-dark mb-3">
                <AppIcon name="target" size={28} color={isDark ? RAW.brandInkDark : RAW.brandInk} />
              </View>
              <Body className="text-center">No stats yet — these fill in once your matches are confirmed.</Body>
            </View>
          ) : (
            <>
              {/* Editorial hierarchy (one dominant figure, smaller
                  supporting ones) — same pattern as Home's Your Stats,
                  not four equal-weight KPI tiles. */}
              <View className="flex-row items-end gap-5 mb-5">
                <Stat size="lg" tone="brand">{winPct !== null ? `${winPct}%` : '—'}</Stat>
                <View className="flex-row gap-4 pb-1">
                  <View>
                    <Stat size="sm">{myStats.played}</Stat>
                    <Caption className="mt-0.5">Played</Caption>
                  </View>
                  <View>
                    <Stat size="sm">{myStats.won}</Stat>
                    <Caption className="mt-0.5">Won</Caption>
                  </View>
                  <View>
                    <Stat size="sm">{myStats.oneEighties}</Stat>
                    <Caption className="mt-0.5">180s</Caption>
                  </View>
                </View>
              </View>

              <Heading size="sm" className="mb-2.5">High Checkouts</Heading>
              {myStats.highCheckouts.length === 0 ? (
                <Body size="sm">None recorded yet</Body>
              ) : (
                <View className="rounded-lg border border-border dark:border-border-dark overflow-hidden">
                  {[...myStats.highCheckouts].sort((a, b) => b.date.getTime() - a.date.getTime()).map((c, i) => (
                    <View
                      key={i}
                      className={[
                        'flex-row items-center justify-between px-4 py-3 bg-surface dark:bg-surface-dark',
                        i > 0 ? 'border-t border-border dark:border-border-dark' : '',
                      ].join(' ')}
                    >
                      <Body tone="strong" weight="bold">{c.value}</Body>
                      <Body size="sm">{formatDate(c.date)}</Body>
                    </View>
                  ))}
                </View>
              )}
            </>
          )
        ) : !appUser?.divisionId ? (
          <Body className="text-center py-5">Join a team to see your division's leaderboard.</Body>
        ) : (
          <>
            <View className="flex-row items-center gap-1.5 mb-2.5">
              <AppIcon name="target" size={16} color={isDark ? RAW.brandInkDark : RAW.brandInk} />
              <Heading size="sm">Most 180s</Heading>
            </View>
            {mostOneEighties.length === 0 ? (
              <Body size="sm" className="mb-5">None yet this season</Body>
            ) : (
              mostOneEighties.map((s, i) => (
                <View key={s.id} className="flex-row py-2 items-center">
                  <Body size="sm" className="w-6">{i + 1}</Body>
                  <Body tone="strong" className="flex-1" onPress={() => router.push(`/(protected)/player-profile?playerId=${s.playerId}`)}>{playerName(s.playerId)}</Body>
                  <Body tone="strong" weight="bold">{s.oneEighties}</Body>
                </View>
              ))
            )}

            <View className="flex-row items-center gap-1.5 mt-5 mb-2.5">
              <AppIcon name="medal" size={16} color={isDark ? RAW.sageInkDark : RAW.sageInk} />
              <Heading size="sm">Leaderboard</Heading>
            </View>
            {leaderboard.length === 0 ? (
              <Body size="sm" className="mb-5">None yet this season</Body>
            ) : (
              leaderboard.map((s, i) => (
                <View key={s.id} className="flex-row py-2 items-center">
                  <Body size="sm" className="w-6">{i + 1}</Body>
                  <Body tone="strong" className="flex-1" onPress={() => router.push(`/(protected)/player-profile?playerId=${s.playerId}`)}>{playerName(s.playerId)}</Body>
                  <Body tone="strong" weight="bold">{s.legsWon} legs</Body>
                </View>
              ))
            )}

            <View className="flex-row items-center gap-1.5 mt-5 mb-2.5">
              <AppIcon name="zap" size={16} color={isDark ? RAW.textFaintDark : RAW.textFaint} />
              <Heading size="sm">Notable High Checkouts</Heading>
            </View>
            {notableCheckouts.length === 0 ? (
              <Body size="sm">None recorded yet</Body>
            ) : (
              notableCheckouts.map((c, i) => (
                <View key={i} className="flex-row py-2 items-center">
                  <Body tone="strong" weight="bold" className="w-14">{c.value}</Body>
                  <Body tone="strong" className="flex-1" onPress={() => router.push(`/(protected)/player-profile?playerId=${c.playerId}`)}>{playerName(c.playerId)}</Body>
                  <Body size="sm">{formatDate(c.date)}</Body>
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}
