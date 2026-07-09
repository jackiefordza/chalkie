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
      },
    },
  },
  plugins: [],
};
