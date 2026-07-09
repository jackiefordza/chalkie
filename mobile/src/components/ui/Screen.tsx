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
}

export function Screen({ children, scroll = true, contentClassName = '', contentContainerStyle, header }: ScreenProps) {
  // Floating tab bar overlays content — 0 outside a tabs screen (context is unset there)
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? 0;

  if (!scroll) {
    return (
      <View className="flex-1 bg-bg dark:bg-bg-dark">
        {header}
        <View className={`flex-1 ${contentClassName}`} style={{ paddingBottom: tabBarHeight }}>
          {children}
        </View>
      </View>
    );
  }
  return (
    <View className="flex-1 bg-bg dark:bg-bg-dark">
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
