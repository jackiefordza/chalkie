import { useState } from 'react';
import { View, Text, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { useAuthStore } from '@/stores/authStore';
import { TEST_HOME_EMAIL, TEST_AWAY_EMAIL, TEST_PASSWORD } from '@/lib/testData';
import { FONT_DISPLAY } from '@/styles/typography';
import { RAW } from '@/lib/theme';
import { Heading, Body, Caption, Button, Card, Input, Label, AppIcon } from '@/components/ui';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [quickSigningIn, setQuickSigningIn] = useState<'home' | 'away' | null>(null);

  const { signIn, error, clearError } = useAuthStore();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

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
    <View className="flex-1 bg-bg dark:bg-bg-dark">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Capped so this doesn't stretch edge-to-edge on a wide desktop browser —
              this screen has no isDesktop branch of its own, unlike the admin console. */}
          <View style={{ width: '100%', maxWidth: 400 }}>
          {/* Logo / Title */}
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
            <Body className="mt-1">Darts League Management</Body>
          </View>

          <Card>
            <Heading size="lg" className="mb-6">Sign In</Heading>

            {error ? (
              <Card tone="coral" className="mb-4" padded={false}>
                <Body tone="coral" className="p-3">{error}</Body>
              </Card>
            ) : null}

            <View className="mb-3.5">
              <Label>Email</Label>
              <Input
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                returnKeyType="next"
              />
            </View>

            <View className="mb-6">
              <Label>Password</Label>
              <Input
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                secureTextEntry
                returnKeyType="done"
                onSubmitEditing={handleSignIn}
              />
            </View>

            <Button
              onPress={handleSignIn}
              disabled={isSubmitting || !email.trim() || !password}
              loading={isSubmitting}
            >
              Sign In
            </Button>
          </Card>

          {/* Register link */}
          <View className="items-center mt-6">
            <Body onPress={() => router.push('/(auth)/register')} suppressHighlighting>
              New to Chalkie? <Body tone="brand" weight="semibold">Create Account</Body>
            </Body>
          </View>

          {/* Dev-only: instant sign-in as the seeded test captains */}
          {__DEV__ && (
            <View className="mt-7 items-center">
              <Caption className="mb-2.5">Dev quick sign-in</Caption>
              <View className="flex-row gap-2.5">
                <Button
                  variant="secondary"
                  size="sm"
                  onPress={() => handleQuickSignIn('home')}
                  disabled={quickSigningIn !== null}
                  loading={quickSigningIn === 'home'}
                >
                  Test Home Captain
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onPress={() => handleQuickSignIn('away')}
                  disabled={quickSigningIn !== null}
                  loading={quickSigningIn === 'away'}
                >
                  Test Away Captain
                </Button>
              </View>
            </View>
          )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
