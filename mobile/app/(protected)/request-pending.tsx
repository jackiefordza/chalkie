import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { router, Stack } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { useAuthStore } from '@/stores/authStore';
import { RAW } from '@/lib/theme';
import { Heading, Body, Card, AppIcon } from '@/components/ui';

export default function RequestPendingScreen() {
  const { appUser } = useAuthStore();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  // authStore uses onSnapshot — when admin/captain updates the user's role,
  // appUser.role changes automatically and we redirect without any polling.
  useEffect(() => {
    if (!appUser) return;
    if (appUser.role !== 'pending') {
      router.replace('/');
    }
  }, [appUser?.role]);

  const requestType = appUser?.pendingRequestType;

  const title = requestType === 'captainRole' ? 'Request sent'
    : requestType === 'claim' ? 'Claim request sent'
    : 'Join request sent';
  const body = requestType === 'captainRole'
    ? "Your request has been sent for approval. You'll get access to your team dashboard once it's approved."
    : requestType === 'claim'
    ? "Your captain has been asked to confirm that's you. You'll be able to access your team dashboard once they approve it."
    : "Your request has been sent to the team captain. You'll be able to access your team dashboard once they approve you.";
  const waiting = requestType === 'captainRole' ? 'Waiting for approval…' : 'Waiting for captain approval…';

  return (
    <View className="flex-1 bg-bg dark:bg-bg-dark justify-center px-5">
      <Stack.Screen options={{ title: 'Pending Approval' }} />
      <Card className="items-center">
        <View className="w-16 h-16 rounded-full items-center justify-center bg-brand-fill dark:bg-brand-fill-dark mb-4">
          <AppIcon name={requestType === 'captainRole' ? 'trophy' : 'target'} size={32} color={isDark ? RAW.brandInkDark : RAW.brandInk} />
        </View>
        <Heading size="lg" className="text-center mb-3">{title}</Heading>
        <Body className="text-center mb-8" style={{ lineHeight: 22 }}>{body}</Body>
        <View className="flex-row items-center gap-2.5">
          <ActivityIndicator color={RAW.brand} />
          <Body size="sm">{waiting}</Body>
        </View>
      </Card>
    </View>
  );
}
