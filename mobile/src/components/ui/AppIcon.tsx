import { Feather, Ionicons } from '@expo/vector-icons';

const FEATHER_ICONS = {
  home: 'home',
  shield: 'shield',
  calendar: 'calendar',
  table: 'bar-chart-2',
  target: 'target',
  warning: 'alert-triangle',
  check: 'check',
  close: 'x',
  zap: 'zap',
  'log-out': 'log-out',
  'trending-up': 'trending-up',
  'chevron-left': 'chevron-left',
  settings: 'settings',
  phone: 'phone',
  sun: 'sun',
  moon: 'moon',
  monitor: 'monitor',
  users: 'users',
  edit: 'edit-3',
} as const;

const IONICONS_ICONS = {
  trophy: 'trophy-outline',
  medal: 'medal-outline',
  flask: 'flask-outline',
} as const;

export type AppIconName = keyof typeof FEATHER_ICONS | keyof typeof IONICONS_ICONS;

interface AppIconProps {
  name: AppIconName;
  size?: number;
  color: string;
}

export function AppIcon({ name, size = 20, color }: AppIconProps) {
  if (name in FEATHER_ICONS) {
    return <Feather name={FEATHER_ICONS[name as keyof typeof FEATHER_ICONS]} size={size} color={color} />;
  }
  return <Ionicons name={IONICONS_ICONS[name as keyof typeof IONICONS_ICONS]} size={size} color={color} />;
}
