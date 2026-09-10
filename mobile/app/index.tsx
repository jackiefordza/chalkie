import { useEffect } from 'react';
import { View, Text, ActivityIndicator, Alert } from 'react-native';
import { router } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { useAuthStore } from '@/stores/authStore';
import { RAW } from '@/lib/theme';
import { FONT_DISPLAY } from '@/styles/typography';
import { Body, AppIcon } from '@/components/ui';

export default function IndexScreen() {
  const { firebaseUser, appUser, isLoading, logOut } = useAuthStore();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  useEffect(() => {
    if (isLoading) return;

    if (!firebaseUser) {
      router.replace('/(auth)/login');
      return;
    }

    // Authenticated, but no Firestore profile exists (or was deleted) — there's
    // nothing this screen can wait for, and looping here forever with no
    // explanation is worse than signing out with a clear reason.
    if (!appUser) {
      Alert.alert(
        'Account not set up',
        "We couldn't find your profile. Please sign in again, or contact your league admin if this keeps happening.",
        [{ text: 'OK', onPress: () => logOut() }],
      );
      return;
    }

    // isLeagueAdmin/isGlobalAdmin are independent of role — a captain/player
    // can also be an admin, so neither overrides where their role sends them.
    // The one case either does affect is a pure admin with no team of their
    // own yet (League Admin) or no league at all (Global Admin): they'd
    // otherwise get funneled into "find your league" onboarding, which makes
    // no sense for someone who already administers a league — or every league.
    switch (appUser.role) {
      case 'captain':
      case 'viceCaptain':
        router.replace('/(protected)/(tabs)/captain');
        break;
      case 'player':
        router.replace('/(protected)/(tabs)/home');
        break;
      case 'pending':
        if (appUser.pendingRequestType) {
          // Already submitted a request — go to waiting screen
          router.replace('/(protected)/request-pending');
        } else if (appUser.isLeagueAdmin || appUser.isGlobalAdmin) {
          // Admin who's never onboarded as a player on any team — nothing to
          // find/join, go straight to admin.
          router.replace('/(protected)/(tabs)/admin');
        } else {
          // Fresh pending user — start onboarding
          router.replace('/(protected)/find-league');
        }
        break;
    }
  }, [firebaseUser, appUser, isLoading]);

  return (
    <View className="flex-1 bg-bg dark:bg-bg-dark items-center justify-center">
      <View className="w-20 h-20 rounded-full items-center justify-center bg-brand-fill dark:bg-brand-fill-dark mb-3">
        <AppIcon name="target" size={40} color={isDark ? RAW.brandInkDark : RAW.brandInk} />
      </View>
      <Text
        className="text-text dark:text-text-dark"
        style={{ fontFamily: FONT_DISPLAY, fontSize: 36, fontWeight: '700', letterSpacing: -0.5 }}
      >
        Chalkie
      </Text>
      <Body className="mt-1 mb-8">Darts League Management</Body>
      <ActivityIndicator size="large" color={RAW.brand} />
    </View>
  );
}
