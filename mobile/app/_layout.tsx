import '../global.css';
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { initAuthListener } from '@/stores/authStore';

export default function RootLayout() {
  useEffect(() => {
    const unsub = initAuthListener();
    return unsub;
  }, []);

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />
    </>
  );
}
