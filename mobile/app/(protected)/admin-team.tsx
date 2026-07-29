import { useState, useEffect } from 'react';
import { View, TouchableOpacity, ActivityIndicator, useWindowDimensions } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import {
  collection, doc, onSnapshot, query, where, updateDoc, getDoc, addDoc, writeBatch,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { goBack } from '@/lib/navigation';
import { Alert } from '@/lib/alert';
import { RAW } from '@/lib/theme';
import { Screen, Heading, Body, Caption, Button, Card, Avatar, ListRow, Input, Label, Badge, Sheet } from '@/components/ui';
import { AdminShell } from '@/components/admin/AdminShell';
import { VenuePickerSheet } from '@/components/admin/VenuePickerSheet';
import type { Venue } from '@/types';

const DESKTOP_BREAKPOINT = 768;

interface Player {
  id: string; name: string; teamId: string;
  claimedByUserId: string | null;
  designatedRole: 'captain' | 'viceCaptain' | null;
}
interface OtherTeam { id: string; name: string }

type TeamRole = 'captain' | 'viceCaptain' | 'player';

const ROLE_OPTIONS: { value: TeamRole; label: string; description: string }[] = [
  { value: 'captain', label: 'Captain', description: "Becomes the team's Captain. Whoever currently holds that role on this team moves to Player." },
  { value: 'viceCaptain', label: 'Vice Captain', description: "Becomes the team's Vice Captain. Whoever currently holds that role on this team moves to Player." },
  { value: 'player', label: 'Player', description: 'No captaincy — a regular squad player.' },
];

const ROLE_BADGE_LABEL: Record<TeamRole, string> = {
  captain: 'Captain',
  viceCaptain: 'Vice Captain',
  player: 'Player',
};

export default function AdminTeamScreen() {
  const { teamId } = useLocalSearchParams<{ teamId: string }>();
  const { appUser } = useAuthStore();
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;

  const [teamName, setTeamName] = useState('');
  const [teamVenueId, setTeamVenueId] = useState<string | null>(null);
  const [teamVenue, setTeamVenue] = useState<Venue | null>(null);
  const [showVenuePicker, setShowVenuePicker] = useState(false);
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [divisionId, setDivisionId] = useState<string | null>(null);
  const [seasonName, setSeasonName] = useState<string | null>(null);
  const [divisionName, setDivisionName] = useState<string | null>(null);
  const [captainUserId, setCaptainUserId] = useState<string | null>(null);
  const [vcUserId, setVcUserId] = useState<string | null>(null);
  const [captainName, setCaptainName] = useState<string | null>(null);
  const [vcName, setVcName] = useState<string | null>(null);
  const [roleSheetPlayer, setRoleSheetPlayer] = useState<Player | null>(null);
  const [isChangingRole, setIsChangingRole] = useState(false);
  const [players, setPlayers] = useState<Player[]>([]);
  const [otherTeams, setOtherTeams] = useState<OtherTeam[]>([]);

  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [isAddingPlayer, setIsAddingPlayer] = useState(false);

  const [moveTarget, setMoveTarget] = useState<Player | null>(null);
  const [isMoving, setIsMoving] = useState(false);

  const [editingName, setEditingName] = useState(false);
  const [teamNameDraft, setTeamNameDraft] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);

  const [siblingDivisions, setSiblingDivisions] = useState<{ id: string; name: string }[]>([]);
  const [showMoveDivision, setShowMoveDivision] = useState(false);
  const [isMovingDivision, setIsMovingDivision] = useState(false);

  useEffect(() => {
    if (!teamId) return;

    const unsubTeam = onSnapshot(doc(db, 'teams', teamId), async (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      setTeamName(data.name);
      setTeamVenueId(data.venueId ?? null);

      setCaptainUserId(data.captainUserId ?? null);
      setVcUserId(data.viceCaptainUserId ?? null);

      setSeasonId(data.seasonId ?? null);
      setDivisionId(data.divisionId ?? null);
      if (data.seasonId) {
        const seasonSnap = await getDoc(doc(db, 'seasons', data.seasonId));
        if (seasonSnap.exists()) setSeasonName(seasonSnap.data().name ?? null);
      }
      if (data.divisionId) {
        const divisionSnap = await getDoc(doc(db, 'divisions', data.divisionId));
        if (divisionSnap.exists()) setDivisionName(divisionSnap.data().name ?? null);
      }

      if (data.captainUserId) {
        const userSnap = await getDoc(doc(db, 'users', data.captainUserId));
        if (userSnap.exists()) setCaptainName(userSnap.data().displayName ?? null);
      } else {
        setCaptainName(null);
      }

      if (data.viceCaptainUserId) {
        const userSnap = await getDoc(doc(db, 'users', data.viceCaptainUserId));
        if (userSnap.exists()) setVcName(userSnap.data().displayName ?? null);
      } else {
        setVcName(null);
      }
    }, (e) => Alert.alert('Error', (e as Error).message ?? 'Something went wrong'));

    const unsubPlayers = onSnapshot(
      query(collection(db, 'players'), where('teamId', '==', teamId)),
      (snap) => setPlayers(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Player))),
      (e) => Alert.alert('Error', (e as Error).message ?? 'Something went wrong'),
    );

    return () => { unsubTeam(); unsubPlayers(); };
  }, [teamId]);

  useEffect(() => {
    if (!teamVenueId) { setTeamVenue(null); return; }
    const unsub = onSnapshot(doc(db, 'venues', teamVenueId), (snap) => {
      setTeamVenue(snap.exists() ? ({ id: snap.id, ...snap.data() } as Venue) : null);
    }, (e) => Alert.alert('Error', (e as Error).message ?? 'Something went wrong'));
    return unsub;
  }, [teamVenueId]);

  useEffect(() => {
    if (!appUser?.leagueId) return;
    const unsub = onSnapshot(
      query(collection(db, 'teams'), where('leagueId', '==', appUser.leagueId)),
      (snap) => {
        setOtherTeams(
          snap.docs
            .map((d) => ({ id: d.id, name: d.data().name as string }))
            .filter((t) => t.id !== teamId)
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      },
      (e) => Alert.alert('Error', (e as Error).message ?? 'Something went wrong'),
    );
    return unsub;
  }, [appUser?.leagueId, teamId]);

  useEffect(() => {
    if (!seasonId) return;
    const unsub = onSnapshot(
      query(collection(db, 'divisions'), where('seasonId', '==', seasonId)),
      (snap) => setSiblingDivisions(
        snap.docs.map((d) => ({ id: d.id, name: d.data().name as string })).sort((a, b) => a.name.localeCompare(b.name)),
      ),
      (e) => Alert.alert('Error', (e as Error).message ?? 'Something went wrong'),
    );
    return unsub;
  }, [seasonId]);

  async function selectVenue(venueId: string | null) {
    if (!teamId) return;
    await updateDoc(doc(db, 'teams', teamId), { venueId });
  }

  async function saveName() {
    if (!teamId || !teamNameDraft.trim()) return;
    setIsSavingName(true);
    try {
      await updateDoc(doc(db, 'teams', teamId), { name: teamNameDraft.trim() });
      setEditingName(false);
    } finally {
      setIsSavingName(false);
    }
  }

  async function moveDivision(targetDivisionId: string) {
    if (!teamId || targetDivisionId === divisionId) { setShowMoveDivision(false); return; }
    setIsMovingDivision(true);
    try {
      await httpsCallable(functions, 'adminMoveTeamDivision')({ teamId, divisionId: targetDivisionId });
      setShowMoveDivision(false);
    } catch (e: unknown) {
      Alert.alert("Can't move team", (e as Error).message ?? 'Something went wrong');
    } finally {
      setIsMovingDivision(false);
    }
  }

  // null = no role at all. Unclaimed players can still carry a *designated*
  // role (see designatedRoleOf) even though roleOf itself is null for them —
  // a role only becomes "real" (drives team.captainUserId, Firestore rules
  // access) once someone has actually claimed the slot.
  function roleOf(player: Player): TeamRole | null {
    if (!player.claimedByUserId) return null;
    if (player.claimedByUserId === captainUserId) return 'captain';
    if (player.claimedByUserId === vcUserId) return 'viceCaptain';
    return 'player';
  }

  // Only meaningful for unclaimed players — what an admin has pre-assigned,
  // pending that person actually registering and claiming this roster slot.
  function designatedRoleOf(player: Player): 'captain' | 'viceCaptain' | null {
    return player.claimedByUserId ? null : player.designatedRole;
  }

  async function changeRole(player: Player, newRole: TeamRole) {
    if (!teamId) return;
    const targetUid = player.claimedByUserId; // null = pre-assigning an unclaimed slot
    setIsChangingRole(true);
    try {
      const teamSnap = await getDoc(doc(db, 'teams', teamId));
      if (!teamSnap.exists()) return;
      const teamData = teamSnap.data();

      let nextCaptainUserId: string | null = teamData.captainUserId ?? null;
      let nextVcUserId: string | null = teamData.viceCaptainUserId ?? null;

      // Clear the target out of whichever registered slot they currently hold
      if (targetUid && nextCaptainUserId === targetUid) nextCaptainUserId = null;
      if (targetUid && nextVcUserId === targetUid) nextVcUserId = null;

      const batch = writeBatch(db);

      if (newRole === 'captain' || newRole === 'viceCaptain') {
        const currentSlotUid = newRole === 'captain' ? nextCaptainUserId : nextVcUserId;
        if (currentSlotUid && currentSlotUid !== targetUid) {
          batch.update(doc(db, 'users', currentSlotUid), { role: 'player' });
        }
        // Only one pending designee per role slot — clear any other unclaimed
        // player already holding this designation
        const otherDesignee = players.find(
          (p) => p.id !== player.id && !p.claimedByUserId && p.designatedRole === newRole,
        );
        if (otherDesignee) {
          batch.update(doc(db, 'players', otherDesignee.id), { designatedRole: null });
        }
        if (newRole === 'captain') nextCaptainUserId = targetUid;
        else nextVcUserId = targetUid;
      }

      batch.update(doc(db, 'teams', teamId), {
        captainUserId: nextCaptainUserId,
        viceCaptainUserId: nextVcUserId,
      });

      if (targetUid) {
        batch.update(doc(db, 'users', targetUid), { role: newRole });
        batch.update(doc(db, 'players', player.id), { designatedRole: null });
      } else {
        // No account yet — just record the pending designation. The claim-
        // approval flow (captains.tsx) reads this and promotes them straight
        // to the role once they actually register and claim this slot.
        batch.update(doc(db, 'players', player.id), {
          designatedRole: newRole === 'player' ? null : newRole,
        });
      }

      await batch.commit();
      setRoleSheetPlayer(null);
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error).message ?? 'Something went wrong');
    } finally {
      setIsChangingRole(false);
    }
  }

  async function addPlayer() {
    if (!newPlayerName.trim() || !teamId || !appUser?.leagueId) return;
    setIsAddingPlayer(true);
    try {
      await addDoc(collection(db, 'players'), {
        leagueId: appUser.leagueId,
        teamId,
        divisionId,
        name: newPlayerName.trim(),
        claimedByUserId: null,
      });
      setNewPlayerName('');
      setShowAddPlayer(false);
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error).message ?? 'Something went wrong');
    } finally {
      setIsAddingPlayer(false);
    }
  }

  function confirmDeletePlayer(player: Player) {
    const claimed = !!player.claimedByUserId;
    Alert.alert(
      'Delete player',
      claimed
        ? `${player.name} has a linked account. Deleting removes them from this team and sends their account back to "find a team" — this can't be undone.`
        : `Delete ${player.name}? This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deletePlayer(player) },
      ],
    );
  }

  async function deletePlayer(player: Player) {
    if (!teamId) return;
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'players', player.id));
      if (player.claimedByUserId) {
        batch.update(doc(db, 'users', player.claimedByUserId), {
          teamId: null, playerId: null, divisionId: null, role: 'pending',
        });
        if (player.claimedByUserId === captainUserId || player.claimedByUserId === vcUserId) {
          batch.update(doc(db, 'teams', teamId), {
            captainUserId: player.claimedByUserId === captainUserId ? null : captainUserId,
            viceCaptainUserId: player.claimedByUserId === vcUserId ? null : vcUserId,
          });
        }
      }
      await batch.commit();
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error).message ?? 'Something went wrong');
    }
  }

  async function movePlayerTo(player: Player, targetTeamId: string) {
    if (!teamId) return;
    setIsMoving(true);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'players', player.id), { teamId: targetTeamId });
      if (player.claimedByUserId) {
        batch.update(doc(db, 'users', player.claimedByUserId), { teamId: targetTeamId, role: 'player' });
        if (player.claimedByUserId === captainUserId || player.claimedByUserId === vcUserId) {
          batch.update(doc(db, 'teams', teamId), {
            captainUserId: player.claimedByUserId === captainUserId ? null : captainUserId,
            viceCaptainUserId: player.claimedByUserId === vcUserId ? null : vcUserId,
          });
        }
      }
      await batch.commit();
      setMoveTarget(null);
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error).message ?? 'Something went wrong');
    } finally {
      setIsMoving(false);
    }
  }

  const [isDeletingTeam, setIsDeletingTeam] = useState(false);

  function confirmDeleteTeam() {
    Alert.alert(
      'Delete team',
      `Delete ${teamName}? This removes all its players and any unplayed fixtures. Blocked if this team has any confirmed match results.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: deleteTeam },
      ],
    );
  }

  async function deleteTeam() {
    if (!teamId) return;
    setIsDeletingTeam(true);
    try {
      await httpsCallable(functions, 'adminDeleteTeam')({ teamId });
      goBack();
    } catch (e: unknown) {
      Alert.alert("Can't delete team", (e as Error).message ?? 'Something went wrong');
    } finally {
      setIsDeletingTeam(false);
    }
  }

  const pendingCaptain = players.find((p) => !p.claimedByUserId && p.designatedRole === 'captain');
  const pendingVc = players.find((p) => !p.claimedByUserId && p.designatedRole === 'viceCaptain');

  const teamInfoCard = (
    <Card className="mb-4">
      <View className="flex-row items-center mb-2.5">
        <Heading size="sm" className="flex-1">Team</Heading>
        {!editingName && (
          <Button variant="secondary" size="sm" onPress={() => { setTeamNameDraft(teamName); setEditingName(true); }}>
            Rename
          </Button>
        )}
      </View>
      {editingName ? (
        <View className="mb-3">
          <Input value={teamNameDraft} onChangeText={setTeamNameDraft} autoCapitalize="words" autoFocus className="mb-2.5" />
          <View className="flex-row gap-2">
            <Button variant="ghost" className="flex-1" onPress={() => setEditingName(false)}>Cancel</Button>
            <Button className="flex-1" disabled={isSavingName || !teamNameDraft.trim()} loading={isSavingName} onPress={saveName}>
              Save
            </Button>
          </View>
        </View>
      ) : (
        <Body tone="strong" weight="semibold" className="mb-3">{teamName}</Body>
      )}

      <View className="flex-row items-center justify-between">
        <View>
          <Caption className="mb-0.5">Division</Caption>
          <Body size="sm" tone="strong">{divisionName ?? 'Unassigned'}</Body>
        </View>
        <Button variant="secondary" size="sm" onPress={() => setShowMoveDivision(true)}>Move</Button>
      </View>
    </Card>
  );

  const captainCard = (
    <Card className="mb-4">
      <View className="mb-3">
        <Caption className="mb-1">Captain</Caption>
        <Body tone={captainName ? 'strong' : 'dim'} weight="semibold">{captainName ?? 'Not yet assigned'}</Body>
        {!captainName && pendingCaptain && (
          <Body size="xs" className="mt-0.5">Reserved for {pendingCaptain.name}, pending them joining</Body>
        )}
        {!captainName && !pendingCaptain && (
          <Body size="xs" className="mt-0.5">Waiting for someone to request this role — see the league Inbox.</Body>
        )}
      </View>
      <View>
        <Caption className="mb-1">Vice Captain</Caption>
        <Body tone={vcName ? 'strong' : 'dim'} weight="semibold">{vcName ?? 'Not yet assigned'}</Body>
        {!vcName && pendingVc && (
          <Body size="xs" className="mt-0.5">Reserved for {pendingVc.name}, pending them joining</Body>
        )}
        {!vcName && !pendingVc && (
          <Body size="xs" className="mt-0.5">Waiting for someone to request this role — see the league Inbox.</Body>
        )}
      </View>
    </Card>
  );

  const venueCard = (
    <Card className="mb-5">
      <View className="flex-row items-center mb-2.5">
        <Heading size="sm" className="flex-1">Home Venue</Heading>
        <Button variant="secondary" size="sm" onPress={() => setShowVenuePicker(true)}>
          {teamVenue ? 'Change' : 'Set'}
        </Button>
      </View>
      <Body size="sm" tone={teamVenue ? 'strong' : 'dim'}>{teamVenue?.name ?? 'No venue set'}</Body>
      {teamVenue?.address && <Body size="sm" className="mt-1">{teamVenue.address}</Body>}
      {teamVenue?.venuePhone && <Body size="sm" className="mt-1">{teamVenue.venuePhone}</Body>}
      {teamVenue && (
        <Caption className="mt-1">{teamVenue.boardCount} board{teamVenue.boardCount === 1 ? '' : 's'}</Caption>
      )}
    </Card>
  );

  const body = (
    <>
      {teamInfoCard}
      {captainCard}
      {venueCard}

      <View className="flex-row items-center mb-2.5">
        <Heading size="sm" className="flex-1">Players ({players.length})</Heading>
        <Button size="sm" onPress={() => setShowAddPlayer(true)}>+ Add Player</Button>
      </View>
      {players.length === 0 ? (
        <Body className="text-center py-4">No players yet</Body>
      ) : (
        <View className="gap-2">
          {players.map((player) => {
            const role = roleOf(player);
            const designated = designatedRoleOf(player);
            return (
              <ListRow
                key={player.id}
                avatar={<Avatar initial={player.name.charAt(0)} tone="brand" size="sm" />}
                title={player.name}
                subtitle={role ? undefined : designated ? 'Pending — no account yet' : 'No account yet'}
                trailing={(
                  <View className="items-end gap-1.5">
                    {role && <Badge tone={role === 'player' ? 'butter' : 'brand'}>{ROLE_BADGE_LABEL[role]}</Badge>}
                    {designated && <Badge tone="butter">{ROLE_BADGE_LABEL[designated]} (Pending)</Badge>}
                    <View className="flex-row gap-3">
                      <TouchableOpacity onPress={() => setRoleSheetPlayer(player)}>
                        <Body size="xs" tone="brand" weight="semibold">
                          {role ? 'Change Role' : designated ? 'Change' : 'Assign Role'}
                        </Body>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setMoveTarget(player)}>
                        <Body size="xs" tone="brand" weight="semibold">Move</Body>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => confirmDeletePlayer(player)}>
                        <Body size="xs" tone="coral" weight="semibold">Delete</Body>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              />
            );
          })}
        </View>
      )}

      <Button variant="danger" className="mt-6" disabled={isDeletingTeam} loading={isDeletingTeam} onPress={confirmDeleteTeam}>
        Delete Team
      </Button>
    </>
  );

  const modals = (
    <>
      {appUser?.leagueId && (
        <VenuePickerSheet
          visible={showVenuePicker}
          onClose={() => setShowVenuePicker(false)}
          leagueId={appUser.leagueId}
          value={teamVenueId}
          onSelect={selectVenue}
          allowCreate
        />
      )}

      <Sheet visible={!!roleSheetPlayer} onClose={() => setRoleSheetPlayer(null)}>
        {roleSheetPlayer && (
          <>
            <Heading size="sm" className="mb-1">{roleOf(roleSheetPlayer) ? 'Change Role' : 'Assign Role'}</Heading>
            <Body size="sm" className="mb-4">{roleSheetPlayer.name}</Body>
            {!roleSheetPlayer.claimedByUserId && (
              <Body size="xs" className="mb-4">
                {roleSheetPlayer.name} hasn't registered yet — this reserves the role for
                when they join and claim their spot on the roster.
              </Body>
            )}
            <View className="gap-2">
              {ROLE_OPTIONS.map((opt) => {
                const selected = (roleOf(roleSheetPlayer) ?? designatedRoleOf(roleSheetPlayer) ?? 'player') === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    onPress={() => changeRole(roleSheetPlayer, opt.value)}
                    disabled={isChangingRole}
                    activeOpacity={0.7}
                    className={[
                      'p-3 rounded-2xl',
                      selected ? 'bg-brand-fill dark:bg-brand-fill-dark' : 'bg-surface-2 dark:bg-surface-2-dark',
                    ].join(' ')}
                  >
                    <Body tone="strong" weight="semibold">{opt.label}</Body>
                    <Body size="xs" className="mt-0.5">{opt.description}</Body>
                  </TouchableOpacity>
                );
              })}
            </View>
            {isChangingRole && <ActivityIndicator color={RAW.brand} style={{ marginTop: 16 }} />}
            <Button variant="ghost" className="mt-4" disabled={isChangingRole} onPress={() => setRoleSheetPlayer(null)}>
              Cancel
            </Button>
          </>
        )}
      </Sheet>

      <Sheet visible={showAddPlayer} onClose={() => setShowAddPlayer(false)}>
        <Heading size="lg" className="mb-4">Add Player</Heading>
        <Label>Name</Label>
        <Input value={newPlayerName} onChangeText={setNewPlayerName} placeholder="e.g. Alex Turner" autoCapitalize="words" autoFocus className="mb-6" />
        <View className="flex-row gap-2.5">
          <Button variant="ghost" className="flex-1" onPress={() => setShowAddPlayer(false)}>Cancel</Button>
          <Button className="flex-1" disabled={isAddingPlayer || !newPlayerName.trim()} loading={isAddingPlayer} onPress={addPlayer}>
            Add
          </Button>
        </View>
      </Sheet>

      <Sheet visible={!!moveTarget} onClose={() => setMoveTarget(null)}>
        <Heading size="lg" className="mb-1">Move Player</Heading>
        <Body size="sm" className="mb-4">{moveTarget?.name} — pick the team to move them to</Body>
        {otherTeams.length === 0 ? (
          <Body size="sm">No other teams in this league yet.</Body>
        ) : (
          <View className="gap-2 mb-2">
            {otherTeams.map((t) => (
              <ListRow key={t.id} title={t.name} onPress={() => moveTarget && movePlayerTo(moveTarget, t.id)} />
            ))}
          </View>
        )}
        {isMoving && <ActivityIndicator color={RAW.brand} style={{ marginTop: 12 }} />}
        <Button variant="ghost" className="mt-4" disabled={isMoving} onPress={() => setMoveTarget(null)}>Cancel</Button>
      </Sheet>

      <Sheet visible={showMoveDivision} onClose={() => setShowMoveDivision(false)}>
        <Heading size="lg" className="mb-1">Move to Division</Heading>
        <Body size="sm" className="mb-4">
          Blocked if this team already has any fixtures, played or not — delete those first if you need to move it.
        </Body>
        {siblingDivisions.length === 0 ? (
          <Body size="sm" className="mb-2">No other divisions in this season yet.</Body>
        ) : (
          <View className="gap-2 mb-2">
            {siblingDivisions.map((d) => (
              <ListRow
                key={d.id}
                title={d.name}
                trailing={d.id === divisionId ? <Body size="xs" tone="brand" weight="semibold">Current</Body> : undefined}
                onPress={() => moveDivision(d.id)}
              />
            ))}
          </View>
        )}
        {isMovingDivision && <ActivityIndicator color={RAW.brand} style={{ marginTop: 12 }} />}
        <Button variant="ghost" className="mt-4" disabled={isMovingDivision} onPress={() => setShowMoveDivision(false)}>Cancel</Button>
      </Sheet>
    </>
  );

  if (isDesktop) {
    const breadcrumb = [
      { label: 'Dashboard', path: '/(protected)/(tabs)/admin' },
      ...(seasonId ? [{ label: seasonName ?? 'Season', path: `/(protected)/admin-season?seasonId=${seasonId}` }] : []),
      ...(seasonId && divisionId ? [{ label: divisionName ?? 'Division', path: `/(protected)/admin-season?seasonId=${seasonId}&divisionId=${divisionId}&tab=teams` }] : []),
      { label: teamName || 'Team' },
    ];
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <AdminShell title={teamName || 'Team'} breadcrumb={breadcrumb}>
          <View style={{ maxWidth: 780 }}>{body}</View>
        </AdminShell>
        {modals}
      </>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: teamName || 'Team' }} />
      {body}
      {modals}
    </Screen>
  );
}
