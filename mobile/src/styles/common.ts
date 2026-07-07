import type { ViewStyle, TextStyle } from 'react-native';

export const GRADIENT = ['#0f0c29', '#302b63', '#24243e'] as const;

export const glassCard: ViewStyle = {
  backgroundColor: 'rgba(255,255,255,0.08)',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.15)',
  borderRadius: 20,
  padding: 24,
};

export const input: ViewStyle & TextStyle = {
  backgroundColor: 'rgba(255,255,255,0.1)',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.3)',
  borderRadius: 12,
  padding: 14,
  fontSize: 16,
  color: '#FFFFFF',
};

export const label: TextStyle = {
  color: 'rgba(255,255,255,0.6)',
  fontSize: 13,
  marginBottom: 8,
  fontWeight: '500',
};

export const primaryButton: ViewStyle = {
  backgroundColor: '#007AFF',
  borderRadius: 14,
  paddingVertical: 16,
  alignItems: 'center',
};

export const primaryButtonDisabled: ViewStyle = {
  backgroundColor: 'rgba(0,122,255,0.4)',
  borderRadius: 14,
  paddingVertical: 16,
  alignItems: 'center',
};

export const primaryButtonText: TextStyle = {
  color: '#FFFFFF',
  fontSize: 17,
  fontWeight: '600',
};

export const errorBox: ViewStyle = {
  backgroundColor: 'rgba(255,59,48,0.15)',
  borderWidth: 1,
  borderColor: 'rgba(255,59,48,0.4)',
  borderRadius: 12,
  padding: 12,
  marginBottom: 16,
};

// A tappable "chip"/box for compact controls (score pickers, toggles, tags).
// Meets the ~44pt minimum tap target and uses a stronger border/fill than
// plain text so it reads as tappable at a glance, not just as a label.
export const tapBox: ViewStyle = {
  minHeight: 44,
  minWidth: 44,
  borderRadius: 10,
  borderWidth: 1.5,
  borderColor: 'rgba(255,255,255,0.3)',
  backgroundColor: 'rgba(255,255,255,0.10)',
  alignItems: 'center',
  justifyContent: 'center',
};

export const tapBoxSelected: ViewStyle = {
  borderColor: '#007AFF',
  backgroundColor: 'rgba(0,122,255,0.25)',
};

export const WHITE = '#FFFFFF';
export const WHITE_80 = 'rgba(255,255,255,0.8)';
export const WHITE_60 = 'rgba(255,255,255,0.6)';
export const WHITE_50 = 'rgba(255,255,255,0.5)';
export const WHITE_30 = 'rgba(255,255,255,0.3)';
export const BLUE = '#007AFF';
export const RED = '#FF6B6B';
export const GREEN = '#34C759';
export const ORANGE = '#FF9500';
