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
      <Tabs.Screen name="home" options={{ title: 'Home' }} />
      <Tabs.Screen name="captain" options={{ title: 'Home' }} />
      <Tabs.Screen name="captains" options={{ title: 'Captains' }} />
      <Tabs.Screen name="admin" options={{ title: 'Admin' }} />
      <Tabs.Screen name="fixtures" options={{ title: 'Fixtures' }} />
      <Tabs.Screen name="standings" options={{ title: 'Standings' }} />
      <Tabs.Screen name="stats" options={{ title: 'Stats' }} />
    </Tabs>
  );
}
