import { View, TouchableOpacity } from 'react-native';
import { Body } from './Text';
import type { PhoneVisibility } from '@/types';

const OPTIONS: { value: PhoneVisibility; label: string; description: string }[] = [
  { value: 'private', label: 'Admin only', description: 'Only the league admin can see your number' },
  { value: 'captains', label: 'Captains & VCs', description: 'Captains and vice captains can contact you' },
  { value: 'public', label: 'All players', description: 'All registered players in your team can see it' },
];

interface VisibilityPickerProps {
  value: PhoneVisibility;
  onChange: (value: PhoneVisibility) => void;
}

export function VisibilityPicker({ value, onChange }: VisibilityPickerProps) {
  return (
    <View className="gap-2">
      {OPTIONS.map((opt) => {
        const selected = value === opt.value;
        return (
          <TouchableOpacity
            key={opt.value}
            onPress={() => onChange(opt.value)}
            activeOpacity={0.7}
            className={[
              'flex-row items-center min-h-[44px] p-3 rounded-2xl',
              selected ? 'bg-brand-fill dark:bg-brand-fill-dark' : 'bg-surface-2 dark:bg-surface-2-dark',
            ].join(' ')}
          >
            <View
              className={[
                'w-5 h-5 rounded-full mr-3 border-2 items-center justify-center',
                selected ? 'border-brand-ink dark:border-brand-ink-dark' : 'border-border dark:border-border-dark',
              ].join(' ')}
            >
              {selected && <View className="w-2.5 h-2.5 rounded-full bg-brand dark:bg-brand-dark" />}
            </View>
            <View className="flex-1">
              <Body tone="strong" weight="semibold">{opt.label}</Body>
              <Body size="xs" className="mt-0.5">{opt.description}</Body>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
