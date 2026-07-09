import { useState, useEffect } from 'react';
import { View, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import {
  collection, doc, onSnapshot, query, where, updateDoc, getDoc, writeBatch,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { RAW } from '@/lib/theme';
import { Screen, Heading, Body, Caption, Button, Card, Avatar, ListRow, Input, Badge, Sheet } from '@/components/ui';

interface Player { id: string; name: string; claimedByUserId: string | null }

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

  const [teamName, setTeamName] = useState('');
  const [teamAddress, setTeamAddress] = useState<string | null>(null);
  const [teamVenuePhone, setTeamVenuePhone] = useState<string | null>(null);
  const [captainUserId, setCaptainUserId] = useState<string | null>(null);
  const [vcUserId, setVcUserId] = useState<string | null>(null);
  const [captainName, setCaptainName] = useState<string | null>(null);
  const [vcName, setVcName] = useState<string | null>(null);
  const [roleSheetPlayer, setRoleSheetPlayer] = useState<Player | null>(null);
  const [isChangingRole, setIsChangingRole] = useState(false);
  const [players, setPlayers] = useState<Player[]>([]);

  const [editingAddress, setEditingAddress] = useState(false);
  const [addressDraft, setAddressDraft] = useState('');
  const [venuePhoneDraft, setVenuePhoneDraft] = useState('');
  const [isSavingAddress, setIsSavingAddress] = useState(false);

  useEffect(() => {
    if (!teamId) return;

    const unsubTeam = onSnapshot(doc(db, 'teams', teamId), async (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      setTeamName(data.name);
      setTeamAddress(data.address ?? null);
      setTeamVenuePhone(data.venuePhone ?? null);

      setCaptainUserId(data.captainUserId ?? null);
      setVcUserId(data.viceCaptainUserId ?? null);

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
    });

    const unsubPlayers = onSnapshot(
      query(collection(db, 'players'), where('teamId', '==', teamId)),
      (snap) => setPlayers(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Player))),
    );

    return () => { unsubTeam(); unsubPlayers(); };
  }, [teamId]);

  async function saveAddress() {
    if (!teamId) return;
    setIsSavingAddress(true);
    try {
      await updateDoc(doc(db, 'teams', teamId), {
        address: addressDraft.trim() || null,
        venuePhone: venuePhoneDraft.trim() || null,
      });
      setEditingAddress(false);
    } finally {
      setIsSavingAddress(false);
    }
  }

  function roleOf(player: Player): TeamRole | null {
    if (!player.claimedByUserId) return null;
    if (player.claimedByUserId === captainUserId) return 'captain';
    if (player.claimedByUserId === vcUserId) return 'viceCaptain';
    return 'player';
  }

  async function changeRole(player: Player, newRole: TeamRole) {
    if (!teamId || !player.claimedByUserId) return;
    const targetUid = player.claimedByUserId;
    setIsChangingRole(true);
    try {
      const teamSnap = await getDoc(doc(db, 'teams', teamId));
      if (!teamSnap.exists()) return;
      const teamData = teamSnap.data();

      let nextCaptainUserId: string | null = teamData.captainUserId ?? null;
      let nextVcUserId: string | null = teamData.viceCaptainUserId ?? null;

      // Clear the target out of whichever slot they currently hold
      if (nextCaptainUserId === targetUid) nextCaptainUserId = null;
      if (nextVcUserId === targetUid) nextVcUserId = null;

      const batch = writeBatch(db);

      if (newRole === 'captain') {
        if (nextCaptainUserId && nextCaptainUserId !== targetUid) {
          batch.update(doc(db, 'users', nextCaptainUserId), { role: 'player' });
        }
        nextCaptainUserId = targetUid;
      } else if (newRole === 'viceCaptain') {
        if (nextVcUserId && nextVcUserId !== targetUid) {
          batch.update(doc(db, 'users', nextVcUserId), { role: 'player' });
        }
        nextVcUserId = targetUid;
      }

      batch.update(doc(db, 'teams', teamId), {
        captainUserId: nextCaptainUserId,
        viceCaptainUserId: nextVcUserId,
      });
      batch.update(doc(db, 'users', targetUid), { role: newRole });

      await batch.commit();
      setRoleSheetPlayer(null);
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error).message ?? 'Something went wrong');
    } finally {
      setIsChangingRole(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: teamName || 'Team' }} />

      {/* Captain / VC */}
      <Card className="mb-4">
        <View className={vcName ? 'mb-3' : ''}>
          <Caption className="mb-1">Captain</Caption>
          <Body tone={captainName ? 'strong' : 'dim'} weight="semibold">{captainName ?? 'Not yet assigned'}</Body>
        </View>
        {vcName && (
          <View>
            <Caption className="mb-1">Vice Captain</Caption>
            <Body tone="strong" weight="semibold">{vcName}</Body>
          </View>
        )}
        {!captainName && (
          <Body size="xs" className="mt-2">
            Waiting for someone to request this role — see the league Inbox.
          </Body>
        )}
      </Card>

      {/* Home venue */}
      <Card className="mb-5">
        <View className="flex-row items-center mb-2.5">
          <Heading size="sm" className="flex-1">Home Venue</Heading>
          {!editingAddress && (
            <Button
              variant="secondary"
              size="sm"
              onPress={() => {
                setAddressDraft(teamAddress ?? '');
                setVenuePhoneDraft(teamVenuePhone ?? '');
                setEditingAddress(true);
              }}
            >
              {teamAddress ? 'Edit' : 'Add'}
            </Button>
          )}
        </View>
        {editingAddress ? (
          <>
            <Input
              value={addressDraft}
              onChangeText={setAddressDraft}
              placeholder="e.g. The Red Lion, 12 High St, Birmingham"
              autoCapitalize="words"
              autoFocus
              className="mb-2.5"
            />
            <Input
              value={venuePhoneDraft}
              onChangeText={setVenuePhoneDraft}
              placeholder="Venue contact number (optional)"
              keyboardType="phone-pad"
              className="mb-2.5"
            />
            <View className="flex-row gap-2">
              <Button variant="ghost" className="flex-1" onPress={() => setEditingAddress(false)}>Cancel</Button>
              <Button className="flex-1" disabled={isSavingAddress} loading={isSavingAddress} onPress={saveAddress}>Save</Button>
            </View>
          </>
        ) : (
          <>
            <Body size="sm" tone={teamAddress ? 'strong' : 'dim'}>{teamAddress ?? 'No venue set'}</Body>
            {teamVenuePhone && <Body size="sm" className="mt-1">{teamVenuePhone}</Body>}
          </>
        )}
      </Card>

      {/* Players */}
      <Heading size="sm" className="mb-2.5">Players ({players.length})</Heading>
      {players.length === 0 ? (
        <Body className="text-center py-4">No players yet</Body>
      ) : (
        <View className="gap-2">
          {players.map((player) => {
            const role = roleOf(player);
            return (
              <ListRow
                key={player.id}
                avatar={<Avatar initial={player.name.charAt(0)} tone="brand" size="sm" />}
                title={player.name}
                subtitle={role ? undefined : 'No account yet'}
                trailing={role ? (
                  <View className="items-end gap-1.5">
                    <Badge tone={role === 'player' ? 'butter' : 'brand'}>{ROLE_BADGE_LABEL[role]}</Badge>
                    <Button variant="ghost" size="sm" onPress={() => setRoleSheetPlayer(player)}>Change</Button>
                  </View>
                ) : undefined}
              />
            );
          })}
        </View>
      )}

      <Sheet visible={!!roleSheetPlayer} onClose={() => setRoleSheetPlayer(null)}>
        {roleSheetPlayer && (
          <>
            <Heading size="sm" className="mb-1">Change Role</Heading>
            <Body size="sm" className="mb-4">{roleSheetPlayer.name}</Body>
            <View className="gap-2">
              {ROLE_OPTIONS.map((opt) => {
                const selected = roleOf(roleSheetPlayer) === opt.value;
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
    </Screen>
  );
}
