import { View, Text } from 'react-native';
import { FONT_DISPLAY } from '@/styles/typography';
import { toneClasses, type SemanticTone } from '@/lib/theme';

interface AvatarProps {
  initial: string;
  tone?: SemanticTone;
  size?: 'sm' | 'md';
  className?: string;
}

export function Avatar({ initial, tone = 'brand', size = 'md', className = '' }: AvatarProps) {
  const { fill, ink } = toneClasses(tone);
  const dimension = size === 'sm' ? 'w-[34px] h-[34px]' : 'w-11 h-11';
  const fontSize = size === 'sm' ? 'text-[13px]' : 'text-base';

  return (
    <View className={`${dimension} rounded-full items-center justify-center ${fill} ${className}`}>
      <Text className={`font-bold ${fontSize} ${ink}`} style={{ fontFamily: FONT_DISPLAY }}>
        {initial.toUpperCase()}
      </Text>
    </View>
  );
}
