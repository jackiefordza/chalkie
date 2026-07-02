import { useEffect } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { router, Stack } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useAuthStore } from '@/stores/authStore';
import * as S from '@/styles/common';

export default function RequestPendingScreen() {
  const { appUser } = useAuthStore();

  // authStore uses onSnapshot — when admin/captain updates the user's role,
  // appUser.role changes automatically and we redirect without any polling.
  useEffect(() => {
    if (!appUser) return;
    if (appUser.role !== 'pending') {
      router.replace('/');
    }
  }, [appUser?.role]);

  const isTeamRequest = appUser?.pendingRequestType === 'team';

  const title = isTeamRequest ? 'Team request sent' : 'Join request sent';
  const body = isTeamRequest
    ? "Your request has been sent to the league admin. You'll be notified as soon as they approve your team and assign you to a division."
    : "Your request has been sent to the team captain. You'll be able to access your team dashboard once they approve you.";
  const waiting = isTeamRequest ? 'Waiting for admin approval…' : 'Waiting for captain approval…';

  return (
    <LinearGradient colors={S.GRADIENT} style={{ flex: 1 }}>
      <Stack.Screen options={{ title: 'Pending Approval' }} />
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 20 }}>
        <BlurView intensity={20} tint="dark" style={{ borderRadius: 20, overflow: 'hidden' }}>
          <View style={[S.glassCard, { alignItems: 'center' }]}>
            <Text style={{ fontSize: 48, marginBottom: 16 }}>
              {isTeamRequest ? '🏆' : '🎯'}
            </Text>

            <Text style={{ color: S.WHITE, fontSize: 22, fontWeight: '700', textAlign: 'center', marginBottom: 12 }}>
              {title}
            </Text>

            <Text style={{ color: S.WHITE_50, fontSize: 15, textAlign: 'center', lineHeight: 22, marginBottom: 32 }}>
              {body}
            </Text>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <ActivityIndicator color={S.BLUE} />
              <Text style={{ color: S.WHITE_60, fontSize: 14 }}>{waiting}</Text>
            </View>
          </View>
        </BlurView>
      </View>
    </LinearGradient>
  );
}
