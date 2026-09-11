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

// Phase E, Step 2 — Home V1 visual prototype; Step 3 — colour pass. Maps
// the SAME semantic tone values matchStatus.ts's STATUS_TONE already uses
// onto the fixed dark palette (tailwind.config.js's home-* tokens) — the
// meaning (which status is "warning-ish" vs "error-ish") is untouched,
// only its rendering under the new colours changes. Subtle tinted
// background (Tailwind's /opacity modifier) + full-strength text, mirroring
// the existing toneClasses() fill+ink pattern, deliberately restrained
// rather than a solid saturated fill (see Phase E brief: avoid glow/neon).
interface HomeToneClasses {
  bg: string;
  text: string;
}

const HOME_TONE_CLASSES: Record<SemanticTone, HomeToneClasses> = {
  brand: { bg: 'bg-home-accent/15', text: 'text-home-accent' },
  coral: { bg: 'bg-home-error/15', text: 'text-home-error' },
  sage: { bg: 'bg-home-success/15', text: 'text-home-success' },
  butter: { bg: 'bg-home-warning/15', text: 'text-home-warning' },
};

export function homeToneClasses(tone: SemanticTone): HomeToneClasses {
  return HOME_TONE_CLASSES[tone];
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

  // Phase E, Step 2 — Home V1 fixed dark palette; Step 3 — colour pass
  // ("graphite + muted Chalkie green + off-white"); Step 4 — tonal
  // refinement (lighter background/surface/elevated for real-device
  // legibility, same structure). For the handful of props that can't take
  // a className (AppIcon's color, ActivityIndicator, a BlurView tint).
  // Mirrors tailwind.config.js's home-* tokens exactly — keep these two in
  // sync if either changes.
  homeBase: '#181B19',
  homeSurface: '#242925',
  homeElevated: '#2C322E',
  homeText: '#F2F3EF',
  homeTextDim: '#B4BAB6',
  homeTextFaint: '#858D88',
  homeAccent: '#B1C75E',
  homeAccentStrong: '#B8CC67',
  homeAccentInk: '#181B19',
  homeSuccess: '#69C98A',
  homeWarning: '#D5AE55',
  homeError: '#E66B6B',
} as const;
