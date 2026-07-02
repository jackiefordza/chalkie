import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Modal, Share, Platform, Alert,
} from 'react-native';
import { router, Stack } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import {
  collection, doc, onSnapshot, query, where,
  writeBatch, getDocs, serverTimestamp, updateDoc,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import * as S from '@/styles/common';

import type { PhoneVisibility } from '@/types';

interface Player {
  id: string; name: string;
  claimedByUserId: string | null;
  teamId: string;
}
interface JoinRequest {
  id: string; userId: string; displayName: string; teamId: string;
}

const VISIBILITY_OPTIONS: { value: PhoneVisibility; label: string; description: string }[] = [
  { value: 'private', label: 'Admin only', description: 'Only the league admin can see your number' },
  { value: 'captains', label: 'Captains & VCs', description: 'Other captains and vice captains can contact you' },
  { value: 'public', label: 'All players', description: 'All registered players in your team can see it' },
];

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

async function shareText(label: string, code: string) {
  const message = `${label}: ${code}`;
  if (Platform.OS === 'web') {
    try { await (navigator as any).clipboard.writeText(code); } catch {}
  } else {
    await Share.share({ message });
  }
}

export default function CaptainScreen() {
  const { appUser } = useAuthStore();
  const teamId = appUser?.teamId ?? null;

  const [teamName, setTeamName] = useState('');
  const [players, setPlayers] = useState<Player[]>([]);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  // map of playerId → active claim code
  const [claimCodes, setClaimCodes] = useState<Record<string, string>>({});
  const [teamAddress, setTeamAddress] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Address editing
  const [editingAddress, setEditingAddress] = useState(false);
  const [addressDraft, setAddressDraft] = useState('');
  const [isSavingAddress, setIsSavingAddress] = useState(false);

  // Phone editing
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState('');
  const [visibilityDraft, setVisibilityDraft] = useState<PhoneVisibility>('captains');
  const [isSavingPhone, setIsSavingPhone] = useState(false);
  const [phoneEditError, setPhoneEditError] = useState<string | null>(null);

  // Add player modal — two phases: 'input' → 'code'
  type ModalPhase = 'closed' | 'input' | 'code';
  const [modalPhase, setModalPhase] = useState<ModalPhase>('closed');
  const [newPlayerName, setNewPlayerName] = useState('');
  const [generatedCode, setGeneratedCode] = useState('');
  const [generatedPlayerName, setGeneratedPlayerName] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const [generatingCodeFor, setGeneratingCodeFor] = useState<string | null>(null);

  useEffect(() => {
    if (!teamId) return;

    const unsubTeam = onSnapshot(doc(db, 'teams', teamId), (snap) => {
      if (snap.exists()) {
        setTeamName(snap.data().name ?? '');
        setTeamAddress(snap.data().address ?? null);
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

    const unsubCodes = onSnapshot(
      query(collection(db, 'claimCodes'), where('teamId', '==', teamId), where('usedByUserId', '==', null)),
      (snap) => {
        const map: Record<string, string> = {};
        snap.docs.forEach((d) => { map[d.data().playerId] = d.id; });
        setClaimCodes(map);
      },
    );

    return () => { unsubTeam(); unsubPlayers(); unsubRequests(); unsubCodes(); };
  }, [teamId]);

  async function saveAddress() {
    if (!teamId) return;
    setIsSavingAddress(true);
    try {
      await updateDoc(doc(db, 'teams', teamId), { address: addressDraft.trim() || null });
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
      const batch = writeBatch(db);
      const playerRef = doc(collection(db, 'players'));
      const code = generateCode();
      const codeRef = doc(db, 'claimCodes', code);

      batch.set(playerRef, {
        name: newPlayerName.trim(),
        leagueId: appUser.leagueId,
        teamId: appUser.teamId,
        claimedByUserId: null,
        claimedAt: null,
        createdAt: serverTimestamp(),
        createdByUserId: appUser.uid,
      });

      batch.set(codeRef, {
        playerId: playerRef.id,
        leagueId: appUser.leagueId,
        teamId: appUser.teamId,
        usedByUserId: null,
        createdAt: serverTimestamp(),
        createdByUserId: appUser.uid,
      });

      await batch.commit();
      setGeneratedCode(code);
      setGeneratedPlayerName(newPlayerName.trim());
      setNewPlayerName('');
      setModalPhase('code');
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error).message ?? 'Something went wrong');
    } finally {
      setIsAdding(false);
    }
  }

  async function generateCodeForPlayer(playerId: string) {
    if (!appUser?.teamId) return;
    setGeneratingCodeFor(playerId);
    try {
      // Delete existing unused codes for this player
      const existing = await getDocs(
        query(collection(db, 'claimCodes'), where('playerId', '==', playerId), where('usedByUserId', '==', null)),
      );
      const batch = writeBatch(db);
      existing.docs.forEach((d) => batch.delete(d.ref));
      const code = generateCode();
      batch.set(doc(db, 'claimCodes', code), {
        playerId,
        leagueId: appUser.leagueId,
        teamId: appUser.teamId,
        usedByUserId: null,
        createdAt: serverTimestamp(),
        createdByUserId: appUser.uid,
      });
      await batch.commit();
    } finally {
      setGeneratingCodeFor(null);
    }
  }

  async function removePlayer(playerId: string, name: string) {
    Alert.alert('Remove player', `Remove "${name}" from the squad?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          const batch = writeBatch(db);
          batch.delete(doc(db, 'players', playerId));
          // also delete any unused claim codes
          const codes = await getDocs(
            query(collection(db, 'claimCodes'), where('playerId', '==', playerId), where('usedByUserId', '==', null)),
          );
          codes.docs.forEach((d) => batch.delete(d.ref));
          await batch.commit();
        },
      },
    ]);
  }

  async function approveJoinRequest(req: JoinRequest) {
    if (!appUser?.teamId || !appUser.leagueId) return;
    try {
      const batch = writeBatch(db);
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
      batch.update(doc(db, 'joinRequests', req.id), {
        status: 'approved',
        playerId: playerRef.id,
        approvedAt: serverTimestamp(),
        approvedByUserId: appUser.uid,
      });
      // This triggers the player's onSnapshot → auto-redirects them
      batch.update(doc(db, 'users', req.userId), {
        role: 'player',
        teamId: appUser.teamId,
        leagueId: appUser.leagueId,
        playerId: playerRef.id,
        pendingRequestType: null,
        pendingRequestId: null,
      });
      await batch.commit();
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error).message ?? 'Something went wrong');
    }
  }

  async function rejectJoinRequest(req: JoinRequest) {
    Alert.alert('Reject request', `Reject ${req.displayName}'s request to join?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reject', style: 'destructive',
        onPress: async () => {
          const batch = writeBatch(db);
          batch.update(doc(db, 'joinRequests', req.id), {
            status: 'rejected',
            rejectedAt: serverTimestamp(),
          });
          // Let the player try again
          batch.update(doc(db, 'users', req.userId), {
            pendingRequestType: null,
            pendingRequestId: null,
          });
          await batch.commit();
        },
      },
    ]);
  }

  const roleLabel = appUser?.role === 'viceCaptain' ? 'Vice Captain' : 'Captain';
  const unclaimedCount = players.filter((p) => !p.claimedByUserId).length;

  return (
    <LinearGradient colors={S.GRADIENT} style={{ flex: 1 }}>
      <Stack.Screen options={{ title: teamName || 'My Team' }} />
      <ScrollView contentContainerStyle={{ padding: 20 }}>

        {/* Captain banner */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 12 }}>
          <View style={{
            width: 44, height: 44, borderRadius: 22,
            backgroundColor: 'rgba(0,122,255,0.2)',
            borderWidth: 1, borderColor: 'rgba(0,122,255,0.4)',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ color: S.BLUE, fontSize: 18, fontWeight: '700' }}>
              {appUser?.displayName?.charAt(0).toUpperCase() ?? '?'}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: S.WHITE, fontSize: 16, fontWeight: '700' }}>
              {appUser?.displayName ?? ''}
            </Text>
            <Text style={{ color: S.BLUE, fontSize: 12, fontWeight: '600', marginTop: 1 }}>
              {roleLabel} · {players.length} player{players.length !== 1 ? 's' : ''}
              {unclaimedCount > 0 ? ` · ${unclaimedCount} unclaimed` : ''}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push('/(protected)/fixtures')}
            style={{ backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 }}
            activeOpacity={0.7}
          >
            <Text style={{ color: S.WHITE, fontSize: 13, fontWeight: '600' }}>🗓 Fixtures</Text>
          </TouchableOpacity>
        </View>

        {/* Home venue */}
        <BlurView intensity={20} tint="dark" style={{ borderRadius: 16, overflow: 'hidden', marginBottom: 16 }}>
          <View style={[S.glassCard, { padding: 16 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
              <Text style={{ color: S.WHITE, fontSize: 14, fontWeight: '700', flex: 1 }}>Home Venue</Text>
              {!editingAddress && (
                <TouchableOpacity
                  onPress={() => { setAddressDraft(teamAddress ?? ''); setEditingAddress(true); }}
                  style={{ backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}
                >
                  <Text style={{ color: S.WHITE_60, fontSize: 12 }}>{teamAddress ? 'Edit' : 'Add'}</Text>
                </TouchableOpacity>
              )}
            </View>
            {editingAddress ? (
              <>
                <TextInput
                  value={addressDraft}
                  onChangeText={setAddressDraft}
                  placeholder="e.g. The Red Lion, 12 High St, Birmingham"
                  placeholderTextColor={S.WHITE_30}
                  autoCapitalize="words"
                  autoFocus
                  style={[S.input, { marginBottom: 10 }]}
                />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    onPress={() => setEditingAddress(false)}
                    style={{ flex: 1, padding: 10, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center' }}
                  >
                    <Text style={{ color: S.WHITE_60 }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={saveAddress}
                    disabled={isSavingAddress}
                    style={[S.primaryButton, { flex: 1, paddingVertical: 10 }]}
                  >
                    {isSavingAddress ? <ActivityIndicator color={S.WHITE} /> : <Text style={S.primaryButtonText}>Save</Text>}
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <Text style={{ color: teamAddress ? S.WHITE : S.WHITE_50, fontSize: 13 }}>
                {teamAddress ?? 'No venue set — tap Add to enter one'}
              </Text>
            )}
          </View>
        </BlurView>

        {/* My contact details */}
        <BlurView intensity={20} tint="dark" style={{ borderRadius: 16, overflow: 'hidden', marginBottom: 16 }}>
          <View style={[S.glassCard, { padding: 16 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
              <Text style={{ color: S.WHITE, fontSize: 14, fontWeight: '700', flex: 1 }}>My Contact Details</Text>
              {!editingPhone && (
                <TouchableOpacity
                  onPress={() => {
                    setPhoneDraft(appUser?.phone ?? '');
                    setVisibilityDraft(appUser?.phoneVisibility ?? 'captains');
                    setPhoneEditError(null);
                    setEditingPhone(true);
                  }}
                  style={{ backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}
                >
                  <Text style={{ color: S.WHITE_60, fontSize: 12 }}>{appUser?.phone ? 'Edit' : 'Add'}</Text>
                </TouchableOpacity>
              )}
            </View>
            {editingPhone ? (
              <>
                {phoneEditError ? (
                  <View style={[S.errorBox, { marginBottom: 10 }]}>
                    <Text style={{ color: S.RED, fontSize: 13 }}>{phoneEditError}</Text>
                  </View>
                ) : null}
                <TextInput
                  value={phoneDraft}
                  onChangeText={setPhoneDraft}
                  placeholder="e.g. 07700 900123"
                  placeholderTextColor={S.WHITE_30}
                  keyboardType="phone-pad"
                  autoFocus
                  style={[S.input, { marginBottom: 12 }]}
                />
                <Text style={{ color: S.WHITE_50, fontSize: 11, fontWeight: '600', marginBottom: 8 }}>WHO CAN SEE YOUR NUMBER?</Text>
                {VISIBILITY_OPTIONS.map((opt) => {
                  const selected = visibilityDraft === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      onPress={() => setVisibilityDraft(opt.value)}
                      activeOpacity={0.7}
                      style={{
                        flexDirection: 'row', alignItems: 'center', padding: 10,
                        borderRadius: 10, marginBottom: 6,
                        backgroundColor: selected ? 'rgba(0,122,255,0.15)' : 'rgba(255,255,255,0.05)',
                        borderWidth: 1, borderColor: selected ? S.BLUE : 'rgba(255,255,255,0.1)',
                      }}
                    >
                      <View style={{
                        width: 18, height: 18, borderRadius: 9, marginRight: 10,
                        borderWidth: 2, borderColor: selected ? S.BLUE : S.WHITE_30,
                        alignItems: 'center', justifyContent: 'center',
                      }}>
                        {selected && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: S.BLUE }} />}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: S.WHITE, fontWeight: '600', fontSize: 13 }}>{opt.label}</Text>
                        <Text style={{ color: S.WHITE_50, fontSize: 11, marginTop: 1 }}>{opt.description}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                  <TouchableOpacity
                    onPress={() => setEditingPhone(false)}
                    style={{ flex: 1, padding: 10, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center' }}
                  >
                    <Text style={{ color: S.WHITE_60 }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={savePhone}
                    disabled={isSavingPhone}
                    style={[S.primaryButton, { flex: 1, paddingVertical: 10 }]}
                  >
                    {isSavingPhone ? <ActivityIndicator color={S.WHITE} /> : <Text style={S.primaryButtonText}>Save</Text>}
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <Text style={{ color: appUser?.phone ? S.WHITE : S.WHITE_50, fontSize: 14 }}>
                  {appUser?.phone ?? 'No number saved'}
                </Text>
                {appUser?.phoneVisibility && (
                  <Text style={{ color: S.WHITE_50, fontSize: 12, marginTop: 4 }}>
                    Visible to: {VISIBILITY_OPTIONS.find((o) => o.value === appUser.phoneVisibility)?.label ?? appUser.phoneVisibility}
                  </Text>
                )}
              </>
            )}
          </View>
        </BlurView>

        {/* Guard: warn if team not loaded yet */}
        {!teamId && (
          <View style={[S.errorBox, { marginBottom: 16 }]}>
            <Text style={{ color: S.RED }}>Team not loaded — try signing out and back in.</Text>
          </View>
        )}

        {/* Pending join requests */}
        {joinRequests.length > 0 && (
          <View style={{ marginBottom: 20 }}>
            <Text style={{ color: S.WHITE, fontSize: 15, fontWeight: '700', marginBottom: 10 }}>
              ⏳  Join Requests ({joinRequests.length})
            </Text>
            {joinRequests.map((req) => (
              <View
                key={req.id}
                style={{
                  backgroundColor: 'rgba(255,165,0,0.1)',
                  borderWidth: 1, borderColor: 'rgba(255,165,0,0.35)',
                  borderRadius: 14, padding: 16, marginBottom: 10,
                }}
              >
                <Text style={{ color: S.WHITE, fontSize: 15, fontWeight: '600', marginBottom: 12 }}>
                  {req.displayName}
                </Text>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity
                    onPress={() => approveJoinRequest(req)}
                    style={{ flex: 1, backgroundColor: '#007AFF', borderRadius: 10, paddingVertical: 10, alignItems: 'center' }}
                    activeOpacity={0.8}
                  >
                    <Text style={{ color: S.WHITE, fontWeight: '600' }}>Approve</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => rejectJoinRequest(req)}
                    style={{ flex: 1, backgroundColor: 'rgba(255,59,48,0.15)', borderRadius: 10, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,59,48,0.4)' }}
                    activeOpacity={0.8}
                  >
                    <Text style={{ color: S.RED, fontWeight: '600' }}>Reject</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Roster */}
        <Text style={{ color: S.WHITE, fontSize: 15, fontWeight: '700', marginBottom: 10 }}>
          Squad
        </Text>

        {isLoading ? (
          <ActivityIndicator color={S.BLUE} style={{ marginTop: 20 }} />
        ) : players.length === 0 ? (
          <BlurView intensity={20} tint="dark" style={{ borderRadius: 16, overflow: 'hidden', marginBottom: 16 }}>
            <View style={[S.glassCard, { alignItems: 'center', paddingVertical: 32 }]}>
              <Text style={{ fontSize: 36, marginBottom: 12 }}>🎯</Text>
              <Text style={{ color: S.WHITE, fontWeight: '600', marginBottom: 4 }}>No players yet</Text>
              <Text style={{ color: S.WHITE_50, fontSize: 13, textAlign: 'center' }}>
                Add players below, or approve join requests when players find your team.
              </Text>
            </View>
          </BlurView>
        ) : (
          players.map((player) => {
            const code = claimCodes[player.id];
            const isClaimed = !!player.claimedByUserId;
            return (
              <View
                key={player.id}
                style={{
                  backgroundColor: 'rgba(255,255,255,0.07)',
                  borderRadius: 14, padding: 14, marginBottom: 10,
                  borderWidth: 1, borderColor: isClaimed ? 'rgba(52,199,89,0.3)' : 'rgba(255,255,255,0.12)',
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: isClaimed ? 0 : 10 }}>
                  <View style={{
                    width: 36, height: 36, borderRadius: 18, marginRight: 12,
                    backgroundColor: isClaimed ? 'rgba(52,199,89,0.2)' : 'rgba(255,255,255,0.1)',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Text style={{ color: isClaimed ? '#34C759' : S.WHITE_60, fontWeight: '700' }}>
                      {player.name.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: S.WHITE, fontWeight: '600' }}>{player.name}</Text>
                    {isClaimed ? (
                      <Text style={{ color: '#34C759', fontSize: 12, marginTop: 1 }}>✓ Registered</Text>
                    ) : (
                      <Text style={{ color: S.WHITE_50, fontSize: 12, marginTop: 1 }}>No account yet</Text>
                    )}
                  </View>
                  {!isClaimed && (
                    <TouchableOpacity onPress={() => removePlayer(player.id, player.name)} hitSlop={8}>
                      <Text style={{ color: 'rgba(255,59,48,0.7)', fontSize: 18 }}>✕</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Claim code section for unclaimed players */}
                {!isClaimed && (
                  code ? (
                    <View style={{
                      flexDirection: 'row', alignItems: 'center',
                      backgroundColor: 'rgba(0,122,255,0.1)', borderRadius: 10,
                      padding: 10, borderWidth: 1, borderColor: 'rgba(0,122,255,0.25)',
                    }}>
                      <Text style={{ color: S.BLUE, fontSize: 16, fontWeight: '700', letterSpacing: 3, flex: 1 }}>
                        {code}
                      </Text>
                      <TouchableOpacity
                        onPress={() => shareText(`${player.name}'s claim code`, code)}
                        style={{ backgroundColor: 'rgba(0,122,255,0.2)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 }}
                      >
                        <Text style={{ color: S.BLUE, fontSize: 12, fontWeight: '600' }}>Share</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => generateCodeForPlayer(player.id)}
                        style={{ marginLeft: 8 }}
                        disabled={generatingCodeFor === player.id}
                      >
                        {generatingCodeFor === player.id
                          ? <ActivityIndicator color={S.WHITE_50} size="small" />
                          : <Text style={{ color: S.WHITE_50, fontSize: 12 }}>Regen</Text>
                        }
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity
                      onPress={() => generateCodeForPlayer(player.id)}
                      disabled={generatingCodeFor === player.id}
                      style={{
                        borderRadius: 10, padding: 10, borderWidth: 1,
                        borderColor: 'rgba(255,255,255,0.15)', borderStyle: 'dashed',
                        alignItems: 'center',
                      }}
                    >
                      {generatingCodeFor === player.id
                        ? <ActivityIndicator color={S.WHITE_50} size="small" />
                        : <Text style={{ color: S.WHITE_50, fontSize: 13 }}>Generate claim code</Text>
                      }
                    </TouchableOpacity>
                  )
                )}
              </View>
            );
          })
        )}

        {/* Add player button */}
        <TouchableOpacity
          onPress={() => { setNewPlayerName(''); setModalPhase('input'); }}
          style={[S.primaryButton, { marginTop: 8 }]}
          activeOpacity={0.8}
        >
          <Text style={S.primaryButtonText}>+ Add Player</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Add player modal */}
      <Modal visible={modalPhase !== 'closed'} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', padding: 24 }}>
          <BlurView intensity={30} tint="dark" style={{ borderRadius: 20, overflow: 'hidden' }}>
            <View style={S.glassCard}>
              {modalPhase === 'input' ? (
                <>
                  <Text style={{ color: S.WHITE, fontSize: 20, fontWeight: '700', marginBottom: 20 }}>
                    Add Player
                  </Text>
                  <Text style={S.label}>PLAYER NAME</Text>
                  <TextInput
                    value={newPlayerName}
                    onChangeText={setNewPlayerName}
                    placeholder="e.g. Jake Smith"
                    placeholderTextColor={S.WHITE_30}
                    autoCapitalize="words"
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={addPlayer}
                    style={[S.input, { marginBottom: 20 }]}
                  />
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <TouchableOpacity
                      onPress={() => setModalPhase('closed')}
                      style={{ flex: 1, padding: 14, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center' }}
                    >
                      <Text style={{ color: S.WHITE_60 }}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={addPlayer}
                      disabled={isAdding || !newPlayerName.trim()}
                      style={[isAdding || !newPlayerName.trim() ? S.primaryButtonDisabled : S.primaryButton, { flex: 1 }]}
                    >
                      {isAdding
                        ? <ActivityIndicator color={S.WHITE} />
                        : <Text style={S.primaryButtonText}>Add</Text>
                      }
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <>
                  <Text style={{ color: '#34C759', fontSize: 16, fontWeight: '700', marginBottom: 4 }}>
                    ✓ {generatedPlayerName} added
                  </Text>
                  <Text style={{ color: S.WHITE_50, fontSize: 13, marginBottom: 20 }}>
                    Share this claim code so they can link their account when they register.
                  </Text>
                  <View style={{
                    backgroundColor: 'rgba(0,122,255,0.1)', borderRadius: 12, padding: 16,
                    borderWidth: 1, borderColor: 'rgba(0,122,255,0.3)', alignItems: 'center', marginBottom: 20,
                  }}>
                    <Text style={{ color: S.BLUE, fontSize: 28, fontWeight: '700', letterSpacing: 6 }}>
                      {generatedCode}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <TouchableOpacity
                      onPress={() => shareText(`${generatedPlayerName}'s claim code`, generatedCode)}
                      style={[S.primaryButton, { flex: 1 }]}
                      activeOpacity={0.8}
                    >
                      <Text style={S.primaryButtonText}>Share Code</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => { setModalPhase('closed'); setGeneratedCode(''); }}
                      style={{ flex: 1, padding: 14, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center' }}
                    >
                      <Text style={{ color: S.WHITE_60 }}>Done</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </BlurView>
        </View>
      </Modal>
    </LinearGradient>
  );
}
