import { View, Text, TouchableOpacity } from 'react-native';
import { router, Stack } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { RAW } from '@/lib/theme';
import { Heading, Body, Card, AppIcon } from '@/components/ui';

export default function ChoosePathScreen() {
  const { league, setCaptainPath } = useOnboardingStore();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  function goAsCaptain() {
    setCaptainPath(true);
    router.push('/(protected)/request-captain-role');
  }

  function goAsPlayer() {
    setCaptainPath(false);
    router.push('/(protected)/browse-teams');
  }

  return (
    <View className="flex-1 bg-bg dark:bg-bg-dark justify-center px-5">
      <Stack.Screen options={{ title: league?.name ?? 'Your Role' }} />
      <Card>
        <Heading size="lg" className="mb-1.5">How are you joining?</Heading>
        <Body className="mb-7">{league?.name}</Body>

        {/* Captain */}
        <TouchableOpacity onPress={goAsCaptain} activeOpacity={0.8} className="flex-row items-center rounded-2xl p-5 mb-3 bg-brand dark:bg-brand-dark">
          <View className="w-10 h-10 rounded-full items-center justify-center bg-white/20 mr-3">
            <AppIcon name="trophy" size={20} color="#FFFFFF" />
          </View>
          <View className="flex-1">
            <Text className="text-white text-[17px] font-bold mb-1">I'm a Captain / Vice Captain</Text>
            <Text className="text-white/70 text-[13px]">Find your team and request the role</Text>
          </View>
        </TouchableOpacity>

        {/* Player */}
        <TouchableOpacity onPress={goAsPlayer} activeOpacity={0.8} className="flex-row items-center rounded-2xl p-5 mb-3 bg-surface-2 dark:bg-surface-2-dark">
          <View className="w-10 h-10 rounded-full items-center justify-center bg-brand-fill dark:bg-brand-fill-dark mr-3">
            <AppIcon name="target" size={20} color={isDark ? RAW.brandInkDark : RAW.brandInk} />
          </View>
          <View className="flex-1">
            <Body tone="strong" weight="bold" className="mb-1">I'm a Player</Body>
            <Body size="sm">Find your team and request to join</Body>
          </View>
        </TouchableOpacity>
      </Card>
    </View>
  );
}
