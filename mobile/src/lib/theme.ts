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
// DartGrid visual identity pass — a deliberately more vivid, warmer palette
// than the muted graphite/olive one above (now retired): a confident
// grass-green brand accent (distinct in hue from the sage "success" tone,
// never confused with it), a warm cream/off-white light mode instead of a
// near-neutral pale gray, and a genuinely deep navy-charcoal dark mode
// (bluer, with more contrast between steps) instead of a flat near-black.
// Chosen by how the combination actually reads in the rendered app, not by
// theory — every hardcoded literal elsewhere that mirrors one of these
// (TabBar's highlight tint, +html.tsx's SSR background) is updated to match.
export const RAW = {
  bg: '#F7F3EA',
  bgDark: '#0F1320',
  surface: '#FFFFFF',
  surfaceDark: '#1A1F2E',
  surface2: '#ECE6D9',
  surface2Dark: '#242B3D',
  // Recessed/"inset" surface — one step further in than surface2, for
  // controls meant to read as pressed into the page rather than sitting
  // on it (text inputs, stat counters, an unselected segmented-toggle
  // track). Light mode reads this via the darker fill alone (plus
  // insetBorder below); dark mode leans on the same darker-fill approach
  // rather than a shadow, per the "dark mode: subtle inset contrast, not
  // shadow-dependent" direction.
  surfaceInset: '#E4DCC9',
  surfaceInsetDark: '#0A0D16',
  // The hairline that sells the recessed look — a touch stronger than the
  // ordinary `border` token in light mode (a visible groove edge), and a
  // dark seam (not a light highlight) in dark mode, consistent with that
  // mode relying on contrast/borders rather than shadow for depth.
  insetBorder: 'rgba(28,26,22,0.16)',
  insetBorderDark: 'rgba(0,0,0,0.4)',
  text: '#1C1A16',
  textDark: '#F3F1EA',
  textDim: '#5C574E',
  textDimDark: '#B8B3A8',
  textFaint: '#8B8477',
  textFaintDark: '#8F897D',
  // DartGrid Green — a confident grass-green, not the old desaturated
  // olive. Deliberately ~50° away in hue from sage's teal-green (below) so
  // "brand accent" and "success/confirmed" never read as the same colour.
  brand: '#3F7D32',
  brandDark: '#7ED957',
  brandStrong: '#2F6826',
  brandStrongDark: '#5BC93F',
  brandInk: '#2C5F24',
  brandInkDark: '#7ED957',
  brandFill: 'rgba(63,125,50,0.12)',
  brandFillDark: 'rgba(126,217,87,0.16)',
  brandCtaInk: '#FFFFFF',
  brandCtaInkDark: '#0F2608',
  coralInk: '#C94F4F',
  coralInkDark: '#E66B6B',
  sageInk: '#31875A',
  sageInkDark: '#69C98A',
  butterInk: '#9A741F',
  butterInkDark: '#D5AE55',
} as const;
