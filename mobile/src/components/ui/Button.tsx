import type { ReactNode } from 'react';
import { TouchableOpacity, ActivityIndicator, Text, type TouchableOpacityProps } from 'react-native';
import { FONT_DISPLAY } from '@/styles/typography';

export type ButtonVariant = 'primary' | 'secondary' | 'good' | 'danger' | 'ghost';

interface Variant {
  container: string;
  text: string;
}

const VARIANTS: Record<ButtonVariant, Variant> = {
  primary: { container: 'bg-brand dark:bg-brand-dark shadow-sm', text: 'text-white' },
  secondary: { container: 'bg-surface-2 dark:bg-surface-2-dark', text: 'text-text dark:text-text-dark' },
  good: { container: 'bg-sage-fill dark:bg-sage-fill-dark', text: 'text-sage-ink dark:text-sage-ink-dark' },
  danger: { container: 'bg-coral-fill dark:bg-coral-fill-dark', text: 'text-coral-ink dark:text-coral-ink-dark' },
  ghost: { container: 'bg-transparent border border-dashed border-border dark:border-border-dark', text: 'text-text-dim dark:text-text-dim-dark' },
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

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      disabled={isDisabled}
      className={`rounded-full items-center justify-center flex-row gap-2 ${padding} ${v.container} ${isDisabled ? 'opacity-40' : ''} ${className}`}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? '#FFFFFF' : '#7A4FD1'} />
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
