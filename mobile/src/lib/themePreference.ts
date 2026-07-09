import AsyncStorage from '@react-native-async-storage/async-storage';
import { Appearance } from 'react-native';

const STORAGE_KEY = 'chalkie:themePreference';

export type ThemePreference = 'light' | 'dark' | 'system';
type ResolvedScheme = 'light' | 'dark';
type SetColorScheme = (scheme: ResolvedScheme) => void;

// Tracked at module scope so the live OS-theme listener (subscribed once in
// the root layout) knows whether it should still be following the system —
// NativeWind's own setColorScheme('system') just forces light for CSS
// `dark:` variants rather than resolving to the actual OS scheme, so we
// resolve it ourselves everywhere instead of ever passing 'system' through.
let currentPreference: ThemePreference = 'system';

export async function loadThemePreference(): Promise<ThemePreference> {
  const saved = await AsyncStorage.getItem(STORAGE_KEY);
  currentPreference = saved === 'light' || saved === 'dark' ? saved : 'system';
  return currentPreference;
}

export async function saveThemePreference(pref: ThemePreference): Promise<void> {
  currentPreference = pref;
  if (pref === 'system') {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } else {
    await AsyncStorage.setItem(STORAGE_KEY, pref);
  }
}

function resolve(pref: ThemePreference): ResolvedScheme {
  return pref === 'system' ? (Appearance.getColorScheme() ?? 'light') : pref;
}

export function applyThemePreference(pref: ThemePreference, setColorScheme: SetColorScheme) {
  currentPreference = pref;
  setColorScheme(resolve(pref));
}

// Mounted once at the root — keeps the applied scheme in sync with live OS
// theme changes whenever the user's preference is 'system'.
export function watchSystemTheme(setColorScheme: SetColorScheme) {
  const sub = Appearance.addChangeListener(() => {
    if (currentPreference === 'system') setColorScheme(resolve('system'));
  });
  return () => sub.remove();
}
