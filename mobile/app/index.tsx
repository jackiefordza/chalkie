import { useEffect } from 'react';
import { View, ActivityIndicator, Alert } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/authStore';

export default function IndexScreen() {
  const { firebaseUser, appUser, isLoading, logOut } = useAuthStore();

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

    // isLeagueAdmin is independent of role — a captain/player can also be a
    // league admin, so it no longer overrides where their role sends them.
    // The one case it does affect is a pure admin with no team of their own
    // yet: they'd otherwise get funneled into "find your league" onboarding,
    // which makes no sense for someone who already administers a league.
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
        } else if (appUser.isLeagueAdmin) {
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
    <View className="flex-1 bg-black items-center justify-center">
      <ActivityIndicator size="large" color="#007AFF" />
    </View>
  );
}
