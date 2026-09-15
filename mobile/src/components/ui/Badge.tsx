import type { ReactNode } from 'react';
import { View, Text } from 'react-native';
import { toneClasses, type SemanticTone } from '@/lib/theme';

interface BadgeProps {
  // Optional — a Badge with no semantic meaning (an informational count, a
  // notable-but-not-warning figure) renders as a neutral pill instead of
  // being forced into one of the four semantic tones just to have a colour.
  tone?: SemanticTone;
  children: ReactNode;
  className?: string;
}

export function Badge({ tone, children, className = '' }: BadgeProps) {
  const { fill, ink } = tone
    ? toneClasses(tone)
    : { fill: 'bg-surface-2 dark:bg-surface-2-dark', ink: 'text-text-dim dark:text-text-dim-dark' };
  return (
    <View className={`rounded-full px-2.5 py-1 ${fill} ${className}`}>
      <Text className={`text-[10.5px] font-bold ${ink}`}>{children}</Text>
    </View>
  );
}
