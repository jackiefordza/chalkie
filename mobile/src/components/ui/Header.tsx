import { View, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FONT_DISPLAY_EXTRABOLD } from '@/styles/typography';
import { HeaderAvatar } from './AppHeader';

interface HeaderProps {
  contextLine?: string | null;
}

// Phase E, Step 2 — the quiet Home V1 header (see the Step 1 audit's §4/§5:
// the old native Tabs header carries no league/division/season context, and
// every screen's top area is otherwise ad hoc). Deliberately no card, no
// glass, no border — sits directly on Home's own background, exactly the
// "content layer, not a control surface" split the Phase E brief draws.
// Currently only rendered by HomeDashboard (home.tsx/captain.tsx hide the
// native header specifically for this reason — see (tabs)/_layout.tsx);
// built as a real reusable component, per the brief, for other screens to
// adopt in a later phase rather than being redesigned now.
export function Header({ contextLine }: HeaderProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={{ paddingTop: insets.top + 12, paddingBottom: 12, paddingHorizontal: 20 }} className="flex-row items-center justify-between">
      <View className="flex-1 mr-3">
        <Text
          className="text-[15px] text-home-text tracking-wide"
          style={{ fontFamily: FONT_DISPLAY_EXTRABOLD }}
        >
          CHALKIE
        </Text>
        {contextLine ? (
          <Text className="text-[12px] text-home-text-dim mt-0.5" numberOfLines={1}>
            {contextLine}
          </Text>
        ) : null}
      </View>
      <HeaderAvatar />
    </View>
  );
}
