import { View } from 'react-native';
import { Body } from './Text';

export function FormBadge({ result }: { result: 'W' | 'L' }) {
  const isWin = result === 'W';
  return (
    <View className={`w-6 h-6 rounded-full items-center justify-center ${isWin ? 'bg-sage-fill dark:bg-sage-fill-dark' : 'bg-coral-fill dark:bg-coral-fill-dark'}`}>
      <Body size="sm" weight="bold" tone={isWin ? 'sage' : 'coral'}>{result}</Body>
    </View>
  );
}
