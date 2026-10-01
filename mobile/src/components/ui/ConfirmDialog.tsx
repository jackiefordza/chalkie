import { useState } from 'react';
import { View } from 'react-native';
import { Sheet } from './Sheet';
import { Heading, Body } from './Text';
import { Button, type ButtonVariant } from './Button';
import { Card } from './Card';

interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  // 'danger' for a destructive/irreversible action (Reset, Reject, Dispute),
  // 'primary' for one that isn't (Admin Override still writes real data, but
  // isn't a deletion) — callers choose per-action.
  confirmVariant?: ButtonVariant;
  // When set, a success screen with this text is shown after onConfirm
  // resolves, and onSuccess only fires once the user acknowledges it. When
  // omitted, onSuccess fires immediately on success (e.g. Dispute/Reject,
  // where the live Firestore listener re-rendering the underlying screen is
  // already the feedback).
  successMessage?: string;
  onConfirm: () => Promise<void> | void;
  // Dialog dismissed without the action completing — initial Cancel, or
  // dismissing after a failed attempt. Nothing changed; the host just hides
  // the dialog.
  onCancel: () => void;
  // The action completed, and (if successMessage was given) the user has
  // acknowledged it. The host hides the dialog and performs any post-success
  // side effect (e.g. navigating back) here.
  onSuccess: () => void;
}

// Cross-platform replacement for an Alert.alert(...) confirmation. RN's
// Modal (which Sheet wraps) renders correctly on react-native-web; Alert.alert
// itself is a documented no-op there (`static alert() {}`), which silently
// broke every confirm-then-act flow built on it when opened in a browser.
//
// Guards against duplicate submissions — a native Alert only ever showed one
// dialog with one tap possible, but a web button is exposed to a double
// click or a second tap landing before re-render — by tracking its own
// phase: a confirm press is a no-op unless phase === 'idle'.
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'primary',
  successMessage,
  onConfirm,
  onCancel,
  onSuccess,
}: ConfirmDialogProps) {
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setPhase('idle');
    setError(null);
  }

  function handleCancel() {
    if (phase === 'submitting') return; // can't dismiss mid-write
    reset();
    onCancel();
  }

  function handleAcknowledgeSuccess() {
    reset();
    onSuccess();
  }

  async function handleConfirm() {
    if (phase !== 'idle') return; // already submitting, or already resolved — ignore repeat taps/clicks
    setPhase('submitting');
    try {
      await onConfirm();
      if (successMessage) {
        setPhase('success');
      } else {
        reset();
        onSuccess();
      }
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Something went wrong');
      setPhase('error');
    }
  }

  return (
    <Sheet visible={visible} onClose={phase === 'success' ? handleAcknowledgeSuccess : handleCancel}>
      {phase === 'success' ? (
        <>
          <Heading size="lg" className="mb-2">Done</Heading>
          <Body size="sm" className="mb-5">{successMessage}</Body>
          <Button className="w-full" onPress={handleAcknowledgeSuccess}>OK</Button>
        </>
      ) : (
        <>
          <Heading size="lg" className="mb-2">{title}</Heading>
          <Body size="sm" className="mb-5">{message}</Body>
          {phase === 'error' && (
            <Card tone="coral" className="mb-4">
              <Body size="sm" tone="coral">{error}</Body>
            </Card>
          )}
          <View className="flex-row gap-2.5">
            <Button variant="ghost" className="flex-1" disabled={phase === 'submitting'} onPress={handleCancel}>
              {cancelLabel}
            </Button>
            <Button
              variant={confirmVariant}
              className="flex-1"
              disabled={phase === 'submitting'}
              loading={phase === 'submitting'}
              onPress={handleConfirm}
            >
              {phase === 'error' ? 'Try Again' : confirmLabel}
            </Button>
          </View>
        </>
      )}
    </Sheet>
  );
}
