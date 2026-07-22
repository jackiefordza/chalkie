import { useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { Stack } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { Alert } from '@/lib/alert';
import { seedTestLeague, TEST_HOME_EMAIL, TEST_AWAY_EMAIL, TEST_PASSWORD } from '@/lib/testData';
import { seedMockSeason, MOCK_CAPTAIN_EMAILS } from '@/lib/mockSeason';
import { seedBlankSeason } from '@/lib/blankSeason';
import { RAW } from '@/lib/theme';
import { Screen, Heading, Body, Button, Card, AppBar, AppIcon } from '@/components/ui';
import { AdminShell } from '@/components/admin/AdminShell';

const DESKTOP_BREAKPOINT = 768;

export default function AdminToolsScreen() {
  const { appUser } = useAuthStore();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const leagueId = appUser?.leagueId ?? null;
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;

  const [isSeeding, setIsSeeding] = useState(false);
  const [isSeedingMock, setIsSeedingMock] = useState(false);
  const [mockProgress, setMockProgress] = useState<string | null>(null);
  const [isSeedingBlank, setIsSeedingBlank] = useState(false);
  const [isMigratingVenues, setIsMigratingVenues] = useState(false);

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

  async function handleSeedBlankSeason() {
    if (!leagueId) {
      Alert.alert('Not ready yet', 'Your account is still loading — wait a moment and try again.');
      return;
    }
    setIsSeedingBlank(true);
    try {
      await seedBlankSeason(leagueId);
      Alert.alert(
        'Blank test season ready',
        '"Blank Test Division" has 8 teams (with rosters, no accounts needed) and 2 venues — including 3 teams sharing a 1-board venue, so Generate Fixtures will demonstrate the auto-clash-resolution. No fixtures generated yet — that\'s the part to try yourself from the Fixtures tab.',
      );
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error).message ?? 'Something went wrong');
    } finally {
      setIsSeedingBlank(false);
    }
  }

  function handleMigrateVenues() {
    if (!leagueId) {
      Alert.alert('Not ready yet', 'Your account is still loading — wait a moment and try again.');
      return;
    }
    Alert.alert(
      'Migrate teams to venues?',
      "Creates a Venue for every distinct home address your teams already have set, and points each team at it (board count defaults to 1 — edit that afterward on the Venues screen). Teams with no address, or that already point at a venue, are left alone. Safe to re-run.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Migrate',
          onPress: async () => {
            setIsMigratingVenues(true);
            try {
              const result = await httpsCallable(functions, 'adminMigrateVenues')({ leagueId });
              const { createdVenues, migratedTeams } = result.data as { createdVenues: number; migratedTeams: number };
              Alert.alert('Done', `Created ${createdVenues} venue${createdVenues === 1 ? '' : 's'} and updated ${migratedTeams} team${migratedTeams === 1 ? '' : 's'}.`);
            } catch (e: unknown) {
              Alert.alert('Error', (e as Error).message ?? 'Something went wrong');
            } finally {
              setIsMigratingVenues(false);
            }
          },
        },
      ],
    );
  }

  const body = (
    <>
      {/* Real one-off admin tool, not dev-gated — migrates teams created before the Venue entity existed */}
      <Card className="mb-5">
        <View className="flex-row items-center gap-1.5 mb-1">
          <AppIcon name="map-pin" size={16} color={isDark ? RAW.brandInkDark : RAW.brandInk} />
          <Heading size="sm">Migrate Teams to Venues</Heading>
        </View>
        <Body size="sm" className="mb-3">
          If your teams still show a plain address instead of a proper venue, run this once to create a
          Venue per distinct address and re-point your teams at them. Only needed if you had teams set up
          before venues existed.
        </Body>
        <Button disabled={isMigratingVenues} loading={isMigratingVenues} onPress={handleMigrateVenues}>
          Migrate Teams to Venues
        </Button>
      </Card>

      {/* Dev-only: blank season + teams + venues (incl. a deliberate board clash), no fixtures — for exercising the real Generate Fixtures flow */}
      {__DEV__ && (
        <Card className="mb-5">
          <View className="flex-row items-center gap-1.5 mb-1">
            <AppIcon name="flask" size={16} color={isDark ? RAW.brandInkDark : RAW.brandInk} />
            <Heading size="sm">Blank Test Season</Heading>
          </View>
          <Body size="sm" className="mb-3">
            8 teams with full rosters, no fixtures — for trying the real Generate Fixtures flow yourself.
            Includes a season start date, a sample Christmas break, and 2 venues (one with only 1 board
            shared by 3 teams, to show off the venue-clash auto-resolve).
          </Body>
          <Button disabled={isSeedingBlank} loading={isSeedingBlank} onPress={handleSeedBlankSeason}>
            Seed Blank Test Season
          </Button>
        </Card>
      )}

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

    </>
  );

  if (isDesktop) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <AdminShell title="Tools" breadcrumb={[{ label: 'Dashboard', path: '/(protected)/(tabs)/admin' }, { label: 'Tools' }]}>
          <View style={{ maxWidth: 780 }}>{body}</View>
        </AdminShell>
      </>
    );
  }

  return (
    <Screen header={<AppBar title="Tools" />}>
      <Stack.Screen options={{ headerShown: false }} />
      {body}
    </Screen>
  );
}
