import { useState, useEffect } from 'react';
import { View, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { router } from 'expo-router';
import { useColorScheme } from 'nativewind';
import {
  collection, doc, onSnapshot, query, where, and, or, orderBy,
  writeBatch, addDoc, getDoc, getDocs, serverTimestamp, updateDoc,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { RAW } from '@/lib/theme';
import {
  Screen, Heading, Body, Chip, Button, Card, Badge, Avatar, Input, Label, Sheet, VisibilityPicker, AppIcon,
} from '@/components/ui';
import type { Match, PhoneVisibility, JoinRequest } from '@/types';

interface Player {
  id: string; name: string;
  claimedByUserId: string | null;
  teamId: string;
}
interface ActionableMatch {
  id: string; opponentName: string; isHome: boolean; scheduledDate: Date;
}

type TeamRole = 'captain' | 'viceCaptain' | 'player';

const ROLE_BADGE_LABEL: Record<TeamRole, string> = {
  captain: 'Captain',
  viceCaptain: 'Vice Captain',
  player: 'Player',
};

const VISIBILITY_LABELS: Record<PhoneVisibility, string> = {
  private: 'Admin only',
  captains: 'Captains & VCs',
  public: 'All players',
};

export default function CaptainsScreen() {
  const { appUser } = useAuthStore();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const teamId = appUser?.teamId ?? null;

  const [tab, setTab] = useState<'team' | 'inbox'>('team');

  const [teamName, setTeamName] = useState('');
  const [captainUserId, setCaptainUserId] = useState<string | null>(null);
  const [vcUserId, setVcUserId] = useState<string | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [teamAddress, setTeamAddress] = useState<string | null>(null);
  const [teamVenuePhone, setTeamVenuePhone] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [actionableMatches, setActionableMatches] = useState<ActionableMatch[]>([]);

  // Venue (address + contact number) editing
  const [editingAddress, setEditingAddress] = useState(false);
  const [addressDraft, setAddressDraft] = useState('');
  const [venuePhoneDraft, setVenuePhoneDraft] = useState('');
  const [isSavingAddress, setIsSavingAddress] = useState(false);

  // Phone editing
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState('');
  const [visibilityDraft, setVisibilityDraft] = useState<PhoneVisibility>('captains');
  const [isSavingPhone, setIsSavingPhone] = useState(false);
  const [phoneEditError, setPhoneEditError] = useState<string | null>(null);

  // Add player modal — two phases: 'input' → 'added'
  type ModalPhase = 'closed' | 'input' | 'added';
  const [modalPhase, setModalPhase] = useState<ModalPhase>('closed');
  const [newPlayerName, setNewPlayerName] = useState('');
  const [addedPlayerName, setAddedPlayerName] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const [respondingId, setRespondingId] = useState<string | null>(null);

  useEffect(() => {
    if (!teamId) return;

    const unsubTeam = onSnapshot(doc(db, 'teams', teamId), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setTeamName(data.name ?? '');
        setTeamAddress(data.address ?? null);
        setTeamVenuePhone(data.venuePhone ?? null);
        setCaptainUserId(data.captainUserId ?? null);
        setVcUserId(data.viceCaptainUserId ?? null);
      }
    });

    const unsubPlayers = onSnapshot(
      query(collection(db, 'players'), where('teamId', '==', teamId)),
      (snap) => {
        setPlayers(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() } as Player))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
        setIsLoading(false);
      },
    );

    const unsubRequests = onSnapshot(
      query(collection(db, 'joinRequests'), where('teamId', '==', teamId), where('status', '==', 'pending')),
      (snap) => setJoinRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() } as JoinRequest))),
    );

    return () => { unsubTeam(); unsubPlayers(); unsubRequests(); };
  }, [teamId]);

  // Matches that need this team's attention: already-played fixtures nobody has
  // submitted yet, or fixtures where the opponent has submitted and we haven't.
  useEffect(() => {
    if (!teamId || !appUser?.leagueId) { setActionableMatches([]); return; }

    const unsub = onSnapshot(
      query(
        collection(db, 'matches'),
        and(
          where('leagueId', '==', appUser.leagueId),
          or(where('homeTeamId', '==', teamId), where('awayTeamId', '==', teamId)),
        ),
        orderBy('scheduledDate', 'asc'),
      ),
      async (snap) => {
        const now = new Date();
        const all = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
          scheduledDate: d.data().scheduledDate?.toDate() ?? new Date(),
        } as Match));

        const candidates = all.filter((m) => (
          (m.status === 'scheduled' && m.scheduledDate <= now) || m.status === 'awaiting_confirmation'
        ));

        const teamNamesSnap = await getDocs(query(collection(db, 'teams'), where('leagueId', '==', appUser.leagueId)));
        const teamNames: Record<string, string> = {};
        teamNamesSnap.docs.forEach((d) => { teamNames[d.id] = d.data().name; });

        const resolved = await Promise.all(candidates.map(async (m) => {
          if (m.status === 'awaiting_confirmation') {
            const subSnap = await getDoc(doc(db, 'matches', m.id, 'submissions', teamId));
            if (subSnap.exists()) return null; // already submitted, just waiting on the opponent
          }
          const opponentId = m.homeTeamId === teamId ? m.awayTeamId : m.homeTeamId;
          return {
            id: m.id,
            opponentName: teamNames[opponentId] ?? '…',
            isHome: m.homeTeamId === teamId,
            scheduledDate: m.scheduledDate,
          } as ActionableMatch;
        }));

        setActionableMatches(resolved.filter((m): m is ActionableMatch => m !== null));
      },
    );

    return unsub;
  }, [teamId, appUser?.leagueId]);

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

  async function savePhone() {
    if (!phoneDraft.trim()) { setPhoneEditError('Enter your mobile number'); return; }
    setPhoneEditError(null);
    setIsSavingPhone(true);
    try {
      await useAuthStore.getState().updateContactDetails(phoneDraft.trim(), visibilityDraft);
      setEditingPhone(false);
    } catch (e: unknown) {
      setPhoneEditError((e as Error).message ?? 'Something went wrong');
    } finally {
      setIsSavingPhone(false);
    }
  }

  async function addPlayer() {
    if (!newPlayerName.trim()) return;
    if (!appUser?.teamId) {
      Alert.alert('Error', 'Team not loaded yet — please wait a moment and try again.');
      return;
    }
    setIsAdding(true);
    try {
      await addDoc(collection(db, 'players'), {
        name: newPlayerName.trim(),
        leagueId: appUser.leagueId,
        teamId: appUser.teamId,
        claimedByUserId: null,
        claimedAt: null,
        createdAt: serverTimestamp(),
        createdByUserId: appUser.uid,
      });
      setAddedPlayerName(newPlayerName.trim());
      setNewPlayerName('');
      setModalPhase('added');
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error).message ?? 'Something went wrong');
    } finally {
      setIsAdding(false);
    }
  }

  async function removePlayer(playerId: string, name: string) {
    Alert.alert('Remove player', `Remove "${name}" from the squad?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => { await writeBatch(db).delete(doc(db, 'players', playerId)).commit(); },
      },
    ]);
  }

  // Covers all three request kinds this team's captain/VC can act on: a plain
  // new player, someone claiming a placeholder player already on the roster,
  // or (captain only — gated below in visibleRequests) a VC role request.
  async function approveJoinRequest(req: JoinRequest) {
    if (!appUser?.teamId || !appUser.leagueId) return;
    setRespondingId(req.id);
    try {
      const batch = writeBatch(db);

      if (req.requestType === 'claim' && req.claimPlayerId) {
        batch.update(doc(db, 'players', req.claimPlayerId), {
          claimedByUserId: req.userId,
          claimedAt: serverTimestamp(),
        });
        batch.update(doc(db, 'users', req.userId), {
          role: 'player',
          teamId: appUser.teamId,
          leagueId: appUser.leagueId,
          divisionId: appUser.divisionId,
          seasonId: appUser.seasonId,
          playerId: req.claimPlayerId,
          pendingRequestType: null,
          pendingRequestId: null,
        });
      } else {
        // Plain new player, or a VC-role request — either way, a fresh linked
        // player record (a captain/VC is always also a player).
        const playerRef = doc(collection(db, 'players'));
        batch.set(playerRef, {
          name: req.displayName,
          leagueId: appUser.leagueId,
          teamId: appUser.teamId,
          claimedByUserId: req.userId,
          claimedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          createdByUserId: appUser.uid,
        });
        const role = req.requestType === 'captainRole' && req.requestedRole ? req.requestedRole : 'player';
        if (role === 'viceCaptain') {
          batch.update(doc(db, 'teams', appUser.teamId), { viceCaptainUserId: req.userId });
        }
        batch.update(doc(db, 'users', req.userId), {
          role,
          teamId: appUser.teamId,
          leagueId: appUser.leagueId,
          divisionId: appUser.divisionId,
          seasonId: appUser.seasonId,
          playerId: playerRef.id,
          pendingRequestType: null,
          pendingRequestId: null,
        });
      }

      batch.update(doc(db, 'joinRequests', req.id), {
        status: 'approved',
        approvedAt: serverTimestamp(),
        approvedByUserId: appUser.uid,
      });

      await batch.commit();
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error).message ?? 'Something went wrong');
    } finally {
      setRespondingId(null);
    }
  }

  async function rejectJoinRequest(req: JoinRequest) {
    Alert.alert('Reject request', `Reject ${req.displayName}'s request?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reject', style: 'destructive',
        onPress: async () => {
          const batch = writeBatch(db);
          batch.update(doc(db, 'joinRequests', req.id), {
            status: 'rejected',
            rejectedAt: serverTimestamp(),
          });
          batch.update(doc(db, 'users', req.userId), {
            pendingRequestType: null,
            pendingRequestId: null,
          });
          await batch.commit();
        },
      },
    ]);
  }

  function roleOf(player: Player): TeamRole | null {
    if (!player.claimedByUserId) return null;
    if (player.claimedByUserId === captainUserId) return 'captain';
    if (player.claimedByUserId === vcUserId) return 'viceCaptain';
    return 'player';
  }

  // A VC-role request is this team's captain's call, not any VC's — a plain
  // join/claim request is fine for either. A captain-role request never shows
  // here at all (that's always admin's call, see admin-inbox.tsx).
  const visibleRequests = joinRequests.filter((r) => (
    r.requestType !== 'captainRole' || (r.requestedRole === 'viceCaptain' && appUser?.uid === captainUserId)
  ));

  const roleLabel = appUser?.role === 'viceCaptain' ? 'Vice Captain' : 'Captain';
  const unclaimedCount = players.filter((p) => !p.claimedByUserId).length;
  const inboxCount = visibleRequests.length + actionableMatches.length;

  return (
    <Screen>
      <View className="flex-row gap-2 mb-5">
        <Chip label="My Team" selected={tab === 'team'} onPress={() => setTab('team')} className="flex-1" />
        <Chip
          label={inboxCount > 0 ? `Inbox (${inboxCount})` : 'Inbox'}
          selected={tab === 'inbox'}
          onPress={() => setTab('inbox')}
          className="flex-1"
        />
      </View>

      {tab === 'team' ? (
        <>
          {/* Team summary */}
          <View className="mb-5">
            <Heading size="lg">{teamName || 'My Team'}</Heading>
            <Body size="sm" tone="brand" weight="semibold" className="mt-0.5">
              {roleLabel} · {players.length} player{players.length !== 1 ? 's' : ''}
              {unclaimedCount > 0 ? ` · ${unclaimedCount} unclaimed` : ''}
            </Body>
          </View>

          {/* Home venue */}
          <Card className="mb-4">
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
                  <Button className="flex-1" disabled={isSavingAddress} loading={isSavingAddress} onPress={saveAddress}>
                    Save
                  </Button>
                </View>
              </>
            ) : (
              <>
                <Body tone={teamAddress ? 'strong' : 'dim'}>
                  {teamAddress ?? 'No venue set — tap Add to enter one'}
                </Body>
                {teamAddress && teamVenuePhone && <Body size="sm" className="mt-1">{teamVenuePhone}</Body>}
              </>
            )}
          </Card>

          {/* My contact details */}
          <Card className="mb-4">
            <View className="flex-row items-center mb-2.5">
              <Heading size="sm" className="flex-1">My Contact Details</Heading>
              {!editingPhone && (
                <Button
                  variant="secondary"
                  size="sm"
                  onPress={() => {
                    setPhoneDraft(appUser?.phone ?? '');
                    setVisibilityDraft(appUser?.phoneVisibility ?? 'captains');
                    setPhoneEditError(null);
                    setEditingPhone(true);
                  }}
                >
                  {appUser?.phone ? 'Edit' : 'Add'}
                </Button>
              )}
            </View>
            {editingPhone ? (
              <>
                {phoneEditError ? (
                  <Card tone="coral" className="mb-2.5" padded={false}>
                    <Body tone="coral" size="sm" className="p-3">{phoneEditError}</Body>
                  </Card>
                ) : null}
                <Input
                  value={phoneDraft}
                  onChangeText={setPhoneDraft}
                  placeholder="e.g. 07700 900123"
                  keyboardType="phone-pad"
                  autoFocus
                  className="mb-3"
                />
                <Label>Who can see your number?</Label>
                <VisibilityPicker value={visibilityDraft} onChange={setVisibilityDraft} />
                <View className="flex-row gap-2 mt-2.5">
                  <Button variant="ghost" className="flex-1" onPress={() => setEditingPhone(false)}>Cancel</Button>
                  <Button className="flex-1" disabled={isSavingPhone} loading={isSavingPhone} onPress={savePhone}>
                    Save
                  </Button>
                </View>
              </>
            ) : (
              <>
                <Body size="sm" tone={appUser?.phone ? 'strong' : 'dim'}>
                  {appUser?.phone ?? 'No number saved'}
                </Body>
                {appUser?.phoneVisibility && (
                  <Body size="xs" className="mt-1">
                    Visible to: {VISIBILITY_LABELS[appUser.phoneVisibility]}
                  </Body>
                )}
              </>
            )}
          </Card>

          {!teamId && (
            <Card tone="coral" className="mb-4">
              <Body tone="coral">Team not loaded — try signing out and back in.</Body>
            </Card>
          )}

          {/* Roster */}
          <Heading size="sm" className="mb-2.5">Squad</Heading>

          {isLoading ? (
            <ActivityIndicator color={RAW.brand} style={{ marginTop: 20 }} />
          ) : players.length === 0 ? (
            <Card className="mb-4 items-center py-8">
              <View className="w-14 h-14 rounded-full items-center justify-center bg-brand-fill dark:bg-brand-fill-dark mb-3">
                <AppIcon name="target" size={28} color={isDark ? RAW.brandInkDark : RAW.brandInk} />
              </View>
              <Body tone="strong" weight="semibold" className="mb-1">No players yet</Body>
              <Body size="sm" className="text-center">
                Add players below — they can then find your team and select their name to link their account.
              </Body>
            </Card>
          ) : (
            players.map((player) => {
              const isClaimed = !!player.claimedByUserId;
              const role = roleOf(player);
              return (
                <Card key={player.id} tone={isClaimed ? 'sage' : 'default'} className="mb-2.5">
                  <View className="flex-row items-center">
                    <Avatar initial={player.name.charAt(0)} tone={isClaimed ? 'sage' : 'brand'} size="sm" className="mr-3" />
                    <View className="flex-1">
                      <Body tone="strong" weight="semibold">{player.name}</Body>
                      {!isClaimed && (
                        <Body size="xs" className="mt-0.5">Not yet claimed</Body>
                      )}
                    </View>
                    {role && role !== 'player' && (
                      <Badge tone="brand" className="mr-2">{ROLE_BADGE_LABEL[role]}</Badge>
                    )}
                    <Badge tone={isClaimed ? 'sage' : 'coral'} className="mr-2">
                      {isClaimed ? 'Registered' : 'Unclaimed'}
                    </Badge>
                    {!isClaimed && (
                      <TouchableOpacity activeOpacity={0.7}
                        onPress={() => removePlayer(player.id, player.name)}
                        hitSlop={8}
                        className="w-8 h-8 rounded-full items-center justify-center bg-coral-fill dark:bg-coral-fill-dark"
                      >
                        <AppIcon name="close" size={16} color={isDark ? RAW.coralInkDark : RAW.coralInk} />
                      </TouchableOpacity>
                    )}
                  </View>
                </Card>
              );
            })
          )}

          <Button className="mt-2" onPress={() => { setNewPlayerName(''); setModalPhase('input'); }}>
            + Add Player
          </Button>

          <Sheet visible={modalPhase !== 'closed'} onClose={() => setModalPhase('closed')}>
            {modalPhase === 'input' ? (
              <>
                <Heading size="lg" className="mb-5">Add Player</Heading>
                <Label>Player name</Label>
                <Input
                  value={newPlayerName}
                  onChangeText={setNewPlayerName}
                  placeholder="e.g. Jake Smith"
                  autoCapitalize="words"
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={addPlayer}
                  className="mb-5"
                />
                <View className="flex-row gap-2.5">
                  <Button variant="ghost" className="flex-1" onPress={() => setModalPhase('closed')}>Cancel</Button>
                  <Button className="flex-1" disabled={isAdding || !newPlayerName.trim()} loading={isAdding} onPress={addPlayer}>
                    Add
                  </Button>
                </View>
              </>
            ) : (
              <>
                <View className="flex-row items-center gap-1.5 mb-1">
                  <AppIcon name="check" size={16} color={isDark ? RAW.sageInkDark : RAW.sageInk} />
                  <Body tone="sage" weight="bold">{addedPlayerName} added</Body>
                </View>
                <Body size="sm" className="mb-5">
                  When {addedPlayerName} registers, they can search for this team and select their name from the
                  squad list to link their account — no code needed.
                </Body>
                <Button onPress={() => setModalPhase('closed')}>Done</Button>
              </>
            )}
          </Sheet>
        </>
      ) : (
        <>
          {/* Needs your action */}
          <Heading size="sm" className="mb-2.5">Needs Your Action</Heading>
          {actionableMatches.length === 0 ? (
            <Body size="sm" className="mb-5">Nothing needs entering right now</Body>
          ) : (
            <View className="mb-5">
              {actionableMatches.map((m) => (
                <Card key={m.id} tone="butter" className="mb-2.5">
                  <View className="flex-row items-center justify-between mb-3">
                    <Body tone="strong" weight="semibold">
                      {m.isHome ? 'vs' : '@'} {m.opponentName}
                    </Body>
                    <Badge tone="butter">Result needed</Badge>
                  </View>
                  <Button size="sm" onPress={() => router.push(`/(protected)/results-entry?matchId=${m.id}`)}>
                    Enter Result
                  </Button>
                </Card>
              ))}
            </View>
          )}

          {/* Pending join/claim/VC requests */}
          <Heading size="sm" className="mb-2.5">Requests</Heading>
          {visibleRequests.length === 0 ? (
            <Body size="sm">No pending requests</Body>
          ) : (
            visibleRequests.map((req) => {
              const claimedPlayerName = req.claimPlayerId ? players.find((p) => p.id === req.claimPlayerId)?.name : null;
              const subtitle = req.requestType === 'claim'
                ? `Says this is: ${claimedPlayerName ?? '…'}`
                : req.requestType === 'captainRole'
                ? 'Wants to be Vice Captain'
                : 'New player';
              const isResponding = respondingId === req.id;
              return (
                <Card key={req.id} tone="coral" className="mb-2.5">
                  <Body tone="strong" weight="semibold" className="mb-1">{req.displayName}</Body>
                  <Body size="sm" className="mb-3">{subtitle}</Body>
                  <View className="flex-row gap-2.5">
                    <Button
                      variant="good"
                      className="flex-1"
                      disabled={isResponding}
                      loading={isResponding}
                      onPress={() => approveJoinRequest(req)}
                    >
                      Approve
                    </Button>
                    <Button variant="danger" className="flex-1" disabled={isResponding} onPress={() => rejectJoinRequest(req)}>
                      Reject
                    </Button>
                  </View>
                </Card>
              );
            })
          )}
        </>
      )}
    </Screen>
  );
}
