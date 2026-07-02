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
  getDocs, getDoc, writeBatch, addDoc, updateDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import * as S from '@/styles/common';

interface TeamRequest {
  id: string; leagueId: string; teamName: string;
  captainUserId: string; captainDisplayName: string;
  status: string;
}
interface Season { id: string; name: string; status: string }
interface Division { id: string; name: string; order: number }

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

async function shareText(text: string) {
  if (Platform.OS === 'web') {
    try { await (navigator as any).clipboard.writeText(text); } catch {}
  } else {
    await Share.share({ message: text });
  }
}

export default function AdminHomeScreen() {
  const { appUser, isLoading, logOut } = useAuthStore();
  const leagueId = appUser?.leagueId ?? null;

  const [leagueName, setLeagueName] = useState('');
  const [leagueExists, setLeagueExists] = useState<boolean | null>(null); // null = checking
  const [captainCode, setCaptainCode] = useState<string | null>(null);
  const [requests, setRequests] = useState<TeamRequest[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);

  // New season modal
  const [showSeasonModal, setShowSeasonModal] = useState(false);
  const [newSeasonName, setNewSeasonName] = useState('');
  const [isCreatingSeason, setIsCreatingSeason] = useState(false);

  // Approve modal
  const [approvalTarget, setApprovalTarget] = useState<TeamRequest | null>(null);
  const [approvalSeasons, setApprovalSeasons] = useState<Season[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<Season | null>(null);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [selectedDivision, setSelectedDivision] = useState<Division | null>(null);
  const [newDivisionName, setNewDivisionName] = useState('');
  const [showNewDivision, setShowNewDivision] = useState(false);
  const [isApproving, setIsApproving] = useState(false);

  const [setupLeagueName, setSetupLeagueName] = useState('');
  const [isCreatingLeague, setIsCreatingLeague] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  async function handleCreateLeague() {
    if (!setupLeagueName.trim() || !appUser) return;
    setSetupError(null);
    setIsCreatingLeague(true);
    try {
      const batch = writeBatch(db);
      const leagueRef = doc(collection(db, 'leagues'));
      batch.set(leagueRef, {
        name: setupLeagueName.trim(),
        adminUserId: appUser.uid,
        captainInviteCode: null,
        createdAt: serverTimestamp(),
      });
      batch.update(doc(db, 'users', appUser.uid), { leagueId: leagueRef.id });
      await batch.commit();
      // Stay on null (spinner) — onSnapshot updates leagueId → useEffect checks Firestore → sets leagueExists(true)
    } catch (e: unknown) {
      setSetupError((e as Error).message ?? 'Something went wrong');
      setIsCreatingLeague(false);
    }
  }

  // Load league info + live subscriptions
  useEffect(() => {
    if (!leagueId) {
      setLeagueExists(false);
      return;
    }

    let cancelled = false;
    getDoc(doc(db, 'leagues', leagueId)).then((snap) => {
      if (cancelled) return;
      if (snap.exists()) {
        setLeagueExists(true);
        setLeagueName(snap.data().name);
        setCaptainCode(snap.data().captainInviteCode ?? null);
      } else {
        setLeagueExists(false);
      }
    });

    const unsubReqs = onSnapshot(
      query(collection(db, 'teamRequests'), where('leagueId', '==', leagueId), where('status', '==', 'pending')),
      (snap) => setRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() } as TeamRequest))),
    );

    const unsubSeasons = onSnapshot(
      query(collection(db, 'seasons'), where('leagueId', '==', leagueId)),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Season))
          .sort((a, b) => (b as any).createdAt?.seconds - (a as any).createdAt?.seconds);
        setSeasons(list);
      },
    );

    return () => { cancelled = true; unsubReqs(); unsubSeasons(); };
  }, [leagueId]); // appUser intentionally excluded — new object ref on every onSnapshot would restart subscriptions

  // Load divisions when a season is selected in the approve modal
  useEffect(() => {
    if (!selectedSeason) { setDivisions([]); return; }
    getDocs(query(collection(db, 'divisions'), where('seasonId', '==', selectedSeason.id)))
      .then((snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Division))
          .sort((a, b) => a.order - b.order);
        setDivisions(list);
      });
  }, [selectedSeason]);

  async function generateCaptainCode() {
    if (!leagueId) return;
    setIsGeneratingCode(true);
    const code = generateCode();
    await updateDoc(doc(db, 'leagues', leagueId), { captainInviteCode: code });
    setCaptainCode(code);
    setIsGeneratingCode(false);
  }

  async function createSeason() {
    if (!newSeasonName.trim() || !leagueId) return;
    setIsCreatingSeason(true);
    await addDoc(collection(db, 'seasons'), {
      leagueId,
      name: newSeasonName.trim(),
      status: 'upcoming',
      createdAt: serverTimestamp(),
    });
    setNewSeasonName('');
    setShowSeasonModal(false);
    setIsCreatingSeason(false);
  }

  function openApprove(req: TeamRequest) {
    setApprovalTarget(req);
    setApprovalSeasons(seasons);
    setSelectedSeason(seasons.length === 1 ? seasons[0] : null);
    setSelectedDivision(null);
    setNewDivisionName('');
    setShowNewDivision(false);
  }

  async function approveRequest() {
    if (!approvalTarget || !selectedSeason || !appUser?.leagueId) return;
    if (!selectedDivision && !newDivisionName.trim()) return;

    setIsApproving(true);
    try {
      const batch = writeBatch(db);

      let divisionId = selectedDivision?.id;
      if (!divisionId) {
        const divRef = doc(collection(db, 'divisions'));
        divisionId = divRef.id;
        batch.set(divRef, {
          leagueId: appUser.leagueId,
          seasonId: selectedSeason.id,
          name: newDivisionName.trim(),
          order: divisions.length + 1,
          createdAt: serverTimestamp(),
        });
      }

      const teamRef = doc(collection(db, 'teams'));
      batch.set(teamRef, {
        leagueId: appUser.leagueId,
        seasonId: selectedSeason.id,
        divisionId,
        name: approvalTarget.teamName,
        captainUserId: approvalTarget.captainUserId,
        viceCaptainUserId: null,
        playerInviteCode: null,
        createdAt: serverTimestamp(),
      });

      // Auto-create a player record for the captain
      const captainPlayerRef = doc(collection(db, 'players'));
      batch.set(captainPlayerRef, {
        name: approvalTarget.captainDisplayName,
        leagueId: appUser.leagueId,
        teamId: teamRef.id,
        claimedByUserId: approvalTarget.captainUserId,
        claimedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        createdByUserId: appUser.uid,
      });

      batch.update(doc(db, 'teamRequests', approvalTarget.id), {
        status: 'approved',
        teamId: teamRef.id,
        approvedAt: serverTimestamp(),
        approvedByUserId: appUser.uid,
      });

      // This update triggers the captain's onSnapshot → auto-redirects them
      batch.update(doc(db, 'users', approvalTarget.captainUserId), {
        role: 'captain',
        teamId: teamRef.id,
        leagueId: appUser.leagueId,
        divisionId,
        seasonId: selectedSeason.id,
        playerId: captainPlayerRef.id,
        pendingRequestType: null,
        pendingRequestId: null,
      });

      await batch.commit();
      setApprovalTarget(null);
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error).message ?? 'Something went wrong');
    } finally {
      setIsApproving(false);
    }
  }

  async function rejectRequest(req: TeamRequest) {
    Alert.alert(
      'Reject request',
      `Reject "${req.teamName}" from ${req.captainDisplayName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject', style: 'destructive',
          onPress: async () => {
            await updateDoc(doc(db, 'teamRequests', req.id), {
              status: 'rejected',
              rejectedAt: serverTimestamp(),
            });
          },
        },
      ],
    );
  }

  const canApprove = selectedSeason && (selectedDivision || newDivisionName.trim());

  // Auth still loading, or leagueId is set but we haven't confirmed the doc exists yet
  if (isLoading || (leagueId && leagueExists === null)) {
    return (
      <LinearGradient colors={S.GRADIENT} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Stack.Screen options={{ title: 'Admin' }} />
        <ActivityIndicator color={S.BLUE} size="large" />
      </LinearGradient>
    );
  }

  // Show setup if no leagueId or league doc doesn't exist in Firestore
  if (!leagueId || leagueExists === false) {
    return (
      <LinearGradient colors={S.GRADIENT} style={{ flex: 1 }}>
        <Stack.Screen options={{ title: 'League Setup' }} />
        <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 20 }}>
          <BlurView intensity={20} tint="dark" style={{ borderRadius: 20, overflow: 'hidden' }}>
            <View style={S.glassCard}>
              <Text style={{ color: S.WHITE, fontSize: 24, fontWeight: '700', marginBottom: 6 }}>
                Set up your league
              </Text>
              <Text style={{ color: S.WHITE_50, fontSize: 14, marginBottom: 28 }}>
                One-time setup — this is the name players will search for when joining.
              </Text>
              {setupError ? (
                <View style={S.errorBox}>
                  <Text style={{ color: S.RED }}>{setupError}</Text>
                </View>
              ) : null}
              <Text style={S.label}>LEAGUE NAME</Text>
              <TextInput
                value={setupLeagueName}
                onChangeText={setSetupLeagueName}
                placeholder="e.g. Midlands Darts League"
                placeholderTextColor={S.WHITE_30}
                autoCapitalize="words"
                returnKeyType="done"
                onSubmitEditing={handleCreateLeague}
                style={[S.input, { marginBottom: 24 }]}
              />
              <TouchableOpacity
                onPress={handleCreateLeague}
                disabled={isCreatingLeague || !setupLeagueName.trim()}
                style={isCreatingLeague || !setupLeagueName.trim() ? S.primaryButtonDisabled : S.primaryButton}
                activeOpacity={0.8}
              >
                {isCreatingLeague
                  ? <ActivityIndicator color={S.WHITE} />
                  : <Text style={S.primaryButtonText}>Create League</Text>
                }
              </TouchableOpacity>
            </View>
          </BlurView>
        </View>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient colors={S.GRADIENT} style={{ flex: 1 }}>
      <Stack.Screen options={{ title: leagueName || 'Admin' }} />
      <ScrollView contentContainerStyle={{ padding: 20 }}>

        {/* League banner */}
        <BlurView intensity={20} tint="dark" style={{ borderRadius: 16, overflow: 'hidden', marginBottom: 20 }}>
          <View style={{ padding: 16, flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ fontSize: 28, marginRight: 12 }}>🏆</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: S.WHITE_50, fontSize: 11, fontWeight: '600', marginBottom: 2 }}>YOUR LEAGUE</Text>
              <Text style={{ color: S.WHITE, fontSize: 18, fontWeight: '700' }}>
                {leagueName || '…'}
              </Text>
            </View>
            <View style={{ backgroundColor: 'rgba(0,122,255,0.2)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(0,122,255,0.4)' }}>
              <Text style={{ color: S.BLUE, fontSize: 11, fontWeight: '600' }}>Admin</Text>
            </View>
          </View>
        </BlurView>

        {/* Pending requests */}
        {requests.length > 0 && (
          <View style={{ marginBottom: 20 }}>
            <Text style={{ color: S.WHITE, fontSize: 16, fontWeight: '700', marginBottom: 10 }}>
              ⏳  Pending Team Requests ({requests.length})
            </Text>
            {requests.map((req) => (
              <View
                key={req.id}
                style={{
                  backgroundColor: 'rgba(255,165,0,0.1)',
                  borderWidth: 1,
                  borderColor: 'rgba(255,165,0,0.35)',
                  borderRadius: 14,
                  padding: 16,
                  marginBottom: 10,
                }}
              >
                <Text style={{ color: S.WHITE, fontSize: 16, fontWeight: '700' }}>{req.teamName}</Text>
                <Text style={{ color: S.WHITE_50, fontSize: 13, marginBottom: 14 }}>
                  Captain: {req.captainDisplayName}
                </Text>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity
                    onPress={() => openApprove(req)}
                    style={{ flex: 1, backgroundColor: '#007AFF', borderRadius: 10, paddingVertical: 10, alignItems: 'center' }}
                    activeOpacity={0.8}
                  >
                    <Text style={{ color: S.WHITE, fontWeight: '600' }}>Approve</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => rejectRequest(req)}
                    style={{ flex: 1, backgroundColor: 'rgba(255,59,48,0.2)', borderRadius: 10, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,59,48,0.4)' }}
                    activeOpacity={0.8}
                  >
                    <Text style={{ color: S.RED, fontWeight: '600' }}>Reject</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Captain invite code */}
        <BlurView intensity={20} tint="dark" style={{ borderRadius: 16, overflow: 'hidden', marginBottom: 20 }}>
          <View style={[S.glassCard, { padding: 16 }]}>
            <Text style={{ color: S.WHITE, fontSize: 15, fontWeight: '700', marginBottom: 4 }}>
              Captain Invite Code
            </Text>
            <Text style={{ color: S.WHITE_50, fontSize: 12, marginBottom: 12 }}>
              Share this code with captains so they can create their team
            </Text>
            {captainCode ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ color: S.BLUE, fontSize: 22, fontWeight: '700', letterSpacing: 4, flex: 1 }}>
                  {captainCode}
                </Text>
                <TouchableOpacity
                  onPress={() => shareText(captainCode)}
                  style={{ backgroundColor: 'rgba(0,122,255,0.2)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}
                >
                  <Text style={{ color: S.BLUE, fontWeight: '600', fontSize: 13 }}>Share</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={generateCaptainCode}>
                  <Text style={{ color: S.WHITE_50, fontSize: 13 }}>Regen</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                onPress={generateCaptainCode}
                disabled={isGeneratingCode}
                style={[S.primaryButton, { paddingVertical: 10 }]}
                activeOpacity={0.8}
              >
                {isGeneratingCode
                  ? <ActivityIndicator color={S.WHITE} />
                  : <Text style={S.primaryButtonText}>Generate Code</Text>
                }
              </TouchableOpacity>
            )}
          </View>
        </BlurView>

        {/* Seasons */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
          <Text style={{ color: S.WHITE, fontSize: 16, fontWeight: '700', flex: 1 }}>Seasons</Text>
          <TouchableOpacity
            onPress={() => setShowSeasonModal(true)}
            style={{ backgroundColor: S.BLUE, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}
          >
            <Text style={{ color: S.WHITE, fontWeight: '600', fontSize: 13 }}>+ New Season</Text>
          </TouchableOpacity>
        </View>

        {seasons.length === 0 ? (
          <Text style={{ color: S.WHITE_50, textAlign: 'center', paddingVertical: 20 }}>
            No seasons yet — create one to get started
          </Text>
        ) : (
          seasons.map((season) => (
            <TouchableOpacity
              key={season.id}
              onPress={() => router.push(`/(protected)/admin-season?seasonId=${season.id}`)}
              activeOpacity={0.7}
              style={{
                backgroundColor: 'rgba(255,255,255,0.07)',
                borderRadius: 14,
                padding: 16,
                marginBottom: 10,
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.12)',
                flexDirection: 'row',
                alignItems: 'center',
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: S.WHITE, fontSize: 16, fontWeight: '600' }}>{season.name}</Text>
              </View>
              <View style={{
                paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
                backgroundColor: season.status === 'active'
                  ? 'rgba(52,199,89,0.2)'
                  : season.status === 'upcoming'
                    ? 'rgba(255,165,0,0.2)'
                    : 'rgba(255,255,255,0.1)',
              }}>
                <Text style={{
                  fontSize: 12, fontWeight: '600',
                  color: season.status === 'active' ? '#34C759' : season.status === 'upcoming' ? '#FF9500' : S.WHITE_50,
                }}>
                  {season.status}
                </Text>
              </View>
              <Text style={{ color: S.WHITE_50, marginLeft: 8 }}>›</Text>
            </TouchableOpacity>
          ))
        )}

        {/* Sign out */}
        <TouchableOpacity onPress={logOut} style={{ alignItems: 'center', marginTop: 24, paddingVertical: 8 }}>
          <Text style={{ color: S.RED, fontSize: 15 }}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* New season modal */}
      <Modal visible={showSeasonModal} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', padding: 24 }}>
          <BlurView intensity={30} tint="dark" style={{ borderRadius: 20, overflow: 'hidden' }}>
            <View style={S.glassCard}>
              <Text style={{ color: S.WHITE, fontSize: 20, fontWeight: '700', marginBottom: 20 }}>New Season</Text>
              <Text style={S.label}>SEASON NAME</Text>
              <TextInput
                value={newSeasonName}
                onChangeText={setNewSeasonName}
                placeholder="e.g. 2025/26"
                placeholderTextColor={S.WHITE_30}
                style={[S.input, { marginBottom: 20 }]}
                autoFocus
              />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity
                  onPress={() => { setShowSeasonModal(false); setNewSeasonName(''); }}
                  style={{ flex: 1, padding: 14, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center' }}
                >
                  <Text style={{ color: S.WHITE_60 }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={createSeason}
                  disabled={isCreatingSeason || !newSeasonName.trim()}
                  style={[isCreatingSeason || !newSeasonName.trim() ? S.primaryButtonDisabled : S.primaryButton, { flex: 1 }]}
                >
                  {isCreatingSeason
                    ? <ActivityIndicator color={S.WHITE} />
                    : <Text style={S.primaryButtonText}>Create</Text>
                  }
                </TouchableOpacity>
              </View>
            </View>
          </BlurView>
        </View>
      </Modal>

      {/* Approve request modal */}
      <Modal visible={!!approvalTarget} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 20 }}>
          <BlurView intensity={30} tint="dark" style={{ borderRadius: 20, overflow: 'hidden', maxHeight: '90%' }}>
            <ScrollView>
              <View style={S.glassCard}>
                <Text style={{ color: S.WHITE, fontSize: 20, fontWeight: '700', marginBottom: 4 }}>
                  Approve Team
                </Text>
                <Text style={{ color: S.WHITE_50, fontSize: 14, marginBottom: 24 }}>
                  "{approvalTarget?.teamName}" — {approvalTarget?.captainDisplayName}
                </Text>

                {/* Season picker */}
                <Text style={[S.label, { marginBottom: 10 }]}>SELECT SEASON</Text>
                {seasons.length === 0 ? (
                  <Text style={{ color: S.RED, fontSize: 13, marginBottom: 16 }}>
                    No seasons exist yet. Close this and create a season first.
                  </Text>
                ) : (
                  seasons.map((s) => (
                    <TouchableOpacity
                      key={s.id}
                      onPress={() => { setSelectedSeason(s); setSelectedDivision(null); }}
                      style={{
                        padding: 12, borderRadius: 10, marginBottom: 6,
                        backgroundColor: selectedSeason?.id === s.id ? 'rgba(0,122,255,0.25)' : 'rgba(255,255,255,0.07)',
                        borderWidth: 1,
                        borderColor: selectedSeason?.id === s.id ? S.BLUE : 'rgba(255,255,255,0.12)',
                      }}
                    >
                      <Text style={{ color: S.WHITE, fontWeight: '500' }}>{s.name}</Text>
                    </TouchableOpacity>
                  ))
                )}

                {/* Division picker */}
                {selectedSeason && (
                  <>
                    <Text style={[S.label, { marginTop: 16, marginBottom: 10 }]}>SELECT DIVISION</Text>
                    {divisions.map((d) => (
                      <TouchableOpacity
                        key={d.id}
                        onPress={() => { setSelectedDivision(d); setShowNewDivision(false); }}
                        style={{
                          padding: 12, borderRadius: 10, marginBottom: 6,
                          backgroundColor: selectedDivision?.id === d.id ? 'rgba(0,122,255,0.25)' : 'rgba(255,255,255,0.07)',
                          borderWidth: 1,
                          borderColor: selectedDivision?.id === d.id ? S.BLUE : 'rgba(255,255,255,0.12)',
                        }}
                      >
                        <Text style={{ color: S.WHITE, fontWeight: '500' }}>{d.name}</Text>
                      </TouchableOpacity>
                    ))}

                    {!showNewDivision ? (
                      <TouchableOpacity
                        onPress={() => { setShowNewDivision(true); setSelectedDivision(null); }}
                        style={{ padding: 12, borderRadius: 10, marginBottom: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', borderStyle: 'dashed' }}
                      >
                        <Text style={{ color: S.BLUE, textAlign: 'center' }}>+ New Division</Text>
                      </TouchableOpacity>
                    ) : (
                      <TextInput
                        value={newDivisionName}
                        onChangeText={setNewDivisionName}
                        placeholder="Division name (e.g. Division 1)"
                        placeholderTextColor={S.WHITE_30}
                        autoFocus
                        style={[S.input, { marginBottom: 6 }]}
                      />
                    )}
                  </>
                )}

                <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
                  <TouchableOpacity
                    onPress={() => setApprovalTarget(null)}
                    style={{ flex: 1, padding: 14, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center' }}
                  >
                    <Text style={{ color: S.WHITE_60 }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={approveRequest}
                    disabled={isApproving || !canApprove}
                    style={[isApproving || !canApprove ? S.primaryButtonDisabled : S.primaryButton, { flex: 1 }]}
                  >
                    {isApproving
                      ? <ActivityIndicator color={S.WHITE} />
                      : <Text style={S.primaryButtonText}>Approve</Text>
                    }
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </BlurView>
        </View>
      </Modal>
    </LinearGradient>
  );
}
