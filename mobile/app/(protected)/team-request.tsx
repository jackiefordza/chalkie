import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { router, Stack } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { collection, addDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import type { PhoneVisibility } from '@/types';
import * as S from '@/styles/common';

const VISIBILITY_OPTIONS: { value: PhoneVisibility; label: string; description: string }[] = [
  { value: 'private', label: 'Admin only', description: 'Only the league admin can see your number' },
  { value: 'captains', label: 'Captains & VCs', description: 'Other captains and vice captains can contact you' },
  { value: 'public', label: 'All players', description: 'All registered players in your team can see it' },
];

export default function TeamRequestScreen() {
  const [teamName, setTeamName] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneVisibility, setPhoneVisibility] = useState<PhoneVisibility>('captains');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { appUser } = useAuthStore();
  const { league } = useOnboardingStore();

  async function handleSubmit() {
    if (!teamName.trim()) { setError('Enter a team name'); return; }
    if (!phone.trim()) { setError('Enter your mobile number'); return; }
    if (!league || !appUser) return;

    setError(null);
    setIsSubmitting(true);
    try {
      const reqRef = await addDoc(collection(db, 'teamRequests'), {
        leagueId: league.id,
        leagueName: league.name,
        captainUserId: appUser.uid,
        captainDisplayName: appUser.displayName,
        captainPhone: phone.trim(),
        teamName: teamName.trim(),
        status: 'pending',
        createdAt: serverTimestamp(),
      });

      await updateDoc(doc(db, 'users', appUser.uid), {
        leagueId: league.id,
        pendingRequestType: 'team',
        pendingRequestId: reqRef.id,
        phone: phone.trim(),
        phoneVisibility,
      });

      router.replace('/(protected)/request-pending');
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Something went wrong');
      setIsSubmitting(false);
    }
  }

  return (
    <LinearGradient colors={S.GRADIENT} style={{ flex: 1 }}>
      <Stack.Screen options={{ title: 'Create Your Team' }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingVertical: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          <BlurView intensity={20} tint="dark" style={{ borderRadius: 20, overflow: 'hidden' }}>
            <View style={S.glassCard}>
              <Text style={{ color: S.WHITE_50, fontSize: 13, marginBottom: 4 }}>
                {league?.name}
              </Text>
              <Text style={{ color: S.WHITE, fontSize: 22, fontWeight: '700', marginBottom: 6 }}>
                Create your team
              </Text>
              <Text style={{ color: S.WHITE_50, fontSize: 14, marginBottom: 24 }}>
                The league admin will review your request and assign you to a division.
              </Text>

              {error ? (
                <View style={S.errorBox}>
                  <Text style={{ color: S.RED, fontSize: 14 }}>{error}</Text>
                </View>
              ) : null}

              <Text style={S.label}>TEAM NAME</Text>
              <TextInput
                value={teamName}
                onChangeText={setTeamName}
                placeholder="e.g. The Arrows"
                placeholderTextColor={S.WHITE_30}
                autoCapitalize="words"
                returnKeyType="next"
                style={[S.input, { marginBottom: 20 }]}
              />

              <Text style={S.label}>YOUR MOBILE NUMBER</Text>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder="e.g. 07700 900123"
                placeholderTextColor={S.WHITE_30}
                keyboardType="phone-pad"
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
                      flexDirection: 'row', alignItems: 'center', padding: 12,
                      borderRadius: 12, marginBottom: 8,
                      backgroundColor: selected ? 'rgba(0,122,255,0.15)' : 'rgba(255,255,255,0.05)',
                      borderWidth: 1, borderColor: selected ? S.BLUE : 'rgba(255,255,255,0.1)',
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
                onPress={handleSubmit}
                disabled={isSubmitting || !teamName.trim() || !phone.trim()}
                style={[isSubmitting || !teamName.trim() || !phone.trim() ? S.primaryButtonDisabled : S.primaryButton, { marginTop: 24 }]}
                activeOpacity={0.8}
              >
                {isSubmitting
                  ? <ActivityIndicator color={S.WHITE} />
                  : <Text style={S.primaryButtonText}>Submit Request</Text>
                }
              </TouchableOpacity>
            </View>
          </BlurView>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}
