import { useState } from 'react';
import { View, Text, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { useAuthStore } from '@/stores/authStore';
import { FONT_DISPLAY } from '@/styles/typography';
import { RAW } from '@/lib/theme';
import { Heading, Body, Button, Card, Input, Label, AppIcon } from '@/components/ui';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const { sendPasswordReset, error, clearError } = useAuthStore();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  async function handleSend() {
    if (!email.trim()) return;
    clearError();
    setIsSubmitting(true);
    try {
      await sendPasswordReset(email.trim().toLowerCase());
      setSent(true);
    } catch {
      // error is set in the store
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <View className="flex-1 bg-bg dark:bg-bg-dark">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="items-center mb-10">
            <View className="w-20 h-20 rounded-full items-center justify-center bg-brand-fill dark:bg-brand-fill-dark mb-3">
              <AppIcon name="target" size={40} color={isDark ? RAW.brandInkDark : RAW.brandInk} />
            </View>
            <Text
              className="text-text dark:text-text-dark"
              style={{ fontFamily: FONT_DISPLAY, fontSize: 36, fontWeight: '700', letterSpacing: -0.5 }}
            >
              Chalkie
            </Text>
          </View>

          <Card>
            {sent ? (
              <>
                <Heading size="lg" className="mb-3">Check your email</Heading>
                <Body className="mb-6">
                  If an account exists for {email.trim()}, we&apos;ve sent instructions to reset your password.
                </Body>
                <Button onPress={() => router.replace('/(auth)/login')}>Back to Sign In</Button>
              </>
            ) : (
              <>
                <Heading size="lg" className="mb-2">Reset Password</Heading>
                <Body className="mb-6">Enter your email and we&apos;ll send you a link to reset your password.</Body>

                {error ? (
                  <Card tone="coral" className="mb-4" padded={false}>
                    <Body tone="coral" className="p-3">{error}</Body>
                  </Card>
                ) : null}

                <View className="mb-6">
                  <Label>Email</Label>
                  <Input
                    value={email}
                    onChangeText={setEmail}
                    placeholder="you@example.com"
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    returnKeyType="done"
                    onSubmitEditing={handleSend}
                  />
                </View>

                <Button onPress={handleSend} disabled={isSubmitting || !email.trim()} loading={isSubmitting}>
                  Send Reset Link
                </Button>
              </>
            )}
          </Card>

          {!sent && (
            <View className="items-center mt-6">
              <Body onPress={() => router.replace('/(auth)/login')} suppressHighlighting>
                <Body tone="brand" weight="semibold">Back to Sign In</Body>
              </Body>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
