import { useState, useEffect, useMemo } from 'react';
import { View, ScrollView, TouchableOpacity, ActivityIndicator, useWindowDimensions } from 'react-native';
import { router, Stack } from 'expo-router';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { Alert } from '@/lib/alert';
import { parseDateInput, formatDateInput, formatDate } from '@/lib/dates';
import { RAW, type SemanticTone } from '@/lib/theme';
import {
  Screen, Heading, Body, Caption, Badge, Button, Card, Chip, Input, Label, Sheet, AppBar,
} from '@/components/ui';
import { AdminShell } from '@/components/admin/AdminShell';
import type { Cup, CupRound, CupTie, CupTieStatus } from '@/types';

const DESKTOP_BREAKPOINT = 768;

interface SeasonInfo { id: string; name: string }
interface TeamInfo { id: string; name: string; seasonId: string }

const TIE_STATUS_LABEL: Record<CupTieStatus, string> = {
  pending: 'Waiting',
  scheduled: 'Upcoming',
  awaiting_confirmation: 'Awaiting confirmation',
  disputed: 'Disputed',
  confirmed: 'Final',
  bye: 'Bye',
};

const TIE_STATUS_TONE: Record<CupTieStatus, SemanticTone | null> = {
  pending: null,
  scheduled: null,
  awaiting_confirmation: 'butter',
  disputed: 'coral',
  confirmed: 'sage',
  bye: 'butter',
};

// A local, cosmetic-only echo of the Cloud Function's nextPowerOfTwo/
// cupRoundName (functions/src/index.ts) — used purely to preview "here's
// what the bracket will look like" before creating it. The real bracket
// (byes, pairings, advancement wiring) is only ever computed once, server-
// side in adminCreateCup, so there's no risk of this preview and the real
// draw ever disagreeing about anything that actually matters.
function previewRounds(teamCount: number): string[] {
  if (teamCount < 2) return [];
  let bracketSize = 1;
  while (bracketSize < teamCount) bracketSize *= 2;
  const names: string[] = [];
  let slots = bracketSize;
  while (slots >= 2) {
    names.push(slots === 2 ? 'Final' : slots === 4 ? 'Semi-Final' : slots === 8 ? 'Quarter-Final' : `Round of ${slots}`);
    slots /= 2;
  }
  return names;
}

