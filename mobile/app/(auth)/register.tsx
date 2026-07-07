import { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  type TextInput as TextInputType,
} from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useAuthStore } from '@/stores/authStore';
import { goBack } from '@/lib/navigation';

export default function RegisterScreen() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const emailRef = useRef<TextInputType>(null);
  const passwordRef = useRef<TextInputType>(null);
  const confirmRef = useRef<TextInputType>(null);

  const { register, error, clearError } = useAuthStore();

  async function handleRegister() {
    setValidationError(null);
    clearError();

    if (!name.trim()) { setValidationError('Enter your full name'); return; }
    if (!email.trim()) { setValidationError('Enter your email'); return; }
    if (password.length < 6) { setValidationError('Password must be at least 6 characters'); return; }
    if (password !== confirmPassword) { setValidationError('Passwords do not match'); return; }

    setIsSubmitting(true);
    try {
      await register(email.trim().toLowerCase(), password, name.trim());
      router.replace('/');
    } catch {
      // error is set in the store
    } finally {
      setIsSubmitting(false);
    }
  }

  const displayedError = validationError ?? error;
  const canSubmit = name.trim() && email.trim() && password && confirmPassword && !isSubmitting;

  return (
    <LinearGradient colors={['#0f0c29', '#302b63', '#24243e']} style={{ flex: 1 }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={{ marginBottom: 32 }}>
            <Text style={{ fontSize: 28, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.5 }}>
              Create account
            </Text>
            <Text style={{ fontSize: 15, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>
              Join your darts league
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
              {/* Error banner */}
              {displayedError ? (
                <View
                  style={{
                    backgroundColor: 'rgba(255,59,48,0.15)',
                    borderWidth: 1,
                    borderColor: 'rgba(255,59,48,0.4)',
                    borderRadius: 12,
                    padding: 12,
                    marginBottom: 20,
                  }}
                >
                  <Text style={{ color: '#FF6B6B', fontSize: 14 }}>{displayedError}</Text>
                </View>
              ) : null}

              {/* Full name */}
              <View style={{ marginBottom: 14 }}>
                <Text style={labelStyle}>FULL NAME</Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Jane Smith"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  autoCapitalize="words"
                  autoCorrect={false}
                  returnKeyType="next"
                  onSubmitEditing={() => emailRef.current?.focus()}
                  style={inputStyle}
                />
              </View>

              {/* Email */}
              <View style={{ marginBottom: 14 }}>
                <Text style={labelStyle}>EMAIL</Text>
                <TextInput
                  ref={emailRef}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                  style={inputStyle}
                />
              </View>

              {/* Password */}
              <View style={{ marginBottom: 14 }}>
                <Text style={labelStyle}>PASSWORD</Text>
                <TextInput
                  ref={passwordRef}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="At least 6 characters"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  secureTextEntry
                  returnKeyType="next"
                  onSubmitEditing={() => confirmRef.current?.focus()}
                  style={inputStyle}
                />
              </View>

              {/* Confirm password */}
              <View style={{ marginBottom: 28 }}>
                <Text style={labelStyle}>CONFIRM PASSWORD</Text>
                <TextInput
                  ref={confirmRef}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="••••••••"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  secureTextEntry
                  returnKeyType="done"
                  onSubmitEditing={handleRegister}
                  style={inputStyle}
                />
              </View>

              {/* Submit button */}
              <TouchableOpacity
                onPress={handleRegister}
                disabled={!canSubmit}
                style={{
                  backgroundColor: canSubmit ? '#007AFF' : 'rgba(0,122,255,0.4)',
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
                    Create Account
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </BlurView>

          {/* Back to sign in */}
          <TouchableOpacity
            onPress={() => goBack('/(auth)/login')}
            style={{ alignItems: 'center', marginTop: 24 }}
            activeOpacity={0.7}
          >
            <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 15 }}>
              Already have an account?{' '}
              <Text style={{ color: '#007AFF', fontWeight: '600' }}>Sign In</Text>
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const labelStyle = {
  color: 'rgba(255,255,255,0.6)',
  fontSize: 13,
  marginBottom: 8,
  fontWeight: '500' as const,
};

const inputStyle = {
  backgroundColor: 'rgba(255,255,255,0.1)',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.3)',
  borderRadius: 12,
  padding: 14,
  fontSize: 16,
  color: '#FFFFFF',
};
