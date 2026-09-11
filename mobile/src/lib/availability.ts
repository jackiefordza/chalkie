import type { SemanticTone } from '@/lib/theme';
import type { AvailabilityStatus, MatchStatus } from '@/types';

export const AVAILABILITY_LABEL: Record<AvailabilityStatus, string> = {
  available: 'Available',
  unavailable: 'Unavailable',
  unsure: 'Not Sure',
};

export const AVAILABILITY_TONE: Record<AvailabilityStatus, SemanticTone> = {
  available: 'sage',
  unavailable: 'coral',
  unsure: 'butter',
};

// One doc per player per match — never per team, and never a lineup (see
// the Availability comment in src/types/index.ts).
export function availabilityDocId(matchId: string, playerId: string): string {
  return `${matchId}_${playerId}`;
}

// Availability is only meaningful for a fixture that's genuinely upcoming
// and unplayed. Once it's postponed/cancelled there's no date to be
// available for (see matchStatus.ts's isFixtureException); once it's
// awaiting_confirmation/disputed/confirmed the match has already been
// played. A rescheduled fixture returns to 'scheduled' and becomes
// actionable again automatically — no separate case needed here.
export function isAvailabilityActionable(status: MatchStatus): boolean {
  return status === 'scheduled';
}
