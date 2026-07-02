import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { router, Stack } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useAuthStore } from '@/stores/authStore';
import * as S from '@/styles/common';

export default function ClaimProfileScreen() {
  const [code, setCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { processClaimCode } = useAuthStore();

  async function handleClaim() {
    if (!code.trim()) { setError('Enter your claim code'); return; }
    setError(null);
    setIsSubmitting(true);
    try {
      await processClaimCode(code);
      router.replace('/');
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <LinearGradient colors={S.GRADIENT} style={{ flex: 1 }}>
      <Stack.Screen options={{ title: 'Claim Your Profile' }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20 }}
          keyboardShouldPersistTaps="handled"
        >
          <BlurView intensity={20} tint="dark" style={{ borderRadius: 20, overflow: 'hidden' }}>
            <View style={S.glassCard}>
              <Text style={{ color: S.WHITE, fontSize: 22, fontWeight: '700', marginBottom: 6 }}>
                Claim your profile
              </Text>
              <Text style={{ color: S.WHITE_50, fontSize: 14, marginBottom: 24 }}>
                Your captain has already added you to the squad. Enter the claim code they shared to link your account.
              </Text>

              {error ? (
                <View style={S.errorBox}>
                  <Text style={{ color: S.RED, fontSize: 14 }}>{error}</Text>
                </View>
              ) : null}

              <Text style={S.label}>CLAIM CODE</Text>
              <TextInput
                value={code}
                onChangeText={(t) => setCode(t.toUpperCase())}
                placeholder="e.g. JAKE-7X4"
                placeholderTextColor={S.WHITE_30}
                autoCapitalize="characters"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleClaim}
                style={[S.input, { letterSpacing: 4, textAlign: 'center', fontSize: 20, fontWeight: '700', marginBottom: 24 }]}
              />

              <TouchableOpacity
                onPress={handleClaim}
                disabled={isSubmitting || !code.trim()}
                style={isSubmitting || !code.trim() ? S.primaryButtonDisabled : S.primaryButton}
                activeOpacity={0.8}
              >
                {isSubmitting
                  ? <ActivityIndicator color={S.WHITE} />
                  : <Text style={S.primaryButtonText}>Claim Profile</Text>
                }
              </TouchableOpacity>
            </View>
          </BlurView>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}
