import { TouchableOpacity, View, Text } from 'react-native';
import { useColorScheme } from 'nativewind';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { RAW } from '@/lib/theme';
import { FONT_DISPLAY_EXTRABOLD } from '@/styles/typography';
import { Avatar } from './Avatar';
import { AppIcon } from './AppIcon';

const ROLE_BADGE: Record<string, string> = {
  captain: 'C',
  viceCaptain: 'VC',
};

export function HeaderAvatar() {
  const { appUser } = useAuthStore();
  const openAccountMenu = useUiStore((s) => s.openAccountMenu);
  const badge = appUser?.role ? ROLE_BADGE[appUser.role] : undefined;

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

export function HeaderWordmark() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  return (
    <View className="flex-row items-center gap-1.5">
      <AppIcon name="target" size={18} color={isDark ? RAW.brandInkDark : RAW.brandInk} />
      <Text className="text-lg text-brand dark:text-brand-dark" style={{ fontFamily: FONT_DISPLAY_EXTRABOLD }}>
        Chalkie
      </Text>
    </View>
  );
}
