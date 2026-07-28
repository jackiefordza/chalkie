import { useState, useEffect, useMemo, useContext } from 'react';
import { View, ScrollView, ActivityIndicator } from 'react-native';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useColorScheme } from 'nativewind';
import { collection, doc, onSnapshot, query, where, type DocumentData } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { RAW } from '@/lib/theme';
import { Heading, Body, Chip, Card, StatTile, AppIcon } from '@/components/ui';
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
      (e) => setLoadError(e.message),
    );

    return () => { unsubMine?.(); unsubDivision?.(); unsubPlayers(); };
  }, [appUser?.leagueId, appUser?.seasonId, appUser?.divisionId, appUser?.playerId]);

  const playerName = (id: string) => players.find((p) => p.id === id)?.name ?? '?';

  const mostOneEighties = useMemo(
    () => [...divisionStats].filter((s) => s.oneEighties > 0).sort((a, b) => b.oneEighties - a.oneEighties).slice(0, 10),
    [divisionStats],
  );
  const bestWinRate = useMemo(
    () => [...divisionStats]
      .filter((s) => s.played > 0)
      .sort((a, b) => (b.won / b.played) - (a.won / a.played) || b.played - a.played)
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
              <View className="flex-row gap-2.5 mb-4">
                <StatTile label="Played" value={myStats.played} tone="brand" />
                <StatTile label="Won" value={myStats.won} tone="sage" />
                <StatTile label="Win %" value={winPct !== null ? `${winPct}%` : '—'} tone="sage" />
                <StatTile label="180s" value={myStats.oneEighties} tone="butter" />
              </View>

              <Heading size="sm" className="mb-2.5">High Checkouts</Heading>
              {myStats.highCheckouts.length === 0 ? (
                <Body size="sm">None recorded yet</Body>
              ) : (
                [...myStats.highCheckouts].sort((a, b) => b.date.getTime() - a.date.getTime()).map((c, i) => (
                  <Card key={i} className="flex-row mb-1.5" padded={false}>
                    <View className="flex-row flex-1 items-center p-3">
                      <Body tone="butter" weight="bold" className="flex-1">{c.value}</Body>
                      <Body size="sm">{formatDate(c.date)}</Body>
                    </View>
                  </Card>
                ))
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
                  <Body tone="strong" className="flex-1">{playerName(s.playerId)}</Body>
                  <Body tone="strong" weight="bold">{s.oneEighties}</Body>
                </View>
              ))
            )}

            <View className="flex-row items-center gap-1.5 mt-5 mb-2.5">
              <AppIcon name="medal" size={16} color={isDark ? RAW.sageInkDark : RAW.sageInk} />
              <Heading size="sm">Best Win %</Heading>
            </View>
            {bestWinRate.length === 0 ? (
              <Body size="sm" className="mb-5">None yet this season</Body>
            ) : (
              bestWinRate.map((s, i) => (
                <View key={s.id} className="flex-row py-2 items-center">
                  <Body size="sm" className="w-6">{i + 1}</Body>
                  <Body tone="strong" className="flex-1">{playerName(s.playerId)}</Body>
                  <Body tone="strong" weight="bold">{Math.round((s.won / s.played) * 100)}% ({s.played})</Body>
                </View>
              ))
            )}

            <View className="flex-row items-center gap-1.5 mt-5 mb-2.5">
              <AppIcon name="zap" size={16} color={isDark ? RAW.butterInkDark : RAW.butterInk} />
              <Heading size="sm">Notable High Checkouts</Heading>
            </View>
            {notableCheckouts.length === 0 ? (
              <Body size="sm">None recorded yet</Body>
            ) : (
              notableCheckouts.map((c, i) => (
                <View key={i} className="flex-row py-2 items-center">
                  <Body tone="butter" weight="bold" className="w-14">{c.value}</Body>
                  <Body tone="strong" className="flex-1">{playerName(c.playerId)}</Body>
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
