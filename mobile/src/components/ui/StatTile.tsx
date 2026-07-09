import { View } from 'react-native';
import { Stat, Caption } from './Text';
import type { SemanticTone } from '@/lib/theme';

interface StatTileProps {
  label: string;
  value: string | number;
  tone?: SemanticTone;
  className?: string;
}

export function StatTile({ label, value, tone = 'butter', className = '' }: StatTileProps) {
  return (
    <View className={`rounded-2xl bg-surface-2 dark:bg-surface-2-dark p-4 items-center ${className}`}>
      <Stat tone={tone}>{value}</Stat>
      <Caption className="mt-1">{label}</Caption>
    </View>
  );
}
