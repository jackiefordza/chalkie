import type { ReactNode } from 'react';
import { Modal, View, ScrollView, type ModalProps } from 'react-native';
import { Card } from './Card';

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  animationType?: ModalProps['animationType'];
}

// MW-003: Card has no scroll/overflow handling of its own (by design, so it
// stays a plain reusable container everywhere else it's used) — Sheet's own
// maxHeight only clamps the box, it doesn't clip or scroll what's inside.
// On a small phone with the keyboard open, content taller than the visible
// sheet could render past its edges with no way to reach it, since the web
// build disables body scroll as a fallback. Wrapping children in a
// ScrollView here fixes every Sheet-based form at once (checkout entry,
// admin team/fixture/standings sheets) without any caller needing its own.
export function Sheet({ visible, onClose, children, animationType = 'fade' }: SheetProps) {
  return (
    <Modal visible={visible} transparent animationType={animationType} onRequestClose={onClose}>
      <View className="flex-1 bg-black/60 justify-center p-6">
        <Card className="rounded-3xl" padded={false} style={{ maxHeight: '85%', overflow: 'hidden' }}>
          <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </Card>
      </View>
    </Modal>
  );
}
