import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Animated, Platform, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from 'nativewind';
import * as Haptics from 'expo-haptics';
import { useAuthStore } from '@/stores/authStore';
import { RAW } from '@/lib/theme';
import { AppIcon, type AppIconName } from './AppIcon';

// Matches the DESKTOP_BREAKPOINT constant duplicated across admin-*.tsx screens —
// AdminShell's sidebar is the desktop nav, so this bar must not render on top of it.
const DESKTOP_BREAKPOINT = 768;

const TAB_META: Record<string, { icon: AppIconName; label: string }> = {
  home: { icon: 'home', label: 'Home' },
  captain: { icon: 'home', label: 'Home' },
  captains: { icon: 'users', label: 'Captains' },
  admin: { icon: 'shield', label: 'Admin' },
  fixtures: { icon: 'calendar', label: 'Fixtures' },
  standings: { icon: 'table', label: 'Table' },
  stats: { icon: 'target', label: 'Stats' },
};

// isLeagueAdmin is independent of role now — an admin can also be a captain
// or player of a team in the same league, so the admin tab is layered on top
// of whatever role-based tabs apply, rather than being its own exclusive case.
function visibleRouteNames(role: string | undefined, isLeagueAdmin: boolean | undefined): string[] {
  const roleTabs = role === 'player'
    ? ['home', 'fixtures', 'standings', 'stats']
    : role === 'pending'
      ? [] // admin-only, not yet onboarded as a player on any team
      : ['captain', 'captains', 'fixtures', 'standings', 'stats']; // captain, viceCaptain, or not-yet-loaded default
  return isLeagueAdmin ? ['admin', ...roleTabs] : roleTabs;
}

interface TabLayout { x: number; y: number; width: number; height: number }

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const { appUser } = useAuthStore();
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const { width } = useWindowDimensions();
  const isDark = colorScheme === 'dark';
  const names = visibleRouteNames(appUser?.role, appUser?.isLeagueAdmin);

  // The "admin" tab renders AdminShell's own sidebar nav at desktop width,
  // which fully replaces this bar — rendering both stacks a floating pill
  // over the sidebar's content. Every other tab has no desktop layout yet,
  // so this bar is still their only nav there.
  const focusedRouteName = state.routes[state.index]?.name;
  if (width >= DESKTOP_BREAKPOINT && focusedRouteName === 'admin') return null;

  const focusedIndex = names.findIndex((name) => state.routes.find((r) => r.name === name)?.key === state.routes[state.index]?.key);

  // Measured from real onLayout results, not assumed from padding/gap classNames,
  // so the sliding highlight stays correct if the pill's spacing ever changes.
  const tabLayouts = useRef<Record<number, TabLayout>>({});
  const [highlight, setHighlight] = useState<TabLayout | null>(null);
  const translateX = useRef(new Animated.Value(0)).current;
  const hasPositioned = useRef(false);

  const positionHighlight = useCallback((layout: TabLayout, animate: boolean) => {
    setHighlight((prev) => (prev && prev.width === layout.width && prev.height === layout.height && prev.y === layout.y ? prev : layout));
    if (animate) {
      Animated.spring(translateX, { toValue: layout.x, useNativeDriver: true, bounciness: 6, speed: 16 }).start();
    } else {
      translateX.setValue(layout.x);
    }
    hasPositioned.current = true;
  }, [translateX]);

  const handleTabLayout = useCallback((index: number, e: LayoutChangeEvent) => {
    const { x, y, width, height } = e.nativeEvent.layout;
    const layout = { x, y, width, height };
    tabLayouts.current[index] = layout;
    if (index === focusedIndex) {
      positionHighlight(layout, hasPositioned.current);
    }
  }, [focusedIndex, positionHighlight]);

  useEffect(() => {
    const target = tabLayouts.current[focusedIndex];
    if (target) positionHighlight(target, true);
  }, [focusedIndex, positionHighlight]);

  const handlePress = useCallback((routeName: string) => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate(routeName);
  }, [navigation]);

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        paddingHorizontal: 16,
        paddingBottom: insets.bottom + 8,
        paddingTop: 8,
      }}
    >
      <View
        className="flex-row gap-1 rounded-full bg-surface dark:bg-surface-dark p-1.5"
        style={{
          shadowColor: '#3C321E',
          shadowOffset: { width: 0, height: 10 },
          shadowOpacity: 0.18,
          shadowRadius: 24,
          elevation: 12,
        }}
      >
        {highlight && (
          // NativeWind's className interop doesn't cover Animated.View, so this is styled
          // with plain RN style props (RAW theme constants) instead of Tailwind classes.
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: 0,
              borderRadius: 9999,
              backgroundColor: isDark ? RAW.brandFillDark : RAW.brandFill,
              width: highlight.width,
              height: highlight.height,
              top: highlight.y,
              transform: [{ translateX }],
            }}
          />
        )}
        {names.map((name, index) => {
          const route = state.routes.find((r) => r.name === name);
          if (!route) return null;
          const meta = TAB_META[name];
          const isFocused = state.routes[state.index]?.key === route.key;

          return (
            <TouchableOpacity
              key={route.key}
              activeOpacity={0.7}
              onPress={() => handlePress(route.name)}
              onLayout={(e) => handleTabLayout(index, e)}
              className="flex-1 items-center py-2 rounded-full"
            >
              <AppIcon
                name={meta.icon}
                size={isFocused ? 21 : 19}
                color={isFocused ? (isDark ? RAW.brandInkDark : RAW.brandInk) : (isDark ? RAW.textFaintDark : RAW.textFaint)}
              />
              <Text
                className={[
                  'text-[10px] font-semibold mt-0.5',
                  isFocused ? 'text-brand-ink dark:text-brand-ink-dark' : 'text-text-faint dark:text-text-faint-dark',
                ].join(' ')}
              >
                {meta.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}
