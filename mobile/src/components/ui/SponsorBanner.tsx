import { View, TouchableOpacity, Image, Linking } from 'react-native';
import { Card } from './Card';
import { Caption, Body } from './Text';
import type { LeagueSponsor } from '@/types';

interface SponsorBannerProps {
  sponsor: LeagueSponsor | null | undefined;
  className?: string;
}

// Single reusable placement for the league's one primary sponsor (Phase 10)
// — renders nothing for a missing/inactive sponsor, so call sites can drop
// this in unconditionally. Deliberately plain: a logo, a name, optionally
// tappable through to their site — league branding, not an ad unit.
export function SponsorBanner({ sponsor, className = '' }: SponsorBannerProps) {
  if (!sponsor || !sponsor.active) return null;

  const inner = (
    <View className="flex-row items-center gap-3">
      {sponsor.logoUrl ? (
        <Image source={{ uri: sponsor.logoUrl }} style={{ width: 36, height: 36, borderRadius: 8 }} resizeMode="contain" />
      ) : null}
      <View className="flex-1">
        <Caption>Proudly sponsored by</Caption>
        <Body size="sm" tone="strong" weight="semibold" numberOfLines={1}>{sponsor.name}</Body>
      </View>
    </View>
  );

  return (
    <Card className={className}>
      {sponsor.websiteUrl ? (
        <TouchableOpacity activeOpacity={0.7} onPress={() => Linking.openURL(sponsor.websiteUrl!)}>
          {inner}
        </TouchableOpacity>
      ) : inner}
    </Card>
  );
}
