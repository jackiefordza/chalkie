import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Animated, Platform, type LayoutChangeEvent } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useAuthStore } from '@/stores/authStore';
import { RAW } from '@/lib/theme';
import { AppIcon, type AppIconName } from './AppIcon';

const TAB_META: Record<string, { icon: AppIconName; label: string }> = {
  home: { icon: 'home', label: 'Home' },
  captain: { icon: 'home', label: 'Home' },
  captains: { icon: 'users', label: 'Captains' },
  admin: { icon: 'shield', label: 'Admin' },
  fixtures: { icon: 'calendar', label: 'Fixtures' },
  standings: { icon: 'table', label: 'Table' },
  stats: { icon: 'target', label: 'Stats' },
};

// isAdmin (isLeagueAdmin or isGlobalAdmin) is independent of role now — an
// admin can also be a captain or player of a team in the same league, so the
// admin tab is layered on top of whatever role-based tabs apply, rather than
// being its own exclusive case.
function visibleRouteNames(role: string | undefined, isAdmin: boolean | undefined): string[] {
  const roleTabs = role === 'player'
    ? ['home', 'fixtures', 'standings', 'stats']
    : role === 'pending'
      ? [] // admin-only, not yet onboarded as a player on any team
      : ['captain', 'captains', 'fixtures', 'standings', 'stats']; // captain, viceCaptain, or not-yet-loaded default
  return isAdmin ? ['admin', ...roleTabs] : roleTabs;
}

interface TabLayout { x: number; y: number; width: number; height: number }

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const { appUser } = useAuthStore();
  const insets = useSafeAreaInsets();
  const names = visibleRouteNames(appUser?.role, appUser?.isLeagueAdmin || appUser?.isGlobalAdmin);

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
      {/*
        Phase E, Step 2 — glass restyle. Same technique already proven by
        AccountMenu (BlurView + a translucent tint layer), applied to the
        one surface the Phase E brief explicitly calls out for it. This is
        deliberately a FIXED dark glass look, not tied to the app's
        light/dark toggle — Home (which this bar floats over first) is
        itself fixed-dark for this prototype, and a consistently-dark nav
        reads as "Chalkie's own material" regardless of which tab's content
        is underneath. `overflow-hidden` on this outer rounded container is
        required for the blur to respect the pill's rounded corners.
        Step 3 — colour pass: this should read as dark translucent graphite
        glass, not a green component, so only the active icon/label/highlight
        carry the (restrained) accent colour.
      */}
      <View
        className="rounded-full overflow-hidden border border-home-border"
        style={{
          shadowColor: '#000000',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.35,
          shadowRadius: 20,
          elevation: 12,
        }}
      >
        <BlurView intensity={48} tint="dark" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
        {/* expo-blur's actual blur has known gaps on web — this tint alone
            still reads as a translucent dark "glass" pill there even when
            the blur itself doesn't render, rather than the bar disappearing
            or looking broken. */}
        <View className="absolute inset-0 bg-home-elevated/55" pointerEvents="none" />
        <View className="flex-row gap-1 p-1.5">
          {highlight && (
            // NativeWind's className interop doesn't cover Animated.View, so this is styled
            // with plain RN style props (RAW theme constants) instead of Tailwind classes.
            <Animated.View
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: 0,
                borderRadius: 9999,
                // Muted-green-tinted glass, not a solid fill — "accent =
                // active/selected" communicated at low opacity, matching
                // Step 3's "restrained, not neon" direction. rgba of
                // home-accent (#AFC65A), not the stronger CTA accent.
                backgroundColor: 'rgba(175,198,90,0.16)',
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
                  color={isFocused ? RAW.homeAccent : RAW.homeTextFaint}
                />
                <Text
                  className={[
                    'text-[10px] font-semibold mt-0.5',
                    isFocused ? 'text-home-accent' : 'text-home-text-faint',
                  ].join(' ')}
                >
                  {meta.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );
}
