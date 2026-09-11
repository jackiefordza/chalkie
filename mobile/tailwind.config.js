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
        brand: '#7A4FD1',
        'brand-dark': '#8B6FD9',
        'brand-ink': '#5B32A8',
        'brand-ink-dark': '#D7C6FA',
        'brand-fill': '#EDE3FB',
        'brand-fill-dark': 'rgba(139,111,217,0.2)',

        'coral-ink': '#C6483C',
        'coral-ink-dark': '#FF9C8D',
        'coral-fill': '#FCE2DD',
        'coral-fill-dark': 'rgba(255,138,122,0.16)',

        'sage-ink': '#1F8054',
        'sage-ink-dark': '#8FE0B0',
        'sage-fill': '#DFF3E7',
        'sage-fill-dark': 'rgba(117,214,153,0.16)',

        'butter-ink': '#A97917',
        'butter-ink-dark': '#F0C368',
        'butter-fill': '#FBEBC7',
        'butter-fill-dark': 'rgba(255,205,112,0.16)',

        bg: '#F7F5F0',
        'bg-dark': '#15171C',
        surface: '#FFFFFF',
        'surface-dark': '#1D2027',
        'surface-2': '#E9E2D0',
        'surface-2-dark': '#262A33',
        border: '#E7E2D6',
        'border-dark': '#333844',
        text: '#22242B',
        'text-dark': '#F2EFE7',
        'text-dim': '#6B6F7A',
        'text-dim-dark': '#A9AFBC',
        'text-faint': '#96998F',
        'text-faint-dark': '#6F7684',

        // Admin console — deliberately cooler/darker than the app's warm
        // branded palette above, so the desktop admin shell reads as a
        // distinct console rather than a stretched phone screen. The
        // sidebar is a fixed dark slate regardless of light/dark theme
        // (same convention as most desktop admin tools).
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

        // Phase E, Step 2 — Home V1 visual prototype; Step 3 — colour pass
        // ("graphite + muted Chalkie green + off-white"). A deliberately
        // FIXED dark palette (no light/dark-variant pair) — same precedent
        // as admin-sidebar/admin-canvas above, which are also fixed
        // regardless of the app's light/dark toggle. Not yet the app-wide
        // theme; currently used only by HomeDashboard, Header, and TabBar.
        // The interface is mostly neutral graphite — home-accent is a
        // restrained accent (numbers, active/selected state), never a
        // background or decorative surface. There is no general-purpose
        // "amber" token any more: home-warning exists solely for genuine
        // warning/status meaning, not as a decorative secondary brand colour.
        'home-base': '#0D0F0E',
        'home-surface': '#171A18',
        'home-elevated': '#202421',
        'home-border': 'rgba(241,242,238,0.10)',
        'home-text': '#F1F2EE',
        'home-text-dim': '#A7ADA8',
        'home-text-faint': '#737A76',
        'home-accent': '#AFC65A',
        'home-accent-strong': '#BBD267',
        'home-accent-ink': '#0D0F0E',
        'home-success': '#69C98A',
        'home-warning': '#D5AE55',
        'home-error': '#E66B6B',
      },
    },
  },
  plugins: [],
};
