import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Share, Platform, TextInput, Alert } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import {
  collection, doc, onSnapshot, query, where, updateDoc, getDoc, getDocs, writeBatch, serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import * as S from '@/styles/common';

interface Player { id: string; name: string; claimedByUserId: string | null }

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

async function shareText(text: string) {
  if (Platform.OS === 'web') {
    try { await (navigator as any).clipboard.writeText(text); } catch {}
  } else {
    await Share.share({ message: text });
  }
}

export default function AdminTeamScreen() {
  const { teamId } = useLocalSearchParams<{ teamId: string }>();
  const { appUser } = useAuthStore();

  const [teamName, setTeamName] = useState('');
  const [teamAddress, setTeamAddress] = useState<string | null>(null);
  const [captainName, setCaptainName] = useState<string | null>(null);
  const [vcName, setVcName] = useState<string | null>(null);
  const [playerCode, setPlayerCode] = useState<string | null>(null);
  const [captainJoinCode, setCaptainJoinCode] = useState<string | null>(null);
  const [vcJoinCode, setVcJoinCode] = useState<string | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [isGeneratingPlayer, setIsGeneratingPlayer] = useState(false);
  const [generatingJoinCode, setGeneratingJoinCode] = useState<'captain' | 'viceCaptain' | null>(null);

  const [editingAddress, setEditingAddress] = useState(false);
  const [addressDraft, setAddressDraft] = useState('');
  const [isSavingAddress, setIsSavingAddress] = useState(false);

  useEffect(() => {
    if (!teamId) return;

    const unsubTeam = onSnapshot(doc(db, 'teams', teamId), async (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      setTeamName(data.name);
      setPlayerCode(data.playerInviteCode ?? null);
      setTeamAddress(data.address ?? null);

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

    const unsubJoinCodes = onSnapshot(
      query(collection(db, 'joinCodes'), where('teamId', '==', teamId), where('usedByUserId', '==', null)),
      (snap) => {
        let capCode: string | null = null;
        let vcCode: string | null = null;
        snap.docs.forEach((d) => {
          if (d.data().role === 'captain') capCode = d.id;
          if (d.data().role === 'viceCaptain') vcCode = d.id;
        });
        setCaptainJoinCode(capCode);
        setVcJoinCode(vcCode);
      },
    );

    return () => { unsubTeam(); unsubPlayers(); unsubJoinCodes(); };
  }, [teamId]);

  async function generatePlayerCode() {
    if (!teamId) return;
    setIsGeneratingPlayer(true);
    const code = generateCode();
    await updateDoc(doc(db, 'teams', teamId), { playerInviteCode: code });
    setIsGeneratingPlayer(false);
  }

  async function generateJoinCode(role: 'captain' | 'viceCaptain') {
    if (!teamId || !appUser?.leagueId) return;
    setGeneratingJoinCode(role);
    try {
      const teamSnap = await getDoc(doc(db, 'teams', teamId));
      if (!teamSnap.exists()) return;
      const teamData = teamSnap.data();

      const existing = await getDocs(
        query(collection(db, 'joinCodes'),
          where('teamId', '==', teamId),
          where('role', '==', role),
          where('usedByUserId', '==', null)),
      );
      const batch = writeBatch(db);
      existing.docs.forEach((d) => batch.delete(d.ref));

      const code = generateCode();
      batch.set(doc(db, 'joinCodes', code), {
        leagueId: appUser.leagueId,
        seasonId: teamData.seasonId ?? null,
        divisionId: teamData.divisionId ?? null,
        teamId,
        role,
        createdByUserId: appUser.uid,
        usedByUserId: null,
        usedAt: null,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error).message ?? 'Something went wrong');
    } finally {
      setGeneratingJoinCode(null);
    }
  }

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

  function JoinCodeRow({ role, code }: { role: 'captain' | 'viceCaptain'; code: string | null }) {
    const label = role === 'captain' ? 'Captain' : 'Vice Captain';
    const isGenerating = generatingJoinCode === role;
    return (
      <View style={{ marginBottom: 4 }}>
        <Text style={{ color: S.WHITE, fontSize: 14, fontWeight: '600', marginBottom: 4 }}>{label}</Text>
        {code ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: S.BLUE, fontSize: 18, fontWeight: '700', letterSpacing: 3, flex: 1 }}>{code}</Text>
            <TouchableOpacity
              onPress={() => shareText(code)}
              style={{ minHeight: 36, justifyContent: 'center', backgroundColor: 'rgba(0,122,255,0.2)', borderRadius: 8, paddingHorizontal: 12, borderWidth: 1.5, borderColor: 'rgba(0,122,255,0.5)' }}
            >
              <Text style={{ color: S.WHITE, fontWeight: '600', fontSize: 12 }}>Share</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => generateJoinCode(role)}
              disabled={isGenerating}
              style={{ minHeight: 36, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 8, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)' }}
            >
              {isGenerating
                ? <ActivityIndicator color={S.WHITE_50} size="small" />
                : <Text style={{ color: S.WHITE_80, fontSize: 12, fontWeight: '600' }}>Regen</Text>
              }
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            onPress={() => generateJoinCode(role)}
            disabled={isGenerating}
            style={{
              minHeight: 44, justifyContent: 'center', borderRadius: 10, padding: 10, borderWidth: 1.5,
              borderColor: 'rgba(255,255,255,0.35)', borderStyle: 'dashed', alignItems: 'center',
            }}
          >
            {isGenerating
              ? <ActivityIndicator color={S.WHITE_50} size="small" />
              : <Text style={{ color: S.BLUE, fontSize: 13, fontWeight: '600' }}>Generate {label} Code</Text>
            }
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <LinearGradient colors={S.GRADIENT} style={{ flex: 1 }}>
      <Stack.Screen options={{ title: teamName || 'Team' }} />
      <ScrollView contentContainerStyle={{ padding: 20 }}>

        {/* Captain / VC */}
        <BlurView intensity={20} tint="dark" style={{ borderRadius: 16, overflow: 'hidden', marginBottom: 16 }}>
          <View style={[S.glassCard, { padding: 16 }]}>
            <View style={{ marginBottom: vcName ? 12 : 0 }}>
              <Text style={{ color: S.WHITE_50, fontSize: 11, marginBottom: 4 }}>CAPTAIN</Text>
              <Text style={{ color: captainName ? S.WHITE : S.WHITE_50, fontSize: 15, fontWeight: '600' }}>
                {captainName ?? 'Not yet assigned'}
              </Text>
            </View>
            {vcName && (
              <View>
                <Text style={{ color: S.WHITE_50, fontSize: 11, marginBottom: 4 }}>VICE CAPTAIN</Text>
                <Text style={{ color: S.WHITE, fontSize: 15, fontWeight: '600' }}>{vcName}</Text>
              </View>
            )}
          </View>
        </BlurView>

        {/* Home venue */}
        <BlurView intensity={20} tint="dark" style={{ borderRadius: 16, overflow: 'hidden', marginBottom: 16 }}>
          <View style={[S.glassCard, { padding: 16 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
              <Text style={{ color: S.WHITE, fontSize: 15, fontWeight: '700', flex: 1 }}>Home Venue</Text>
              {!editingAddress && (
                <TouchableOpacity
                  onPress={() => { setAddressDraft(teamAddress ?? ''); setEditingAddress(true); }}
                  style={{ minHeight: 36, justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 8, paddingHorizontal: 12, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)' }}
                >
                  <Text style={{ color: S.WHITE_80, fontSize: 12, fontWeight: '600' }}>{teamAddress ? 'Edit' : 'Add'}</Text>
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
                    style={{ flex: 1, minHeight: 44, justifyContent: 'center', padding: 10, borderRadius: 10, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)' }}
                  >
                    <Text style={{ color: S.WHITE_80, fontWeight: '600' }}>Cancel</Text>
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
              <Text style={{ color: teamAddress ? S.WHITE : S.WHITE_50, fontSize: 14 }}>
                {teamAddress ?? 'No venue set'}
              </Text>
            )}
          </View>
        </BlurView>

        {/* Join codes */}
        <BlurView intensity={20} tint="dark" style={{ borderRadius: 16, overflow: 'hidden', marginBottom: 16 }}>
          <View style={[S.glassCard, { padding: 16 }]}>
            <Text style={{ color: S.WHITE_50, fontSize: 11, fontWeight: '600', marginBottom: 4 }}>CAPTAIN / VICE CAPTAIN CODES</Text>
            <Text style={{ color: S.WHITE_50, fontSize: 12, marginBottom: 16 }}>
              Share these codes so captains and vice captains can claim the team
            </Text>
            <JoinCodeRow role="captain" code={captainJoinCode} />
            <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginVertical: 14 }} />
            <JoinCodeRow role="viceCaptain" code={vcJoinCode} />
          </View>
        </BlurView>

        {/* Player invite code */}
        <BlurView intensity={20} tint="dark" style={{ borderRadius: 16, overflow: 'hidden', marginBottom: 20 }}>
          <View style={[S.glassCard, { padding: 16 }]}>
            <Text style={{ color: S.WHITE, fontSize: 15, fontWeight: '700', marginBottom: 4 }}>
              Player Invite Code
            </Text>
            <Text style={{ color: S.WHITE_50, fontSize: 12, marginBottom: 12 }}>
              Captains can share this so players can find the team quickly
            </Text>
            {playerCode ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ color: S.BLUE, fontSize: 22, fontWeight: '700', letterSpacing: 4, flex: 1 }}>
                  {playerCode}
                </Text>
                <TouchableOpacity
                  onPress={() => shareText(playerCode)}
                  style={{ minHeight: 40, justifyContent: 'center', backgroundColor: 'rgba(0,122,255,0.2)', borderRadius: 8, paddingHorizontal: 14, borderWidth: 1.5, borderColor: 'rgba(0,122,255,0.5)' }}
                >
                  <Text style={{ color: S.WHITE, fontWeight: '600', fontSize: 13 }}>Share</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={generatePlayerCode}
                  style={{ minHeight: 40, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 8, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)' }}
                >
                  <Text style={{ color: S.WHITE_80, fontSize: 13, fontWeight: '600' }}>Regen</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                onPress={generatePlayerCode}
                disabled={isGeneratingPlayer}
                style={[S.primaryButton, { paddingVertical: 10 }]}
                activeOpacity={0.8}
              >
                {isGeneratingPlayer
                  ? <ActivityIndicator color={S.WHITE} />
                  : <Text style={S.primaryButtonText}>Generate Code</Text>
                }
              </TouchableOpacity>
            )}
          </View>
        </BlurView>

        {/* Players */}
        <Text style={{ color: S.WHITE, fontSize: 15, fontWeight: '700', marginBottom: 10 }}>
          Players ({players.length})
        </Text>
        {players.length === 0 ? (
          <Text style={{ color: S.WHITE_50, textAlign: 'center', paddingVertical: 16 }}>No players yet</Text>
        ) : (
          players.map((player) => (
            <View
              key={player.id}
              style={{
                padding: 14, borderRadius: 12, marginBottom: 8,
                backgroundColor: 'rgba(255,255,255,0.07)',
                borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.22)',
                flexDirection: 'row', alignItems: 'center',
              }}
            >
              <View style={{
                width: 36, height: 36, borderRadius: 18,
                backgroundColor: 'rgba(0,122,255,0.3)',
                alignItems: 'center', justifyContent: 'center', marginRight: 12,
              }}>
                <Text style={{ color: S.BLUE, fontWeight: '700' }}>
                  {player.name.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: S.WHITE, fontWeight: '600' }}>{player.name}</Text>
                <Text style={{ color: S.WHITE_50, fontSize: 12 }}>
                  {player.claimedByUserId ? 'Account linked' : 'No account yet'}
                </Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </LinearGradient>
  );
}
