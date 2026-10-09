import { TouchableOpacity, View, Text } from 'react-native';
import { useColorScheme } from 'nativewind';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { RAW } from '@/lib/theme';
import { APP_NAME } from '@/lib/brand';
import { FONT_DISPLAY_BLACK } from '@/styles/typography';
import { Avatar } from './Avatar';

const ROLE_BADGE: Record<string, string> = {
  captain: 'C',
  viceCaptain: 'VC',
};

export function HeaderAvatar() {
  const { appUser } = useAuthStore();
  const openAccountMenu = useUiStore((s) => s.openAccountMenu);
  // isLeagueAdmin/isGlobalAdmin are independent of role and take priority in
  // this one-badge slot — a captain/VC who's also an admin sees "A" here, not
  // "C"/"VC"; the full picture (both role and admin status) is in the account
  // menu itself.
  const isAdmin = appUser?.isLeagueAdmin || appUser?.isGlobalAdmin;
  const badge = isAdmin ? 'A' : appUser?.role ? ROLE_BADGE[appUser.role] : undefined;

  return (
    <TouchableOpacity onPress={openAccountMenu} activeOpacity={0.7} hitSlop={12} className="ml-4">
      <View>
        <Avatar initial={appUser?.displayName?.charAt(0) ?? '?'} tone="brand" size="sm" />
        {badge && (
          <View className="absolute -bottom-1 -right-1 rounded-full bg-brand dark:bg-brand-dark px-1 min-w-[16px] h-4 items-center justify-center border-2 border-surface dark:border-surface-dark">
            <Text className="text-[9px] font-bold text-white">{badge}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// GRID MARK — DartGrid's own small geometric identity mark: a 2×2 grid of
// squares (two solid DartGrid Green, two at a faint tint), nodding to
// "Grid" in the name without ever drawing a dartboard/bullseye/dart —
// replaces the previous literal "target" icon (a bullseye glyph), which is
// exactly the cliché the brand direction rules out. Deliberately small and
// static — a mark, not a logo.
// ─────────────────────────────────────────────────────────────────────────
export function GridMark({ size = 18 }: { size?: number }) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const strong = isDark ? RAW.brandDark : RAW.brand;
  const soft = isDark ? RAW.brandFillDark : RAW.brandFill;
  const cell = Math.round(size * 0.42);
  const gap = Math.max(2, Math.round(size * 0.14));
  const radius = Math.max(2, Math.round(cell * 0.22));

  return (
    <View style={{ width: size, height: size, flexDirection: 'row', flexWrap: 'wrap', gap }}>
      <View style={{ width: cell, height: cell, borderRadius: radius, backgroundColor: strong }} />
      <View style={{ width: cell, height: cell, borderRadius: radius, backgroundColor: soft }} />
      <View style={{ width: cell, height: cell, borderRadius: radius, backgroundColor: soft }} />
      <View style={{ width: cell, height: cell, borderRadius: radius, backgroundColor: strong }} />
    </View>
  );
}

const WORDMARK_SIZES = {
  sm: { mark: 15, text: 15 },
  md: { mark: 20, text: 19 },
} as const;

// ─────────────────────────────────────────────────────────────────────────
// WORDMARK — the actual DartGrid product identity, not plain tracked-out
// caps: GridMark plus a two-tone "Dart"/"Grid" treatment (dark ink + brand
// green) in the heaviest weight Nunito ships, which reads as a deliberate
// mark rather than a label. Used both as the native header title on every
// non-Home screen (previously HeaderWordmark's own target-icon version) and
// by Header.tsx on Home — one wordmark, not two diverging treatments.
// ─────────────────────────────────────────────────────────────────────────
export function Wordmark({ size = 'md' }: { size?: keyof typeof WORDMARK_SIZES }) {
  const s = WORDMARK_SIZES[size];
  return (
    <View className="flex-row items-center gap-2" accessibilityRole="text" accessibilityLabel={APP_NAME}>
      <GridMark size={s.mark} />
      <Text style={{ fontFamily: FONT_DISPLAY_BLACK, fontSize: s.text }} className="text-text dark:text-text-dark">
        Dart<Text style={{ fontFamily: FONT_DISPLAY_BLACK, fontSize: s.text }} className="text-brand dark:text-brand-dark">Grid</Text>
      </Text>
    </View>
  );
}

export function HeaderWordmark() {
  return <Wordmark size="sm" />;
}
