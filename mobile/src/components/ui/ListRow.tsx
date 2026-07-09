import type { ReactNode } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

interface ListRowProps {
  avatar?: ReactNode;
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  onPress?: () => void;
  className?: string;
}

export function ListRow({ avatar, title, subtitle, trailing, onPress, className = '' }: ListRowProps) {
  const Wrapper = onPress ? TouchableOpacity : View;
  const wrapperProps = onPress ? { onPress, activeOpacity: 0.7 } : {};

  return (
    <Wrapper
      className={`flex-row items-center gap-3 p-3 rounded-2xl bg-surface-2 dark:bg-surface-2-dark ${className}`}
      {...wrapperProps}
    >
      {avatar}
      <View className="flex-1">
        <Text className="text-[14px] font-semibold text-text dark:text-text-dark" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text className="text-[12px] text-text-faint dark:text-text-faint-dark mt-0.5" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
    </Wrapper>
  );
}
