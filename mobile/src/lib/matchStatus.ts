import type { SemanticTone } from '@/lib/theme';
import type { MatchStatus } from '@/types';

// Single source of truth for how a Match['status'] is shown to users —
// previously duplicated (and disagreeing: 'Final' vs 'Confirmed', case
// differences) across HomeDashboard, MatchCentre and admin-fixtures.
export const STATUS_LABEL: Record<MatchStatus, string> = {
  scheduled: 'Scheduled',
  awaiting_confirmation: 'Awaiting Confirmation',
  pending_confirmation: 'Pending Confirmation',
  disputed: 'Disputed',
  confirmed: 'Confirmed',
};

export const STATUS_TONE: Record<MatchStatus, SemanticTone | null> = {
  scheduled: null,
  awaiting_confirmation: 'butter',
  pending_confirmation: 'butter',
  disputed: 'coral',
  confirmed: 'sage',
};

// The "Next Match" hero's call-to-action label (HomeDashboard.tsx's
// NextMatchHero) — derived from the match/submission state actually in
// front of the viewer, never hard-coded off status alone. Own-team-only
// model: at 'scheduled' neither team has submitted yet; `hasSubmitted`
// (does MY OWN team's submissions/{teamId} doc exist) is what tells
// 'awaiting_confirmation' apart into "it's my move" vs "I'm waiting on
// them" — there's nothing to review pre-emptively under this model, so a
// captain who hasn't submitted is always told to enter their own result,
// never to "review" the other side's raw submission (the stale pre-model
// wording this replaces). `hasSubmitted === null` covers the brief window
// before that doc-existence check has resolved.
export function nextMatchCtaLabel(
  status: MatchStatus,
  hasSubmitted: boolean | null,
  opponentName: string,
): string {
  switch (status) {
    case 'scheduled':
      return 'Enter Your Result';
    case 'awaiting_confirmation':
      if (hasSubmitted === false) return 'Enter Your Result';
      if (hasSubmitted === true) return `Waiting on ${opponentName}`;
      return 'View Result';
    case 'disputed':
      return 'Resolve Differences';
    case 'pending_confirmation':
      return 'Review Result';
    case 'confirmed':
      return 'View Result';
  }
}
