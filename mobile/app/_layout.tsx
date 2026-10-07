import '../global.css';
import { useEffect } from 'react';
import { View, Text } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from 'nativewind';
import { useFonts, Nunito_700Bold, Nunito_800ExtraBold } from '@expo-google-fonts/nunito';
import { initAuthListener } from '@/stores/authStore';
import { loadThemePreference, applyThemePreference, watchSystemTheme } from '@/lib/themePreference';
import { isStaging, firebaseConfig } from '@/config/firebase';

export default function RootLayout() {
  const { setColorScheme } = useColorScheme();
  const [fontsLoaded] = useFonts({ Nunito_700Bold, Nunito_800ExtraBold });

  useEffect(() => {
    const unsub = initAuthListener();
    return unsub;
  }, []);

  useEffect(() => {
    loadThemePreference().then((pref) => applyThemePreference(pref, setColorScheme));
    return watchSystemTheme(setColorScheme);
  }, [setColorScheme]);

  if (!fontsLoaded) {
    return <View className="flex-1 bg-bg dark:bg-bg-dark" />;
  }

  // SafeAreaProvider must wrap everything that calls useSafeAreaInsets
  // (TabBar, AccountMenu, Header, the staging banner below) — on web,
  // react-native-safe-area-context has no native frame to read insets
  // from; without this provider (reading the CSS env(safe-area-inset-*)
  // values app/+html.tsx's viewport-fit=cover makes available) every one
  // of those hooks would silently resolve to zero instead of the real
  // iPhone notch/home-indicator insets.
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />
        {isStaging && <StagingBanner />}
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

function StagingBanner() {
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute', top: 0, left: 0, right: 0, paddingTop: insets.top,
        backgroundColor: '#B45309', paddingBottom: 4, zIndex: 9999,
      }}
    >
      <Text style={{ color: '#fff', textAlign: 'center', fontSize: 11, fontWeight: '700' }}>
        STAGING — {firebaseConfig.projectId} — not real league data
      </Text>
    </View>
  );
}
