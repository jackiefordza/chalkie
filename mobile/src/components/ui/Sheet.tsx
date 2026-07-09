import type { ReactNode } from 'react';
import { Modal, View, type ModalProps } from 'react-native';
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
        <Card className="rounded-3xl" style={{ maxHeight: '85%' }}>
          {children}
        </Card>
      </View>
    </Modal>
  );
}
