import { router } from 'expo-router';
import { View } from 'react-native';
import { useAuthStore } from '@/stores/authStore';
import { Screen, ListRow, Body } from '@/components/ui';
import { NextFixtureTile } from '@/components/NextFixtureTile';

// Shared "Home" content for both the player role and the captain/VC role — just
// the next couple of fixtures, nothing else. Team management, roster, and
// requests live in the Captains section instead (captain/VC only).
export function HomeFixturesScreen() {
  const { appUser } = useAuthStore();
  const teamId = appUser?.teamId ?? null;

  return (
    <Screen>
      {teamId && <NextFixtureTile teamId={teamId} count={2} />}
      <View className="mt-5">
        <ListRow
          title="Singles Knockout"
          subtitle="Register, follow live results and board assignment"
          trailing={<Body tone="dim">›</Body>}
          onPress={() => router.push('/(protected)/singles' as never)}
        />
      </View>
    </Screen>
  );
}