export default function AdminCupScreen() {
  const { appUser } = useAuthStore();
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;
  const leagueId = appUser?.leagueId ?? null;

  const [seasons, setSeasons] = useState<SeasonInfo[]>([]);
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [allTeamNames, setAllTeamNames] = useState<Record<string, string>>({});
  const [cups, setCups] = useState<Cup[]>([]);
  const [selectedCupId, setSelectedCupId] = useState<string | null>(null);
  const [rounds, setRounds] = useState<CupRound[]>([]);
  const [ties, setTies] = useState<CupTie[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [cupName, setCupName] = useState('Team Knockout Cup');
  const [selectedTeamIds, setSelectedTeamIds] = useState<Set<string>>(new Set());
  const [startDateText, setStartDateText] = useState('');
  const [intervalDays, setIntervalDays] = useState('14');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!leagueId) return;
    const onErr = (e: unknown) => { setLoadError((e as Error).message ?? 'Something went wrong'); setIsLoading(false); };
    const unsubSeasons = onSnapshot(
      query(collection(db, 'seasons'), where('leagueId', '==', leagueId)),
      (snap) => {
        setSeasons(snap.docs.map((d) => ({ id: d.id, name: d.data().name })).sort((a, b) => b.name.localeCompare(a.name)));
        setIsLoading(false);
      },
      onErr,
    );
    const unsubTeams = onSnapshot(
      query(collection(db, 'teams'), where('leagueId', '==', leagueId)),
      (snap) => {
        const names: Record<string, string> = {};
        snap.docs.forEach((d) => { names[d.id] = d.data().name; });
        setAllTeamNames(names);
      },
      onErr,
    );
    return () => { unsubSeasons(); unsubTeams(); };
  }, [leagueId]);

  useEffect(() => {
    if (!leagueId || !seasonId) { setTeams([]); return; }
    const unsub = onSnapshot(
      query(collection(db, 'teams'), where('leagueId', '==', leagueId), where('seasonId', '==', seasonId)),
      (snap) => setTeams(
        snap.docs
          .map((d) => ({ id: d.id, name: d.data().name, seasonId: d.data().seasonId } as TeamInfo))
          .sort((a, b) => a.name.localeCompare(b.name)),
      ),
      (e) => Alert.alert('Error', (e as Error).message ?? 'Something went wrong'),
    );
    return unsub;
  }, [leagueId, seasonId]);

  useEffect(() => {
    if (!leagueId || !seasonId) { setCups([]); return; }
    const unsub = onSnapshot(
      query(collection(db, 'cups'), where('leagueId', '==', leagueId), where('seasonId', '==', seasonId)),
      (snap) => setCups(snap.docs.map((d) => ({
        id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate() ?? new Date(),
      } as Cup))),
      (e) => Alert.alert('Error', (e as Error).message ?? 'Something went wrong'),
    );
    return unsub;
  }, [leagueId, seasonId]);

  useEffect(() => {
    setSelectedCupId(cups.length === 1 ? cups[0].id : null);
  }, [cups]);

  useEffect(() => {
    if (!leagueId || !selectedCupId) { setRounds([]); setTies([]); return; }
    // Both fields must be explicit query filters, not just cupId — the
    // security rule checks leagueId too, and Firestore rejects a list query
    // outright unless every field the rule touches is also a filter on the
    // query itself (same reason matches/cupTies elsewhere in this app filter
    // by leagueId explicitly rather than relying on cupId/divisionId alone).
    const unsubRounds = onSnapshot(
      query(collection(db, 'cupRounds'), where('leagueId', '==', leagueId), where('cupId', '==', selectedCupId)),
      (snap) => {
        const list: CupRound[] = snap.docs.map((d) => ({
          id: d.id, ...d.data(), scheduledDate: d.data().scheduledDate?.toDate() ?? new Date(),
        } as CupRound));
        setRounds(list.sort((a, b) => a.order - b.order));
      },
      (e) => Alert.alert('Error', (e as Error).message ?? 'Something went wrong'),
    );
    const unsubTies = onSnapshot(
      query(collection(db, 'cupTies'), where('leagueId', '==', leagueId), where('cupId', '==', selectedCupId)),
      (snap) => setTies(snap.docs.map((d) => ({
        id: d.id, ...d.data(), scheduledDate: d.data().scheduledDate?.toDate() ?? new Date(),
      } as CupTie))),
      (e) => Alert.alert('Error', (e as Error).message ?? 'Something went wrong'),
    );
    return () => { unsubRounds(); unsubTies(); };
  }, [leagueId, selectedCupId]);

  function openCreate() {
    setSelectedTeamIds(new Set(teams.map((t) => t.id)));
    setCupName('Team Knockout Cup');
    setStartDateText('');
    setIntervalDays('14');
    setCreateError(null);
    setShowCreate(true);
  }

  function toggleTeam(teamId: string) {
    setSelectedTeamIds((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId); else next.add(teamId);
      return next;
    });
  }

  async function createCup() {
    setCreateError(null);
    if (!leagueId || !seasonId) return;
    if (!cupName.trim()) { setCreateError('Give the cup a name'); return; }
    if (selectedTeamIds.size < 2) { setCreateError('Pick at least 2 teams'); return; }
    const startDate = parseDateInput(startDateText);
    if (!startDate) { setCreateError('Enter the first round date as YYYY-MM-DD'); return; }
    const interval = Number(intervalDays);
    if (!Number.isFinite(interval) || interval <= 0) { setCreateError('Enter a valid number of days between rounds'); return; }

    setIsCreating(true);
    try {
      const result = await httpsCallable(functions, 'adminCreateCup')({
        leagueId, seasonId, name: cupName.trim(), teamIds: [...selectedTeamIds],
        startDate: formatDateInput(startDate), intervalDays: interval,
      });
      const { cupId } = result.data as { cupId: string };
      setSelectedCupId(cupId);
      setShowCreate(false);
    } catch (e: unknown) {
      setCreateError((e as Error).message ?? 'Something went wrong');
    } finally {
      setIsCreating(false);
    }
  }

  const selectedCup = cups.find((c) => c.id === selectedCupId) ?? null;

  function confirmDeleteCup() {
    if (!selectedCup) return;
    Alert.alert(
      'Delete this cup',
      `Delete "${selectedCup.name}" and its entire bracket? Blocked if any tie has a confirmed result. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: deleteCup },
      ],
    );
  }

  async function deleteCup() {
    if (!selectedCup) return;
    setIsDeleting(true);
    try {
      await httpsCallable(functions, 'adminDeleteCup')({ cupId: selectedCup.id });
      setSelectedCupId(null);
    } catch (e: unknown) {
      Alert.alert("Can't delete cup", (e as Error).message ?? 'Something went wrong');
    } finally {
      setIsDeleting(false);
    }
  }

  const roundsWithTies = useMemo(
    () => rounds.map((round) => ({
      round,
      ties: ties.filter((t) => t.cupRoundId === round.id).sort((a, b) => a.id.localeCompare(b.id)),
    })),
    [rounds, ties],
  );

  function openTie(tie: CupTie) {
    router.push(`/(protected)/results-entry?cupTieId=${tie.id}` as never);
  }

  function tieLabel(tie: CupTie): string {
    const home = tie.homeTeamId ? allTeamNames[tie.homeTeamId] ?? '?' : 'TBD';
    if (tie.status === 'bye') return `${home} — bye`;
    const away = tie.awayTeamId ? allTeamNames[tie.awayTeamId] ?? '?' : 'TBD';
    return `${home} vs ${away}`;
  }

  const preview = previewRounds(selectedTeamIds.size);

  const body = (
    <>
      <View className="flex-row items-center mb-4">
        <Heading size="sm" className="flex-1">Season</Heading>
      </View>
      {seasons.length === 0 ? (
        <Card className="items-center py-6 mb-5">
          <Body size="sm">No seasons yet — create one from the Dashboard first.</Body>
        </Card>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-5" contentContainerStyle={{ gap: 8 }}>
          {seasons.map((s) => (
            <Chip key={s.id} label={s.name} selected={seasonId === s.id} onPress={() => setSeasonId(s.id)} />
          ))}
        </ScrollView>
      )}

      {loadError ? (
        <Card tone="coral"><Body tone="coral">{loadError}</Body></Card>
      ) : isLoading ? (
        <ActivityIndicator color={RAW.brand} style={{ marginTop: 40 }} />
      ) : !seasonId ? (
        <Card className="items-center py-8">
          <Body tone="strong" weight="semibold">Pick a season above</Body>
        </Card>
      ) : cups.length === 0 ? (
        <Card>
          <Heading size="lg" className="mb-1.5">Team Knockout Cup</Heading>
          <Body size="sm" className="mb-5">
            {teams.length} team{teams.length === 1 ? '' : 's'} in this season, cross-division. Draws a
            single-elimination bracket — teams that don't divide evenly get a bye in round 1.
          </Body>
          <Button onPress={openCreate} disabled={teams.length < 2}>Create &amp; Draw Cup</Button>
          {teams.length < 2 && <Body size="xs" className="mt-2">This season needs at least 2 teams first.</Body>}
        </Card>
      ) : cups.length > 1 && !selectedCupId ? (
        <View className="gap-2">
          {cups.map((c) => (
            <TouchableOpacity
              key={c.id}
              activeOpacity={0.7}
              onPress={() => setSelectedCupId(c.id)}
              className="p-4 rounded-2xl bg-surface-2 dark:bg-surface-2-dark"
            >
              <Body tone="strong" weight="semibold">{c.name}</Body>
              <Body size="sm">{c.teamIds.length} teams · {c.status}</Body>
            </TouchableOpacity>
          ))}
        </View>
      ) : selectedCup ? (
        <>
          <View className="flex-row items-center justify-between mb-4">
            <View>
              <Heading size="lg">{selectedCup.name}</Heading>
              <Body size="sm">
                {selectedCup.status === 'completed' && selectedCup.winnerTeamId
                  ? `Winner: ${allTeamNames[selectedCup.winnerTeamId] ?? '?'}`
                  : `${selectedCup.teamIds.length} teams · ${selectedCup.status}`}
              </Body>
            </View>
            <Button variant="danger" size="sm" disabled={isDeleting} loading={isDeleting} onPress={confirmDeleteCup}>
              Delete Cup
            </Button>
          </View>

          {roundsWithTies.map(({ round, ties: roundTies }) => (
            <Card key={round.id} className="mb-4" padded={false}>
              <View className="flex-row items-center justify-between p-4 border-b border-border dark:border-border-dark">
                <Heading size="sm">{round.name}</Heading>
                <Caption>{formatDate(round.scheduledDate)}</Caption>
              </View>
              {roundTies.map((tie, i) => {
                const tone = TIE_STATUS_TONE[tie.status];
                return (
                  <TouchableOpacity
                    key={tie.id}
                    activeOpacity={0.6}
                    onPress={() => openTie(tie)}
                    className={[
                      'flex-row items-center justify-between px-4 py-3',
                      i < roundTies.length - 1 ? 'border-b border-border dark:border-border-dark' : '',
                    ].join(' ')}
                  >
                    <Body tone="strong" weight="semibold" numberOfLines={1} className="flex-1 mr-2">{tieLabel(tie)}</Body>
                    {tie.status === 'confirmed' && (
                      <Body size="sm" className="mr-3">
                        {tie.homeLegsWon}-{tie.awayLegsWon}
                      </Body>
                    )}
                    {tone ? <Badge tone={tone}>{TIE_STATUS_LABEL[tie.status]}</Badge> : <Body size="sm">{TIE_STATUS_LABEL[tie.status]}</Body>}
                  </TouchableOpacity>
                );
              })}
            </Card>
          ))}
        </>
      ) : null}

      <Sheet visible={showCreate} onClose={() => setShowCreate(false)}>
        <ScrollView>
          <Heading size="lg" className="mb-4">Create &amp; Draw Cup</Heading>

          <Label>Name</Label>
          <Input value={cupName} onChangeText={setCupName} autoCapitalize="words" className="mb-4" />

          <Label>First round date (YYYY-MM-DD)</Label>
          <Input value={startDateText} onChangeText={setStartDateText} placeholder="e.g. 2026-05-20" autoCapitalize="none" autoCorrect={false} className="mb-4" />

          <Label>Days between rounds</Label>
          <Input value={intervalDays} onChangeText={setIntervalDays} placeholder="14" keyboardType="number-pad" className="mb-4" />

          <Label>Teams entering ({selectedTeamIds.size})</Label>
          <View className="flex-row flex-wrap gap-2 mb-2">
            {teams.map((t) => (
              <Chip key={t.id} label={t.name} selected={selectedTeamIds.has(t.id)} onPress={() => toggleTeam(t.id)} />
            ))}
          </View>

          {preview.length > 0 && (
            <Body size="xs" className="mb-4">
              Bracket: {preview.reverse().join(' → ')}
              {selectedTeamIds.size > 0 && (2 ** Math.ceil(Math.log2(selectedTeamIds.size))) !== selectedTeamIds.size
                ? ` (${(2 ** Math.ceil(Math.log2(selectedTeamIds.size))) - selectedTeamIds.size} bye${(2 ** Math.ceil(Math.log2(selectedTeamIds.size))) - selectedTeamIds.size === 1 ? '' : 's'} in round 1)`
                : ''}
            </Body>
          )}

          {createError && (
            <Card tone="coral" className="mb-4" padded={false}>
              <Body tone="coral" className="p-3">{createError}</Body>
            </Card>
          )}

          <View className="flex-row gap-2.5">
            <Button variant="ghost" className="flex-1" disabled={isCreating} onPress={() => setShowCreate(false)}>Cancel</Button>
            <Button className="flex-1" disabled={isCreating || selectedTeamIds.size < 2} loading={isCreating} onPress={createCup}>
              Draw Bracket
            </Button>
          </View>
        </ScrollView>
      </Sheet>
    </>
  );

  if (isDesktop) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <AdminShell title="Team Knockout Cup" breadcrumb={[{ label: 'Dashboard', path: '/(protected)/(tabs)/admin' }, { label: 'Cup' }]}>
          <View style={{ maxWidth: 780 }}>{body}</View>
        </AdminShell>
      </>
    );
  }

  return (
    <Screen header={<AppBar title="Cup" />}>
      <Stack.Screen options={{ headerShown: false }} />
      {body}
    </Screen>
  );
}
