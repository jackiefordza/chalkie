import type { SemanticTone } from '@/lib/theme';
import type { MatchStatus } from '@/types';

// Single source of truth for how a Match['status'] is shown to users —
// previously duplicated (and disagreeing: 'Final' vs 'Confirmed', case
// differences) across HomeDashboard, MatchCentre and admin-fixtures.
export const STATUS_LABEL: Record<MatchStatus, string> = {
  scheduled: 'Scheduled',
  awaiting_confirmation: 'Awaiting Confirmation',
  disputed: 'Disputed',
  confirmed: 'Confirmed',
  postponed: 'Postponed',
  cancelled: 'Cancelled',
};

export const STATUS_TONE: Record<MatchStatus, SemanticTone | null> = {
  scheduled: null,
  awaiting_confirmation: 'butter',
  disputed: 'coral',
  confirmed: 'sage',
  postponed: 'butter',
  cancelled: 'coral',
};

// A match in either of these states is an admin-declared exception — it
// will never receive a result through the normal submission pipeline (the
// Firestore rules independently block writes against both), so every
// screen that lists "upcoming"/"needs action" fixtures or offers "Enter
// Result" must exclude them explicitly rather than relying on the older
// `status !== 'confirmed'` shorthand, which would otherwise still catch
// them. Single source of truth so this can't drift between screens.
export function isFixtureException(status: MatchStatus): boolean {
  return status === 'postponed' || status === 'cancelled';
}
