import { useState, useEffect, useMemo } from 'react';
import { View, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import {
  collection, doc, onSnapshot, query, where, orderBy,
  getDocs, writeBatch, updateDoc, deleteDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { generateRoundRobinFixtures } from '@/lib/fixtures';
import { RAW } from '@/lib/theme';
import { Screen, Heading, Body, Caption, Button, Card, ListRow, Input, Label, Sheet, AppBar } from '@/components/ui';
import type { Match } from '@/types';

interface TeamInfo { id: string; name: string; address: string | null }

function parseDateInput(text: string): Date | null {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

export default function AdminFixturesScreen() {
  const { divisionId } = useLocalSearchParams<{ divisionId: string }>();
  const { appUser } = useAuthStore();

  const [divisionName, setDivisionName] = useState('');
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [startDateText, setStartDateText] = useState('');
  const [intervalDays, setIntervalDays] = useState('7');
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);

  const [editTarget, setEditTarget] = useState<Match | null>(null);
  const [editDateText, setEditDateText] = useState('');
  const [editVenue, setEditVenue] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  useEffect(() => {
    if (!divisionId || !appUser?.leagueId) return;

    const unsubDivision = onSnapshot(
      doc(db, 'divisions', divisionId),
      (snap) => {
        if (snap.exists()) {
          setDivisionName(snap.data().name ?? '');
          setSeasonId(snap.data().seasonId ?? null);
        }
      },
      (e) => setLoadError(e.message),
    );

    const unsubTeams = onSnapshot(
      query(collection(db, 'teams'), where('divisionId', '==', divisionId)),
      (snap) => {
        setTeams(
          snap.docs
            .map((d) => ({ id: d.id, name: d.data().name, address: d.data().address ?? null }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      },
      (e) => setLoadError(e.message),
    );

    const unsubMatches = onSnapshot(
      query(
        collection(db, 'matches'),
        where('leagueId', '==', appUser.leagueId),
        where('divisionId', '==', divisionId),
        orderBy('scheduledDate', 'asc'),
      ),
      (snap) => {
        setMatches(
          snap.docs.map((d) => ({
            id: d.id,
            ...d.data(),
            scheduledDate: d.data().scheduledDate?.toDate() ?? new Date(),
          } as Match)),
        );
        setIsLoading(false);
      },
      (e) => { setLoadError(e.message); setIsLoading(false); },
    );

    return () => { unsubDivision(); unsubTeams(); unsubMatches(); };
  }, [divisionId, appUser?.leagueId]);

  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? 'Unknown';

  const rounds = useMemo(() => {
    const byRound = new Map<number, Match[]>();
    matches.forEach((m) => {
      if (!byRound.has(m.round)) byRound.set(m.round, []);
      byRound.get(m.round)!.push(m);
    });
    return [...byRound.entries()].sort((a, b) => a[0] - b[0]);
  }, [matches]);

  async function generateFixtures() {
    setGenError(null);
    const startDate = parseDateInput(startDateText);
    if (!startDate) { setGenError('Enter the start date as YYYY-MM-DD'); return; }
    const interval = Number(intervalDays);
    if (!Number.isFinite(interval) || interval <= 0) { setGenError('Enter a valid number of days between rounds'); return; }
    if (teams.length < 2) { setGenError('This division needs at least 2 teams first'); return; }
    if (!appUser?.leagueId || !seasonId || !divisionId) { setGenError('Season not loaded yet — try again in a moment'); return; }

    setIsGenerating(true);
    try {
      const fixtures = generateRoundRobinFixtures(
        teams.map((t) => ({ id: t.id })),
        { startDate, intervalDays: interval },
      );

      const batch = writeBatch(db);
      fixtures.forEach((fixture) => {
        const matchRef = doc(collection(db, 'matches'));
        batch.set(matchRef, {
          leagueId: appUser.leagueId,
          seasonId,
          divisionId,
          round: fixture.round,
          homeTeamId: fixture.homeTeamId,
          awayTeamId: fixture.awayTeamId,
          scheduledDate: fixture.scheduledDate,
          venue: teams.find((t) => t.id === fixture.homeTeamId)?.address ?? null,
          status: 'scheduled',
          homeGamesWon: null,
          awayGamesWon: null,
          homeLegsWon: null,
          awayLegsWon: null,
          createdAt: serverTimestamp(),
        });
      });
      await batch.commit();
      setIsRegenerating(false);
    } catch (e: unknown) {
      setGenError((e as Error).message ?? 'Something went wrong');
    } finally {
      setIsGenerating(false);
    }
  }

  async function deleteAllFixtures() {
    Alert.alert(
      'Delete all fixtures',
      `Delete all ${matches.length} fixtures for ${divisionName}? This can't be undone — only do this if no results have been submitted yet.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All', style: 'destructive',
          onPress: async () => {
            const snap = await getDocs(query(collection(db, 'matches'), where('divisionId', '==', divisionId)));
            const batch = writeBatch(db);
            snap.docs.forEach((d) => batch.delete(d.ref));
            await batch.commit();
            setIsRegenerating(true);
          },
        },
      ],
    );
  }

  function openEdit(match: Match) {
    setEditTarget(match);
    const d = match.scheduledDate;
    setEditDateText(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    setEditVenue(match.venue ?? '');
  }

  async function saveEdit() {
    if (!editTarget) return;
    const parsed = parseDateInput(editDateText);
    if (!parsed) { Alert.alert('Invalid date', 'Enter the date as YYYY-MM-DD'); return; }
    setIsSavingEdit(true);
    try {
      await updateDoc(doc(db, 'matches', editTarget.id), {
        scheduledDate: parsed,
        venue: editVenue.trim() || null,
      });
      setEditTarget(null);
    } finally {
      setIsSavingEdit(false);
    }
  }

  async function deleteFixture() {
    if (!editTarget) return;
    if (editTarget.status !== 'scheduled') {
      Alert.alert('Can’t delete', 'This fixture already has results submitted against it.');
      return;
    }
    await deleteDoc(doc(db, 'matches', editTarget.id));
    setEditTarget(null);
  }

  const showGenerator = !isLoading && (matches.length === 0 || isRegenerating);

  return (
    <Screen header={<AppBar title={divisionName ? `${divisionName} Fixtures` : 'Fixtures'} />}>
      <Stack.Screen options={{ headerShown: false }} />
      {loadError ? (
        <Card tone="coral">
          <Body tone="coral" weight="semibold" className="mb-1">Couldn't load fixtures</Body>
          <Body tone="coral" size="sm">{loadError}</Body>
        </Card>
      ) : isLoading ? (
        <ActivityIndicator color={RAW.brand} style={{ marginTop: 40 }} />
      ) : showGenerator ? (
        <Card>
          <Heading size="lg" className="mb-1.5">Generate Fixtures</Heading>
          <Body size="sm" className="mb-5">
            {teams.length} teams — every team plays every other team twice (home & away).
            {teams.length > 0 ? ` That's ${teams.length * (teams.length - 1)} matches.` : ''}
          </Body>

          {genError ? (
            <Card tone="coral" className="mb-4" padded={false}>
              <Body tone="coral" className="p-3">{genError}</Body>
            </Card>
          ) : null}

          <Label>First round date (YYYY-MM-DD)</Label>
          <Input value={startDateText} onChangeText={setStartDateText} placeholder="e.g. 2026-09-10" autoCapitalize="none" autoCorrect={false} className="mb-4" />

          <Label>Days between rounds</Label>
          <Input value={intervalDays} onChangeText={setIntervalDays} placeholder="7" keyboardType="number-pad" className="mb-6" />

          <Button onPress={generateFixtures} disabled={isGenerating || teams.length < 2} loading={isGenerating}>
            Generate Fixtures
          </Button>

          {isRegenerating && (
            <Button variant="ghost" className="mt-3.5" onPress={() => setIsRegenerating(false)}>Cancel</Button>
          )}
        </Card>
      ) : (
        <>
          <Button variant="danger" size="sm" className="self-end mb-3" onPress={deleteAllFixtures}>
            Delete all & regenerate
          </Button>

          {rounds.map(([round, roundMatches]) => (
            <View key={round} className="mb-5">
              <Caption className="mb-2">Round {round} · {formatDate(roundMatches[0].scheduledDate)}</Caption>
              <View className="gap-2">
                {roundMatches.map((match) => (
                  <ListRow
                    key={match.id}
                    title={`${teamName(match.homeTeamId)} vs ${teamName(match.awayTeamId)}`}
                    subtitle={`${match.venue ?? 'No venue set'}${match.status !== 'scheduled' ? ` · ${match.status}` : ''}`}
                    onPress={() => openEdit(match)}
                  />
                ))}
              </View>
            </View>
          ))}
        </>
      )}

      {/* Edit fixture modal */}
      <Sheet visible={!!editTarget} onClose={() => setEditTarget(null)}>
        <Heading size="lg" className="mb-1">Edit Fixture</Heading>
        <Body size="sm" className="mb-5">
          {editTarget ? `${teamName(editTarget.homeTeamId)} vs ${teamName(editTarget.awayTeamId)}` : ''}
        </Body>

        <Label>Date (YYYY-MM-DD)</Label>
        <Input value={editDateText} onChangeText={setEditDateText} autoCapitalize="none" autoCorrect={false} className="mb-4" />

        <Label>Venue</Label>
        <Input value={editVenue} onChangeText={setEditVenue} placeholder="e.g. The Red Lion, 12 High St" autoCapitalize="words" className="mb-6" />

        <View className="flex-row gap-2.5 mb-3">
          <Button variant="ghost" className="flex-1" onPress={() => setEditTarget(null)}>Cancel</Button>
          <Button className="flex-1" disabled={isSavingEdit} loading={isSavingEdit} onPress={saveEdit}>Save</Button>
        </View>

        {editTarget?.status === 'scheduled' && (
          <Button variant="danger" onPress={deleteFixture}>Delete this fixture</Button>
        )}
      </Sheet>
    </Screen>
  );
}
