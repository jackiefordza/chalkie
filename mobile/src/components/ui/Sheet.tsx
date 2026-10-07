import type { ReactNode } from 'react';
import { Modal, View, StyleSheet, type ModalProps } from 'react-native';
import { BlurView } from 'expo-blur';
import { useColorScheme } from 'nativewind';
import { Card } from './Card';

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  animationType?: ModalProps['animationType'];
}

export function Sheet({ visible, onClose, children, animationType = 'fade' }: SheetProps) {
  const { colorScheme } = useColorScheme();
  // Same frosted-backdrop technique AccountMenu/TabBar already use (BlurView
  // + a translucent tint layer) rather than a flat black scrim — one
  // consistent "floating surface" language across every overlay in the app.
  return (
    <Modal visible={visible} transparent animationType={animationType} onRequestClose={onClose}>
      <View className="flex-1 justify-center p-6">
        <BlurView intensity={30} tint={colorScheme === 'dark' ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
        <View className="absolute inset-0 bg-black/45" pointerEvents="none" />
        <Card className="rounded-3xl" style={{ maxHeight: '85%' }}>
          {children}
        </Card>
      </View>
    </Modal>
  );
}
