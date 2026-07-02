import { useState, useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Modal, TextInput, Alert } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import {
  collection, doc, onSnapshot, query, where, orderBy,
  getDocs, writeBatch, updateDoc, deleteDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { generateRoundRobinFixtures } from '@/lib/fixtures';
import type { Match } from '@/types';
import * as S from '@/styles/common';

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

    const unsubDivision = onSnapshot(doc(db, 'divisions', divisionId), (snap) => {
      if (snap.exists()) {
        setDivisionName(snap.data().name ?? '');
        setSeasonId(snap.data().seasonId ?? null);
      }
    });

    const unsubTeams = onSnapshot(
      query(collection(db, 'teams'), where('divisionId', '==', divisionId)),
      (snap) => {
        setTeams(
          snap.docs
            .map((d) => ({ id: d.id, name: d.data().name, address: d.data().address ?? null }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      },
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
    <LinearGradient colors={S.GRADIENT} style={{ flex: 1 }}>
      <Stack.Screen options={{ title: divisionName ? `${divisionName} Fixtures` : 'Fixtures' }} />
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        {isLoading ? (
          <ActivityIndicator color={S.BLUE} style={{ marginTop: 40 }} />
        ) : showGenerator ? (
          <BlurView intensity={20} tint="dark" style={{ borderRadius: 20, overflow: 'hidden' }}>
            <View style={S.glassCard}>
              <Text style={{ color: S.WHITE, fontSize: 20, fontWeight: '700', marginBottom: 6 }}>
                Generate Fixtures
              </Text>
              <Text style={{ color: S.WHITE_50, fontSize: 13, marginBottom: 20 }}>
                {teams.length} teams — every team plays every other team twice (home & away).
                {teams.length > 0 ? ` That's ${teams.length * (teams.length - 1)} matches.` : ''}
              </Text>

              {genError ? (
                <View style={S.errorBox}>
                  <Text style={{ color: S.RED }}>{genError}</Text>
                </View>
              ) : null}

              <Text style={S.label}>FIRST ROUND DATE (YYYY-MM-DD)</Text>
              <TextInput
                value={startDateText}
                onChangeText={setStartDateText}
                placeholder="e.g. 2026-09-10"
                placeholderTextColor={S.WHITE_30}
                autoCapitalize="none"
                autoCorrect={false}
                style={[S.input, { marginBottom: 16 }]}
              />

              <Text style={S.label}>DAYS BETWEEN ROUNDS</Text>
              <TextInput
                value={intervalDays}
                onChangeText={setIntervalDays}
                placeholder="7"
                placeholderTextColor={S.WHITE_30}
                keyboardType="number-pad"
                style={[S.input, { marginBottom: 24 }]}
              />

              <TouchableOpacity
                onPress={generateFixtures}
                disabled={isGenerating || teams.length < 2}
                style={isGenerating || teams.length < 2 ? S.primaryButtonDisabled : S.primaryButton}
                activeOpacity={0.8}
              >
                {isGenerating
                  ? <ActivityIndicator color={S.WHITE} />
                  : <Text style={S.primaryButtonText}>Generate Fixtures</Text>
                }
              </TouchableOpacity>

              {isRegenerating && (
                <TouchableOpacity onPress={() => setIsRegenerating(false)} style={{ marginTop: 14, alignItems: 'center' }}>
                  <Text style={{ color: S.WHITE_50 }}>Cancel</Text>
                </TouchableOpacity>
              )}
            </View>
          </BlurView>
        ) : (
          <>
            <TouchableOpacity
              onPress={deleteAllFixtures}
              style={{ alignSelf: 'flex-end', marginBottom: 12 }}
              activeOpacity={0.7}
            >
              <Text style={{ color: S.RED, fontSize: 13 }}>Delete all & regenerate</Text>
            </TouchableOpacity>

            {rounds.map(([round, roundMatches]) => (
              <View key={round} style={{ marginBottom: 20 }}>
                <Text style={{ color: S.WHITE_50, fontSize: 12, fontWeight: '700', marginBottom: 8 }}>
                  ROUND {round} · {formatDate(roundMatches[0].scheduledDate)}
                </Text>
                {roundMatches.map((match) => (
                  <TouchableOpacity
                    key={match.id}
                    onPress={() => openEdit(match)}
                    activeOpacity={0.7}
                    style={{
                      padding: 14, borderRadius: 12, marginBottom: 8,
                      backgroundColor: 'rgba(255,255,255,0.07)',
                      borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
                    }}
                  >
                    <Text style={{ color: S.WHITE, fontWeight: '600' }}>
                      {teamName(match.homeTeamId)} <Text style={{ color: S.WHITE_50 }}>vs</Text> {teamName(match.awayTeamId)}
                    </Text>
                    <Text style={{ color: S.WHITE_50, fontSize: 12, marginTop: 2 }}>
                      {match.venue ?? 'No venue set'}
                      {match.status !== 'scheduled' ? ` · ${match.status}` : ''}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ))}
          </>
        )}
      </ScrollView>

      {/* Edit fixture modal */}
      <Modal visible={!!editTarget} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', padding: 24 }}>
          <BlurView intensity={30} tint="dark" style={{ borderRadius: 20, overflow: 'hidden' }}>
            <View style={S.glassCard}>
              <Text style={{ color: S.WHITE, fontSize: 20, fontWeight: '700', marginBottom: 4 }}>
                Edit Fixture
              </Text>
              <Text style={{ color: S.WHITE_50, fontSize: 13, marginBottom: 20 }}>
                {editTarget ? `${teamName(editTarget.homeTeamId)} vs ${teamName(editTarget.awayTeamId)}` : ''}
              </Text>

              <Text style={S.label}>DATE (YYYY-MM-DD)</Text>
              <TextInput
                value={editDateText}
                onChangeText={setEditDateText}
                placeholderTextColor={S.WHITE_30}
                autoCapitalize="none"
                autoCorrect={false}
                style={[S.input, { marginBottom: 16 }]}
              />

              <Text style={S.label}>VENUE</Text>
              <TextInput
                value={editVenue}
                onChangeText={setEditVenue}
                placeholder="e.g. The Red Lion, 12 High St"
                placeholderTextColor={S.WHITE_30}
                autoCapitalize="words"
                style={[S.input, { marginBottom: 24 }]}
              />

              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
                <TouchableOpacity
                  onPress={() => setEditTarget(null)}
                  style={{ flex: 1, padding: 14, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center' }}
                >
                  <Text style={{ color: S.WHITE_60 }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={saveEdit}
                  disabled={isSavingEdit}
                  style={[isSavingEdit ? S.primaryButtonDisabled : S.primaryButton, { flex: 1 }]}
                >
                  {isSavingEdit ? <ActivityIndicator color={S.WHITE} /> : <Text style={S.primaryButtonText}>Save</Text>}
                </TouchableOpacity>
              </View>

              {editTarget?.status === 'scheduled' && (
                <TouchableOpacity onPress={deleteFixture} style={{ alignItems: 'center', paddingVertical: 6 }}>
                  <Text style={{ color: S.RED, fontSize: 13 }}>Delete this fixture</Text>
                </TouchableOpacity>
              )}
            </View>
          </BlurView>
        </View>
      </Modal>
    </LinearGradient>
  );
}
