import type { CompetitionType } from '@/types';

// Single source of truth for how a Match['competitionType'] is labeled —
// same convention as matchStatus.ts's STATUS_LABEL. A match written before
// this field existed (or with no value at all) is treated as 'league' by
// every reader in this app already (see types/index.ts's own comment on
// CompetitionType) — this map covers exactly the three values that exist
// today. 'league' is deliberately the only one with no badge tone: it's
// the default, unremarkable case: a cup/knockout or friendly fixture is
// the one worth calling out at a glance.
export const COMPETITION_TYPE_LABEL: Record<CompetitionType, string> = {
  league: 'League',
  tko: 'Cup',
  friendly: 'Friendly',
};

export function competitionTypeLabel(type: CompetitionType | undefined | null): string {
  return COMPETITION_TYPE_LABEL[type ?? 'league'];
}

// Only 'league' renders as plain/no badge in the UI components that use
// this — everything else (including any future addition here) is treated
// as worth a visible, distinct badge.
export function isNotableCompetitionType(type: CompetitionType | undefined | null): boolean {
  return (type ?? 'league') !== 'league';
}
