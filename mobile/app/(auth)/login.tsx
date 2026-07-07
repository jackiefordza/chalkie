import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useAuthStore } from '@/stores/authStore';
import { TEST_HOME_EMAIL, TEST_AWAY_EMAIL, TEST_PASSWORD } from '@/lib/testData';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [quickSigningIn, setQuickSigningIn] = useState<'home' | 'away' | null>(null);

  const { signIn, error, clearError } = useAuthStore();

  async function handleSignIn() {
    if (!email.trim() || !password) return;
    clearError();
    setIsSubmitting(true);
    try {
      await signIn(email.trim().toLowerCase(), password);
      router.replace('/');
    } catch {
      // error is set in the store
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleQuickSignIn(which: 'home' | 'away') {
    clearError();
    setQuickSigningIn(which);
    try {
      await signIn(which === 'home' ? TEST_HOME_EMAIL : TEST_AWAY_EMAIL, TEST_PASSWORD);
      router.replace('/');
    } catch {
      // error is set in the store
    } finally {
      setQuickSigningIn(null);
    }
  }

  return (
    <LinearGradient
      colors={['#0f0c29', '#302b63', '#24243e']}
      style={{ flex: 1 }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Logo / Title */}
          <View className="items-center mb-10">
            <Text style={{ fontSize: 52, marginBottom: 8 }}>🎯</Text>
            <Text
              style={{
                fontSize: 36,
                fontWeight: '700',
                color: '#FFFFFF',
                letterSpacing: -0.5,
              }}
            >
              Chalkie
            </Text>
            <Text style={{ fontSize: 15, color: 'rgba(255,255,255,0.55)', marginTop: 4 }}>
              Darts League Management
            </Text>
          </View>

          {/* Frosted glass card */}
          <BlurView intensity={25} tint="dark" style={{ borderRadius: 24, overflow: 'hidden' }}>
            <View
              style={{
                padding: 28,
                backgroundColor: 'rgba(255,255,255,0.08)',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.15)',
                borderRadius: 24,
              }}
            >
              <Text
                style={{
                  fontSize: 22,
                  fontWeight: '600',
                  color: '#FFFFFF',
                  marginBottom: 24,
                }}
              >
                Sign In
              </Text>

              {/* Error banner */}
              {error ? (
                <View
                  style={{
                    backgroundColor: 'rgba(255,59,48,0.15)',
                    borderWidth: 1,
                    borderColor: 'rgba(255,59,48,0.4)',
                    borderRadius: 12,
                    padding: 12,
                    marginBottom: 16,
                  }}
                >
                  <Text style={{ color: '#FF6B6B', fontSize: 14 }}>{error}</Text>
                </View>
              ) : null}

              {/* Email field */}
              <View style={{ marginBottom: 14 }}>
                <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, marginBottom: 8, fontWeight: '500' }}>
                  EMAIL
                </Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  returnKeyType="next"
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.3)',
                    borderRadius: 12,
                    padding: 14,
                    fontSize: 16,
                    color: '#FFFFFF',
                  }}
                />
              </View>

              {/* Password field */}
              <View style={{ marginBottom: 24 }}>
                <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, marginBottom: 8, fontWeight: '500' }}>
                  PASSWORD
                </Text>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  secureTextEntry
                  returnKeyType="done"
                  onSubmitEditing={handleSignIn}
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.3)',
                    borderRadius: 12,
                    padding: 14,
                    fontSize: 16,
                    color: '#FFFFFF',
                  }}
                />
              </View>

              {/* Sign In button */}
              <TouchableOpacity
                onPress={handleSignIn}
                disabled={isSubmitting || !email.trim() || !password}
                style={{
                  backgroundColor: isSubmitting || !email.trim() || !password
                    ? 'rgba(0,122,255,0.4)'
                    : '#007AFF',
                  borderRadius: 14,
                  paddingVertical: 16,
                  alignItems: 'center',
                }}
                activeOpacity={0.8}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={{ color: '#FFFFFF', fontSize: 17, fontWeight: '600' }}>
                    Sign In
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </BlurView>

          {/* Register link */}
          <TouchableOpacity
            onPress={() => router.push('/(auth)/register')}
            style={{ alignItems: 'center', marginTop: 24 }}
            activeOpacity={0.7}
          >
            <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 15 }}>
              New to Chalkie?{' '}
              <Text style={{ color: '#007AFF', fontWeight: '600' }}>Create Account</Text>
            </Text>
          </TouchableOpacity>

          {/* Dev-only: instant sign-in as the seeded test captains */}
          {__DEV__ && (
            <View style={{ marginTop: 28, alignItems: 'center' }}>
              <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, marginBottom: 10 }}>
                🧪 DEV QUICK SIGN-IN
              </Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity
                  onPress={() => handleQuickSignIn('home')}
                  disabled={quickSigningIn !== null}
                  style={{
                    paddingHorizontal: 16, minHeight: 44, justifyContent: 'center', borderRadius: 10,
                    backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.3)',
                  }}
                >
                  {quickSigningIn === 'home'
                    ? <ActivityIndicator color="#FFFFFF" size="small" />
                    : <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13, fontWeight: '600' }}>Test Home Captain</Text>
                  }
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleQuickSignIn('away')}
                  disabled={quickSigningIn !== null}
                  style={{
                    paddingHorizontal: 16, minHeight: 44, justifyContent: 'center', borderRadius: 10,
                    backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.3)',
                  }}
                >
                  {quickSigningIn === 'away'
                    ? <ActivityIndicator color="#FFFFFF" size="small" />
                    : <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13, fontWeight: '600' }}>Test Away Captain</Text>
                  }
                </TouchableOpacity>
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}
