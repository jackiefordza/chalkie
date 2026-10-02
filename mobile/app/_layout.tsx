import '../global.css';
import { useEffect } from 'react';
import { View, Text } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
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

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />
      {isStaging && (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: '#B45309', paddingVertical: 4, zIndex: 9999 }}
        >
          <Text style={{ color: '#fff', textAlign: 'center', fontSize: 11, fontWeight: '700' }}>
            STAGING — {firebaseConfig.projectId} — not real league data
          </Text>
        </View>
      )}
    </GestureHandlerRootView>
  );
}
