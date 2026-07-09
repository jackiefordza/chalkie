// Tailwind's content scanner only picks up class names that appear as literal
// strings in source — a template like `bg-${tone}-fill` never generates CSS.
// Every tone's classes are spelled out in full here so the scanner finds them.
export type SemanticTone = 'brand' | 'coral' | 'sage' | 'butter';

interface ToneClasses {
  fill: string;
  ink: string;
  border: string;
}

const TONE_CLASSES: Record<SemanticTone, ToneClasses> = {
  brand: {
    fill: 'bg-brand-fill dark:bg-brand-fill-dark',
    ink: 'text-brand-ink dark:text-brand-ink-dark',
    border: 'border-brand-ink dark:border-brand-ink-dark',
  },
  coral: {
    fill: 'bg-coral-fill dark:bg-coral-fill-dark',
    ink: 'text-coral-ink dark:text-coral-ink-dark',
    border: 'border-coral-ink dark:border-coral-ink-dark',
  },
  sage: {
    fill: 'bg-sage-fill dark:bg-sage-fill-dark',
    ink: 'text-sage-ink dark:text-sage-ink-dark',
    border: 'border-sage-ink dark:border-sage-ink-dark',
  },
  butter: {
    fill: 'bg-butter-fill dark:bg-butter-fill-dark',
    ink: 'text-butter-ink dark:text-butter-ink-dark',
    border: 'border-butter-ink dark:border-butter-ink-dark',
  },
};

export function toneClasses(tone: SemanticTone): ToneClasses {
  return TONE_CLASSES[tone];
}

// Raw hex, mirroring tailwind.config.js — for the handful of places that can't
// take a className (React Navigation's headerStyle/headerTintColor, an
// ActivityIndicator's `color` prop, TextInput's placeholderTextColor).
export const RAW = {
  surface: '#FFFFFF',
  surfaceDark: '#1D2027',
  text: '#22242B',
  textDark: '#F2EFE7',
  textFaint: '#96998F',
  textFaintDark: '#6F7684',
  brand: '#7A4FD1',
  brandDark: '#8B6FD9',
  brandInk: '#5B32A8',
  brandInkDark: '#D7C6FA',
  brandFill: '#EDE3FB',
  brandFillDark: 'rgba(139,111,217,0.2)',
  coralInk: '#C6483C',
  coralInkDark: '#FF9C8D',
  sageInk: '#1F8054',
  sageInkDark: '#8FE0B0',
  butterInk: '#A97917',
  butterInkDark: '#F0C368',
} as const;
