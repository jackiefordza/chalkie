import type { ReactNode } from 'react';
import { View, type ViewProps } from 'react-native';
import { toneClasses, type SemanticTone } from '@/lib/theme';

interface CardProps extends ViewProps {
  children: ReactNode;
  tone?: 'default' | SemanticTone;
  padded?: boolean;
  className?: string;
}

export function Card({ children, tone = 'default', padded = true, className = '', ...rest }: CardProps) {
  const padding = padded ? 'p-5' : '';

  if (tone === 'default') {
    return (
      <View
        className={`bg-surface dark:bg-surface-dark rounded-2xl shadow-sm ${padding} ${className}`}
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
      {...rest}
    >
      {children}
    </View>
  );
}
