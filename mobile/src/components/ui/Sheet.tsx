import type { ReactNode } from 'react';
import { Modal, View, ScrollView, type ModalProps } from 'react-native';
import { Card } from './Card';

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  animationType?: ModalProps['animationType'];
}

export function Sheet({ visible, onClose, children, animationType = 'fade' }: SheetProps) {
  return (
    <Modal visible={visible} transparent animationType={animationType} onRequestClose={onClose}>
      <View className="flex-1 bg-black/60 justify-center p-6">
        <Card className="rounded-3xl overflow-hidden" padded={false} style={{ maxHeight: '85%' }}>
          <ScrollView contentContainerClassName="p-5" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
        </Card>
      </View>
    </Modal>
  );
}
