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
};

export const STATUS_TONE: Record<MatchStatus, SemanticTone | null> = {
  scheduled: null,
  awaiting_confirmation: 'butter',
  disputed: 'coral',
  confirmed: 'sage',
};
