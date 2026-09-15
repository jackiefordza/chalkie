import { Tabs } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { RAW } from '@/lib/theme';
import { TabBar, HeaderAvatar, HeaderWordmark } from '@/components/ui';

export default function TabsLayout() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: isDark ? RAW.surfaceDark : RAW.surface },
        headerTintColor: isDark ? RAW.textDark : RAW.text,
        headerTitleAlign: 'center',
        headerTitle: () => <HeaderWordmark />,
        headerLeft: () => <HeaderAvatar />,
      }}
    >
      {/* Phase E, Step 2: Home renders its own quiet Header (see
          components/ui/Header.tsx) instead of the shared native header —
          the only two screens this differs for. Every other tab is
          unchanged. */}
      <Tabs.Screen name="home" options={{ title: 'Home', headerShown: false }} />
      <Tabs.Screen name="captain" options={{ title: 'Home', headerShown: false }} />
      <Tabs.Screen name="captains" options={{ title: 'Captains' }} />
      <Tabs.Screen name="admin" options={{ title: 'Admin' }} />
      <Tabs.Screen name="fixtures" options={{ title: 'Fixtures' }} />
      <Tabs.Screen name="standings" options={{ title: 'Standings' }} />
      <Tabs.Screen name="stats" options={{ title: 'Stats' }} />
    </Tabs>
  );
}
