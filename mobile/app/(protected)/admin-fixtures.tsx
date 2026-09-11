import { useState, useEffect, useMemo } from 'react';
import { View, TouchableOpacity, ActivityIndicator, Alert, Platform, useWindowDimensions } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import {
  collection, doc, onSnapshot, query, where, orderBy,
  getDocs, writeBatch, updateDoc, deleteDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { generateRoundRobinFixtures } from '@/lib/fixtures';
import { parseFixtureCSV, validateFixtureRows, type FixtureImportResult } from '@/lib/fixtureImport';
import { importFixtures } from '@/lib/importFixtures';
import { pickCSVFile } from '@/lib/pickCSVFile';
import { friendlyFirestoreError } from '@/lib/friendlyFirestoreError';
import { RAW } from '@/lib/theme';
import { STATUS_LABEL, STATUS_TONE, isFixtureException } from '@/lib/matchStatus';
import { Screen, Heading, Body, Caption, Badge, Button, Card, ListRow, Input, Label, Sheet, AppBar } from '@/components/ui';
import { AdminShell } from '@/components/admin/AdminShell';
import type { Match } from '@/types';

// Desktop-vs-mobile is a viewport-width call, not Platform.OS — a wide
// browser window gets the table/wide-panel treatment, a narrow one (phone,
// or a browser window sized down) keeps the existing card-list layout. All
// state/handlers above are shared; only the JSX below this point branches.
const DESKTOP_BREAKPOINT = 768;

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

function groupByRound(matches: Match[]): [number, Match[]][] {
  const byRound = new Map<number, Match[]>();
  matches.forEach((m) => {
    if (!byRound.has(m.round)) byRound.set(m.round, []);
    byRound.get(m.round)!.push(m);
  });
  return [...byRound.entries()].sort((a, b) => a[0] - b[0]);
}

// Confirmed matches go to the full result editor; disputed ones go to the
// admin resolution screen — used by the Results tab, distinct from
// `openEdit` below (which is for the date/venue sheet on not-yet-played
// fixtures, though it also redirects a confirmed row the same way).
function openResult(match: Match) {
  if (match.status === 'disputed') {
    router.push(`/(protected)/admin-dispute?matchId=${match.id}`);
    return;
  }
  router.push(`/(protected)/results-entry?matchId=${match.id}`);
}

// A distinct, review-oriented table for played matches — no generator/
// delete-all header (those are Fixtures-tab concerns), sorted most-recent
// first, disputed rows flagged so they read as needing attention.
function ResultsTable({
  matches, teamName, onOpen,
}: {
  matches: Match[];
  teamName: (id: string) => string;
  onOpen: (match: Match) => void;
}) {
  return (
    <Card padded={false}>
      <View className="flex-row items-center justify-between p-4 border-b border-border dark:border-border-dark">
        <Heading size="sm">{matches.length} result{matches.length === 1 ? '' : 's'}</Heading>
      </View>
      <View className="flex-row px-4 py-2.5 bg-surface-2 dark:bg-surface-2-dark">
        <Caption className="w-14">Round</Caption>
        <Caption className="flex-1">Home</Caption>
        <Caption className="flex-1">Away</Caption>
        <Caption className="w-24">Score</Caption>
        <Caption className="w-36">Date</Caption>
        <Caption className="w-32">Status</Caption>
      </View>
      {matches.map((match, i) => {
        const tone = STATUS_TONE[match.status];
        return (
          <TouchableOpacity
            key={match.id}
            activeOpacity={0.6}
            onPress={() => onOpen(match)}
            className={[
              'flex-row items-center px-4 py-3',
              i < matches.length - 1 ? 'border-b border-border dark:border-border-dark' : '',
            ].join(' ')}
          >
            <Body size="sm" className="w-14">{match.round}</Body>
            <Body size="sm" tone="strong" weight="semibold" className="flex-1" numberOfLines={1}>{teamName(match.homeTeamId)}</Body>
            <Body size="sm" tone="strong" weight="semibold" className="flex-1" numberOfLines={1}>{teamName(match.awayTeamId)}</Body>
            <Body size="sm" className="w-24">{match.homeLegsWon ?? '–'}-{match.awayLegsWon ?? '–'}</Body>
            <Body size="sm" className="w-36">{formatDate(match.scheduledDate)}</Body>
            <View className="w-32">
              {tone ? <Badge tone={tone}>{STATUS_LABEL[match.status]}</Badge> : <Body size="sm">{STATUS_LABEL[match.status]}</Body>}
            </View>
          </TouchableOpacity>
        );
      })}
    </Card>
  );
}

// One continuous table (not grouped per-round like the mobile card list) —
// at desktop width a full season reads better as a single scannable grid
// than as repeated per-round sections.
function DesktopFixtureTable({
  matches, teamName, onEdit, onDeleteAll,
}: {
  matches: Match[];
  teamName: (id: string) => string;
  onEdit: (match: Match) => void;
  onDeleteAll: () => void;
}) {
  return (
    <Card padded={false}>
      <View className="flex-row items-center justify-between p-4 border-b border-border dark:border-border-dark">
        <Heading size="sm">{matches.length} fixtures</Heading>
        <Button variant="danger" size="sm" onPress={onDeleteAll}>Delete all &amp; regenerate</Button>
      </View>
      <View className="flex-row px-4 py-2.5 bg-surface-2 dark:bg-surface-2-dark">
        <Caption className="w-14">Round</Caption>
        <Caption className="flex-1">Home</Caption>
        <Caption className="flex-1">Away</Caption>
        <Caption className="w-36">Date</Caption>
        <Caption className="flex-1">Venue</Caption>
        <Caption className="w-32">Status</Caption>
      </View>
      {matches.map((match, i) => {
        const tone = STATUS_TONE[match.status];
        return (
          <TouchableOpacity
            key={match.id}
            activeOpacity={0.6}
            onPress={() => onEdit(match)}
            className={[
              'flex-row items-center px-4 py-3',
              i < matches.length - 1 ? 'border-b border-border dark:border-border-dark' : '',
            ].join(' ')}
          >
            <Body size="sm" className="w-14">{match.round}</Body>
            <Body size="sm" tone="strong" weight="semibold" className="flex-1" numberOfLines={1}>{teamName(match.homeTeamId)}</Body>
            <Body size="sm" tone="strong" weight="semibold" className="flex-1" numberOfLines={1}>{teamName(match.awayTeamId)}</Body>
            <Body size="sm" className="w-36">{formatDate(match.scheduledDate)}</Body>
            <Body size="sm" className="flex-1" numberOfLines={1}>{match.venue ?? '—'}</Body>
            <View className="w-32">
              {tone ? <Badge tone={tone}>{STATUS_LABEL[match.status]}</Badge> : <Body size="sm">{STATUS_LABEL[match.status]}</Body>}
            </View>
          </TouchableOpacity>
        );
      })}
    </Card>
  );
}

// Everything a fixtures workspace needs, independent of where it's rendered
// (its own standalone route, or as a tab inside admin-season.tsx's division
// workspace) — extracted so both call sites share one implementation rather
// than maintaining two copies of the generate/edit/delete logic.
function useFixturesController(divisionId: string | undefined, leagueId: string | undefined) {
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

  // Bulk CSV import (Phase 11)
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<FixtureImportResult | null>(null);
  const [importParseError, setImportParseError] = useState<string | null>(null);
  const [isPickingFile, setIsPickingFile] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  useEffect(() => {
    if (!divisionId || !leagueId) return;

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
      query(
        collection(db, 'teams'),
        where('leagueId', '==', leagueId),
        where('divisionId', '==', divisionId),
      ),
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
        where('leagueId', '==', leagueId),
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
  }, [divisionId, leagueId]);

  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? 'Unknown';

  const rounds = useMemo(() => groupByRound(matches), [matches]);

  async function generateFixtures() {
    setGenError(null);
    const startDate = parseDateInput(startDateText);
    if (!startDate) { setGenError('Enter the start date as YYYY-MM-DD'); return; }
    const interval = Number(intervalDays);
    if (!Number.isFinite(interval) || interval <= 0) { setGenError('Enter a valid number of days between rounds'); return; }
    if (teams.length < 2) { setGenError('This division needs at least 2 teams first'); return; }
    if (!leagueId || !seasonId || !divisionId) { setGenError('Season not loaded yet — try again in a moment'); return; }

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
          leagueId,
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

  // Web-only (see pickCSVFile.ts) — reads the file, parses it, then
  // validates every row against this division's own teams and its
  // already-loaded fixtures before anything is shown as "ready". Nothing is
  // written to Firestore at this stage.
  async function pickAndValidateCSV() {
    setImportParseError(null);
    setImportResult(null);
    setIsPickingFile(true);
    try {
      const file = await pickCSVFile();
      if (!file) return;
      setImportFileName(file.name);
      const { rows, headerError } = parseFixtureCSV(file.text);
      if (headerError) { setImportParseError(headerError); return; }
      setImportResult(validateFixtureRows(
        rows,
        teams.map((t) => ({ id: t.id, name: t.name })),
        matches.map((m) => ({ homeTeamId: m.homeTeamId, awayTeamId: m.awayTeamId, scheduledDate: m.scheduledDate })),
      ));
    } finally {
      setIsPickingFile(false);
    }
  }

  function closeImportSheet() {
    setImportFileName(null);
    setImportResult(null);
    setImportParseError(null);
  }

  async function confirmImport() {
    if (!importResult || importResult.ready.length === 0 || !leagueId || !seasonId || !divisionId) return;
    setIsImporting(true);
    try {
      await importFixtures(importResult.ready, { leagueId, seasonId, divisionId });
      closeImportSheet();
    } catch (e: unknown) {
      Alert.alert('Import failed', friendlyFirestoreError(e));
    } finally {
      setIsImporting(false);
    }
  }

  // BUG-002 fix: bulk delete must be at least as safe as the single-fixture
  // delete path (deleteFixture below, which refuses anything but a
  // 'scheduled' match) — previously this wiped every match in the division
  // unconditionally, confirmed/disputed/awaiting-confirmation included.
  async function deleteAllFixtures() {
    const nonScheduled = matches.filter((m) => m.status !== 'scheduled');
    if (nonScheduled.length > 0) {
      Alert.alert(
        'Can’t regenerate fixtures',
        `${nonScheduled.length} fixture${nonScheduled.length === 1 ? '' : 's'} in ${divisionName} ${nonScheduled.length === 1 ? 'is' : 'are'} no longer just scheduled (a result recorded, or postponed/cancelled). Regenerating would leave that history behind or duplicate it, so it's blocked while any exist — resolve those fixtures first, or delete individual still-scheduled fixtures one at a time instead.`,
        [{ text: 'OK' }],
      );
      return;
    }

    const expectedCount = matches.length;
    Alert.alert(
      'Delete all fixtures',
      `Delete all ${expectedCount} fixtures for ${divisionName}? This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All', style: 'destructive',
          onPress: async () => {
            // Defense in depth against a race (e.g. a result gets submitted
            // in the moment between opening this dialog and confirming it):
            // scope the actual delete query to status=='scheduled' so this
            // is structurally incapable of deleting a fixture with any
            // result recorded, regardless of what the check above saw.
            const snap = await getDocs(query(
              collection(db, 'matches'),
              where('leagueId', '==', leagueId),
              where('divisionId', '==', divisionId),
              where('status', '==', 'scheduled'),
            ));
            if (snap.size !== expectedCount) {
              Alert.alert('Fixtures changed', 'Something changed since you opened this screen — please review the fixtures and try again.');
              return;
            }
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
    // Confirmed matches go to the full result editor (score/players/180s/
    // checkouts, with stats recomputed on save) rather than this date/venue
    // sheet, which only ever made sense pre-result.
    if (match.status === 'confirmed') {
      router.push(`/(protected)/results-entry?matchId=${match.id}`);
      return;
    }
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
        // Saving a new date for a postponed fixture is how it gets
        // rescheduled — reuses this same edit sheet rather than a separate
        // reschedule flow, per the approved plan.
        ...(editTarget.status === 'postponed' ? { status: 'scheduled' } : {}),
      });
      setEditTarget(null);
    } catch (e: unknown) {
      Alert.alert('Error', friendlyFirestoreError(e));
    } finally {
      setIsSavingEdit(false);
    }
  }

  // Postponed/cancelled fixtures never received a result, so deleting them
  // is as safe as deleting a still-scheduled one — unlike a confirmed or
  // disputed match, which represents (or partially represents) real
  // submitted results. Confirmed-match deletion has its own separate flow
  // (results-entry.tsx's deleteMatch), not this one.
  async function deleteFixture() {
    if (!editTarget) return;
    if (editTarget.status !== 'scheduled' && !isFixtureException(editTarget.status)) {
      Alert.alert('Can’t delete', 'This fixture already has results submitted against it.');
      return;
    }
    try {
      await deleteDoc(doc(db, 'matches', editTarget.id));
      setEditTarget(null);
    } catch (e: unknown) {
      Alert.alert('Error', friendlyFirestoreError(e));
    }
  }

  // Only offered from a scheduled fixture, per the approved plan — a fixture
  // already postponed/cancelled/awaiting confirmation/disputed/confirmed
  // isn't a valid target for a fresh postpone/cancel decision.
  async function markPostponed() {
    if (!editTarget) return;
    try {
      await updateDoc(doc(db, 'matches', editTarget.id), { status: 'postponed' });
      setEditTarget(null);
    } catch (e: unknown) {
      Alert.alert('Error', friendlyFirestoreError(e));
    }
  }

  async function markCancelled() {
    if (!editTarget) return;
    try {
      await updateDoc(doc(db, 'matches', editTarget.id), { status: 'cancelled' });
      setEditTarget(null);
    } catch (e: unknown) {
      Alert.alert('Error', friendlyFirestoreError(e));
    }
  }

  function confirmMarkPostponed() {
    if (!editTarget) return;
    const target = editTarget;
    Alert.alert(
      'Postpone this fixture',
      `${teamName(target.homeTeamId)} vs ${teamName(target.awayTeamId)} will be marked postponed — captains won't be able to submit a result until it's rescheduled.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Postpone', onPress: markPostponed },
      ],
    );
  }

  function confirmMarkCancelled() {
    if (!editTarget) return;
    const target = editTarget;
    Alert.alert(
      'Cancel this fixture',
      `${teamName(target.homeTeamId)} vs ${teamName(target.awayTeamId)} will be marked cancelled. This is terminal for the season — if it needs to be played after all, create a new fixture instead.`,
      [
        { text: 'Back', style: 'cancel' },
        { text: 'Mark Cancelled', style: 'destructive', onPress: markCancelled },
      ],
    );
  }

  const showGenerator = !isLoading && (matches.length === 0 || isRegenerating);

  return {
    divisionName, teams, matches, isLoading, loadError,
    startDateText, setStartDateText, intervalDays, setIntervalDays, isGenerating, genError, isRegenerating, setIsRegenerating,
    editTarget, setEditTarget, editDateText, setEditDateText, editVenue, setEditVenue, isSavingEdit,
    teamName, rounds, generateFixtures, deleteAllFixtures, openEdit, saveEdit, deleteFixture, showGenerator,
    confirmMarkPostponed, confirmMarkCancelled,
    importFileName, importResult, importParseError, isPickingFile, isImporting,
    pickAndValidateCSV, closeImportSheet, confirmImport,
  };
}

type FixturesController = ReturnType<typeof useFixturesController>;

// statusFilter narrows what's displayed without changing showGenerator's
// "has anything ever been created" check (still based on the full list) —
// omitted entirely by the standalone route/mobile card list (unchanged
// behavior there), passed by admin-season.tsx's Fixtures tab to show only
// what's still to be played, now that Results has its own place for the rest.
function FixturesBody({ c, isDesktop, statusFilter }: { c: FixturesController; isDesktop: boolean; statusFilter?: Match['status'][] }) {
  const displayMatches = statusFilter ? c.matches.filter((m) => statusFilter.includes(m.status)) : c.matches;
  const displayRounds = statusFilter ? groupByRound(displayMatches) : c.rounds;

  return (
    <>
      {c.loadError ? (
        <Card tone="coral">
          <Body tone="coral" weight="semibold" className="mb-1">Couldn't load fixtures</Body>
          <Body tone="coral" size="sm">{c.loadError}</Body>
        </Card>
      ) : c.isLoading ? (
        <ActivityIndicator color={RAW.brand} style={{ marginTop: 40 }} />
      ) : c.showGenerator ? (
        <Card>
          <Heading size="lg" className="mb-1.5">Generate Fixtures</Heading>
          <Body size="sm" className="mb-5">
            {c.teams.length} teams — every team plays every other team twice (home & away).
            {c.teams.length > 0 ? ` That's ${c.teams.length * (c.teams.length - 1)} matches.` : ''}
          </Body>

          {c.genError ? (
            <Card tone="coral" className="mb-4" padded={false}>
              <Body tone="coral" className="p-3">{c.genError}</Body>
            </Card>
          ) : null}

          {isDesktop ? (
            <View className="flex-row gap-4 mb-6">
              <View className="flex-1">
                <Label>First round date (YYYY-MM-DD)</Label>
                <Input value={c.startDateText} onChangeText={c.setStartDateText} placeholder="e.g. 2026-09-10" autoCapitalize="none" autoCorrect={false} />
              </View>
              <View className="flex-1">
                <Label>Days between rounds</Label>
                <Input value={c.intervalDays} onChangeText={c.setIntervalDays} placeholder="7" keyboardType="number-pad" />
              </View>
            </View>
          ) : (
            <>
              <Label>First round date (YYYY-MM-DD)</Label>
              <Input value={c.startDateText} onChangeText={c.setStartDateText} placeholder="e.g. 2026-09-10" autoCapitalize="none" autoCorrect={false} className="mb-4" />

              <Label>Days between rounds</Label>
              <Input value={c.intervalDays} onChangeText={c.setIntervalDays} placeholder="7" keyboardType="number-pad" className="mb-6" />
            </>
          )}

          <Button onPress={c.generateFixtures} disabled={c.isGenerating || c.teams.length < 2} loading={c.isGenerating}>
            Generate Fixtures
          </Button>

          {c.isRegenerating && (
            <Button variant="ghost" className="mt-3.5" onPress={() => c.setIsRegenerating(false)}>Cancel</Button>
          )}
        </Card>
      ) : isDesktop ? (
        <DesktopFixtureTable matches={displayMatches} teamName={c.teamName} onEdit={c.openEdit} onDeleteAll={c.deleteAllFixtures} />
      ) : (
        <>
          <Button variant="danger" size="sm" className="self-end mb-3" onPress={c.deleteAllFixtures}>
            Delete all & regenerate
          </Button>

          {displayRounds.map(([round, roundMatches]) => (
            <View key={round} className="mb-5">
              <Caption className="mb-2">Round {round} · {formatDate(roundMatches[0].scheduledDate)}</Caption>
              <View className="gap-2">
                {roundMatches.map((match) => (
                  <ListRow
                    key={match.id}
                    title={`${c.teamName(match.homeTeamId)} vs ${c.teamName(match.awayTeamId)}`}
                    subtitle={`${match.venue ?? 'No venue set'}${match.status !== 'scheduled' ? ` · ${STATUS_LABEL[match.status]}` : ''}`}
                    onPress={() => c.openEdit(match)}
                  />
                ))}
              </View>
            </View>
          ))}
        </>
      )}

      {/* Decoupled from showGenerator on purpose (Phase 15 / P1 fix): the
          importer's own validation already checks every row against the
          division's full existing match list, so it's already safe to run
          whether the division is empty, partway through a season, or has
          results recorded — an admin correcting or adding one fixture must
          never be forced through "Delete all & regenerate" to reach it. */}
      {!c.loadError && !c.isLoading && Platform.OS === 'web' && (
        <Button
          variant="secondary"
          className="mt-3"
          onPress={c.pickAndValidateCSV}
          disabled={c.isPickingFile}
          loading={c.isPickingFile}
        >
          Import Fixtures (CSV)
        </Button>
      )}

      <Sheet visible={!!c.editTarget} onClose={() => c.setEditTarget(null)}>
        <Heading size="lg" className="mb-1">
          {c.editTarget?.status === 'cancelled' ? 'Cancelled Fixture' : c.editTarget?.status === 'postponed' ? 'Reschedule Fixture' : 'Edit Fixture'}
        </Heading>
        <Body size="sm" className="mb-5">
          {c.editTarget ? `${c.teamName(c.editTarget.homeTeamId)} vs ${c.teamName(c.editTarget.awayTeamId)}` : ''}
        </Body>

        {c.editTarget?.status === 'cancelled' ? (
          <>
            <Card tone="coral" className="mb-5">
              <Body tone="coral" size="sm">
                This fixture has been cancelled. If it needs to be played after all, create a new fixture instead.
              </Body>
            </Card>
            <Button variant="danger" onPress={c.deleteFixture}>Delete this fixture</Button>
          </>
        ) : (
          <>
            {c.editTarget?.status === 'postponed' && (
              <Card tone="butter" className="mb-4">
                <Body size="sm">This fixture is postponed. Saving a new date below will reschedule it.</Body>
              </Card>
            )}

            <Label>Date (YYYY-MM-DD)</Label>
            <Input value={c.editDateText} onChangeText={c.setEditDateText} autoCapitalize="none" autoCorrect={false} className="mb-4" />

            <Label>Venue</Label>
            <Input value={c.editVenue} onChangeText={c.setEditVenue} placeholder="e.g. The Red Lion, 12 High St" autoCapitalize="words" className="mb-6" />

            <View className="flex-row gap-2.5 mb-3">
              <Button variant="ghost" className="flex-1" onPress={() => c.setEditTarget(null)}>Cancel</Button>
              <Button className="flex-1" disabled={c.isSavingEdit} loading={c.isSavingEdit} onPress={c.saveEdit}>
                {c.editTarget?.status === 'postponed' ? 'Reschedule' : 'Save'}
              </Button>
            </View>

            {c.editTarget?.status === 'scheduled' && (
              <View className="flex-row gap-2.5 mb-3">
                <Button variant="secondary" className="flex-1" onPress={c.confirmMarkPostponed}>Mark Postponed</Button>
                <Button variant="danger" className="flex-1" onPress={c.confirmMarkCancelled}>Mark Cancelled</Button>
              </View>
            )}

            {(c.editTarget?.status === 'scheduled' || c.editTarget?.status === 'postponed') && (
              <Button variant="danger" onPress={c.deleteFixture}>Delete this fixture</Button>
            )}
          </>
        )}
      </Sheet>

      <Sheet visible={!!c.importParseError || !!c.importResult} onClose={c.closeImportSheet}>
        <Heading size="lg" className="mb-1">Import Preview</Heading>
        {c.importFileName ? <Body size="sm" className="mb-4">{c.importFileName}</Body> : null}

        {c.importParseError ? (
          <>
            <Card tone="coral" className="mb-5" padded={false}>
              <Body tone="coral" className="p-3">{c.importParseError}</Body>
            </Card>
            <Button variant="ghost" onPress={c.closeImportSheet}>Close</Button>
          </>
        ) : c.importResult ? (
          <>
            <Body className="mb-4">
              {c.importResult.ready.length + c.importResult.errors.length} fixture{c.importResult.ready.length + c.importResult.errors.length === 1 ? '' : 's'} found
            </Body>

            <View className="flex-row gap-2 mb-4">
              <Badge tone="sage">✓ {c.importResult.ready.length} ready</Badge>
              {c.importResult.errors.length > 0 && <Badge tone="coral">⚠ {c.importResult.errors.length} error{c.importResult.errors.length === 1 ? '' : 's'}</Badge>}
            </View>

            {c.importResult.errors.length > 0 && (
              <View className="gap-2 mb-5">
                {c.importResult.errors.map((err) => (
                  <Card key={err.rowNumber} tone="coral" padded={false}>
                    <View className="p-3">
                      <Caption className="mb-0.5 text-coral-ink dark:text-coral-ink-dark">Row {err.rowNumber}</Caption>
                      <Body size="sm" tone="coral">{err.message}</Body>
                    </View>
                  </Card>
                ))}
              </View>
            )}

            <View className="flex-row gap-2.5">
              <Button variant="ghost" className="flex-1" disabled={c.isImporting} onPress={c.closeImportSheet}>Cancel</Button>
              <Button
                className="flex-1"
                disabled={c.isImporting || c.importResult.ready.length === 0}
                loading={c.isImporting}
                onPress={c.confirmImport}
              >
                Import {c.importResult.ready.length} Fixture{c.importResult.ready.length === 1 ? '' : 's'}
              </Button>
            </View>
          </>
        ) : null}
      </Sheet>
    </>
  );
}

// Consumed by admin-season.tsx's Fixtures tab — calls the hook itself so the
// caller doesn't need to know about FixturesController's shape.
export function FixturesTab({ divisionId, leagueId, isDesktop, statusFilter }: {
  divisionId: string | undefined; leagueId: string | undefined; isDesktop: boolean; statusFilter?: Match['status'][];
}) {
  const c = useFixturesController(divisionId, leagueId);
  return <FixturesBody c={c} isDesktop={isDesktop} statusFilter={statusFilter} />;
}

function ResultsBody({ c }: { c: FixturesController }) {
  const results = useMemo(
    () => c.matches
      .filter((m) => m.status === 'confirmed' || m.status === 'disputed')
      .sort((a, b) => b.scheduledDate.getTime() - a.scheduledDate.getTime()),
    [c.matches],
  );

  if (c.loadError) {
    return (
      <Card tone="coral">
        <Body tone="coral" weight="semibold" className="mb-1">Couldn't load results</Body>
        <Body tone="coral" size="sm">{c.loadError}</Body>
      </Card>
    );
  }
  if (c.isLoading) return <ActivityIndicator color={RAW.brand} style={{ marginTop: 40 }} />;
  if (results.length === 0) {
    return (
      <Card className="items-center py-8">
        <Body tone="strong" weight="semibold">No results yet</Body>
        <Body size="sm" className="text-center mt-1">Confirmed and disputed matches will show up here once games have been played.</Body>
      </Card>
    );
  }
  return <ResultsTable matches={results} teamName={c.teamName} onOpen={openResult} />;
}

// Consumed by admin-season.tsx's Results tab.
export function ResultsTab({ divisionId, leagueId }: { divisionId: string | undefined; leagueId: string | undefined }) {
  const c = useFixturesController(divisionId, leagueId);
  return <ResultsBody c={c} />;
}

export default function AdminFixturesScreen() {
  const { divisionId } = useLocalSearchParams<{ divisionId: string }>();
  const { appUser } = useAuthStore();
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;
  const c = useFixturesController(divisionId, appUser?.leagueId ?? undefined);
  const title = c.divisionName ? `${c.divisionName} Fixtures` : 'Fixtures';

  if (isDesktop) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <AdminShell title={title} breadcrumb={[{ label: 'Dashboard', path: '/(protected)/(tabs)/admin' }, { label: 'Fixtures' }]}>
          <FixturesBody c={c} isDesktop />
        </AdminShell>
      </>
    );
  }

  return (
    <Screen header={<AppBar title={title} />}>
      <Stack.Screen options={{ headerShown: false }} />
      <FixturesBody c={c} isDesktop={false} />
    </Screen>
  );
}
