import type { ReactNode } from 'react';
import { View, Text } from 'react-native';
import { toneClasses, type SemanticTone } from '@/lib/theme';

interface BadgeProps {
  tone: SemanticTone;
  children: ReactNode;
  className?: string;
}

export function Badge({ tone, children, className = '' }: BadgeProps) {
  const { fill, ink } = toneClasses(tone);
  return (
    <View className={`rounded-full px-2.5 py-1 ${fill} ${className}`}>
      <Text className={`text-[10.5px] font-bold ${ink}`}>{children}</Text>
    </View>
  );
}
