import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { router, Stack } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { collection, doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import * as S from '@/styles/common';

export default function AdminSetupScreen() {
  const [leagueName, setLeagueName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { appUser } = useAuthStore();

  async function handleCreate() {
    if (!leagueName.trim() || !appUser) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const batch = writeBatch(db);
      const leagueRef = doc(collection(db, 'leagues'));
      batch.set(leagueRef, {
        name: leagueName.trim(),
        adminUserId: appUser.uid,
        captainInviteCode: null,
        createdAt: serverTimestamp(),
      });
      batch.update(doc(db, 'users', appUser.uid), {
        leagueId: leagueRef.id,
      });
      await batch.commit();
      router.replace('/(protected)/admin');
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Something went wrong');
      setIsSubmitting(false);
    }
  }

  return (
    <LinearGradient colors={S.GRADIENT} style={{ flex: 1 }}>
      <Stack.Screen options={{ title: 'League Setup' }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20 }}
          keyboardShouldPersistTaps="handled"
        >
          <BlurView intensity={20} tint="dark" style={{ borderRadius: 20, overflow: 'hidden' }}>
            <View style={S.glassCard}>
              <Text style={{ color: S.WHITE, fontSize: 24, fontWeight: '700', marginBottom: 6 }}>
                Set up your league
              </Text>
              <Text style={{ color: S.WHITE_50, fontSize: 14, marginBottom: 28 }}>
                One-time setup — this is the name players will search for when joining.
              </Text>

              {error ? (
                <View style={S.errorBox}>
                  <Text style={{ color: S.RED }}>{error}</Text>
                </View>
              ) : null}

              <Text style={S.label}>LEAGUE NAME</Text>
              <TextInput
                value={leagueName}
                onChangeText={setLeagueName}
                placeholder="e.g. Midlands Darts League"
                placeholderTextColor={S.WHITE_30}
                autoCapitalize="words"
                returnKeyType="done"
                onSubmitEditing={handleCreate}
                style={[S.input, { marginBottom: 24 }]}
              />

              <TouchableOpacity
                onPress={handleCreate}
                disabled={isSubmitting || !leagueName.trim()}
                style={isSubmitting || !leagueName.trim() ? S.primaryButtonDisabled : S.primaryButton}
                activeOpacity={0.8}
              >
                {isSubmitting
                  ? <ActivityIndicator color={S.WHITE} />
                  : <Text style={S.primaryButtonText}>Create League</Text>
                }
              </TouchableOpacity>
            </View>
          </BlurView>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}
