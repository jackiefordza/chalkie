import type { ReactNode } from 'react';
import { TouchableOpacity, ActivityIndicator, Text, type TouchableOpacityProps } from 'react-native';
import { useColorScheme } from 'nativewind';
import { FONT_DISPLAY } from '@/styles/typography';
import { RAW } from '@/lib/theme';

export type ButtonVariant = 'primary' | 'secondary' | 'good' | 'danger' | 'ghost';

interface Variant {
  container: string;
  text: string;
  spinner: string;
}

// Phase E, Step 5: 'primary' now uses the "strong accent / CTA" token
// (brand-strong), not the general accent — the one thing on a screen that
// reads as "the action" gets a slightly more saturated green than plain
// numeric/selected-state emphasis elsewhere. This absorbs what used to be
// Home's own Home-only 'accent' variant (retired — Home's CTA now just uses
// 'primary' like every other button in the app, since the whole app shares
// one token system now).
// secondary/good/danger/ghost all previously shared one hardcoded spinner
// colour ('#7A4FD1', the old purple brand hex) regardless of their own
// tone — that literal is now stale (nothing in the new palette is purple),
// so it's replaced with the new brand accent, keeping the same "one shared
// spinner colour across these four muted-fill variants" shape rather than
// giving each variant its own tone-matched spinner (a bigger change than
// this pass calls for).
const VARIANTS: Record<ButtonVariant, Variant> = {
  primary: { container: 'bg-brand-strong dark:bg-brand-strong-dark shadow-sm', text: 'text-brand-cta-ink dark:text-brand-cta-ink-dark', spinner: RAW.brandCtaInk },
  secondary: { container: 'bg-surface-2 dark:bg-surface-2-dark', text: 'text-text dark:text-text-dark', spinner: RAW.brand },
  good: { container: 'bg-sage-fill dark:bg-sage-fill-dark', text: 'text-sage-ink dark:text-sage-ink-dark', spinner: RAW.brand },
  danger: { container: 'bg-coral-fill dark:bg-coral-fill-dark', text: 'text-coral-ink dark:text-coral-ink-dark', spinner: RAW.brand },
  ghost: { container: 'bg-transparent border border-dashed border-border dark:border-border-dark', text: 'text-text-dim dark:text-text-dim-dark', spinner: RAW.brand },
};

interface ButtonProps extends Omit<TouchableOpacityProps, 'children'> {
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  disabled?: boolean;
  loading?: boolean;
  children: ReactNode;
  className?: string;
}

export function Button({
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  children,
  className = '',
  ...rest
}: ButtonProps) {
  const v = VARIANTS[variant];
  const padding = size === 'sm' ? 'py-2.5 px-4' : 'py-3.5 px-5';
  const isDisabled = disabled || loading;
  // 'primary's fill flips lightness between schemes (a medium-dark green in
  // light mode, a bright one in dark mode) enough that the spinner needs to
  // flip contrast with it — every other variant's fill stays pale/muted in
  // both schemes, so their spinner colour (unchanged since before this
  // phase) doesn't need to.
  const { colorScheme } = useColorScheme();
  const spinnerColor = variant === 'primary' && colorScheme === 'dark' ? RAW.brandCtaInkDark : v.spinner;

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      disabled={isDisabled}
      className={`rounded-full items-center justify-center flex-row gap-2 ${padding} ${v.container} ${isDisabled ? 'opacity-40' : ''} ${className}`}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={spinnerColor} />
      ) : (
        <Text
          className={`font-bold ${size === 'sm' ? 'text-sm' : 'text-[15px]'} ${v.text}`}
          style={{ fontFamily: FONT_DISPLAY }}
        >
          {children}
        </Text>
      )}
    </TouchableOpacity>
  );
}
