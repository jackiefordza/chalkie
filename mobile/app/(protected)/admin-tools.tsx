import { useState } from 'react';
import { View, Alert } from 'react-native';
import { Stack } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { useAuthStore } from '@/stores/authStore';
import { seedTestLeague, TEST_HOME_EMAIL, TEST_AWAY_EMAIL, TEST_PASSWORD } from '@/lib/testData';
import { RAW } from '@/lib/theme';
import { Screen, Heading, Body, Button, Card, AppBar, AppIcon } from '@/components/ui';

export default function AdminToolsScreen() {
  const { appUser } = useAuthStore();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const leagueId = appUser?.leagueId ?? null;

  const [isSeeding, setIsSeeding] = useState(false);

  async function handleSeedTestLeague() {
    if (!leagueId) return;
    setIsSeeding(true);
    try {
      await seedTestLeague(leagueId);
      Alert.alert(
        'Test league ready',
        `A "Test Season / Test Division" with two full teams and one scheduled fixture is ready.\n\nSign in as either captain with:\n${TEST_HOME_EMAIL}\n${TEST_AWAY_EMAIL}\nPassword: ${TEST_PASSWORD}`,
      );
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error).message ?? 'Something went wrong');
    } finally {
      setIsSeeding(false);
    }
  }

  return (
    <Screen header={<AppBar title="Tools" />}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Dev-only: seed a throwaway test league for QA */}
      {__DEV__ && (
        <Card className="mb-5">
          <View className="flex-row items-center gap-1.5 mb-1">
            <AppIcon name="flask" size={16} color={isDark ? RAW.brandInkDark : RAW.brandInk} />
            <Heading size="sm">Testing</Heading>
          </View>
          <Body size="sm" className="mb-3">
            Creates "Test Season / Test Division" with two full teams (7 players each), two captain
            accounts, and one scheduled fixture — re-run anytime to reset the fixture to a clean state.
          </Body>
          <Button disabled={isSeeding} loading={isSeeding} onPress={handleSeedTestLeague} className="mb-3">
            Seed / Reset Test League
          </Button>
          <Body size="xs">
            Sign in as either captain (use the quick sign-in on the login screen, or manually):{'\n'}
            {TEST_HOME_EMAIL}{'\n'}{TEST_AWAY_EMAIL}{'\n'}Password: {TEST_PASSWORD}
          </Body>
        </Card>
      )}

      {!__DEV__ && (
        <Card className="items-center py-8">
          <Body tone="strong" weight="semibold">Nothing here yet</Body>
          <Body size="sm" className="text-center mt-1">Admin tools will appear here as they're added.</Body>
        </Card>
      )}
    </Screen>
  );
}
