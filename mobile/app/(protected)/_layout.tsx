import { useEffect } from 'react';
import { View, ActivityIndicator, TouchableOpacity, Text } from 'react-native';
import { Stack, router, usePathname } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { useAuthStore } from '@/stores/authStore';
import { RAW } from '@/lib/theme';
import { AccountMenu } from '@/components/ui';

// Every League Admin screen — the `admin` tab (pathname `/admin`) and every
// standalone `admin-*.tsx` route (`/admin-team`, `/admin-inbox`, etc.) — is a
// sibling under this one layout, so a single pathname check here covers all
// of them without touching each screen individually. `/results-entry` is
// deliberately NOT matched — it's shared by every role and already gates its
// own admin-only buttons internally.
function isAdminPath(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin-');
}

export default function ProtectedLayout() {
  const { firebaseUser, appUser, isLoading, logOut } = useAuthStore();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const pathname = usePathname();

  const onAdminRoute = isAdminPath(pathname);
  // Same check results-entry.tsx already uses for its own admin-only
  // buttons, and the same independence from `role`/`leagueId` TabBar.tsx
  // relies on to show the Admin tab — reused here as the one route guard
  // instead of duplicated per screen. A Global Admin has no leagueId at all,
  // so this must never key off leagueId.
  const isAuthorizedAdmin = !!appUser?.isLeagueAdmin || !!appUser?.isGlobalAdmin;

  useEffect(() => {
    if (isLoading) return;
    if (!firebaseUser) {
      router.replace('/(auth)/login');
      return;
    }
    // A signed-in user with no admin role who reaches an admin route (typed
    // URL, deep link, stale bookmark) is sent through the same role-based
    // landing logic index.tsx already uses for every other entry point,
    // rather than duplicating that role→route mapping here.
    if (onAdminRoute && !isAuthorizedAdmin) {
      router.replace('/');
    }
  }, [firebaseUser, isLoading, onAdminRoute, isAuthorizedAdmin]);

  // Blocks the admin screen from ever mounting — whether auth/profile is
  // still loading, or the redirect above is about to fire — so no admin
  // UI or data is exposed even for a single frame to an unauthorized viewer.
  if (onAdminRoute && (isLoading || !firebaseUser || !isAuthorizedAdmin)) {
    return (
      <View className="flex-1 items-center justify-center bg-bg dark:bg-bg-dark">
        <ActivityIndicator color={RAW.brand} size="large" />
      </View>
    );
  }

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
