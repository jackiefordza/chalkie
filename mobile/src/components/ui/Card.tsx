import type { ReactNode } from 'react';
import { View, type ViewProps } from 'react-native';
import { useColorScheme } from 'nativewind';
import { toneClasses, type SemanticTone } from '@/lib/theme';

// Real elevation (RN shadow props, not a fixed Tailwind shadow-sm class —
// `TabBar`/`AccountMenu` already prove this is the reliable cross-platform
// way to get a believable soft shadow on web too). Light mode gets the
// fuller soft shadow the brief asks for; dark mode deliberately pulls back
// on shadow (barely visible against a dark background anyway) and relies
// on a faint light-edge border for separation instead — "borders/
// highlights where appropriate, less dependence on shadows."
const ELEVATION_LIGHT = {
  shadowColor: '#000000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.08, shadowRadius: 14, elevation: 3,
};
const ELEVATION_DARK = {
  shadowColor: '#000000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 6, elevation: 2,
};

interface CardProps extends ViewProps {
  children: ReactNode;
  tone?: 'default' | SemanticTone;
  padded?: boolean;
  className?: string;
}

export function Card({ children, tone = 'default', padded = true, className = '', style, ...rest }: CardProps) {
  const { colorScheme } = useColorScheme();
  const padding = padded ? 'p-5' : '';

  if (tone === 'default') {
    return (
      <View
        className={`bg-surface dark:bg-surface-dark dark:border dark:border-border-dark rounded-2xl ${padding} ${className}`}
        style={[colorScheme === 'dark' ? ELEVATION_DARK : ELEVATION_LIGHT, style]}
        {...rest}
      >
        {children}
      </View>
    );
  }

  const { fill, border } = toneClasses(tone);
  return (
    <View
      className={`${fill} rounded-2xl border-l-4 ${border} ${padding} ${className}`}
      style={style}
      {...rest}
    >
      {children}
    </View>
  );
}
