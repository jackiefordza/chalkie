import { TouchableOpacity, Text } from 'react-native';
import { useColorScheme } from 'nativewind';
import { goBack } from '@/lib/navigation';
import { RAW } from '@/lib/theme';

interface BackButtonProps {
  fallback?: string;
}

export function BackButton({ fallback }: BackButtonProps) {
  const { colorScheme } = useColorScheme();
  const color = colorScheme === 'dark' ? RAW.brandDark : RAW.brand;

  return (
    <TouchableOpacity onPress={() => goBack(fallback)} activeOpacity={0.7} hitSlop={12} style={{ paddingRight: 12 }}>
      <Text style={{ color, fontSize: 16 }}>‹ Back</Text>
    </TouchableOpacity>
  );
}
