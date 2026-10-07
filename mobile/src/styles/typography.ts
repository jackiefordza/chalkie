import { Platform } from 'react-native';

// Nunito — warm, rounded display face, loaded via expo-font in app/_layout.tsx.
// Every existing FONT_DISPLAY usage is already bold or extrabold (checked before
// swapping this), so two static weights cover the whole app; body/data stay on
// the system font for readability and to avoid loading extra weights.
export const FONT_DISPLAY = 'Nunito_700Bold';
export const FONT_DISPLAY_EXTRABOLD = 'Nunito_800ExtraBold';
// DartGrid visual identity pass — the heaviest weight Nunito ships, reserved
// for the wordmark and the single headline figure per screen (a confirmed
// match score, a league position): the one or two places per screen that
// should feel unmistakably like "the most important thing here," not just a
// bigger Bold. Already bundled by @expo-google-fonts/nunito (no new
// dependency) — see app/_layout.tsx's useFonts call.
export const FONT_DISPLAY_BLACK = 'Nunito_900Black';
export const FONT_BODY = Platform.select({ ios: 'System', android: 'sans-serif', default: 'system-ui' });
export const FONT_MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace' });
