import { useEffect } from 'react';
import { TouchableOpacity, Text } from 'react-native';
import { Stack, router } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { useAuthStore } from '@/stores/authStore';
import { RAW } from '@/lib/theme';
import { AccountMenu } from '@/components/ui';

export default function ProtectedLayout() {
  const { firebaseUser, isLoading, logOut } = useAuthStore();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  useEffect(() => {
    if (isLoading) return;
    if (!firebaseUser) {
      router.replace('/(auth)/login');
    }
  }, [firebaseUser, isLoading]);

  return (
    <>
      <Stack
        screenOptions={{
          headerShown: true,
          headerStyle: { backgroundColor: isDark ? RAW.surfaceDark : RAW.surface },
          headerTintColor: isDark ? RAW.textDark : RAW.text,
          headerTitleStyle: { fontWeight: '600' },
          headerRight: () => (
            <TouchableOpacity onPress={logOut} activeOpacity={0.7} hitSlop={12}>
              <Text style={{ color: isDark ? RAW.coralInkDark : RAW.coralInk, fontSize: 15, fontWeight: '500' }}>
                Sign Out
              </Text>
            </TouchableOpacity>
          ),
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
      <AccountMenu />
    </>
  );
}
