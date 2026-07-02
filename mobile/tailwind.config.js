/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        'ios-blue': '#007AFF',
        'ios-indigo': '#5856D6',
        'ios-gray': '#8E8E93',
        'ios-gray2': '#AEAEB2',
        'ios-gray3': '#C7C7CC',
        'ios-gray4': '#D1D1D6',
        'ios-gray5': '#E5E5EA',
        'ios-gray6': '#F2F2F7',
        'ios-bg': '#F2F2F7',
        'ios-card': '#FFFFFF',
        'ios-separator': '#C6C6C8',
        'ios-label': '#000000',
        'ios-label-secondary': '#3C3C43',
        'ios-danger': '#FF3B30',
        'ios-success': '#34C759',
      },
    },
  },
  plugins: [],
};
