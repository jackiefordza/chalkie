import type { ReactNode } from 'react';
import { TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from 'nativewind';
import { goBack } from '@/lib/navigation';
import { RAW } from '@/lib/theme';
import { Heading } from './Text';
import { AppIcon } from './AppIcon';

interface AppBarProps {
  title: string;
  fallback?: string;
  right?: ReactNode;
}

export function AppBar({ title, fallback, right }: AppBarProps) {
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const color = colorScheme === 'dark' ? RAW.brandDark : RAW.brand;

  return (
    <View
      className="flex-row items-center bg-surface dark:bg-surface-dark border-b border-border dark:border-border-dark px-2"
      style={{ paddingTop: insets.top, height: insets.top + 48 }}
    >
      <TouchableOpacity onPress={() => goBack(fallback)} activeOpacity={0.7} hitSlop={12} className="p-2">
        <AppIcon name="chevron-left" size={24} color={color} />
      </TouchableOpacity>
      <Heading size="md" className="flex-1 ml-1" numberOfLines={1}>
        {title}
      </Heading>
      {right && <View className="ml-2">{right}</View>}
    </View>
  );
}
