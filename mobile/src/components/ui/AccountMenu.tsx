import { useEffect, useState } from 'react';
import { Pressable, View, Text, StyleSheet, Platform } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from 'nativewind';
import { doc, onSnapshot } from 'firebase/firestore';
import * as Haptics from 'expo-haptics';
import { db } from '@/config/firebase';
import { useUiStore } from '@/stores/uiStore';
import { useAuthStore } from '@/stores/authStore';
import {
  loadThemePreference, saveThemePreference, applyThemePreference, type ThemePreference,
} from '@/lib/themePreference';
import { RAW } from '@/lib/theme';
import { FONT_DISPLAY_EXTRABOLD } from '@/styles/typography';
import { Avatar } from './Avatar';
import { AppIcon, type AppIconName } from './AppIcon';
import { Caption, Body } from './Text';

const PANEL_WIDTH = 288;

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  captain: 'Captain',
  viceCaptain: 'Vice Captain',
  player: 'Player',
  pending: 'Pending',
};

const VISIBILITY_LABEL: Record<string, string> = {
  private: 'Admin only',
  captains: 'Captains & VCs',
  public: 'All players',
};

const APPEARANCE_OPTIONS: { value: ThemePreference; icon: AppIconName; label: string }[] = [
  { value: 'light', icon: 'sun', label: 'Light' },
  { value: 'dark', icon: 'moon', label: 'Dark' },
  { value: 'system', icon: 'monitor', label: 'Auto' },
];

export function AccountMenu() {
  const isOpen = useUiStore((s) => s.isAccountMenuOpen);
  const close = useUiStore((s) => s.closeAccountMenu);
  const { appUser, logOut } = useAuthStore();
  const { colorScheme, setColorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();

  const [teamName, setTeamName] = useState<string | null>(null);
  const [themePref, setThemePref] = useState<ThemePreference>('system');

  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(isOpen ? 1 : 0, { duration: 240, easing: Easing.out(Easing.cubic) });
  }, [isOpen, progress]);

  useEffect(() => {
    loadThemePreference().then(setThemePref);
  }, []);

  useEffect(() => {
    if (!appUser?.teamId) {
      setTeamName(null);
      return;
    }
    const unsub = onSnapshot(doc(db, 'teams', appUser.teamId), (snap) => {
      setTeamName((snap.data()?.name as string | undefined) ?? null);
    });
    return unsub;
  }, [appUser?.teamId]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (progress.value - 1) * PANEL_WIDTH }],
  }));

  const isCaptainOrVc = appUser?.role === 'captain' || appUser?.role === 'viceCaptain';

  async function chooseTheme(pref: ThemePreference) {
    if (Platform.OS !== 'web') Haptics.selectionAsync();
    setThemePref(pref);
    applyThemePreference(pref, setColorScheme);
    await saveThemePreference(pref);
  }

  async function handleSignOut() {
    close();
    await logOut();
  }

  return (
    <Animated.View
      pointerEvents={isOpen ? 'auto' : 'none'}
      style={[StyleSheet.absoluteFill, backdropStyle, { zIndex: 100 }]}
    >
      <Pressable className="flex-1 bg-black/40" onPress={close} />
      <Animated.View
        style={[
          { position: 'absolute', top: 0, bottom: 0, left: 0, width: PANEL_WIDTH, paddingTop: insets.top },
          panelStyle,
        ]}
      >
        <BlurView intensity={70} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
        <View className="flex-1 bg-surface/40 dark:bg-surface-dark/40 border-r border-border/60 dark:border-border-dark/60 px-5 pt-6">
          <View className="items-center mb-6">
            <Avatar initial={appUser?.displayName?.charAt(0) ?? '?'} tone="brand" size="md" />
            <Text
              className="mt-3 text-[16px] text-text dark:text-text-dark text-center"
              style={{ fontFamily: FONT_DISPLAY_EXTRABOLD }}
              numberOfLines={1}
            >
              {appUser?.displayName ?? ''}
            </Text>
          </View>

          <View className="gap-4 mb-2">
            {teamName && (
              <View>
                <Caption>Team</Caption>
                <Body tone="strong" weight="semibold" className="mt-0.5">{teamName}</Body>
              </View>
            )}

            {appUser?.role && (
              <View>
                <Caption>Role</Caption>
                <Body tone="strong" weight="semibold" className="mt-0.5">{ROLE_LABEL[appUser.role] ?? appUser.role}</Body>
              </View>
            )}

            {isCaptainOrVc && (
              <View>
                <Caption>Contact Details</Caption>
                {appUser?.phone ? (
                  <>
                    <Body tone="strong" weight="semibold" className="mt-0.5">{appUser.phone}</Body>
                    {appUser.phoneVisibility && (
                      <Body size="sm" className="mt-0.5">
                        Visible to: {VISIBILITY_LABEL[appUser.phoneVisibility]}
                      </Body>
                    )}
                  </>
                ) : (
                  <Body size="sm" className="mt-0.5">Not added yet</Body>
                )}
              </View>
            )}
          </View>

          <View className="h-px bg-border dark:bg-border-dark my-5" />

          <Caption className="mb-3">Appearance</Caption>
          <View className="flex-row gap-2 mb-5">
            {APPEARANCE_OPTIONS.map((opt) => {
              const selected = themePref === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => chooseTheme(opt.value)}
                  accessibilityLabel={opt.label}
                  className={`flex-1 items-center py-2.5 rounded-xl ${selected ? 'bg-brand-fill dark:bg-brand-fill-dark' : 'bg-surface-2 dark:bg-surface-2-dark'}`}
                >
                  <AppIcon
                    name={opt.icon}
                    size={18}
                    color={selected ? (isDark ? RAW.brandInkDark : RAW.brandInk) : (isDark ? RAW.textFaintDark : RAW.textFaint)}
                  />
                </Pressable>
              );
            })}
          </View>

          <View className="h-px bg-border dark:bg-border-dark mb-2" />

          <MenuRow icon="log-out" label="Sign Out" onPress={handleSignOut} isDark={isDark} tone="coral" />
        </View>
      </Animated.View>
    </Animated.View>
  );
}

function MenuRow({
  icon, label, onPress, isDark, tone = 'default',
}: {
  icon: AppIconName; label: string; onPress: () => void; isDark: boolean; tone?: 'default' | 'coral';
}) {
  const color = tone === 'coral'
    ? (isDark ? RAW.coralInkDark : RAW.coralInk)
    : (isDark ? RAW.textDark : RAW.text);

  return (
    <Pressable
      onPress={() => { if (Platform.OS !== 'web') Haptics.selectionAsync(); onPress(); }}
      className="flex-row items-center gap-3 py-3.5"
    >
      <AppIcon name={icon} size={19} color={color} />
      <Text className="text-[15px] font-semibold" style={{ color }}>{label}</Text>
    </Pressable>
  );
}
