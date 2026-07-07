import { View, Text, TouchableOpacity } from 'react-native';
import { router, Stack } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useOnboardingStore } from '@/stores/onboardingStore';
import * as S from '@/styles/common';

export default function ChoosePathScreen() {
  const { league, setCaptainPath } = useOnboardingStore();

  function goAsCaptain() {
    setCaptainPath(true);
    router.push('/(protected)/team-request');
  }

  function goAsPlayer() {
    setCaptainPath(false);
    router.push('/(protected)/browse-teams');
  }

  function goClaimProfile() {
    router.push('/(protected)/claim-profile');
  }

  return (
    <LinearGradient colors={S.GRADIENT} style={{ flex: 1 }}>
      <Stack.Screen options={{ title: league?.name ?? 'Your Role' }} />
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 20 }}>
        <BlurView intensity={20} tint="dark" style={{ borderRadius: 20, overflow: 'hidden' }}>
          <View style={S.glassCard}>
            <Text style={{ color: S.WHITE, fontSize: 22, fontWeight: '700', marginBottom: 6 }}>
              How are you joining?
            </Text>
            <Text style={{ color: S.WHITE_50, fontSize: 14, marginBottom: 28 }}>
              {league?.name}
            </Text>

            {/* Captain */}
            <TouchableOpacity
              onPress={goAsCaptain}
              activeOpacity={0.8}
              style={{
                backgroundColor: S.BLUE,
                borderRadius: 14,
                padding: 20,
                marginBottom: 12,
              }}
            >
              <Text style={{ color: S.WHITE, fontSize: 17, fontWeight: '700', marginBottom: 4 }}>
                🏆  I'm a Captain
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>
                Create a new team and manage your squad
              </Text>
            </TouchableOpacity>

            {/* Player */}
            <TouchableOpacity
              onPress={goAsPlayer}
              activeOpacity={0.8}
              style={{
                backgroundColor: 'rgba(255,255,255,0.1)',
                borderRadius: 14,
                padding: 20,
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.3)',
                marginBottom: 20,
              }}
            >
              <Text style={{ color: S.WHITE, fontSize: 17, fontWeight: '700', marginBottom: 4 }}>
                🎯  I'm a Player
              </Text>
              <Text style={{ color: S.WHITE_50, fontSize: 13 }}>
                Find your team and request to join
              </Text>
            </TouchableOpacity>

            {/* Claim profile */}
            <TouchableOpacity onPress={goClaimProfile} activeOpacity={0.7}>
              <Text style={{ color: S.BLUE, fontSize: 14, textAlign: 'center' }}>
                My captain already added me — I have a claim code
              </Text>
            </TouchableOpacity>
          </View>
        </BlurView>
      </View>
    </LinearGradient>
  );
}
