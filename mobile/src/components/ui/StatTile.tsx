import { View } from 'react-native';
import { Stat, Caption } from './Text';
import type { SemanticTone } from '@/lib/theme';

interface StatTileProps {
  label: string;
  value: string | number;
  // Phase E, Step 5: no default tone any more — amber is a semantic warning
  // colour, not a decorative default for "some stat or other". A tile with
  // no explicit tone renders in neutral ink; pass one only when the figure
  // itself carries real semantic meaning (a positive/negative/warning
  // status), not just because it's a number.
  tone?: SemanticTone;
  className?: string;
}

export function StatTile({ label, value, tone, className = '' }: StatTileProps) {
  // Inset/recessed rather than the general "elevated" surface-2 tile — a
  // stat counter reads as a tactile, pressed-in readout, not a raised
  // card. The hairline border sells the groove edge in light mode; in
  // dark mode it's a dark seam rather than a light highlight (see theme.ts).
  return (
    <View className={`rounded-2xl bg-surface-inset dark:bg-surface-inset-dark border border-inset-border dark:border-inset-border-dark p-4 items-center ${className}`}>
      <Stat tone={tone}>{value}</Stat>
      <Caption className="mt-1">{label}</Caption>
    </View>
  );
}
