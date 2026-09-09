import { useEffect } from 'react';
import { View, ActivityIndicator, Alert } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/authStore';

export default function IndexScreen() {
  const { firebaseUser, appUser, isLoading, logOut } = useAuthStore();

  useEffect(() => {
    // [DIAG-BUG005] temporary — remove before merging
    console.log('[DIAG-BUG005 index.tsx] routing effect fired', {
      isLoading,
      uid: appUser?.uid ?? firebaseUser?.uid ?? null,
      role: appUser?.role,
      isGlobalAdmin: appUser?.isGlobalAdmin,
      isLeagueAdmin: appUser?.isLeagueAdmin,
      leagueId: appUser?.leagueId,
      pendingRequestType: appUser?.pendingRequestType,
    });

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
        console.log('[DIAG-BUG005 index.tsx] branch: captain/viceCaptain -> /(protected)/(tabs)/captain');
        router.replace('/(protected)/(tabs)/captain');
        break;
      case 'player':
        console.log('[DIAG-BUG005 index.tsx] branch: player -> /(protected)/(tabs)/home');
        router.replace('/(protected)/(tabs)/home');
        break;
      case 'pending':
        if (appUser.pendingRequestType) {
          // Already submitted a request — go to waiting screen
          console.log('[DIAG-BUG005 index.tsx] branch: pending+pendingRequestType -> /(protected)/request-pending');
          router.replace('/(protected)/request-pending');
        } else if (appUser.isLeagueAdmin || appUser.isGlobalAdmin) {
          // Admin who's never onboarded as a player on any team — nothing to
          // find/join, go straight to admin.
          console.log('[DIAG-BUG005 index.tsx] branch: pending+admin -> /(protected)/(tabs)/admin', {
            isLeagueAdmin: appUser.isLeagueAdmin, isGlobalAdmin: appUser.isGlobalAdmin,
          });
          router.replace('/(protected)/(tabs)/admin');
        } else {
          // Fresh pending user — start onboarding
          console.log('[DIAG-BUG005 index.tsx] branch: pending+non-admin -> /(protected)/find-league', {
            isLeagueAdmin: appUser.isLeagueAdmin, isGlobalAdmin: appUser.isGlobalAdmin, fullAppUser: appUser,
          });
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
