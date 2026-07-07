import { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { router, Stack } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { collection, doc, onSnapshot, query, where, type DocumentData } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import type { PlayerSeasonStats } from '@/types';
import * as S from '@/styles/common';

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

  return (
    <LinearGradient colors={S.GRADIENT} style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          title: 'Stats',
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={{ paddingRight: 12 }}>
              <Text style={{ color: S.WHITE, fontSize: 16 }}>‹ Back</Text>
            </TouchableOpacity>
          ),
        }}
      />
      <View style={{ flexDirection: 'row', gap: 8, padding: 20, paddingBottom: 0 }}>
        {(['mine', 'leaderboard'] as const).map((t) => {
          const selected = tab === t;
          return (
            <TouchableOpacity
              key={t}
              onPress={() => setTab(t)}
              style={{
                flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
                backgroundColor: selected ? 'rgba(0,122,255,0.2)' : 'rgba(255,255,255,0.07)',
                borderWidth: 1, borderColor: selected ? S.BLUE : 'rgba(255,255,255,0.12)',
              }}
            >
              <Text style={{ color: selected ? S.BLUE : S.WHITE_60, fontWeight: '600', fontSize: 13 }}>
                {t === 'mine' ? 'My Stats' : 'Leaderboard'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={{ padding: 20 }}>
        {loadError ? (
          <View style={S.errorBox}><Text style={{ color: S.RED }}>{loadError}</Text></View>
        ) : isLoading ? (
          <ActivityIndicator color={S.BLUE} style={{ marginTop: 40 }} />
        ) : tab === 'mine' ? (
          !myStats ? (
            <View style={{ alignItems: 'center', paddingVertical: 40 }}>
              <Text style={{ fontSize: 36, marginBottom: 12 }}>🎯</Text>
              <Text style={{ color: S.WHITE_50, textAlign: 'center' }}>
                No stats yet — these fill in once your matches are confirmed.
              </Text>
            </View>
          ) : (
            <>
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
                {[
                  { label: 'Played', value: myStats.played },
                  { label: 'Won', value: myStats.won },
                  { label: 'Win %', value: winPct !== null ? `${winPct}%` : '—' },
                  { label: '180s', value: myStats.oneEighties },
                ].map((stat) => (
                  <BlurView key={stat.label} intensity={20} tint="dark" style={{ flex: 1, borderRadius: 14, overflow: 'hidden' }}>
                    <View style={{ padding: 12, alignItems: 'center' }}>
                      <Text style={{ color: S.WHITE, fontSize: 20, fontWeight: '700' }}>{stat.value}</Text>
                      <Text style={{ color: S.WHITE_50, fontSize: 11, marginTop: 2 }}>{stat.label}</Text>
                    </View>
                  </BlurView>
                ))}
              </View>

              <Text style={{ color: S.WHITE, fontSize: 15, fontWeight: '700', marginBottom: 10 }}>High Checkouts</Text>
              {myStats.highCheckouts.length === 0 ? (
                <Text style={{ color: S.WHITE_50, fontSize: 13 }}>None recorded yet</Text>
              ) : (
                [...myStats.highCheckouts].sort((a, b) => b.date.getTime() - a.date.getTime()).map((c, i) => (
                  <View key={i} style={{
                    flexDirection: 'row', padding: 12, borderRadius: 10, marginBottom: 6,
                    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
                  }}>
                    <Text style={{ color: '#FF9500', fontWeight: '700', flex: 1 }}>{c.value}</Text>
                    <Text style={{ color: S.WHITE_50, fontSize: 12 }}>{formatDate(c.date)}</Text>
                  </View>
                ))
              )}
            </>
          )
        ) : !appUser?.divisionId ? (
          <Text style={{ color: S.WHITE_50, textAlign: 'center', paddingVertical: 20 }}>
            Join a team to see your division's leaderboard.
          </Text>
        ) : (
          <>
            <Text style={{ color: S.WHITE, fontSize: 15, fontWeight: '700', marginBottom: 10 }}>🎯 Most 180s</Text>
            {mostOneEighties.length === 0 ? (
              <Text style={{ color: S.WHITE_50, fontSize: 13, marginBottom: 20 }}>None yet this season</Text>
            ) : (
              mostOneEighties.map((s, i) => (
                <View key={s.id} style={{ flexDirection: 'row', paddingVertical: 8 }}>
                  <Text style={{ color: S.WHITE_50, width: 24 }}>{i + 1}</Text>
                  <Text style={{ color: S.WHITE, flex: 1 }}>{playerName(s.playerId)}</Text>
                  <Text style={{ color: S.WHITE, fontWeight: '700' }}>{s.oneEighties}</Text>
                </View>
              ))
            )}

            <Text style={{ color: S.WHITE, fontSize: 15, fontWeight: '700', marginTop: 20, marginBottom: 10 }}>
              🏅 Best Win %
            </Text>
            {bestWinRate.length === 0 ? (
              <Text style={{ color: S.WHITE_50, fontSize: 13, marginBottom: 20 }}>None yet this season</Text>
            ) : (
              bestWinRate.map((s, i) => (
                <View key={s.id} style={{ flexDirection: 'row', paddingVertical: 8 }}>
                  <Text style={{ color: S.WHITE_50, width: 24 }}>{i + 1}</Text>
                  <Text style={{ color: S.WHITE, flex: 1 }}>{playerName(s.playerId)}</Text>
                  <Text style={{ color: S.WHITE, fontWeight: '700' }}>{Math.round((s.won / s.played) * 100)}% ({s.played})</Text>
                </View>
              ))
            )}

            <Text style={{ color: S.WHITE, fontSize: 15, fontWeight: '700', marginTop: 20, marginBottom: 10 }}>
              💥 Notable High Checkouts
            </Text>
            {notableCheckouts.length === 0 ? (
              <Text style={{ color: S.WHITE_50, fontSize: 13 }}>None recorded yet</Text>
            ) : (
              notableCheckouts.map((c, i) => (
                <View key={i} style={{ flexDirection: 'row', paddingVertical: 8 }}>
                  <Text style={{ color: '#FF9500', fontWeight: '700', width: 50 }}>{c.value}</Text>
                  <Text style={{ color: S.WHITE, flex: 1 }}>{playerName(c.playerId)}</Text>
                  <Text style={{ color: S.WHITE_50, fontSize: 12 }}>{formatDate(c.date)}</Text>
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>
    </LinearGradient>
  );
}
