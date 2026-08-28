import { useState, useEffect, useMemo } from 'react';
import { View, ScrollView, ActivityIndicator } from 'react-native';
import { useColorScheme } from 'nativewind';
import { collection, onSnapshot, query, where, orderBy } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { RAW } from '@/lib/theme';
import { Screen, Body, Caption, Stat, Chip, Card, AppIcon } from '@/components/ui';
import type { DivisionTable } from '@/types';

interface Division { id: string; name: string; order: number; seasonId: string }

export default function StandingsScreen() {
  const { appUser } = useAuthStore();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

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
    if (!selectedDivision || !appUser?.leagueId) { setIsLoading(false); return; }
    setIsLoading(true);
    const unsub = onSnapshot(
      query(
        collection(db, 'divisionTables'),
        where('leagueId', '==', appUser.leagueId),
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
  }, [appUser?.leagueId, selectedDivision?.seasonId, selectedDivision?.id]);

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
    <Screen>
      {divisions.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-4" contentContainerStyle={{ gap: 8 }}>
          {divisions.map((d) => (
            <Chip
              key={d.id}
              label={d.name}
              selected={d.id === selectedDivisionId}
              onPress={() => setSelectedDivisionId(d.id)}
            />
          ))}
        </ScrollView>
      )}

      {loadError ? (
        <Card tone="coral">
          <Body tone="coral">{loadError}</Body>
        </Card>
      ) : isLoading ? (
        <ActivityIndicator color={RAW.brand} style={{ marginTop: 40 }} />
      ) : rows.length === 0 ? (
        <Card className="items-center py-8">
          <View className="w-14 h-14 rounded-full items-center justify-center bg-brand-fill dark:bg-brand-fill-dark mb-3">
            <AppIcon name="table" size={28} color={isDark ? RAW.brandInkDark : RAW.brandInk} />
          </View>
          <Body tone="strong" weight="semibold" className="mb-1">No results yet</Body>
          <Body size="sm" className="text-center">
            The table fills in as matches are played.
          </Body>
        </Card>
      ) : (
        <View className="rounded-2xl overflow-hidden shadow-sm bg-surface dark:bg-surface-dark">
          {/* Header row */}
          <View className="flex-row py-2.5 px-3 bg-surface-2 dark:bg-surface-2-dark">
            <Caption className="w-6">#</Caption>
            <Caption className="flex-1">Team</Caption>
            {columns.map((c) => (
              <Caption key={c.key} className="w-9 text-right">{c.label}</Caption>
            ))}
          </View>
          {rows.map((row, i) => {
            const isMine = row.teamId === appUser?.teamId;
            return (
              <View
                key={row.id}
                className={[
                  'flex-row items-center py-3 px-3',
                  isMine ? 'bg-brand-fill dark:bg-brand-fill-dark' : i % 2 === 0 ? 'bg-surface-2/40 dark:bg-surface-2-dark/40' : '',
                ].join(' ')}
              >
                <Body size="sm" className="w-6">{row.position}</Body>
                <Body size="sm" tone={isMine ? 'strong' : 'dim'} weight={isMine ? 'bold' : 'normal'} className="flex-1" numberOfLines={1}>
                  {teamNames[row.teamId] ?? '…'}
                </Body>
                <Stat size="sm" className="w-9 text-right">{row.played}</Stat>
                <Stat size="sm" className="w-9 text-right">{row.won}</Stat>
                <Stat size="sm" className="w-9 text-right">{row.lost}</Stat>
                <Stat size="sm" className="w-9 text-right">
                  {row.legDiff > 0 ? `+${row.legDiff}` : row.legDiff}
                </Stat>
                <Stat size="sm" tone="brand" className="w-9 text-right">{row.points}</Stat>
              </View>
            );
          })}
        </View>
      )}
    </Screen>
  );
}
