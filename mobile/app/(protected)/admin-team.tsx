import { useState, useEffect } from 'react';
import { View, TouchableOpacity, ActivityIndicator, useWindowDimensions } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import {
  collection, doc, onSnapshot, query, where, updateDoc, getDoc, writeBatch, runTransaction,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { goBack } from '@/lib/navigation';
import { RAW } from '@/lib/theme';
import { DuplicatePlayerNameError, playerDocId } from '@/lib/players';
import { Screen, Heading, Body, Caption, Button, Card, Avatar, ListRow, Input, Label, Badge, Sheet, ConfirmDialog } from '@/components/ui';
import { AdminShell } from '@/components/admin/AdminShell';

const DESKTOP_BREAKPOINT = 768;

interface Player { id: string; name: string; teamId: string; claimedByUserId: string | null }
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
  const [teamAddress, setTeamAddress] = useState<string | null>(null);
  const [teamVenuePhone, setTeamVenuePhone] = useState<string | null>(null);
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [divisionId, setDivisionId] = useState<string | null>(null);
  const [seasonName, setSeasonName] = useState<string | null>(null);
  const [divisionName, setDivisionName] = useState<string | null>(null);
  const [captainUserId, setCaptainUserId] = useState<string | null>(null);
  const [vcUserId, setVcUserId] = useState<string | null>(null);
  const [captainName, setCaptainName] = useState<string | null>(null);
  const [vcName, setVcName] = useState<string | null>(null);

  // Reference-only contact info for the REAL person this team's captain/VC
  // slot belongs to (from scripts/real-team-contacts-seed) — distinct from
  // captainName/vcName above, which reflect whoever is CURRENTLY linked via
  // teams.captainUserId/viceCaptainUserId (nobody, until an invite is
  // accepted).
  const [refCaptainName, setRefCaptainName] = useState<string | null>(null);
  const [refCaptainPhone, setRefCaptainPhone] = useState<string | null>(null);
  const [refVcName, setRefVcName] = useState<string | null>(null);
  const [refVcPhone, setRefVcPhone] = useState<string | null>(null);

  const [inviteSheetRole, setInviteSheetRole] = useState<'captain' | 'viceCaptain' | null>(null);
  const [isCreatingInvite, setIsCreatingInvite] = useState(false);
  const [createdInvite, setCreatedInvite] = useState<{ inviteId: string; token: string } | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [isRevokingInvite, setIsRevokingInvite] = useState(false);
  const [roleSheetPlayer, setRoleSheetPlayer] = useState<Player | null>(null);
  const [isChangingRole, setIsChangingRole] = useState(false);
  const [changeRoleError, setChangeRoleError] = useState<string | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [otherTeams, setOtherTeams] = useState<OtherTeam[]>([]);

  const [editingAddress, setEditingAddress] = useState(false);
  const [addressDraft, setAddressDraft] = useState('');
  const [venuePhoneDraft, setVenuePhoneDraft] = useState('');
  const [isSavingAddress, setIsSavingAddress] = useState(false);

  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [isAddingPlayer, setIsAddingPlayer] = useState(false);
  const [addPlayerError, setAddPlayerError] = useState<string | null>(null);

  const [moveTarget, setMoveTarget] = useState<Player | null>(null);
  const [isMoving, setIsMoving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);

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
      setRefCaptainName(data.captainName ?? null);
      setRefCaptainPhone(data.captainPhone ?? null);
      setRefVcName(data.viceCaptainName ?? null);
      setRefVcPhone(data.viceCaptainPhone ?? null);

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
    });

    const unsubPlayers = onSnapshot(
      query(collection(db, 'players'), where('teamId', '==', teamId)),
      (snap) => setPlayers(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Player))),
    );

    return () => { unsubTeam(); unsubPlayers(); };
  }, [teamId]);

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
    );
    return unsub;
  }, [appUser?.leagueId, teamId]);

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
    setChangeRoleError(null);
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
      setChangeRoleError((e as Error).message ?? 'Something went wrong');
    } finally {
      setIsChangingRole(false);
    }
  }

  async function addPlayer() {
    const trimmedName = newPlayerName.trim();
    if (!trimmedName || !teamId || !appUser?.leagueId) return;
    setIsAddingPlayer(true);
    setAddPlayerError(null);
    try {
      const ref = doc(db, 'players', playerDocId(teamId, trimmedName));
      // Transaction (not a plain create) so the same-name check and the
      // write are atomic — see players.ts: two concurrent adds for the same
      // normalized name resolve to the identical document, so Firestore
      // itself rejects whichever transaction loses the race, rather than a
      // separate query-then-write that both could pass.
      await runTransaction(db, async (tx) => {
        const existing = await tx.get(ref);
        if (existing.exists()) throw new DuplicatePlayerNameError(trimmedName);
        tx.set(ref, {
          leagueId: appUser.leagueId,
          teamId,
          name: trimmedName,
          claimedByUserId: null,
        });
      });
      setNewPlayerName('');
      setShowAddPlayer(false);
    } catch (e: unknown) {
      setAddPlayerError(e instanceof DuplicatePlayerNameError ? e.message : (e as Error).message ?? 'Something went wrong');
    } finally {
      setIsAddingPlayer(false);
    }
  }

  async function deletePlayer(player: Player) {
    if (!teamId) return;
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
  }

  async function movePlayerTo(player: Player, targetTeamId: string) {
    if (!teamId) return;
    setIsMoving(true);
    setMoveError(null);
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
      setMoveError((e as Error).message ?? 'Something went wrong');
    } finally {
      setIsMoving(false);
    }
  }

  const [deleteTeamDialogOpen, setDeleteTeamDialogOpen] = useState(false);
  const [deletePlayerTarget, setDeletePlayerTarget] = useState<Player | null>(null);

  async function deleteTeam() {
    if (!teamId) return;
    await httpsCallable(functions, 'adminDeleteTeam')({ teamId });
  }

  function openInviteSheet(role: 'captain' | 'viceCaptain') {
    setInviteSheetRole(role);
    setCreatedInvite(null);
    setInviteError(null);
  }

  async function generateInvite() {
    if (!teamId || !inviteSheetRole) return;
    setIsCreatingInvite(true);
    setInviteError(null);
    try {
      const result = await httpsCallable(functions, 'createTeamInvite')({ teamId, role: inviteSheetRole });
      const data = result.data as { inviteId: string; token: string };
      setCreatedInvite(data);
    } catch (e: unknown) {
      setInviteError((e as Error).message ?? 'Something went wrong');
    } finally {
      setIsCreatingInvite(false);
    }
  }

  // Only revokes the invite still held in this sheet's own state — this
  // screen doesn't keep a list of past-created pending invites, so once
  // this sheet closes the only way to supersede an invite is to generate a
  // new one for the same role (the old one just goes unused).
  async function revokeCreatedInvite() {
    if (!createdInvite) return;
    setIsRevokingInvite(true);
    try {
      await updateDoc(doc(db, 'invites', createdInvite.inviteId), { status: 'revoked' });
      setCreatedInvite(null);
      setInviteSheetRole(null);
    } catch (e: unknown) {
      setInviteError((e as Error).message ?? 'Something went wrong');
    } finally {
      setIsRevokingInvite(false);
    }
  }

  const inviteLink = createdInvite && typeof window !== 'undefined'
    ? `${window.location.origin}/invite/${createdInvite.inviteId}?t=${encodeURIComponent(createdInvite.token)}`
    : null;

  const captainCard = (
    <Card className="mb-4">
      <View className="mb-3">
        <Caption className="mb-1">Captain</Caption>
        <Body tone={captainName ? 'strong' : 'dim'} weight="semibold">{captainName ?? 'Not yet assigned'}</Body>
        {!captainName && (refCaptainName || refCaptainPhone) && (
          <Body size="xs" className="mt-0.5">
            On file: {refCaptainName ?? 'unnamed'}{refCaptainPhone ? ` · ${refCaptainPhone}` : ''}
          </Body>
        )}
        {!captainName && (
          <Button size="sm" variant="secondary" className="mt-2 self-start" onPress={() => openInviteSheet('captain')}>
            Invite Captain
          </Button>
        )}
      </View>
      <View>
        <Caption className="mb-1">Vice Captain</Caption>
        <Body tone={vcName ? 'strong' : 'dim'} weight="semibold">{vcName ?? 'Not yet assigned'}</Body>
        {!vcName && (refVcName || refVcPhone) && (
          <Body size="xs" className="mt-0.5">
            On file: {refVcName ?? 'unnamed'}{refVcPhone ? ` · ${refVcPhone}` : ''}
          </Body>
        )}
        {!vcName && (
          <Button size="sm" variant="secondary" className="mt-2 self-start" onPress={() => openInviteSheet('viceCaptain')}>
            Invite Vice Captain
          </Button>
        )}
      </View>
      {!captainName && (
        <Body size="xs" className="mt-2">
          A captain can also still request this role themselves — see the league Inbox.
        </Body>
      )}
    </Card>
  );

  const venueCard = (
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
  );

  const body = (
    <>
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
            return (
              <ListRow
                key={player.id}
                avatar={<Avatar initial={player.name.charAt(0)} tone="brand" size="sm" />}
                title={player.name}
                subtitle={role ? undefined : 'No account yet'}
                trailing={(
                  <View className="items-end gap-1.5">
                    {role && <Badge tone={role === 'player' ? 'butter' : 'brand'}>{ROLE_BADGE_LABEL[role]}</Badge>}
                    <View className="flex-row gap-3">
                      {role && (
                        <TouchableOpacity onPress={() => setRoleSheetPlayer(player)}>
                          <Body size="xs" tone="brand" weight="semibold">Change Role</Body>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity onPress={() => setMoveTarget(player)}>
                        <Body size="xs" tone="brand" weight="semibold">Move</Body>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setDeletePlayerTarget(player)}>
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

      <Button variant="danger" className="mt-6" onPress={() => setDeleteTeamDialogOpen(true)}>
        Delete Team
      </Button>
    </>
  );

  const modals = (
    <>
      <Sheet visible={!!roleSheetPlayer} onClose={() => { setRoleSheetPlayer(null); setChangeRoleError(null); }}>
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
            {changeRoleError && (
              <Card tone="coral" className="mt-3">
                <Body size="sm" tone="coral">{changeRoleError}</Body>
              </Card>
            )}
            <Button variant="ghost" className="mt-4" disabled={isChangingRole} onPress={() => { setRoleSheetPlayer(null); setChangeRoleError(null); }}>
              Cancel
            </Button>
          </>
        )}
      </Sheet>

      <Sheet
        visible={!!inviteSheetRole}
        onClose={() => { setInviteSheetRole(null); setCreatedInvite(null); setInviteError(null); }}
      >
        <Heading size="lg" className="mb-1">
          Invite {inviteSheetRole === 'viceCaptain' ? 'Vice Captain' : 'Captain'}
        </Heading>
        <Body size="sm" className="mb-4">
          Generates a one-time link for {teamName || 'this team'}. Send it via WhatsApp/SMS — whoever opens it
          signs in or creates a Chalkie account, then is linked to this team automatically.
        </Body>

        {!createdInvite ? (
          <>
            <Button disabled={isCreatingInvite} loading={isCreatingInvite} onPress={generateInvite}>
              Generate Link
            </Button>
          </>
        ) : (
          <>
            <Card tone="brand" className="mb-3">
              <Caption className="mb-1">Copy this link now — it's shown only once</Caption>
              <Body size="sm" selectable style={{ fontFamily: 'monospace' }}>
                {inviteLink ?? `(invite ${createdInvite.inviteId} created — open this screen on web to see the full link)`}
              </Body>
            </Card>
            <Button
              variant="ghost"
              disabled={isRevokingInvite}
              loading={isRevokingInvite}
              onPress={revokeCreatedInvite}
            >
              Revoke This Invite
            </Button>
          </>
        )}

        {inviteError && (
          <Card tone="coral" className="mt-3">
            <Body size="sm" tone="coral">{inviteError}</Body>
          </Card>
        )}

        <Button
          variant="ghost"
          className="mt-4"
          onPress={() => { setInviteSheetRole(null); setCreatedInvite(null); setInviteError(null); }}
        >
          Close
        </Button>
      </Sheet>

      <Sheet visible={showAddPlayer} onClose={() => { setShowAddPlayer(false); setAddPlayerError(null); }}>
        <Heading size="lg" className="mb-4">Add Player</Heading>
        <Label>Name</Label>
        <Input
          value={newPlayerName}
          onChangeText={(text) => { setNewPlayerName(text); setAddPlayerError(null); }}
          placeholder="e.g. Alex Turner"
          autoCapitalize="words"
          autoFocus
          className="mb-3"
        />
        {addPlayerError && (
          <Card tone="coral" className="mb-3">
            <Body size="sm" tone="coral">{addPlayerError}</Body>
          </Card>
        )}
        <View className="flex-row gap-2.5">
          <Button variant="ghost" className="flex-1" onPress={() => { setShowAddPlayer(false); setAddPlayerError(null); }}>Cancel</Button>
          <Button className="flex-1" disabled={isAddingPlayer || !newPlayerName.trim()} loading={isAddingPlayer} onPress={addPlayer}>
            Add
          </Button>
        </View>
      </Sheet>

      <Sheet visible={!!moveTarget} onClose={() => { setMoveTarget(null); setMoveError(null); }}>
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
        {moveError && (
          <Card tone="coral" className="mt-2">
            <Body size="sm" tone="coral">{moveError}</Body>
          </Card>
        )}
        <Button variant="ghost" className="mt-4" disabled={isMoving} onPress={() => { setMoveTarget(null); setMoveError(null); }}>Cancel</Button>
      </Sheet>

      <ConfirmDialog
        visible={!!deletePlayerTarget}
        title="Delete this player"
        message={
          deletePlayerTarget?.claimedByUserId
            ? `${deletePlayerTarget.name} has a linked account. Deleting removes them from this team and sends their account back to "find a team" — this can't be undone.`
            : `Delete ${deletePlayerTarget?.name}? This can't be undone.`
        }
        confirmLabel="Yes, Delete Player"
        confirmVariant="danger"
        onConfirm={() => { if (deletePlayerTarget) return deletePlayer(deletePlayerTarget); }}
        onCancel={() => setDeletePlayerTarget(null)}
        onSuccess={() => setDeletePlayerTarget(null)}
      />

      <ConfirmDialog
        visible={deleteTeamDialogOpen}
        title="Delete this team"
        message={`Delete ${teamName}? This removes all its players and any unplayed fixtures. Blocked if this team has any confirmed match results.`}
        confirmLabel="Yes, Delete Team"
        confirmVariant="danger"
        onConfirm={deleteTeam}
        onCancel={() => setDeleteTeamDialogOpen(false)}
        onSuccess={() => { setDeleteTeamDialogOpen(false); goBack(); }}
      />
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
