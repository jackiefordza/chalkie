import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Modal, Alert,
} from 'react-native';
import { router, Stack } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { collection, onSnapshot, getDocs, query, where, getDoc, doc } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useAuthStore } from '@/stores/authStore';
import type { PhoneVisibility } from '@/types';
import * as S from '@/styles/common';

interface LeagueDoc { id: string; name: string }

const VISIBILITY_OPTIONS: { value: PhoneVisibility; label: string; description: string }[] = [
  { value: 'private', label: 'Admin only', description: 'Only the league admin can see your number' },
  { value: 'captains', label: 'Captains & VCs', description: 'Captains and vice captains can contact you' },
  { value: 'public', label: 'All players', description: 'All registered players in your team can see it' },
];

export default function FindLeagueScreen() {
  const [search, setSearch] = useState('');
  const [allLeagues, setAllLeagues] = useState<LeagueDoc[]>([]);
  const [isLoadingLeagues, setIsLoadingLeagues] = useState(true);
  const [inviteCode, setInviteCode] = useState('');
  const [isResolvingCode, setIsResolvingCode] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Phone capture modal (shown when a join code for captain/VC is found)
  const [showPhoneModal, setShowPhoneModal] = useState(false);
  const [pendingJoinCode, setPendingJoinCode] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneVisibility, setPhoneVisibility] = useState<PhoneVisibility>('captains');
  const [isProcessing, setIsProcessing] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const { setLeague, setTeam, setSkipChoosePath } = useOnboardingStore();
  const { processJoinCode } = useAuthStore();

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'leagues'),
      (snap) => {
        setAllLeagues(snap.docs.map((d) => ({ id: d.id, name: d.data().name as string })));
        setIsLoadingLeagues(false);
      },
      () => {
        setError('Could not load leagues. Check your connection.');
        setIsLoadingLeagues(false);
      },
    );
    return unsub;
  }, []);

  const filtered = search.trim().length < 2
    ? []
    : allLeagues.filter((l) => l.name.toLowerCase().includes(search.toLowerCase()));

  function selectLeague(league: LeagueDoc) {
    setLeague(league);
    setTeam(null);
    setSkipChoosePath(false);
    router.push('/(protected)/choose-path');
  }

  async function resolveInviteCode() {
    const code = inviteCode.trim().toUpperCase();
    if (!code) return;
    setError(null);
    setIsResolvingCode(true);
    try {
      // 1. League captain invite code
      const leagueSnap = await getDocs(
        query(collection(db, 'leagues'), where('captainInviteCode', '==', code))
      );
      if (!leagueSnap.empty) {
        const leagueDoc = leagueSnap.docs[0];
        setLeague({ id: leagueDoc.id, name: leagueDoc.data().name });
        setTeam(null);
        setSkipChoosePath(true);
        useOnboardingStore.getState().setCaptainPath(true);
        router.push('/(protected)/team-request');
        return;
      }

      // 2. Team player invite code
      const teamSnap = await getDocs(
        query(collection(db, 'teams'), where('playerInviteCode', '==', code))
      );
      if (!teamSnap.empty) {
        const teamDoc = teamSnap.docs[0];
        const teamData = teamDoc.data();
        const leagueDoc = await getDoc(doc(db, 'leagues', teamData.leagueId));
        if (!leagueDoc.exists()) throw new Error('League not found');
        setLeague({ id: leagueDoc.id, name: leagueDoc.data()!.name });
        setTeam({ id: teamDoc.id, name: teamData.name });
        setSkipChoosePath(true);
        useOnboardingStore.getState().setCaptainPath(false);
        router.push('/(protected)/browse-teams');
        return;
      }

      // 3. Captain / vice captain join code
      const joinCodeSnap = await getDoc(doc(db, 'joinCodes', code));
      if (joinCodeSnap.exists() && joinCodeSnap.data().usedByUserId == null) {
        // Prompt for phone before processing
        setPendingJoinCode(code);
        setPhone('');
        setPhoneVisibility('captains');
        setPhoneError(null);
        setIsResolvingCode(false);
        setShowPhoneModal(true);
        return;
      }

      setError('Invalid invite code. Check the code and try again.');
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Something went wrong');
    } finally {
      setIsResolvingCode(false);
    }
  }

  async function confirmJoinWithPhone() {
    const trimmedPhone = phone.trim();
    if (!trimmedPhone) { setPhoneError('Enter your mobile number'); return; }
    setPhoneError(null);
    setIsProcessing(true);
    try {
      await processJoinCode(pendingJoinCode, trimmedPhone, phoneVisibility);
      setShowPhoneModal(false);
      // onSnapshot on user doc picks up role change → router redirects automatically
    } catch (e: unknown) {
      setPhoneError((e as Error).message ?? 'Something went wrong');
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <LinearGradient colors={S.GRADIENT} style={{ flex: 1 }}>
      <Stack.Screen options={{ title: 'Find Your League' }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingVertical: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Search section */}
          <BlurView intensity={20} tint="dark" style={{ borderRadius: 20, overflow: 'hidden', marginBottom: 16 }}>
            <View style={S.glassCard}>
              <Text style={{ color: S.WHITE, fontSize: 18, fontWeight: '700', marginBottom: 4 }}>
                Search for your league
              </Text>
              <Text style={{ color: S.WHITE_50, fontSize: 13, marginBottom: 16 }}>
                Type at least 2 characters
              </Text>
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="e.g. Midlands Darts League"
                placeholderTextColor={S.WHITE_30}
                autoCorrect={false}
                style={S.input}
              />

              {isLoadingLeagues && (
                <ActivityIndicator color={S.BLUE} style={{ marginTop: 16 }} />
              )}

              {!isLoadingLeagues && search.trim().length >= 2 && (
                <View style={{ marginTop: 12 }}>
                  {filtered.length === 0 ? (
                    <Text style={{ color: S.WHITE_50, textAlign: 'center', paddingVertical: 12 }}>
                      No leagues found for "{search}"
                    </Text>
                  ) : (
                    filtered.map((league) => (
                      <TouchableOpacity
                        key={league.id}
                        onPress={() => selectLeague(league)}
                        activeOpacity={0.7}
                        style={{
                          paddingVertical: 14,
                          paddingHorizontal: 16,
                          backgroundColor: 'rgba(255,255,255,0.07)',
                          borderRadius: 12,
                          marginBottom: 8,
                          borderWidth: 1,
                          borderColor: 'rgba(255,255,255,0.22)',
                        }}
                      >
                        <Text style={{ color: S.WHITE, fontSize: 16, fontWeight: '500' }}>
                          {league.name}
                        </Text>
                      </TouchableOpacity>
                    ))
                  )}
                </View>
              )}
            </View>
          </BlurView>

          {/* Divider */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 8 }}>
            <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.15)' }} />
            <Text style={{ color: S.WHITE_50, marginHorizontal: 12, fontSize: 13 }}>or</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.15)' }} />
          </View>

          {/* Invite code section */}
          <BlurView intensity={20} tint="dark" style={{ borderRadius: 20, overflow: 'hidden', marginTop: 8 }}>
            <View style={S.glassCard}>
              <Text style={{ color: S.WHITE, fontSize: 18, fontWeight: '700', marginBottom: 4 }}>
                Have an invite code?
              </Text>
              <Text style={{ color: S.WHITE_50, fontSize: 13, marginBottom: 16 }}>
                Your admin or captain will have shared one with you
              </Text>

              {error ? (
                <View style={S.errorBox}>
                  <Text style={{ color: S.RED, fontSize: 14 }}>{error}</Text>
                </View>
              ) : null}

              <TextInput
                value={inviteCode}
                onChangeText={(t) => setInviteCode(t.toUpperCase())}
                placeholder="Enter code"
                placeholderTextColor={S.WHITE_30}
                autoCapitalize="characters"
                autoCorrect={false}
                returnKeyType="go"
                onSubmitEditing={resolveInviteCode}
                style={[S.input, { letterSpacing: 4, textAlign: 'center', fontSize: 20, fontWeight: '700', marginBottom: 16 }]}
              />

              <TouchableOpacity
                onPress={resolveInviteCode}
                disabled={isResolvingCode || !inviteCode.trim()}
                style={isResolvingCode || !inviteCode.trim() ? S.primaryButtonDisabled : S.primaryButton}
                activeOpacity={0.8}
              >
                {isResolvingCode
                  ? <ActivityIndicator color={S.WHITE} />
                  : <Text style={S.primaryButtonText}>Continue with Code</Text>
                }
              </TouchableOpacity>
            </View>
          </BlurView>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Phone capture modal for captain/VC join codes */}
      <Modal visible={showPhoneModal} transparent animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' }}>
            <BlurView intensity={30} tint="dark" style={{ borderRadius: 24, overflow: 'hidden', margin: 16 }}>
              <View style={[S.glassCard, { paddingBottom: 32 }]}>
                <Text style={{ color: S.WHITE, fontSize: 20, fontWeight: '700', marginBottom: 6 }}>
                  One last step
                </Text>
                <Text style={{ color: S.WHITE_50, fontSize: 14, marginBottom: 24 }}>
                  As a captain or vice captain, your mobile number helps the league and other captains contact you when it matters.
                </Text>

                {phoneError ? (
                  <View style={S.errorBox}>
                    <Text style={{ color: S.RED, fontSize: 14 }}>{phoneError}</Text>
                  </View>
                ) : null}

                <Text style={S.label}>MOBILE NUMBER</Text>
                <TextInput
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="e.g. 07700 900123"
                  placeholderTextColor={S.WHITE_30}
                  keyboardType="phone-pad"
                  autoFocus
                  style={[S.input, { marginBottom: 20 }]}
                />

                <Text style={S.label}>WHO CAN SEE YOUR NUMBER?</Text>
                {VISIBILITY_OPTIONS.map((opt) => {
                  const selected = phoneVisibility === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      onPress={() => setPhoneVisibility(opt.value)}
                      activeOpacity={0.7}
                      style={{
                        flexDirection: 'row', alignItems: 'center', minHeight: 44, padding: 12,
                        borderRadius: 12, marginBottom: 8,
                        backgroundColor: selected ? 'rgba(0,122,255,0.18)' : 'rgba(255,255,255,0.08)',
                        borderWidth: 1.5, borderColor: selected ? S.BLUE : 'rgba(255,255,255,0.25)',
                      }}
                    >
                      <View style={{
                        width: 20, height: 20, borderRadius: 10, marginRight: 12,
                        borderWidth: 2, borderColor: selected ? S.BLUE : S.WHITE_30,
                        alignItems: 'center', justifyContent: 'center',
                      }}>
                        {selected && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: S.BLUE }} />}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: S.WHITE, fontWeight: '600', fontSize: 14 }}>{opt.label}</Text>
                        <Text style={{ color: S.WHITE_50, fontSize: 12, marginTop: 1 }}>{opt.description}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}

                <TouchableOpacity
                  onPress={confirmJoinWithPhone}
                  disabled={isProcessing}
                  style={[isProcessing ? S.primaryButtonDisabled : S.primaryButton, { marginTop: 16 }]}
                  activeOpacity={0.8}
                >
                  {isProcessing
                    ? <ActivityIndicator color={S.WHITE} />
                    : <Text style={S.primaryButtonText}>Join Team</Text>
                  }
                </TouchableOpacity>
              </View>
            </BlurView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </LinearGradient>
  );
}
