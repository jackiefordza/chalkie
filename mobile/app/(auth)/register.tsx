import { useState, useRef } from 'react';
import { View, KeyboardAvoidingView, Platform, ScrollView, type TextInput as TextInputType } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/authStore';
import { goBack } from '@/lib/navigation';
import { Heading, Body, Button, Card, Input, Label } from '@/components/ui';

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
    <View className="flex-1 bg-bg dark:bg-bg-dark">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View className="mb-8">
            <Heading size="lg">Create account</Heading>
            <Body className="mt-1">Join your darts league</Body>
          </View>

          <Card>
            {displayedError ? (
              <Card tone="coral" className="mb-5" padded={false}>
                <Body tone="coral" className="p-3">{displayedError}</Body>
              </Card>
            ) : null}

            <View className="mb-3.5">
              <Label>Full name</Label>
              <Input
                value={name}
                onChangeText={setName}
                placeholder="Jane Smith"
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="next"
                onSubmitEditing={() => emailRef.current?.focus()}
              />
            </View>

            <View className="mb-3.5">
              <Label>Email</Label>
              <Input
                ref={emailRef}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
              />
            </View>

            <View className="mb-3.5">
              <Label>Password</Label>
              <Input
                ref={passwordRef}
                value={password}
                onChangeText={setPassword}
                placeholder="At least 6 characters"
                secureTextEntry
                returnKeyType="next"
                onSubmitEditing={() => confirmRef.current?.focus()}
              />
            </View>

            <View className="mb-7">
              <Label>Confirm password</Label>
              <Input
                ref={confirmRef}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="••••••••"
                secureTextEntry
                returnKeyType="done"
                onSubmitEditing={handleRegister}
              />
            </View>

            <Button onPress={handleRegister} disabled={!canSubmit} loading={isSubmitting}>
              Create Account
            </Button>
          </Card>

          {/* Back to sign in */}
          <View className="items-center mt-6">
            <Body onPress={() => goBack('/(auth)/login')} suppressHighlighting>
              Already have an account? <Body tone="brand" weight="semibold">Sign In</Body>
            </Body>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
