import { useState, useEffect, useMemo } from 'react';
import { View, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { collection, doc, getDoc, onSnapshot, query, where, orderBy } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { RAW } from '@/lib/theme';
import { Screen, Heading, Body, Caption, Stat, Chip, Card, AppIcon } from '@/components/ui';
import type { DivisionTable, Season } from '@/types';

interface Division { id: string; name: string; order: number; seasonId: string }
interface TeamInfo { id: string; name: string; divisionId: string }

// Prefer the viewer's own current season (matches how every other screen in
// the app already defaults — Home, Player Profile, Team Profile) when it's
// actually one of this league's seasons; otherwise fall back to whichever
// season is 'active', else the most recently created one. This is the exact
// same fallback admin.tsx's own season picker already uses, applied here so
// a league/global admin with no personal season still lands somewhere sensible.
function resolveSeasonId(seasons: Season[], viewerSeasonId: string | null | undefined): string | null {
  if (viewerSeasonId && seasons.some((s) => s.id === viewerSeasonId)) return viewerSeasonId;
  const active = seasons.find((s) => s.status === 'active');
  return active?.id ?? seasons[0]?.id ?? null;
}

export default function StandingsScreen() {
  const { appUser } = useAuthStore();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  const [leagueName, setLeagueName] = useState<string | null>(null);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [selectedDivisionId, setSelectedDivisionId] = useState<string | null>(null);
  const [rows, setRows] = useState<DivisionTable[]>([]);
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [teamsLoaded, setTeamsLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // League name — one-time read, same pattern as Home/Player Profile/Team
  // Profile (this data essentially never changes).
  useEffect(() => {
    if (!appUser?.leagueId) return;
    getDoc(doc(db, 'leagues', appUser.leagueId)).then((s) => setLeagueName(s.exists() ? s.data().name : null));
  }, [appUser?.leagueId]);

  // League-wide team names (+ divisionId, for the "teams in this division"
  // count/empty-state below) — same query shape this screen already used
  // before, independent of season/division selection so it doesn't need to
  // re-subscribe every time the viewer picks a different one.
  useEffect(() => {
    if (!appUser?.leagueId) return;
    return onSnapshot(
      query(collection(db, 'teams'), where('leagueId', '==', appUser.leagueId)),
      (snap) => {
        setTeams(snap.docs.map((d) => ({ id: d.id, name: d.data().name, divisionId: d.data().divisionId } as TeamInfo)));
        setTeamsLoaded(true);
      },
    );
  }, [appUser?.leagueId]);

  // Seasons for this league — same query shape admin.tsx's own season
  // picker already uses. Resolving which season to show by default (rather
  // than always showing every division from every season mixed together,
  // which is what this screen did before) is what makes the division list
  // below correctly season-scoped.
  useEffect(() => {
    if (!appUser?.leagueId) return;
    return onSnapshot(
      query(collection(db, 'seasons'), where('leagueId', '==', appUser.leagueId)),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Season))
          .sort((a, b) => (b as any).createdAt?.seconds - (a as any).createdAt?.seconds);
        setSeasons(list);
        setSelectedSeasonId((prev) => (prev && list.some((s) => s.id === prev) ? prev : resolveSeasonId(list, appUser.seasonId)));
      },
      (e) => setLoadError(e.message),
    );
  }, [appUser?.leagueId, appUser?.seasonId]);

  useEffect(() => {
    if (!appUser?.leagueId || !selectedSeasonId) { setDivisions([]); setSelectedDivisionId(null); return; }

    return onSnapshot(
      query(collection(db, 'divisions'), where('leagueId', '==', appUser.leagueId), where('seasonId', '==', selectedSeasonId)),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Division))
          .sort((a, b) => a.order - b.order);
        setDivisions(list);
        setSelectedDivisionId((prev) => (
          prev && list.some((d) => d.id === prev) ? prev : (
            appUser.divisionId && list.some((d) => d.id === appUser.divisionId) ? appUser.divisionId : list[0]?.id ?? null
          )
        ));
      },
      (e) => setLoadError(e.message),
    );
  }, [appUser?.leagueId, appUser?.divisionId, selectedSeasonId]);

  const selectedSeason = seasons.find((s) => s.id === selectedSeasonId) ?? null;
  const selectedDivision = divisions.find((d) => d.id === selectedDivisionId) ?? null;
  const teamNames = useMemo(() => {
    const map: Record<string, string> = {};
    teams.forEach((t) => { map[t.id] = t.name; });
    return map;
  }, [teams]);
  const teamsInDivision = useMemo(
    () => (selectedDivisionId ? teams.filter((t) => t.divisionId === selectedDivisionId).length : 0),
    [teams, selectedDivisionId],
  );

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

  const contextLine = [selectedSeason?.name, selectedDivision?.name, teamsInDivision > 0 ? `${teamsInDivision} teams` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <Screen>
      <View className="mb-4">
        <Heading size="lg">{leagueName ?? '…'}</Heading>
        {contextLine ? <Body size="sm" className="mt-1">{contextLine}</Body> : null}
      </View>

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
      ) : seasons.length === 0 ? (
        <Card className="items-center py-8">
          <View className="w-14 h-14 rounded-full items-center justify-center bg-brand-fill dark:bg-brand-fill-dark mb-3">
            <AppIcon name="table" size={28} color={isDark ? RAW.brandInkDark : RAW.brandInk} />
          </View>
          <Body tone="strong" weight="semibold" className="mb-1">No season set up yet</Body>
          <Body size="sm" className="text-center">
            Your league admin hasn't created a season yet.
          </Body>
        </Card>
      ) : divisions.length === 0 ? (
        <Card className="items-center py-8">
          <View className="w-14 h-14 rounded-full items-center justify-center bg-brand-fill dark:bg-brand-fill-dark mb-3">
            <AppIcon name="table" size={28} color={isDark ? RAW.brandInkDark : RAW.brandInk} />
          </View>
          <Body tone="strong" weight="semibold" className="mb-1">No divisions yet</Body>
          <Body size="sm" className="text-center">
            {selectedSeason?.name ? `${selectedSeason.name} doesn't have any divisions yet.` : "This season doesn't have any divisions yet."}
          </Body>
        </Card>
      ) : teamsLoaded && teamsInDivision === 0 ? (
        <Card className="items-center py-8">
          <View className="w-14 h-14 rounded-full items-center justify-center bg-brand-fill dark:bg-brand-fill-dark mb-3">
            <AppIcon name="table" size={28} color={isDark ? RAW.brandInkDark : RAW.brandInk} />
          </View>
          <Body tone="strong" weight="semibold" className="mb-1">No teams in this division</Body>
          <Body size="sm" className="text-center">
            Teams will appear here once your league admin assigns them.
          </Body>
        </Card>
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
              <TouchableOpacity
                key={row.id}
                activeOpacity={0.7}
                onPress={() => router.push(`/(protected)/team-profile?teamId=${row.teamId}`)}
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
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </Screen>
  );
}
