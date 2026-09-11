import type { ReactNode } from 'react';
import { useContext } from 'react';
import { View, ScrollView, type ScrollViewProps } from 'react-native';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';

interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
  contentClassName?: string;
  contentContainerStyle?: ScrollViewProps['contentContainerStyle'];
  header?: ReactNode;
  // Overrides the outer wrapper's background — every existing call site
  // leaves this unset and gets the exact same 'bg-bg dark:bg-bg-dark' as
  // before. Added for the Home V1 prototype (Phase E, Step 2), whose fixed
  // dark palette doesn't follow the app-wide light/dark toggle.
  backgroundClassName?: string;
}

export function Screen({
  children, scroll = true, contentClassName = '', contentContainerStyle, header, backgroundClassName = 'bg-bg dark:bg-bg-dark',
}: ScreenProps) {
  // Floating tab bar overlays content — 0 outside a tabs screen (context is unset there)
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? 0;

  if (!scroll) {
    return (
      <View className={`flex-1 ${backgroundClassName}`}>
        {header}
        <View className={`flex-1 ${contentClassName}`} style={{ paddingBottom: tabBarHeight }}>
          {children}
        </View>
      </View>
    );
  }
  return (
    <View className={`flex-1 ${backgroundClassName}`}>
      {header}
      <ScrollView
        className={contentClassName}
        contentContainerStyle={[{ padding: 20, paddingBottom: 20 + tabBarHeight }, contentContainerStyle]}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </View>
  );
}
