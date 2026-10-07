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
// ActivityIndicator's `color` prop, AppIcon's `color` prop, a BlurView tint).
//
// Phase E, Step 5: this is now the single source of truth for the whole
// app's light/dark palette (soft graphite + off-white + muted Chalkie green,
// approved across Steps 2-4 on Home and rolled out app-wide here) — the
// Home-only fixed "home-*" family from Steps 2-4 has been retired; Home now
// reads these same scheme-aware values like every other screen, which is
// what gives it a genuine light mode.
export const RAW = {
  bg: '#F3F4F1',
  // Deep charcoal/navy rather than the previous near-black's slight green
  // cast — a cooler, more neutral dark base (blue channel now leads red/
  // green at every step: bg/surface/surface2 below), so the brand green
  // reads as a deliberate accent against it rather than blending into an
  // olive-dark environment. Text/dim/faint colours are unchanged — the
  // contrast shift from this is imperceptible, only the undertone moved.
  bgDark: '#14161B',
  surface: '#FFFFFF',
  surfaceDark: '#1D2027',
  surface2: '#E9ECE8',
  surface2Dark: '#262A33',
  // Recessed/"inset" surface — one step further in than surface2, for
  // controls meant to read as pressed into the page rather than sitting
  // on it (text inputs, stat counters, an unselected segmented-toggle
  // track). Light mode reads this via the darker fill alone (plus
  // insetBorder below); dark mode leans on the same darker-fill approach
  // rather than a shadow, per the "dark mode: subtle inset contrast, not
  // shadow-dependent" direction.
  surfaceInset: '#E2E5DF',
  surfaceInsetDark: '#101216',
  // The hairline that sells the recessed look — a touch stronger than the
  // ordinary `border` token in light mode (a visible groove edge), and a
  // dark seam (not a light highlight) in dark mode, consistent with that
  // mode relying on contrast/borders rather than shadow for depth.
  insetBorder: 'rgba(24,32,27,0.16)',
  insetBorderDark: 'rgba(0,0,0,0.4)',
  text: '#18201B',
  textDark: '#F2F3EF',
  textDim: '#5D6761',
  textDimDark: '#B4BAB6',
  textFaint: '#7C857F',
  textFaintDark: '#858D88',
  brand: '#71883A',
  brandDark: '#B1C75E',
  brandStrong: '#7D9640',
  brandStrongDark: '#B8CC67',
  brandInk: '#5C7030',
  brandInkDark: '#B1C75E',
  brandFill: 'rgba(113,136,58,0.12)',
  brandFillDark: 'rgba(177,199,94,0.16)',
  brandCtaInk: '#FFFFFF',
  brandCtaInkDark: '#14161B',
  coralInk: '#C94F4F',
  coralInkDark: '#E66B6B',
  sageInk: '#31875A',
  sageInkDark: '#69C98A',
  butterInk: '#9A741F',
  butterInkDark: '#D5AE55',
} as const;
