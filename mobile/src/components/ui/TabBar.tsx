import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Animated, Platform, type LayoutChangeEvent } from 'react-native';
import { BottomTabBarHeightCallbackContext, type BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { useColorScheme } from 'nativewind';
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
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const names = visibleRouteNames(appUser?.role, appUser?.isLeagueAdmin || appUser?.isGlobalAdmin);

  // React Navigation only knows this bar's real height if it's told —
  // otherwise BottomTabBarHeightContext (which Screen.tsx uses to reserve
  // bottom clearance for scrollable content) silently falls back to a
  // generic built-in-tab-bar estimate (49pt + the safe-area inset) that
  // has nothing to do with this floating pill's actual footprint. The
  // built-in BottomTabBar reports its own height the same way — via
  // onLayout on its outermost View, below.
  const reportTabBarHeight = useContext(BottomTabBarHeightCallbackContext);

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
      onLayout={(e) => reportTabBarHeight?.(e.nativeEvent.layout.height)}
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
        one surface the Phase E brief explicitly calls out for it.
        `overflow-hidden` on this outer rounded container is required for
        the blur to respect the pill's rounded corners. Step 5: this now
        follows the app's actual light/dark toggle (like AccountMenu
        already does), rather than being fixed dark — dark translucent
        graphite glass in dark mode, a light frosted glass in light mode.
        Only the active icon/label/highlight carry the (restrained) accent
        colour.
      */}
      <View
        className="rounded-full overflow-hidden border border-border dark:border-border-dark"
        style={{
          shadowColor: '#000000',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.35,
          shadowRadius: 20,
          elevation: 12,
        }}
      >
        <BlurView intensity={48} tint={isDark ? 'dark' : 'light'} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
        {/* expo-blur's actual blur has known gaps on web — this tint alone
            still reads as a translucent "glass" pill there even when the
            blur itself doesn't render, rather than the bar disappearing or
            looking broken. */}
        <View className="absolute inset-0 bg-surface-2/55 dark:bg-surface-2-dark/55" pointerEvents="none" />
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
                // the "restrained, not neon" direction. rgba of the
                // general accent token (brand/brand-dark), not the
                // stronger CTA accent.
                backgroundColor: isDark ? 'rgba(177,199,94,0.16)' : 'rgba(113,136,58,0.14)',
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
                  color={isFocused ? (isDark ? RAW.brandDark : RAW.brand) : (isDark ? RAW.textFaintDark : RAW.textFaint)}
                />
                <Text
                  className={[
                    'text-[10px] font-semibold mt-0.5',
                    isFocused ? 'text-brand dark:text-brand-dark' : 'text-text-faint dark:text-text-faint-dark',
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
