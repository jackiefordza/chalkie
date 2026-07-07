import { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Stack } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { collection, onSnapshot, query, where, orderBy } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { goBack } from '@/lib/navigation';
import type { DivisionTable } from '@/types';
import * as S from '@/styles/common';

interface Division { id: string; name: string; order: number; seasonId: string }

export default function StandingsScreen() {
  const { appUser } = useAuthStore();

  const [divisions, setDivisions] = useState<Division[]>([]);
  const [selectedDivisionId, setSelectedDivisionId] = useState<string | null>(null);
  const [rows, setRows] = useState<DivisionTable[]>([]);
  const [teamNames, setTeamNames] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!appUser?.leagueId) return;

    const unsubDivisions = onSnapshot(
      query(collection(db, 'divisions'), where('leagueId', '==', appUser.leagueId)),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Division))
          .sort((a, b) => a.order - b.order);
        setDivisions(list);
        setSelectedDivisionId((prev) => prev ?? appUser.divisionId ?? list[0]?.id ?? null);
      },
      (e) => setLoadError(e.message),
    );

    const unsubTeams = onSnapshot(
      query(collection(db, 'teams'), where('leagueId', '==', appUser.leagueId)),
      (snap) => {
        const map: Record<string, string> = {};
        snap.docs.forEach((d) => { map[d.id] = d.data().name; });
        setTeamNames(map);
      },
    );

    return () => { unsubDivisions(); unsubTeams(); };
  }, [appUser?.leagueId, appUser?.divisionId]);

  const selectedDivision = divisions.find((d) => d.id === selectedDivisionId) ?? null;

  useEffect(() => {
    if (!selectedDivision) { setIsLoading(false); return; }
    setIsLoading(true);
    const unsub = onSnapshot(
      query(
        collection(db, 'divisionTables'),
        where('seasonId', '==', selectedDivision.seasonId),
        where('divisionId', '==', selectedDivision.id),
        orderBy('position', 'asc'),
      ),
      (snap) => {
        setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DivisionTable)));
        setIsLoading(false);
      },
      (e) => { setLoadError(e.message); setIsLoading(false); },
    );
    return () => unsub();
  }, [selectedDivision?.seasonId, selectedDivision?.id]);

  const columns = useMemo(() => (
    [
      { key: 'played', label: 'P' },
      { key: 'won', label: 'W' },
      { key: 'lost', label: 'L' },
      { key: 'legDiff', label: '+/-' },
      { key: 'points', label: 'Pts' },
    ] as const
  ), []);

  return (
    <LinearGradient colors={S.GRADIENT} style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          title: 'Standings',
          headerLeft: () => (
            <TouchableOpacity onPress={() => goBack()} hitSlop={12} style={{ paddingRight: 12 }}>
              <Text style={{ color: S.WHITE, fontSize: 16 }}>‹ Back</Text>
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        {divisions.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {divisions.map((d) => {
                const selected = d.id === selectedDivisionId;
                return (
                  <TouchableOpacity
                    key={d.id}
                    onPress={() => setSelectedDivisionId(d.id)}
                    style={{
                      minHeight: 40, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 10,
                      backgroundColor: selected ? 'rgba(0,122,255,0.22)' : 'rgba(255,255,255,0.08)',
                      borderWidth: 1.5, borderColor: selected ? S.BLUE : 'rgba(255,255,255,0.25)',
                    }}
                  >
                    <Text style={{ color: selected ? S.WHITE : S.WHITE_80, fontWeight: '600', fontSize: 13 }}>{d.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        )}

        {loadError ? (
          <View style={S.errorBox}><Text style={{ color: S.RED }}>{loadError}</Text></View>
        ) : isLoading ? (
          <ActivityIndicator color={S.BLUE} style={{ marginTop: 40 }} />
        ) : rows.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 40 }}>
            <Text style={{ color: S.WHITE_50, textAlign: 'center' }}>
              No results confirmed yet — the table fills in as matches are played.
            </Text>
          </View>
        ) : (
          <View style={{ borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' }}>
            {/* Header row */}
            <View style={{ flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.1)', paddingVertical: 10, paddingHorizontal: 12 }}>
              <Text style={{ color: S.WHITE_50, fontSize: 11, fontWeight: '700', width: 22 }}>#</Text>
              <Text style={{ color: S.WHITE_50, fontSize: 11, fontWeight: '700', flex: 1 }}>TEAM</Text>
              {columns.map((c) => (
                <Text key={c.key} style={{ color: S.WHITE_50, fontSize: 11, fontWeight: '700', width: 34, textAlign: 'right' }}>
                  {c.label}
                </Text>
              ))}
            </View>
            {rows.map((row, i) => {
              const isMine = row.teamId === appUser?.teamId;
              return (
                <View
                  key={row.id}
                  style={{
                    flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 12,
                    backgroundColor: isMine ? 'rgba(0,122,255,0.1)' : i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'transparent',
                  }}
                >
                  <Text style={{ color: S.WHITE_50, fontSize: 13, width: 22 }}>{row.position}</Text>
                  <Text style={{ color: S.WHITE, fontSize: 13, fontWeight: isMine ? '700' : '500', flex: 1 }} numberOfLines={1}>
                    {teamNames[row.teamId] ?? '…'}
                  </Text>
                  <Text style={{ color: S.WHITE_60, fontSize: 13, width: 34, textAlign: 'right' }}>{row.played}</Text>
                  <Text style={{ color: S.WHITE_60, fontSize: 13, width: 34, textAlign: 'right' }}>{row.won}</Text>
                  <Text style={{ color: S.WHITE_60, fontSize: 13, width: 34, textAlign: 'right' }}>{row.lost}</Text>
                  <Text style={{ color: S.WHITE_60, fontSize: 13, width: 34, textAlign: 'right' }}>
                    {row.legDiff > 0 ? `+${row.legDiff}` : row.legDiff}
                  </Text>
                  <Text style={{ color: S.WHITE, fontSize: 13, fontWeight: '700', width: 34, textAlign: 'right' }}>{row.points}</Text>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </LinearGradient>
  );
}
