import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Pressable, ActivityIndicator, useWindowDimensions } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useColorScheme } from 'nativewind';
import {
  collection, doc, onSnapshot, query, where, updateDoc, addDoc, serverTimestamp, getDocs, writeBatch,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { useAdminContextStore } from '@/stores/adminContextStore';
import { goBack } from '@/lib/navigation';
import { Alert } from '@/lib/alert';
import { RAW, type SemanticTone } from '@/lib/theme';
import { FONT_DISPLAY } from '@/styles/typography';
import { Screen, Heading, Body, Caption, Button, Card, Chip, ListRow, Input, Label, Sheet, StatTile, Badge, Avatar, AppIcon } from '@/components/ui';
import { AdminShell } from '@/components/admin/AdminShell';
import { VenuePickerSheet } from '@/components/admin/VenuePickerSheet';
import { parseDateInput, formatDateInput, formatDate } from '@/lib/dates';
import { generateSeasonFixtures } from '@/lib/fixtures';
import { FixturesTab, ResultsTab } from './admin-fixtures';
import { StandingsTab } from './admin-standings-override';
import type { Venue, SeasonBreak } from '@/types';

const DESKTOP_BREAKPOINT = 768;

interface Division { id: string; name: string; order: number }
interface Team { id: string; name: string; divisionId: string; captainUserId: string | null; venueId: string | null }

const STATUS_OPTIONS: { value: string; label: string; tone: SemanticTone }[] = [
  { value: 'upcoming', label: 'Upcoming', tone: 'butter' },
  { value: 'active', label: 'Active', tone: 'sage' },
  { value: 'completed', label: 'Completed', tone: 'brand' },
];

const WORKSPACE_TABS = [
  { value: 'teams', label: 'Teams' },
  { value: 'fixtures', label: 'Fixtures' },
  { value: 'results', label: 'Results' },
  { value: 'standings', label: 'Standings' },
] as const;
type WorkspaceTab = typeof WORKSPACE_TABS[number]['value'];

// Underline style, not pills — reads as a workspace with sub-views rather
// than a set of equally-weighted filter chips.
function WorkspaceTabBar({ active, onChange }: { active: WorkspaceTab; onChange: (tab: WorkspaceTab) => void }) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  return (
    <View className="flex-row gap-6 border-b border-admin-panel-border dark:border-admin-panel-border-dark mb-5">
      {WORKSPACE_TABS.map((t) => {
        const selected = active === t.value;
        return (
          <TouchableOpacity key={t.value} onPress={() => onChange(t.value)} activeOpacity={0.7}>
            <Text
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: 14.5,
                paddingVertical: 10,
                color: selected ? (isDark ? RAW.textDark : RAW.text) : (isDark ? RAW.textFaintDark : RAW.textFaint),
                borderBottomWidth: 2,
                borderBottomColor: selected ? (isDark ? RAW.brandDark : RAW.brand) : 'transparent',
              }}
            >
              {t.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

type TeamStatus = 'active' | 'pending' | 'incomplete';
const TEAM_STATUS_TONE: Record<TeamStatus, SemanticTone> = { active: 'sage', pending: 'butter', incomplete: 'coral' };
const TEAM_STATUS_LABEL: Record<TeamStatus, string> = { active: 'Active', pending: 'Pending Approval', incomplete: 'Incomplete' };

function TeamTableRow({
  team, venueName, players, played, won, lost, status, onPress, isLast,
}: {
  team: Team; venueName: string | null; players: number; played: number; won: number; lost: number; status: TeamStatus;
  onPress: () => void; isLast: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      className={[
        'flex-row items-center gap-2 px-4 py-3',
        isLast ? '' : 'border-b border-admin-panel-border dark:border-admin-panel-border-dark',
        hovered ? 'bg-surface-2 dark:bg-surface-2-dark' : '',
      ].join(' ')}
    >
      <View style={{ flex: 2.6 }} className="flex-row items-center gap-2.5 pr-2">
        <Avatar initial={team.name.charAt(0)} tone="brand" size="sm" />
        <View className="flex-1">
          <Body tone="strong" weight="semibold" size="sm" numberOfLines={1}>{team.name}</Body>
          <Caption className="normal-case tracking-normal font-normal" numberOfLines={1}>
            {team.captainUserId ? 'Captain assigned' : 'No captain'}
          </Caption>
        </View>
      </View>
      <Body size="sm" numberOfLines={1} style={{ flex: 2 }}>{venueName ?? 'Not set'}</Body>
      <Body size="sm" className="text-right" style={{ flex: 0.8 }}>{players}</Body>
      <Body size="sm" className="text-right" style={{ flex: 0.5 }}>{played}</Body>
      <Body size="sm" className="text-right" style={{ flex: 0.5 }}>{won}</Body>
      <Body size="sm" className="text-right" style={{ flex: 0.5 }}>{lost}</Body>
      <View style={{ flex: 1.4 }}>
        <Badge tone={TEAM_STATUS_TONE[status]}>{TEAM_STATUS_LABEL[status]}</Badge>
      </View>
      <View style={{ flex: 0.5 }} className="items-end">
        <AppIcon name="chevron-right" size={15} color={RAW.textFaint} />
      </View>
    </Pressable>
  );
}

function TeamsTable({
  teams, venuesById, playerCountByTeam, tableRowByTeam, pendingTeamIds, onOpenTeam,
}: {
  teams: Team[];
  venuesById: Record<string, Venue>;
  playerCountByTeam: Record<string, number>;
  tableRowByTeam: Record<string, { played: number; won: number; lost: number }>;
  pendingTeamIds: Set<string>;
  onOpenTeam: (teamId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = teams.filter((t) => t.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <View>
      <Input value={query} onChangeText={setQuery} placeholder="Filter teams…" className="mb-3" />
      <View className="rounded-2xl border border-admin-panel-border dark:border-admin-panel-border-dark bg-admin-panel dark:bg-admin-panel-dark overflow-hidden">
        <View className="flex-row items-center gap-2 px-4 py-2.5 border-b border-admin-panel-border dark:border-admin-panel-border-dark">
          <Caption style={{ flex: 2.6 }}>Team</Caption>
          <Caption style={{ flex: 2 }}>Home venue</Caption>
          <Caption className="text-right" style={{ flex: 0.8 }}>Players</Caption>
          <Caption className="text-right" style={{ flex: 0.5 }}>P</Caption>
          <Caption className="text-right" style={{ flex: 0.5 }}>W</Caption>
          <Caption className="text-right" style={{ flex: 0.5 }}>L</Caption>
          <Caption style={{ flex: 1.4 }}>Status</Caption>
          <View style={{ flex: 0.5 }} />
        </View>
        {filtered.length === 0 ? (
          <Body size="sm" className="text-center py-6">
            {query ? `No teams match "${query}"` : 'No teams yet in this division'}
          </Body>
        ) : (
          filtered.map((team, i) => {
            const rowStat = tableRowByTeam[team.id];
            const status: TeamStatus = pendingTeamIds.has(team.id)
              ? 'pending'
              : !team.captainUserId ? 'incomplete' : 'active';
            return (
              <TeamTableRow
                key={team.id}
                team={team}
                venueName={team.venueId ? venuesById[team.venueId]?.name ?? null : null}
                players={playerCountByTeam[team.id] ?? 0}
                played={rowStat?.played ?? 0}
                won={rowStat?.won ?? 0}
                lost={rowStat?.lost ?? 0}
                status={status}
                onPress={() => onOpenTeam(team.id)}
                isLast={i === filtered.length - 1}
              />
            );
          })
        )}
      </View>
    </View>
  );
}

export default function AdminSeasonScreen() {
  const { seasonId, divisionId, tab } = useLocalSearchParams<{ seasonId: string; divisionId?: string; tab?: WorkspaceTab }>();
  const { appUser } = useAuthStore();
  const adminContext = useAdminContextStore();
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;

  // Whichever division workspace is actually being viewed becomes the
  // persisted "current" one — so the sidebar's Teams/Fixtures/Results/
  // Standings shortcuts, and the context switcher, stay in sync no matter
  // how the admin got here (switcher, Dashboard's "Open", or a direct link).
  useEffect(() => {
    if (seasonId && divisionId) adminContext.setContext(seasonId, divisionId);
    // adminContext itself intentionally excluded — it's a new object identity
    // on every store update, which would otherwise refire this effect forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasonId, divisionId]);
  const activeTab: WorkspaceTab = tab ?? 'teams';

  const [seasonName, setSeasonName] = useState('');
  const [seasonStatus, setSeasonStatus] = useState('upcoming');
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [showAddTeam, setShowAddTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamDivisionId, setNewTeamDivisionId] = useState<string | null>(null);
  const [showTeamDivisionPicker, setShowTeamDivisionPicker] = useState(false);
  const [newTeamVenueId, setNewTeamVenueId] = useState<string | null>(null);
  const [showNewTeamVenuePicker, setShowNewTeamVenuePicker] = useState(false);
  const [isAddingTeam, setIsAddingTeam] = useState(false);

  const [venuesById, setVenuesById] = useState<Record<string, Venue>>({});

  const [showAddDivision, setShowAddDivision] = useState(false);
  const [newDivisionName, setNewDivisionName] = useState('');
  const [isAddingDivision, setIsAddingDivision] = useState(false);

  const [renameDivisionTarget, setRenameDivisionTarget] = useState<Division | null>(null);
  const [divisionNameDraft, setDivisionNameDraft] = useState('');
  const [isRenamingDivision, setIsRenamingDivision] = useState(false);

  const [showRenameSeason, setShowRenameSeason] = useState(false);
  const [seasonNameDraft, setSeasonNameDraft] = useState('');
  const [isRenamingSeason, setIsRenamingSeason] = useState(false);

  const [seasonStartDate, setSeasonStartDate] = useState<Date | null>(null);
  const [seasonBreaks, setSeasonBreaks] = useState<SeasonBreak[]>([]);
  const [showSchedule, setShowSchedule] = useState(false);
  const [startDateDraft, setStartDateDraft] = useState('');
  const [breaksDraft, setBreaksDraft] = useState<SeasonBreak[]>([]);
  const [newBreakLabel, setNewBreakLabel] = useState('');
  const [newBreakStart, setNewBreakStart] = useState('');
  const [newBreakEnd, setNewBreakEnd] = useState('');
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);

  // Division-scoped stat-card and Teams-table data. Separate from the
  // season-wide `teams` query above since players/matches/tables/pending
  // requests aren't otherwise loaded here.
  const [divisionPlayers, setDivisionPlayers] = useState<{ id: string; teamId: string }[]>([]);
  const [divisionMatches, setDivisionMatches] = useState<{ status: string }[]>([]);
  const [divisionTableRows, setDivisionTableRows] = useState<{ teamId: string; played: number; won: number; lost: number }[]>([]);
  const [pendingRequestTeamIds, setPendingRequestTeamIds] = useState<string[]>([]);
  const divisionPlayerCount = divisionPlayers.length;

  useEffect(() => {
    if (!divisionId || !appUser?.leagueId || !seasonId) return;
    const onErr = (e: unknown) => Alert.alert('Error', (e as Error).message ?? 'Something went wrong');
    const unsubPlayers = onSnapshot(
      query(collection(db, 'players'), where('divisionId', '==', divisionId)),
      (snap) => setDivisionPlayers(snap.docs.map((d) => ({ id: d.id, teamId: d.data().teamId as string }))),
      onErr,
    );
    // matches' read rule only checks leagueId (not divisionId), so that
    // filter has to be in the query too or Firestore rejects it outright —
    // see the note on this exact failure mode elsewhere in this codebase.
    const unsubMatches = onSnapshot(
      query(
        collection(db, 'matches'),
        where('leagueId', '==', appUser.leagueId),
        where('divisionId', '==', divisionId),
      ),
      (snap) => setDivisionMatches(snap.docs.map((d) => ({ status: d.data().status as string }))),
      onErr,
    );
    const unsubTables = onSnapshot(
      query(collection(db, 'divisionTables'), where('seasonId', '==', seasonId), where('divisionId', '==', divisionId)),
      (snap) => setDivisionTableRows(snap.docs.map((d) => ({
        teamId: d.data().teamId as string,
        played: (d.data().played as number) ?? 0,
        won: (d.data().won as number) ?? 0,
        lost: (d.data().lost as number) ?? 0,
      }))),
      onErr,
    );
    // One query for the whole league rather than one per team — grouped by
    // teamId client-side to flag which teams have a request awaiting review.
    const unsubRequests = onSnapshot(
      query(collection(db, 'joinRequests'), where('leagueId', '==', appUser.leagueId), where('status', '==', 'pending')),
      (snap) => setPendingRequestTeamIds(snap.docs.map((d) => d.data().teamId as string).filter(Boolean)),
      onErr,
    );
    return () => { unsubPlayers(); unsubMatches(); unsubTables(); unsubRequests(); };
  }, [divisionId, appUser?.leagueId, seasonId]);

  useEffect(() => {
    if (!appUser?.leagueId) return;
    const unsub = onSnapshot(
      query(collection(db, 'venues'), where('leagueId', '==', appUser.leagueId)),
      (snap) => {
        const byId: Record<string, Venue> = {};
        snap.docs.forEach((d) => { byId[d.id] = { id: d.id, ...d.data() } as Venue; });
        setVenuesById(byId);
      },
      (e) => Alert.alert('Error', (e as Error).message ?? 'Something went wrong'),
    );
    return unsub;
  }, [appUser?.leagueId]);

  useEffect(() => {
    if (!seasonId) return;

    const onErr = (e: unknown) => { setIsLoading(false); Alert.alert('Error', (e as Error).message ?? 'Something went wrong'); };

    const unsubSeason = onSnapshot(doc(db, 'seasons', seasonId), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setSeasonName(data.name);
        setSeasonStatus(data.status);
        setSeasonStartDate(data.startDate?.toDate() ?? null);
        setSeasonBreaks(
          (data.breaks ?? []).map((b: { start: { toDate(): Date }; end: { toDate(): Date }; label: string }) => ({
            start: b.start.toDate(), end: b.end.toDate(), label: b.label,
          })),
        );
      }
    }, onErr);

    const unsubDivisions = onSnapshot(
      query(collection(db, 'divisions'), where('seasonId', '==', seasonId)),
      (snap) => {
        setDivisions(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() } as Division))
            .sort((a, b) => a.order - b.order),
        );
      },
      onErr,
    );

    const unsubTeams = onSnapshot(
      query(collection(db, 'teams'), where('seasonId', '==', seasonId)),
      (snap) => {
        setTeams(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Team)));
        setIsLoading(false);
      },
      onErr,
    );

    return () => { unsubSeason(); unsubDivisions(); unsubTeams(); };
  }, [seasonId]);

  // Season-wide fixture count (every division, not just whichever one is
  // currently open) — purely to warn "Generate Fixtures for All Divisions"
  // isn't a clean slate if some fixtures already exist. Both fields need to
  // be in the query itself, not just leagueId: same reason as the per-
  // division matches query elsewhere in this codebase — Firestore requires
  // the fields the rule checks to appear as query constraints.
  const [seasonMatchCount, setSeasonMatchCount] = useState<number | null>(null);
  useEffect(() => {
    if (!seasonId || !appUser?.leagueId) return;
    const unsub = onSnapshot(
      query(collection(db, 'matches'), where('leagueId', '==', appUser.leagueId), where('seasonId', '==', seasonId)),
      (snap) => setSeasonMatchCount(snap.size),
      (e) => Alert.alert('Error', (e as Error).message ?? 'Something went wrong'),
    );
    return unsub;
  }, [seasonId, appUser?.leagueId]);

  async function setStatus(status: string) {
    if (!seasonId) return;

    // A league should only ever have one active season — the Dashboard's
    // "Active Season" stat and Teams count both assume this and silently
    // pick/sum the wrong thing if it's violated. Demote any other active
    // season to Completed in the same batch instead of just letting it happen.
    if (status === 'active' && appUser?.leagueId) {
      const others = (await getDocs(query(
        collection(db, 'seasons'),
        where('leagueId', '==', appUser.leagueId),
        where('status', '==', 'active'),
      ))).docs.filter((d) => d.id !== seasonId);

      if (others.length > 0) {
        const names = others.map((d) => d.data().name).join(', ');
        Alert.alert(
          'Mark this season active?',
          `${names} ${others.length > 1 ? 'are' : 'is'} currently marked active too. A league should only have one active season — continuing will mark ${others.length > 1 ? 'those seasons' : 'that season'} Completed.`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Continue',
              onPress: async () => {
                const batch = writeBatch(db);
                others.forEach((d) => batch.update(doc(db, 'seasons', d.id), { status: 'completed' }));
                batch.update(doc(db, 'seasons', seasonId), { status: 'active' });
                await batch.commit();
              },
            },
          ],
        );
        return;
      }
    }

    await updateDoc(doc(db, 'seasons', seasonId), { status });
  }

  async function addDivision() {
    if (!newDivisionName.trim() || !seasonId || !appUser?.leagueId) return;
    setIsAddingDivision(true);
    try {
      await addDoc(collection(db, 'divisions'), {
        leagueId: appUser.leagueId,
        seasonId,
        name: newDivisionName.trim(),
        order: divisions.length,
      });
      setNewDivisionName('');
      setShowAddDivision(false);
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error).message ?? 'Something went wrong');
    } finally {
      setIsAddingDivision(false);
    }
  }

  async function addTeam() {
    if (!newTeamName.trim() || !newTeamDivisionId || !appUser?.leagueId) return;
    setIsAddingTeam(true);
    try {
      await addDoc(collection(db, 'teams'), {
        leagueId: appUser.leagueId,
        seasonId,
        divisionId: newTeamDivisionId,
        name: newTeamName.trim(),
        venueId: newTeamVenueId,
        captainUserId: null,
        viceCaptainUserId: null,
        createdAt: serverTimestamp(),
      });
      setShowAddTeam(false);
      setNewTeamName('');
      setNewTeamDivisionId(null);
      setNewTeamVenueId(null);
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error).message ?? 'Something went wrong');
    } finally {
      setIsAddingTeam(false);
    }
  }

  function openAddTeam(divisionId: string | null) {
    setNewTeamName('');
    setNewTeamDivisionId(divisionId);
    setNewTeamVenueId(null);
    setShowAddTeam(true);
  }

  function openRenameDivision(division: Division) {
    setDivisionNameDraft(division.name);
    setRenameDivisionTarget(division);
  }

  async function saveDivisionName() {
    if (!renameDivisionTarget || !divisionNameDraft.trim()) return;
    setIsRenamingDivision(true);
    try {
      await updateDoc(doc(db, 'divisions', renameDivisionTarget.id), { name: divisionNameDraft.trim() });
      setRenameDivisionTarget(null);
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error).message ?? 'Something went wrong');
    } finally {
      setIsRenamingDivision(false);
    }
  }

  function openRenameSeason() {
    setSeasonNameDraft(seasonName);
    setShowRenameSeason(true);
  }

  async function saveSeasonName() {
    if (!seasonId || !seasonNameDraft.trim()) return;
    setIsRenamingSeason(true);
    try {
      await updateDoc(doc(db, 'seasons', seasonId), { name: seasonNameDraft.trim() });
      setShowRenameSeason(false);
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error).message ?? 'Something went wrong');
    } finally {
      setIsRenamingSeason(false);
    }
  }

  function openScheduleEditor() {
    setStartDateDraft(seasonStartDate ? formatDateInput(seasonStartDate) : '');
    setBreaksDraft(seasonBreaks);
    setNewBreakLabel('');
    setNewBreakStart('');
    setNewBreakEnd('');
    setScheduleError(null);
    setShowSchedule(true);
  }

  function addBreakDraft() {
    const start = parseDateInput(newBreakStart);
    const end = parseDateInput(newBreakEnd);
    if (!start || !end) { setScheduleError('Enter both break dates as YYYY-MM-DD'); return; }
    if (end < start) { setScheduleError('Break end date must be on or after the start date'); return; }
    setScheduleError(null);
    setBreaksDraft([...breaksDraft, { start, end, label: newBreakLabel.trim() || 'Break' }]);
    setNewBreakLabel('');
    setNewBreakStart('');
    setNewBreakEnd('');
  }

  function removeBreakDraft(index: number) {
    setBreaksDraft(breaksDraft.filter((_, i) => i !== index));
  }

  async function saveSchedule() {
    const startDate = startDateDraft.trim() ? parseDateInput(startDateDraft) : null;
    if (startDateDraft.trim() && !startDate) { setScheduleError('Enter the start date as YYYY-MM-DD, or leave it blank'); return; }
    if (!seasonId) return;
    setScheduleError(null);
    setIsSavingSchedule(true);
    try {
      await updateDoc(doc(db, 'seasons', seasonId), { startDate, breaks: breaksDraft });
      setShowSchedule(false);
    } catch (e: unknown) {
      setScheduleError((e as Error).message ?? 'Something went wrong');
    } finally {
      setIsSavingSchedule(false);
    }
  }

  const teamsForDivision = (divId: string) => teams.filter((t) => t.divisionId === divId);
  const unassignedTeams = teams.filter((t) => !divisions.find((d) => d.id === t.divisionId));
  const currentDivision = divisions.find((d) => d.id === divisionId) ?? null;

  const [deletingDivisionId, setDeletingDivisionId] = useState<string | null>(null);
  const [isDeletingSeason, setIsDeletingSeason] = useState(false);

  const [showGenerateAll, setShowGenerateAll] = useState(false);
  const [generateAllStartDateText, setGenerateAllStartDateText] = useState('');
  const [generateAllIntervalDays, setGenerateAllIntervalDays] = useState('7');
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [generateAllError, setGenerateAllError] = useState<string | null>(null);

  // Prefills from the season's own start date the first time it's
  // available — still just a starting point, admin can override.
  useEffect(() => {
    if (seasonStartDate && !generateAllStartDateText) setGenerateAllStartDateText(formatDateInput(seasonStartDate));
  }, [seasonStartDate, generateAllStartDateText]);

  async function generateAllFixtures() {
    setGenerateAllError(null);
    const startDate = parseDateInput(generateAllStartDateText);
    if (!startDate) { setGenerateAllError('Enter the start date as YYYY-MM-DD'); return; }
    const interval = Number(generateAllIntervalDays);
    if (!Number.isFinite(interval) || interval <= 0) { setGenerateAllError('Enter a valid number of days between rounds'); return; }
    if (!appUser?.leagueId || !seasonId) { setGenerateAllError('Season not loaded yet — try again in a moment'); return; }
    const eligibleDivisions = divisions.filter((d) => teamsForDivision(d.id).length >= 2);
    if (eligibleDivisions.length === 0) { setGenerateAllError('No division has 2+ teams yet'); return; }

    setIsGeneratingAll(true);
    try {
      const venueBoardCounts: Record<string, number> = {};
      Object.values(venuesById).forEach((v) => { venueBoardCounts[v.id] = v.boardCount; });

      const { fixturesByDivision, unresolvedClashes } = generateSeasonFixtures(
        eligibleDivisions.map((d) => ({
          divisionId: d.id,
          teams: teamsForDivision(d.id).map((t) => ({ id: t.id, venueId: t.venueId })),
        })),
        { startDate, intervalDays: interval, breaks: seasonBreaks, venueBoardCounts },
      );

      const writes: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];
      eligibleDivisions.forEach((division) => {
        const divTeams = teamsForDivision(division.id);
        (fixturesByDivision[division.id] ?? []).forEach((fixture) => {
          const matchRef = doc(collection(db, 'matches'));
          // Home team's own name, not the venue's — see the note on this in
          // admin-fixtures.tsx's generateFixtures.
          const homeTeamName = divTeams.find((t) => t.id === fixture.homeTeamId)?.name ?? null;
          writes.push((batch) => batch.set(matchRef, {
            leagueId: appUser.leagueId,
            seasonId,
            divisionId: division.id,
            round: fixture.round,
            homeTeamId: fixture.homeTeamId,
            awayTeamId: fixture.awayTeamId,
            scheduledDate: fixture.scheduledDate,
            venue: homeTeamName,
            status: 'scheduled',
            homeGamesWon: null,
            awayGamesWon: null,
            homeLegsWon: null,
            awayLegsWon: null,
            createdAt: serverTimestamp(),
          }));
        });
      });

      // Firestore batches cap at 500 writes — chunk defensively rather than
      // assume this league's size (or a bigger future one) always fits.
      const BATCH_LIMIT = 400;
      for (let i = 0; i < writes.length; i += BATCH_LIMIT) {
        const batch = writeBatch(db);
        writes.slice(i, i + BATCH_LIMIT).forEach((w) => w(batch));
        await batch.commit();
      }

      setShowGenerateAll(false);
      Alert.alert(
        'Fixtures generated',
        `Created ${writes.length} fixtures across ${eligibleDivisions.length} division${eligibleDivisions.length === 1 ? '' : 's'}.`
        + (unresolvedClashes.length > 0
          ? `\n\n${unresolvedClashes.length} venue clash${unresolvedClashes.length === 1 ? '' : 'es'} couldn't be fully avoided even across the whole season — check the affected divisions' Fixtures tabs and adjust manually.`
          : ''),
      );
    } catch (e: unknown) {
      setGenerateAllError((e as Error).message ?? 'Something went wrong');
    } finally {
      setIsGeneratingAll(false);
    }
  }

  function confirmDeleteDivision(division: Division) {
    Alert.alert(
      'Delete division',
      `Delete ${division.name}? This removes all its teams, players and any unplayed fixtures. Blocked if any team here has confirmed match results.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteDivision(division.id) },
      ],
    );
  }

  async function deleteDivision(targetDivisionId: string) {
    setDeletingDivisionId(targetDivisionId);
    try {
      await httpsCallable(functions, 'adminDeleteDivision')({ divisionId: targetDivisionId });
    } catch (e: unknown) {
      Alert.alert("Can't delete division", (e as Error).message ?? 'Something went wrong');
    } finally {
      setDeletingDivisionId(null);
    }
  }

  function confirmDeleteSeason() {
    Alert.alert(
      'Delete season',
      `Delete ${seasonName}? This removes every division, team, player and unplayed fixture in it. Blocked if any team here has confirmed match results.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: deleteSeason },
      ],
    );
  }

  async function deleteSeason() {
    if (!seasonId) return;
    setIsDeletingSeason(true);
    try {
      await httpsCallable(functions, 'adminDeleteSeason')({ seasonId });
      goBack();
    } catch (e: unknown) {
      Alert.alert("Can't delete season", (e as Error).message ?? 'Something went wrong');
    } finally {
      setIsDeletingSeason(false);
    }
  }

  const addTeamSheet = (
    <Sheet visible={showAddTeam} onClose={() => setShowAddTeam(false)}>
      <Heading size="lg" className="mb-4">Add Team</Heading>

      <Label>Team name</Label>
      <Input value={newTeamName} onChangeText={setNewTeamName} placeholder="e.g. The Arrows" autoCapitalize="words" autoFocus className="mb-4" />

      <Label>Division</Label>
      <Button variant="secondary" className="mb-4" onPress={() => setShowTeamDivisionPicker(true)}>
        {newTeamDivisionId ? divisions.find((d) => d.id === newTeamDivisionId)?.name ?? 'Selected' : 'Choose division'}
      </Button>

      <Label>Home venue (optional)</Label>
      <Button variant="secondary" className="mb-6" onPress={() => setShowNewTeamVenuePicker(true)}>
        {newTeamVenueId ? venuesById[newTeamVenueId]?.name ?? 'Selected' : 'Choose venue'}
      </Button>

      <View className="flex-row gap-2.5">
        <Button variant="ghost" className="flex-1" onPress={() => setShowAddTeam(false)}>Cancel</Button>
        <Button className="flex-1" disabled={isAddingTeam || !newTeamName.trim() || !newTeamDivisionId} loading={isAddingTeam} onPress={addTeam}>
          Add Team
        </Button>
      </View>
    </Sheet>
  );

  const teamDivisionPicker = (
    <Sheet visible={showTeamDivisionPicker} onClose={() => setShowTeamDivisionPicker(false)}>
      <Heading size="lg" className="mb-4">Choose Division</Heading>
      {divisions.length === 0 ? (
        <Body size="sm" className="mb-4">No divisions in this season yet — add one first.</Body>
      ) : (
        <View className="gap-2 mb-2">
          {divisions.map((d) => (
            <ListRow
              key={d.id}
              title={d.name}
              trailing={newTeamDivisionId === d.id ? <Body size="xs" tone="brand" weight="semibold">Selected</Body> : undefined}
              onPress={() => { setNewTeamDivisionId(d.id); setShowTeamDivisionPicker(false); }}
            />
          ))}
        </View>
      )}
      <Button variant="ghost" className="mt-2" onPress={() => setShowTeamDivisionPicker(false)}>Cancel</Button>
    </Sheet>
  );

  const addDivisionSheet = (
    <Sheet visible={showAddDivision} onClose={() => setShowAddDivision(false)}>
      <Heading size="lg" className="mb-4">Add Division</Heading>
      <Label>Division name</Label>
      <Input value={newDivisionName} onChangeText={setNewDivisionName} placeholder="e.g. Division 2" autoCapitalize="words" autoFocus className="mb-6" />
      <View className="flex-row gap-2.5">
        <Button variant="ghost" className="flex-1" onPress={() => setShowAddDivision(false)}>Cancel</Button>
        <Button className="flex-1" disabled={isAddingDivision || !newDivisionName.trim()} loading={isAddingDivision} onPress={addDivision}>
          Add
        </Button>
      </View>
    </Sheet>
  );

  const renameDivisionSheet = (
    <Sheet visible={!!renameDivisionTarget} onClose={() => setRenameDivisionTarget(null)}>
      <Heading size="lg" className="mb-4">Rename Division</Heading>
      <Label>Division name</Label>
      <Input value={divisionNameDraft} onChangeText={setDivisionNameDraft} autoCapitalize="words" autoFocus className="mb-6" />
      <View className="flex-row gap-2.5">
        <Button variant="ghost" className="flex-1" onPress={() => setRenameDivisionTarget(null)}>Cancel</Button>
        <Button className="flex-1" disabled={isRenamingDivision || !divisionNameDraft.trim()} loading={isRenamingDivision} onPress={saveDivisionName}>
          Save
        </Button>
      </View>
    </Sheet>
  );

  const renameSeasonSheet = (
    <Sheet visible={showRenameSeason} onClose={() => setShowRenameSeason(false)}>
      <Heading size="lg" className="mb-4">Rename Season</Heading>
      <Label>Season name</Label>
      <Input value={seasonNameDraft} onChangeText={setSeasonNameDraft} autoCapitalize="words" autoFocus className="mb-6" />
      <View className="flex-row gap-2.5">
        <Button variant="ghost" className="flex-1" onPress={() => setShowRenameSeason(false)}>Cancel</Button>
        <Button className="flex-1" disabled={isRenamingSeason || !seasonNameDraft.trim()} loading={isRenamingSeason} onPress={saveSeasonName}>
          Save
        </Button>
      </View>
    </Sheet>
  );

  const newTeamVenuePicker = appUser?.leagueId && (
    <VenuePickerSheet
      visible={showNewTeamVenuePicker}
      onClose={() => setShowNewTeamVenuePicker(false)}
      leagueId={appUser.leagueId}
      value={newTeamVenueId}
      onSelect={setNewTeamVenueId}
      allowCreate
    />
  );

  const scheduleCard = (
    <Card className="mb-5">
      <View className="flex-row items-center mb-2.5">
        <Heading size="sm" className="flex-1">Schedule</Heading>
        <Button variant="secondary" size="sm" onPress={openScheduleEditor}>Edit</Button>
      </View>
      <Caption className="mb-1">Start date</Caption>
      <Body size="sm" tone={seasonStartDate ? 'strong' : 'dim'} className="mb-3">
        {seasonStartDate ? formatDate(seasonStartDate) : 'Not set'}
      </Body>
      <Caption className="mb-1">Breaks</Caption>
      {seasonBreaks.length === 0 ? (
        <Body size="sm" tone="dim">None — fixtures generate straight through</Body>
      ) : (
        <View className="gap-1">
          {seasonBreaks.map((b, i) => (
            <Body size="sm" key={i}>{b.label}: {formatDate(b.start)} – {formatDate(b.end)}</Body>
          ))}
        </View>
      )}
    </Card>
  );

  const scheduleSheet = (
    <Sheet visible={showSchedule} onClose={() => setShowSchedule(false)}>
      <Heading size="lg" className="mb-4">Edit Schedule</Heading>
      <Label>Start date</Label>
      <Input value={startDateDraft} onChangeText={setStartDateDraft} placeholder="YYYY-MM-DD" className="mb-4" />

      <Label>Breaks (e.g. Christmas)</Label>
      {breaksDraft.length > 0 && (
        <View className="gap-2 mb-3">
          {breaksDraft.map((b, i) => (
            <View key={i} className="flex-row items-center justify-between p-2.5 rounded-xl bg-surface-2 dark:bg-surface-2-dark">
              <View className="flex-1">
                <Body size="sm" tone="strong" weight="semibold">{b.label}</Body>
                <Caption className="normal-case tracking-normal font-normal mt-0.5">{formatDate(b.start)} – {formatDate(b.end)}</Caption>
              </View>
              <TouchableOpacity onPress={() => removeBreakDraft(i)}>
                <Body size="xs" tone="coral" weight="semibold">Remove</Body>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      <Input value={newBreakLabel} onChangeText={setNewBreakLabel} placeholder="Label, e.g. Christmas" autoCapitalize="words" className="mb-2" />
      <View className="flex-row gap-2 mb-2">
        <Input value={newBreakStart} onChangeText={setNewBreakStart} placeholder="Start YYYY-MM-DD" className="flex-1" />
        <Input value={newBreakEnd} onChangeText={setNewBreakEnd} placeholder="End YYYY-MM-DD" className="flex-1" />
      </View>
      <Button variant="secondary" size="sm" className="mb-4" onPress={addBreakDraft}>+ Add Break</Button>

      {scheduleError && <Body size="sm" tone="coral" className="mb-3">{scheduleError}</Body>}

      <View className="flex-row gap-2.5">
        <Button variant="ghost" className="flex-1" disabled={isSavingSchedule} onPress={() => setShowSchedule(false)}>Cancel</Button>
        <Button className="flex-1" disabled={isSavingSchedule} loading={isSavingSchedule} onPress={saveSchedule}>Save</Button>
      </View>
    </Sheet>
  );

  const generateAllSheet = (
    <Sheet visible={showGenerateAll} onClose={() => setShowGenerateAll(false)}>
      <Heading size="lg" className="mb-1">Generate Fixtures for All Divisions</Heading>
      <Body size="sm" className="mb-5">
        {divisions.length} division{divisions.length === 1 ? '' : 's'}, {teams.length} teams total.
        Generating every division together — rather than one at a time — lets the scheduler avoid venue
        clashes between teams in *different* divisions that share a venue, which generating one division
        at a time can't see at all. Every fixture stays on its designated match night; clashes are avoided
        by choosing which week each pairing falls in, never by moving a match to a different day.
      </Body>

      {generateAllError ? (
        <Card tone="coral" className="mb-4" padded={false}>
          <Body tone="coral" className="p-3">{generateAllError}</Body>
        </Card>
      ) : null}

      {seasonMatchCount != null && seasonMatchCount > 0 && (
        <Card tone="butter" className="mb-4">
          <Body size="sm">
            This season already has {seasonMatchCount} fixture{seasonMatchCount === 1 ? '' : 's'}. Generating
            again adds more rather than replacing them — delete existing fixtures from each division's
            Fixtures tab first if you want a clean slate.
          </Body>
        </Card>
      )}

      <Label>First round date (YYYY-MM-DD)</Label>
      <Input
        value={generateAllStartDateText}
        onChangeText={setGenerateAllStartDateText}
        placeholder="e.g. 2026-09-10"
        autoCapitalize="none"
        autoCorrect={false}
        className="mb-4"
      />

      <Label>Days between rounds</Label>
      <Input value={generateAllIntervalDays} onChangeText={setGenerateAllIntervalDays} placeholder="7" keyboardType="number-pad" className="mb-6" />

      <View className="flex-row gap-2.5">
        <Button variant="ghost" className="flex-1" disabled={isGeneratingAll} onPress={() => setShowGenerateAll(false)}>Cancel</Button>
        <Button className="flex-1" disabled={isGeneratingAll} loading={isGeneratingAll} onPress={generateAllFixtures}>
          Generate
        </Button>
      </View>
    </Sheet>
  );

  // ── Mobile: unchanged drill-down UX (own screens for Table/Fixtures/Adjust) ──
  if (!isDesktop) {
    return (
      <Screen>
        <Stack.Screen options={{ title: seasonName || 'Season' }} />

        <Card className="mb-5">
          <View className="flex-row items-center mb-2.5">
            <Caption className="flex-1">Season Status</Caption>
            <TouchableOpacity onPress={openRenameSeason}>
              <Body size="xs" tone="brand" weight="semibold">Rename</Body>
            </TouchableOpacity>
          </View>
          <View className="flex-row gap-2 mb-3">
            {STATUS_OPTIONS.map((opt) => (
              <Chip key={opt.value} label={opt.label} tone={opt.tone} selected={seasonStatus === opt.value} onPress={() => setStatus(opt.value)} className="flex-1" />
            ))}
          </View>
          <Button variant="secondary" size="sm" className="mb-2" onPress={() => setShowGenerateAll(true)}>
            Generate Fixtures for All Divisions
          </Button>
          <Button variant="danger" size="sm" disabled={isDeletingSeason} loading={isDeletingSeason} onPress={confirmDeleteSeason}>
            Delete Season
          </Button>
        </Card>

        {scheduleCard}

        {isLoading ? (
          <ActivityIndicator color={RAW.brand} />
        ) : divisions.length === 0 ? (
          <Body className="text-center py-5">
            No divisions yet. Approve team requests from the home screen to populate this season.
          </Body>
        ) : (
          <>
            {divisions.map((division) => {
              const divTeams = teamsForDivision(division.id);
              return (
                <View key={division.id} className="mb-6">
                  <View className="flex-row items-center mb-1">
                    <Heading size="sm" className="flex-1">{division.name}</Heading>
                    <Button variant="secondary" size="sm" className="mr-2" onPress={() => router.push('/(protected)/(tabs)/standings')}>
                      Table
                    </Button>
                    <Button variant="secondary" size="sm" className="mr-2" onPress={() => router.push(`/(protected)/admin-fixtures?divisionId=${division.id}`)}>
                      Fixtures
                    </Button>
                    <Button variant="secondary" size="sm" className="mr-2" onPress={() => router.push(`/(protected)/admin-standings-override?divisionId=${division.id}`)}>
                      Adjust
                    </Button>
                    <Button size="sm" onPress={() => openAddTeam(division.id)}>
                      + Add Team
                    </Button>
                  </View>
                  <View className="flex-row justify-end gap-4 mb-2">
                    <TouchableOpacity onPress={() => openRenameDivision(division)}>
                      <Body size="xs" tone="brand" weight="semibold">Rename</Body>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => confirmDeleteDivision(division)} disabled={deletingDivisionId === division.id}>
                      <Body size="xs" tone="coral" weight="semibold">
                        {deletingDivisionId === division.id ? 'Deleting…' : 'Delete Division'}
                      </Body>
                    </TouchableOpacity>
                  </View>
                  {divTeams.length === 0 ? (
                    <Body size="sm" className="pl-1">No teams yet</Body>
                  ) : (
                    <View className="gap-2">
                      {divTeams.map((team) => (
                        <ListRow
                          key={team.id}
                          title={team.name}
                          subtitle={team.captainUserId ? 'Captain assigned' : 'No captain'}
                          trailing={<Body tone="dim">›</Body>}
                          onPress={() => router.push(`/(protected)/admin-team?teamId=${team.id}`)}
                        />
                      ))}
                    </View>
                  )}
                </View>
              );
            })}

            {unassignedTeams.length > 0 && (
              <View className="mb-5">
                <Caption className="mb-2">Unassigned</Caption>
                <View className="gap-2">
                  {unassignedTeams.map((team) => (
                    <ListRow
                      key={team.id}
                      title={team.name}
                      trailing={<Body tone="dim">›</Body>}
                      onPress={() => router.push(`/(protected)/admin-team?teamId=${team.id}`)}
                    />
                  ))}
                </View>
              </View>
            )}
          </>
        )}

        {addTeamSheet}
        {teamDivisionPicker}
        {newTeamVenuePicker}
        {scheduleSheet}
        {generateAllSheet}
        {renameDivisionSheet}
        {renameSeasonSheet}
      </Screen>
    );
  }

  // ── Desktop: division picker, or a Teams/Fixtures/Standings workspace ──
  if (currentDivision) {
    const divTeams = teamsForDivision(currentDivision.id);

    const playerCountByTeam: Record<string, number> = {};
    divisionPlayers.forEach((p) => { playerCountByTeam[p.teamId] = (playerCountByTeam[p.teamId] ?? 0) + 1; });

    const tableRowByTeam: Record<string, { played: number; won: number; lost: number }> = {};
    divisionTableRows.forEach((r) => { tableRowByTeam[r.teamId] = { played: r.played, won: r.won, lost: r.lost }; });

    const pendingTeamIds = new Set(pendingRequestTeamIds);

    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <AdminShell
          title={currentDivision.name}
          breadcrumb={[
            { label: 'Dashboard', path: '/(protected)/(tabs)/admin' },
            { label: seasonName || 'Season', path: `/(protected)/admin-season?seasonId=${seasonId}` },
            { label: currentDivision.name },
          ]}
          actions={(
            <Button variant="secondary" size="sm" onPress={() => openRenameDivision(currentDivision)}>Rename Division</Button>
          )}
        >
          <View style={{ maxWidth: 960 }}>
            <View className="flex-row gap-3 mb-6">
              <StatTile label="Teams" value={divTeams.length} tone="brand" className="flex-1" />
              <StatTile label="Players" value={divisionPlayerCount} tone="brand" className="flex-1" />
              <StatTile
                label="Fixtures Played"
                value={`${divisionMatches.filter((m) => m.status !== 'scheduled').length} / ${divisionMatches.length}`}
                tone="sage"
                className="flex-1"
              />
              <StatTile
                label="Pending Results"
                value={divisionMatches.filter((m) => m.status === 'awaiting_confirmation' || m.status === 'disputed').length}
                tone={divisionMatches.some((m) => m.status === 'awaiting_confirmation' || m.status === 'disputed') ? 'coral' : 'butter'}
                className="flex-1"
              />
            </View>

            <WorkspaceTabBar active={activeTab} onChange={(t) => router.setParams({ tab: t })} />

            {activeTab === 'teams' && (
              <>
                <View className="flex-row items-center mb-3">
                  <Heading size="sm" className="flex-1">{divTeams.length} teams</Heading>
                  <Button size="sm" onPress={() => openAddTeam(currentDivision.id)}>
                    + Add Team
                  </Button>
                </View>
                <TeamsTable
                  teams={divTeams}
                  venuesById={venuesById}
                  playerCountByTeam={playerCountByTeam}
                  tableRowByTeam={tableRowByTeam}
                  pendingTeamIds={pendingTeamIds}
                  onOpenTeam={(teamId) => router.push(`/(protected)/admin-team?teamId=${teamId}`)}
                />
              </>
            )}

            {activeTab === 'fixtures' && (
              <FixturesTab
                divisionId={currentDivision.id}
                leagueId={appUser?.leagueId ?? undefined}
                isDesktop
                statusFilter={['scheduled', 'awaiting_confirmation']}
              />
            )}

            {activeTab === 'results' && (
              <ResultsTab divisionId={currentDivision.id} leagueId={appUser?.leagueId ?? undefined} />
            )}

            {activeTab === 'standings' && (
              <StandingsTab seasonId={seasonId} divisionId={currentDivision.id} leagueId={appUser?.leagueId ?? undefined} />
            )}
          </View>
        </AdminShell>
        {addTeamSheet}
        {teamDivisionPicker}
        {newTeamVenuePicker}
        {renameDivisionSheet}
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <AdminShell
        title={seasonName || 'Season'}
        breadcrumb={[{ label: 'Dashboard', path: '/(protected)/(tabs)/admin' }, { label: seasonName || 'Season' }]}
        actions={(
          <View className="flex-row items-center gap-2">
            {STATUS_OPTIONS.map((opt) => (
              <Chip key={opt.value} label={opt.label} tone={opt.tone} selected={seasonStatus === opt.value} onPress={() => setStatus(opt.value)} />
            ))}
            <Button variant="secondary" size="sm" onPress={openRenameSeason}>Rename Season</Button>
          </View>
        )}
      >
        <View style={{ maxWidth: 780 }}>
          {scheduleCard}

          <View className="flex-row items-center mb-4">
            <Heading size="sm" className="flex-1">Divisions</Heading>
            <Button variant="secondary" size="sm" className="mr-2" onPress={() => setShowAddDivision(true)}>+ Add Division</Button>
            <Button variant="secondary" size="sm" className="mr-2" onPress={() => openAddTeam(null)}>+ Add Team</Button>
            <Button variant="secondary" size="sm" className="mr-2" onPress={() => setShowGenerateAll(true)}>Generate Fixtures</Button>
            <Button variant="danger" size="sm" disabled={isDeletingSeason} loading={isDeletingSeason} onPress={confirmDeleteSeason}>
              Delete Season
            </Button>
          </View>

          {isLoading ? (
            <ActivityIndicator color={RAW.brand} />
          ) : divisions.length === 0 ? (
            <Body className="text-center py-5">No divisions yet — add one to start setting up teams and fixtures.</Body>
          ) : (
            <View className="gap-2 mb-5">
              {divisions.map((division) => (
                <Card key={division.id} className="flex-row items-center">
                  <View className="flex-1">
                    <Body tone="strong" weight="semibold">{division.name}</Body>
                    <Caption className="mt-0.5">{teamsForDivision(division.id).length} teams</Caption>
                  </View>
                  <TouchableOpacity onPress={() => openRenameDivision(division)} className="mr-4">
                    <Body size="xs" tone="brand" weight="semibold">Rename</Body>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => confirmDeleteDivision(division)}
                    disabled={deletingDivisionId === division.id}
                    className="mr-4"
                  >
                    <Body size="xs" tone="coral" weight="semibold">
                      {deletingDivisionId === division.id ? 'Deleting…' : 'Delete'}
                    </Body>
                  </TouchableOpacity>
                  <Button size="sm" onPress={() => router.setParams({ divisionId: division.id, tab: 'teams' })}>
                    Open
                  </Button>
                </Card>
              ))}
            </View>
          )}

          {unassignedTeams.length > 0 && (
            <View className="mb-5">
              <Caption className="mb-2">Unassigned Teams</Caption>
              <View className="gap-2" style={{ maxWidth: 560 }}>
                {unassignedTeams.map((team) => (
                  <ListRow key={team.id} title={team.name} trailing={<Body tone="dim">›</Body>} onPress={() => router.push(`/(protected)/admin-team?teamId=${team.id}`)} />
                ))}
              </View>
            </View>
          )}
        </View>
      </AdminShell>
      {addTeamSheet}
      {teamDivisionPicker}
      {addDivisionSheet}
      {renameDivisionSheet}
      {renameSeasonSheet}
      {newTeamVenuePicker}
      {scheduleSheet}
      {generateAllSheet}
    </>
  );
}
