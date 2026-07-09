import { Platform } from 'react-native';

// Nunito — warm, rounded display face, loaded via expo-font in app/_layout.tsx.
// Every existing FONT_DISPLAY usage is already bold or extrabold (checked before
// swapping this), so two static weights cover the whole app; body/data stay on
// the system font for readability and to avoid loading extra weights.
export const FONT_DISPLAY = 'Nunito_700Bold';
export const FONT_DISPLAY_EXTRABOLD = 'Nunito_800ExtraBold';
export const FONT_BODY = Platform.select({ ios: 'System', android: 'sans-serif', default: 'system-ui' });
export const FONT_MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace' });
