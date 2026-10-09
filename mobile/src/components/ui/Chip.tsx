import type { ReactNode } from 'react';
import { TouchableOpacity, Text, type TouchableOpacityProps } from 'react-native';
import { toneClasses, type SemanticTone } from '@/lib/theme';

interface ChipProps extends Omit<TouchableOpacityProps, 'children'> {
  selected?: boolean;
  label?: string;
  tone?: SemanticTone;
  children?: ReactNode;
  className?: string;
}

export function Chip({ selected = false, label, tone = 'brand', children, className = '', ...rest }: ChipProps) {
  const { fill, ink } = toneClasses(tone);
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      className={[
        'rounded-full px-4 py-2.5 min-h-[44px] items-center justify-center flex-row',
        // Unselected reads as a recessed track (inset surface + hairline)
        // rather than just a flatter fill — the selected pill then pops
        // out of that groove instead of merely swapping colour.
        selected ? fill : 'bg-surface-inset dark:bg-surface-inset-dark border border-inset-border dark:border-inset-border-dark',
        className,
      ].join(' ')}
      {...rest}
    >
      {label ? (
        <Text className={`font-semibold text-[13px] ${selected ? ink : 'text-text-dim dark:text-text-dim-dark'}`}>
          {label}
        </Text>
      ) : (
        children
      )}
    </TouchableOpacity>
  );
}
