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
import { FixturesTab, ResultsTab } from './admin-fixtures';
import { StandingsTab } from './admin-standings-override';

const DESKTOP_BREAKPOINT = 768;

interface Division { id: string; name: string; order: number }
interface Team { id: string; name: string; divisionId: string; captainUserId: string | null; address: string | null }

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
  team, players, played, won, lost, status, onPress, isLast,
}: {
  team: Team; players: number; played: number; won: number; lost: number; status: TeamStatus;
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
      <Body size="sm" numberOfLines={1} style={{ flex: 2 }}>{team.address || 'Not set'}</Body>
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
  teams, playerCountByTeam, tableRowByTeam, pendingTeamIds, onOpenTeam,
}: {
  teams: Team[];
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

  const [addTeamTarget, setAddTeamTarget] = useState<Division | null>(null);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamAddress, setNewTeamAddress] = useState('');
  const [isAddingTeam, setIsAddingTeam] = useState(false);

  const [showAddDivision, setShowAddDivision] = useState(false);
  const [newDivisionName, setNewDivisionName] = useState('');
  const [isAddingDivision, setIsAddingDivision] = useState(false);

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
    const unsubPlayers = onSnapshot(
      query(collection(db, 'players'), where('divisionId', '==', divisionId)),
      (snap) => setDivisionPlayers(snap.docs.map((d) => ({ id: d.id, teamId: d.data().teamId as string }))),
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
    );
    const unsubTables = onSnapshot(
      query(collection(db, 'divisionTables'), where('seasonId', '==', seasonId), where('divisionId', '==', divisionId)),
      (snap) => setDivisionTableRows(snap.docs.map((d) => ({
        teamId: d.data().teamId as string,
        played: (d.data().played as number) ?? 0,
        won: (d.data().won as number) ?? 0,
        lost: (d.data().lost as number) ?? 0,
      }))),
    );
    // One query for the whole league rather than one per team — grouped by
    // teamId client-side to flag which teams have a request awaiting review.
    const unsubRequests = onSnapshot(
      query(collection(db, 'joinRequests'), where('leagueId', '==', appUser.leagueId), where('status', '==', 'pending')),
      (snap) => setPendingRequestTeamIds(snap.docs.map((d) => d.data().teamId as string).filter(Boolean)),
    );
    return () => { unsubPlayers(); unsubMatches(); unsubTables(); unsubRequests(); };
  }, [divisionId, appUser?.leagueId, seasonId]);

  useEffect(() => {
    if (!seasonId) return;

    const unsubSeason = onSnapshot(doc(db, 'seasons', seasonId), (snap) => {
      if (snap.exists()) {
        setSeasonName(snap.data().name);
        setSeasonStatus(snap.data().status);
      }
    });

    const unsubDivisions = onSnapshot(
      query(collection(db, 'divisions'), where('seasonId', '==', seasonId)),
      (snap) => {
        setDivisions(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() } as Division))
            .sort((a, b) => a.order - b.order),
        );
      },
    );

    const unsubTeams = onSnapshot(
      query(collection(db, 'teams'), where('seasonId', '==', seasonId)),
      (snap) => {
        setTeams(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Team)));
        setIsLoading(false);
      },
    );

    return () => { unsubSeason(); unsubDivisions(); unsubTeams(); };
  }, [seasonId]);

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
    if (!newTeamName.trim() || !addTeamTarget || !appUser?.leagueId) return;
    setIsAddingTeam(true);
    try {
      await addDoc(collection(db, 'teams'), {
        leagueId: appUser.leagueId,
        seasonId,
        divisionId: addTeamTarget.id,
        name: newTeamName.trim(),
        address: newTeamAddress.trim() || null,
        captainUserId: null,
        viceCaptainUserId: null,
        createdAt: serverTimestamp(),
      });
      setAddTeamTarget(null);
      setNewTeamName('');
      setNewTeamAddress('');
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error).message ?? 'Something went wrong');
    } finally {
      setIsAddingTeam(false);
    }
  }

  const teamsForDivision = (divId: string) => teams.filter((t) => t.divisionId === divId);
  const unassignedTeams = teams.filter((t) => !divisions.find((d) => d.id === t.divisionId));
  const currentDivision = divisions.find((d) => d.id === divisionId) ?? null;

  const [deletingDivisionId, setDeletingDivisionId] = useState<string | null>(null);
  const [isDeletingSeason, setIsDeletingSeason] = useState(false);

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
    <Sheet visible={!!addTeamTarget} onClose={() => setAddTeamTarget(null)}>
      <Heading size="lg" className="mb-1">Add Team</Heading>
      <Body size="sm" className="mb-5">{addTeamTarget?.name}</Body>

      <Label>Team name</Label>
      <Input value={newTeamName} onChangeText={setNewTeamName} placeholder="e.g. The Arrows" autoCapitalize="words" autoFocus className="mb-4" />

      <Label>Home venue / address (optional)</Label>
      <Input value={newTeamAddress} onChangeText={setNewTeamAddress} placeholder="e.g. The Red Lion, 12 High St" autoCapitalize="words" className="mb-6" />

      <View className="flex-row gap-2.5">
        <Button variant="ghost" className="flex-1" onPress={() => setAddTeamTarget(null)}>Cancel</Button>
        <Button className="flex-1" disabled={isAddingTeam || !newTeamName.trim()} loading={isAddingTeam} onPress={addTeam}>
          Add Team
        </Button>
      </View>
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

  // ── Mobile: unchanged drill-down UX (own screens for Table/Fixtures/Adjust) ──
  if (!isDesktop) {
    return (
      <Screen>
        <Stack.Screen options={{ title: seasonName || 'Season' }} />

        <Card className="mb-5">
          <Caption className="mb-2.5">Season Status</Caption>
          <View className="flex-row gap-2 mb-3">
            {STATUS_OPTIONS.map((opt) => (
              <Chip key={opt.value} label={opt.label} tone={opt.tone} selected={seasonStatus === opt.value} onPress={() => setStatus(opt.value)} className="flex-1" />
            ))}
          </View>
          <Button variant="danger" size="sm" disabled={isDeletingSeason} loading={isDeletingSeason} onPress={confirmDeleteSeason}>
            Delete Season
          </Button>
        </Card>

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
                    <Button size="sm" onPress={() => { setAddTeamTarget(division); setNewTeamName(''); setNewTeamAddress(''); }}>
                      + Add Team
                    </Button>
                  </View>
                  <TouchableOpacity onPress={() => confirmDeleteDivision(division)} disabled={deletingDivisionId === division.id} className="self-end mb-2">
                    <Body size="xs" tone="coral" weight="semibold">
                      {deletingDivisionId === division.id ? 'Deleting…' : 'Delete Division'}
                    </Body>
                  </TouchableOpacity>
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
                  <Button size="sm" onPress={() => { setAddTeamTarget(currentDivision); setNewTeamName(''); setNewTeamAddress(''); }}>
                    + Add Team
                  </Button>
                </View>
                <TeamsTable
                  teams={divTeams}
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
          </View>
        )}
      >
        <View style={{ maxWidth: 780 }}>
          <View className="flex-row items-center mb-4">
            <Heading size="sm" className="flex-1">Divisions</Heading>
            <Button variant="secondary" size="sm" className="mr-2" onPress={() => setShowAddDivision(true)}>+ Add Division</Button>
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
      {addDivisionSheet}
    </>
  );
}
