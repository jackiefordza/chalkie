import { forwardRef, type ReactNode } from 'react';
import { View, TextInput, Text, type TextInputProps } from 'react-native';
import { useColorScheme } from 'nativewind';
import { FONT_BODY } from '@/styles/typography';
import { RAW } from '@/lib/theme';
import { Caption } from './Text';

export function Label({ children }: { children: ReactNode }) {
  return <Caption className="mb-2">{children}</Caption>;
}

interface InputProps extends TextInputProps {
  error?: string;
  className?: string;
}

export const Input = forwardRef<TextInput, InputProps>(function Input(
  { error, className = '', style, ...rest },
  ref,
) {
  const { colorScheme } = useColorScheme();
  const placeholderColor = colorScheme === 'dark' ? RAW.textFaintDark : RAW.textFaint;

  return (
    <View>
      <TextInput
        ref={ref}
        className={[
          'rounded-xl px-3.5 py-3 text-[15px] bg-surface-2 dark:bg-surface-2-dark text-text dark:text-text-dark',
          error ? 'border-2 border-coral-ink dark:border-coral-ink-dark' : '',
          className,
        ].join(' ')}
        placeholderTextColor={placeholderColor}
        style={[{ fontFamily: FONT_BODY }, style]}
        {...rest}
      />
      {error ? <Text className="text-[12px] mt-1.5 text-coral-ink dark:text-coral-ink-dark">{error}</Text> : null}
    </View>
  );
});
