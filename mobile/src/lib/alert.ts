import { Alert as NativeAlert, Platform } from 'react-native';

type AlertButtonStyle = 'default' | 'cancel' | 'destructive';

interface AlertButton {
  text?: string;
  style?: AlertButtonStyle;
  onPress?: () => void;
}

// react-native-web's own Alert.alert is a no-op — every confirm dialog and
// every error message silently did nothing on the desktop admin console
// (Delete Team/Season/Division/Player, Reject request, "Something went
// wrong", etc.) because the button callbacks it's given are never invoked.
// Native platforms still get the real Alert; web falls back to
// window.confirm/alert, which actually shows something and calls the right
// button's onPress.
function alert(title: string, message?: string, buttons?: AlertButton[]): void {
  if (Platform.OS !== 'web') {
    NativeAlert.alert(title, message, buttons as never);
    return;
  }

  const text = message ? `${title}\n\n${message}` : title;
  const list = buttons && buttons.length > 0 ? buttons : undefined;

  if (!list || list.length < 2) {
    window.alert(text);
    list?.[0]?.onPress?.();
    return;
  }

  const cancelButton = list.find((b) => b.style === 'cancel');
  const actionButton = list.find((b) => b !== cancelButton) ?? list[list.length - 1];

  if (window.confirm(text)) {
    actionButton.onPress?.();
  } else {
    cancelButton?.onPress?.();
  }
}

export const Alert = { alert };
