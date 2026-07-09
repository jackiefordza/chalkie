import type { ReactNode } from 'react';
import { Text as RNText, type TextProps } from 'react-native';
import { FONT_DISPLAY, FONT_BODY, FONT_MONO } from '@/styles/typography';
import { toneClasses, type SemanticTone } from '@/lib/theme';

interface RoleTextProps extends TextProps {
  children: ReactNode;
  className?: string;
}

const HEADING_SIZES = {
  sm: 'text-[15px]',
  md: 'text-[17px]',
  lg: 'text-xl',
} as const;

interface HeadingProps extends RoleTextProps {
  size?: keyof typeof HEADING_SIZES;
}

export function Heading({ children, size = 'md', className = '', style, ...rest }: HeadingProps) {
  return (
    <RNText
      className={`font-bold text-text dark:text-text-dark ${HEADING_SIZES[size]} ${className}`}
      style={[{ fontFamily: FONT_DISPLAY }, style]}
      {...rest}
    >
      {children}
    </RNText>
  );
}

const BODY_SIZES = {
  xs: 'text-[11px]',
  sm: 'text-[13px]',
  md: 'text-[15px]',
} as const;

// 'dim' = secondary text (default), 'strong' = full-contrast text, or a semantic ink color.
type BodyTone = 'dim' | 'strong' | SemanticTone;

const BODY_TONE_CLASSES: Record<BodyTone, string> = {
  dim: 'text-text-dim dark:text-text-dim-dark',
  strong: 'text-text dark:text-text-dark',
  brand: 'text-brand-ink dark:text-brand-ink-dark',
  coral: 'text-coral-ink dark:text-coral-ink-dark',
  sage: 'text-sage-ink dark:text-sage-ink-dark',
  butter: 'text-butter-ink dark:text-butter-ink-dark',
};

interface BodyProps extends RoleTextProps {
  size?: keyof typeof BODY_SIZES;
  tone?: BodyTone;
  weight?: 'normal' | 'semibold' | 'bold';
}

const WEIGHT_CLASSES = { normal: 'font-normal', semibold: 'font-semibold', bold: 'font-bold' } as const;

export function Body({ children, size = 'md', tone = 'dim', weight = 'normal', className = '', style, ...rest }: BodyProps) {
  return (
    <RNText
      className={`${BODY_SIZES[size]} ${WEIGHT_CLASSES[weight]} ${BODY_TONE_CLASSES[tone]} ${className}`}
      style={[{ fontFamily: FONT_BODY }, style]}
      {...rest}
    >
      {children}
    </RNText>
  );
}

export function Caption({ children, className = '', style, ...rest }: RoleTextProps) {
  return (
    <RNText
      className={`text-[11px] font-semibold uppercase tracking-wider text-text-faint dark:text-text-faint-dark ${className}`}
      style={[{ fontFamily: FONT_BODY }, style]}
      {...rest}
    >
      {children}
    </RNText>
  );
}

interface StatProps extends RoleTextProps {
  tone?: SemanticTone;
  size?: 'sm' | 'md' | 'lg';
}

const STAT_SIZES = { sm: 'text-[16px]', md: 'text-[22px]', lg: 'text-[28px]' } as const;

export function Stat({ children, tone, size = 'md', className = '', style, ...rest }: StatProps) {
  const inkClass = tone ? toneClasses(tone).ink : 'text-text dark:text-text-dark';
  return (
    <RNText
      className={`font-bold ${STAT_SIZES[size]} ${inkClass} ${className}`}
      style={[{ fontFamily: FONT_MONO, fontVariant: ['tabular-nums'] }, style]}
      {...rest}
    >
      {children}
    </RNText>
  );
}
