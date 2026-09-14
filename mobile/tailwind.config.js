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
        // Phase E, Step 5 — the approved design system, app-wide. Replaces
        // the previous "warm cream + purple" palette. This IS the app's
        // real light/dark palette now (toggled the same way it always was,
        // via NativeWind's `dark:` variant) — not a Home-only fixed
        // override. Home's own Steps 2-4 fixed-dark "home-*" token family
        // has been retired; HomeDashboard/Header/TabBar now consume these
        // same tokens, which is what gives Home a genuine light mode for
        // the first time. Core visual language: soft graphite + off-white
        // (the environment) with muted Chalkie green as a restrained
        // accent (never the environment itself) — see brand/brand-strong
        // below. Admin's own admin-* tokens (below) are untouched and
        // still deliberately isolated from this family.
        brand: '#71883A', // Chalkie accent — light
        'brand-dark': '#B1C75E', // Chalkie accent — dark
        // Strong accent / primary CTA — a step brighter/more saturated
        // than the general accent above, reserved for primary buttons
        // (the one thing on a screen that should read as "the action").
        // Everything else that wants "accent" (numbers, active nav,
        // selected state, a highlighted row) uses brand/brand-dark instead.
        'brand-strong': '#7D9640',
        'brand-strong-dark': '#B8CC67',
        // Ink to pair with brand-fill (a faint accent-tinted background —
        // badges, selected chips): a readable accent-toned text colour,
        // darker than `brand` itself in light mode for contrast on a pale
        // tint, and the bright accent itself in dark mode where the tint
        // sits on a dark ground.
        'brand-ink': '#5C7030',
        'brand-ink-dark': '#B1C75E',
        'brand-fill': 'rgba(113,136,58,0.12)',
        'brand-fill-dark': 'rgba(177,199,94,0.16)',
        // Ink for text sitting on a SOLID brand-strong fill (Button's
        // primary variant) — the inverse contrast problem from brand-ink
        // above: dark mode's accent is bright, so it needs dark ink; light
        // mode's is medium-dark, so white reads cleanly.
        'brand-cta-ink': '#FFFFFF',
        'brand-cta-ink-dark': '#181B19',

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

        bg: '#F3F4F1',
        'bg-dark': '#181B19',
        surface: '#FFFFFF',
        'surface-dark': '#242925',
        // "Elevated" surface (StatTile fills, unselected chips, table
        // header rows, inner stat panels) — a visible step up from the
        // base surface, not just a slightly-different white/near-black.
        'surface-2': '#E9ECE8',
        'surface-2-dark': '#2C322E',
        border: 'rgba(24,32,27,0.10)',
        'border-dark': 'rgba(242,243,239,0.12)',
        text: '#18201B',
        'text-dark': '#F2F3EF',
        'text-dim': '#5D6761',
        'text-dim-dark': '#B4BAB6',
        'text-faint': '#7C857F',
        'text-faint-dark': '#858D88',

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
