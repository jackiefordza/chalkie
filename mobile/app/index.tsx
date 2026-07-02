import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/authStore';

export default function IndexScreen() {
  const { firebaseUser, appUser, isLoading } = useAuthStore();

  useEffect(() => {
    if (isLoading) return;

    if (!firebaseUser) {
      router.replace('/(auth)/login');
      return;
    }

    if (!appUser) return;

    switch (appUser.role) {
      case 'admin':
        router.replace('/(protected)/admin');
        break;
      case 'captain':
      case 'viceCaptain':
        router.replace('/(protected)/captain');
        break;
      case 'player':
        router.replace('/(protected)/home');
        break;
      case 'pending':
        // Already submitted a request — go to waiting screen
        if (appUser.pendingRequestType) {
          router.replace('/(protected)/request-pending');
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
