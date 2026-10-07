/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // ───────────────────────────────────────────────────────────────
        // DartGrid visual identity pass — a deliberately more vivid, warmer
        // palette than the muted graphite/olive one it replaces. DartGrid
        // Green is a confident grass-green (not the old desaturated olive),
        // kept ~50° away in hue from sage's teal-green below so "brand
        // accent" and "success/confirmed" never read as the same colour.
        // Chosen by how the combination actually renders, not by theory —
        // kept in sync with src/lib/theme.ts's RAW object (the handful of
        // places that can't take a className read colours from there), and
        // with the two hardcoded literals that mirror these exactly:
        // TabBar.tsx's sliding-highlight tint and app/+html.tsx's SSR
        // background. Admin's own admin-* tokens (below) are untouched and
        // still deliberately isolated from this family.
        brand: '#3F7D32', // DartGrid Green — light
        'brand-dark': '#7ED957', // DartGrid Green — dark
        // Strong accent / primary CTA — a step brighter/more saturated
        // than the general accent above, reserved for primary buttons
        // (the one thing on a screen that should read as "the action").
        // Everything else that wants "accent" (numbers, active nav,
        // selected state, a highlighted row) uses brand/brand-dark instead.
        'brand-strong': '#2F6826',
        'brand-strong-dark': '#5BC93F',
        // Ink to pair with brand-fill (a faint accent-tinted background —
        // badges, selected chips): a readable accent-toned text colour,
        // darker than `brand` itself in light mode for contrast on a pale
        // tint, and the bright accent itself in dark mode where the tint
        // sits on a dark ground.
        'brand-ink': '#2C5F24',
        'brand-ink-dark': '#7ED957',
        'brand-fill': 'rgba(63,125,50,0.12)',
        'brand-fill-dark': 'rgba(126,217,87,0.16)',
        // Ink for text sitting on a SOLID brand-strong fill (Button's
        // primary variant) — the inverse contrast problem from brand-ink
        // above: dark mode's accent is bright, so it needs dark ink; light
        // mode's is medium-dark, so white reads cleanly.
        'brand-cta-ink': '#FFFFFF',
        'brand-cta-ink-dark': '#0F2608',

        'coral-ink': '#C94F4F',
        'coral-ink-dark': '#E66B6B',
        'coral-fill': 'rgba(201,79,79,0.12)',
        'coral-fill-dark': 'rgba(230,107,107,0.16)',

        'sage-ink': '#31875A',
        'sage-ink-dark': '#69C98A',
        'sage-fill': 'rgba(49,135,90,0.12)',
        'sage-fill-dark': 'rgba(105,201,138,0.16)',

        // Amber/warning — semantic warning meaning ONLY (a disputed or
        // postponed fixture, an "unsure" availability response). Never a
        // decorative secondary brand colour — a stray achievement figure
        // (180s, a high checkout) is neutral text, not amber, throughout
        // the app now (see each screen for where this was previously
        // applied decoratively and has been corrected).
        'butter-ink': '#9A741F',
        'butter-ink-dark': '#D5AE55',
        'butter-fill': 'rgba(154,116,31,0.12)',
        'butter-fill-dark': 'rgba(213,174,85,0.16)',

        // Warm cream — a deliberately warmer, more distinctive light-mode
        // background than the previous near-neutral pale gray, so the
        // base environment and the crisp-white content surface below it
        // are clearly two different things, not two shades of almost-white.
        bg: '#F7F3EA',
        // Deep navy-charcoal — meaningfully darker and bluer than the
        // previous near-black, with more contrast between each surface
        // step below (bg/surface/surface-2/inset), so DartGrid Green pops
        // as a deliberate accent and dark mode reads as a real, considered
        // theme rather than a dimmed light mode.
        'bg-dark': '#0F1320',
        surface: '#FFFFFF',
        'surface-dark': '#1A1F2E',
        // "Elevated" surface (StatTile fills, unselected chips, table
        // header rows, inner stat panels) — a visible step up from the
        // base surface, not just a slightly-different white/near-black.
        'surface-2': '#ECE6D9',
        'surface-2-dark': '#242B3D',
        // Recessed/"inset" surface, one step further in than surface-2 —
        // for controls meant to read as pressed into the page rather than
        // sitting on it (text inputs, stat counters, an unselected
        // segmented-toggle track). Paired with inset-border below for the
        // groove edge. Dark mode leans on the same darker-fill approach
        // rather than a shadow — see Card's own elevation comment for why
        // dark mode generally trades shadow for contrast/borders here.
        'surface-inset': '#E4DCC9',
        'surface-inset-dark': '#0A0D16',
        border: 'rgba(28,26,22,0.10)',
        'border-dark': 'rgba(243,241,234,0.12)',
        'inset-border': 'rgba(28,26,22,0.16)',
        'inset-border-dark': 'rgba(0,0,0,0.4)',
        text: '#1C1A16',
        'text-dark': '#F3F1EA',
        'text-dim': '#5C574E',
        'text-dim-dark': '#B8B3A8',
        'text-faint': '#8B8477',
        'text-faint-dark': '#8F897D',

        // Admin console — its own isolated palette so the desktop admin
        // shell reads as a distinct console rather than a stretched phone
        // screen; deliberately NOT redesigned as part of Phase E (see the
        // Phase E, Step 5 report). The sidebar is a fixed dark slate
        // regardless of light/dark theme (same convention as most desktop
        // admin tools). Admin screens' own content still reuses the shared
        // Card/Badge/Button/Stat primitives above, so the brand/surface/
        // text retone above is visible inside admin-panel too — only this
        // outer chrome (sidebar/canvas/panel colours) stays isolated.
        'admin-sidebar': '#181B22',
        'admin-sidebar-ink': '#B7BCC9',
        'admin-sidebar-ink-active': '#FFFFFF',
        'admin-sidebar-active': 'rgba(139,111,217,0.28)',
        'admin-sidebar-border': '#262A35',
        'admin-canvas': '#EEF0F4',
        'admin-canvas-dark': '#0E1013',
        'admin-panel': '#FFFFFF',
        'admin-panel-dark': '#181A20',
        'admin-panel-border': '#DFE2E8',
        'admin-panel-border-dark': '#2A2E38',
      },
    },
  },
  plugins: [],
};
