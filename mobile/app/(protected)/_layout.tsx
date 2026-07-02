import { useEffect } from 'react';
import { TouchableOpacity, Text } from 'react-native';
import { Stack, router } from 'expo-router';
import { useAuthStore } from '@/stores/authStore';

export default function ProtectedLayout() {
  const { firebaseUser, isLoading, logOut } = useAuthStore();

  useEffect(() => {
    if (isLoading) return;
    if (!firebaseUser) {
      router.replace('/(auth)/login');
    }
  }, [firebaseUser, isLoading]);

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: '#0f0c29' },
        headerTintColor: '#FFFFFF',
        headerTitleStyle: { fontWeight: '600' },
        headerRight: () => (
          <TouchableOpacity onPress={logOut} hitSlop={12}>
            <Text style={{ color: '#FF6B6B', fontSize: 15, fontWeight: '500' }}>
              Sign Out
            </Text>
          </TouchableOpacity>
        ),
      }}
    />
  );
}
