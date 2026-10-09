import { View, Image, Text, TouchableOpacity, Linking } from 'react-native';
import type { LeagueSponsor } from '@/types';

interface SponsorStripProps {
  sponsor: LeagueSponsor | null | undefined;
  // "League" or a division's own name — used only for the accessibility
  // label ("Sponsored by X — League") and ignored visually; kept tiny and
  // optional rather than printing "League Sponsor" as a second caption,
  // which would compete with the division/league heading already above it
  // wherever this renders.
  context?: string;
  className?: string;
}

// Renders nothing at all when there's no sponsor set — never a placeholder
// "no sponsor" state, since that would read as broken/empty UI on every
// division that genuinely has none (Division 4, per the brief). Logo-first
// when a logoUrl is actually set; otherwise a plain text pill — never an
// invented or placeholder logo image. Deliberately quiet (small, muted,
// bordered pill) rather than a banner ad — sponsorship integrated into the
// product's own chrome, not an interruption of it.
export function SponsorStrip({ sponsor, context, className = '' }: SponsorStripProps) {
  if (!sponsor?.name) return null;

  const body = (
    <View
      className={`flex-row items-center gap-2 self-start rounded-full border border-border dark:border-border-dark bg-surface-2/60 dark:bg-surface-2-dark/60 px-3 py-1.5 ${className}`}
      accessibilityLabel={`Sponsored by ${sponsor.name}${context ? ` — ${context}` : ''}`}
    >
      {sponsor.logoUrl ? (
        <Image source={{ uri: sponsor.logoUrl }} style={{ width: 16, height: 16, borderRadius: 3 }} resizeMode="contain" />
      ) : null}
      <Text className="text-[11px] font-semibold text-text-dim dark:text-text-dim-dark" numberOfLines={1}>
        Sponsored by <Text className="font-bold text-text dark:text-text-dark">{sponsor.name}</Text>
      </Text>
    </View>
  );

  if (!sponsor.websiteUrl) return body;
  return (
    <TouchableOpacity activeOpacity={0.7} onPress={() => Linking.openURL(sponsor.websiteUrl!)}>
      {body}
    </TouchableOpacity>
  );
}
