import { useState } from 'react';
import { View, Alert } from 'react-native';
import { Stack } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { useAuthStore } from '@/stores/authStore';
import { seedTestLeague, TEST_HOME_EMAIL, TEST_AWAY_EMAIL, TEST_PASSWORD } from '@/lib/testData';
import { seedMockSeason, MOCK_CAPTAIN_EMAILS } from '@/lib/mockSeason';
import { RAW } from '@/lib/theme';
import { Screen, Heading, Body, Button, Card, AppBar, AppIcon } from '@/components/ui';

export default function AdminToolsScreen() {
  const { appUser } = useAuthStore();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const leagueId = appUser?.leagueId ?? null;

  const [isSeeding, setIsSeeding] = useState(false);
  const [isSeedingMock, setIsSeedingMock] = useState(false);
  const [mockProgress, setMockProgress] = useState<string | null>(null);

  async function handleSeedTestLeague() {
    if (!leagueId) {
      Alert.alert('Not ready yet', 'Your account is still loading — wait a moment and try again.');
      return;
    }
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

  function handleSeedMockSeason() {
    if (!leagueId) {
      Alert.alert('Not ready yet', 'Your account is still loading — wait a moment and try again.');
      return;
    }
    Alert.alert(
      'Seed mock mid-season?',
      'Creates 5 teams of 5 players, plays out half a full season through the real result-confirmation pipeline, and schedules the rest. Takes a little while, and running it again adds a second copy rather than resetting — only run it once.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Seed it',
          onPress: async () => {
            setIsSeedingMock(true);
            setMockProgress('Starting…');
            try {
              await seedMockSeason(leagueId, setMockProgress);
              Alert.alert(
                'Mock season ready',
                `5 teams, half the season played and confirmed, half still scheduled.\n\nSign in as any team's captain (password ${TEST_PASSWORD}):\n${MOCK_CAPTAIN_EMAILS.join('\n')}`,
              );
            } catch (e: unknown) {
              Alert.alert('Error', (e as Error).message ?? 'Something went wrong');
            } finally {
              setIsSeedingMock(false);
              setMockProgress(null);
            }
          },
        },
      ],
    );
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

      {/* Dev-only: seed a bigger, mid-season-realistic scenario for testing standings/stats at scale */}
      {__DEV__ && (
        <Card className="mb-5">
          <View className="flex-row items-center gap-1.5 mb-1">
            <AppIcon name="flask" size={16} color={isDark ? RAW.brandInkDark : RAW.brandInk} />
            <Heading size="sm">Mock Mid-Season</Heading>
          </View>
          <Body size="sm" className="mb-3">
            5 teams of 5 players, a full double round-robin — half already played and confirmed
            through the real result pipeline (so standings/stats are genuinely computed, not
            faked), half still scheduled. One-shot: safe to run once, not meant to be reset.
          </Body>
          <Button disabled={isSeedingMock} loading={isSeedingMock} onPress={handleSeedMockSeason} className="mb-2">
            Seed Mock Mid-Season
          </Button>
          {mockProgress && <Body size="xs" className="mb-1">{mockProgress}</Body>}
          <Body size="xs">
            Sign in as any team's captain, password {TEST_PASSWORD}:{'\n'}
            {MOCK_CAPTAIN_EMAILS.join('\n')}
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
