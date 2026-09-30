import type { AppUser, Match } from '@/types';

// Mirrors firestore.rules' isAdminFor(): a global admin may act on any
// league; a league admin only on their own leagueId. Admin sign-off is
// additionally restricted to a match that is actually awaiting confirmation
// — an admin has no reason (and this feature grants no ability) to touch a
// scheduled, disputed, or already-confirmed match.
export function canSignOffMatch(
  appUser: Pick<AppUser, 'isLeagueAdmin' | 'isGlobalAdmin' | 'leagueId'> | null | undefined,
  match: Pick<Match, 'leagueId' | 'status'> | null | undefined,
): boolean {
  if (!appUser || !match) return false;
  if (match.status !== 'awaiting_confirmation') return false;
  if (appUser.isGlobalAdmin) return true;
  return appUser.isLeagueAdmin && appUser.leagueId === match.leagueId;
}

// Client-side gate for showing the "Reset Result" action — mirrors the same
// isAdminFor() scoping (global admin any league; league admin only their
// own), matching the real enforcement in the adminResetMatchResult callable
// (functions/src/index.ts), which re-checks this server-side via
// assertLeagueAdmin regardless of what this returns. There's nothing to
// reset on a fixture that hasn't been touched yet.
export function canResetMatch(
  appUser: Pick<AppUser, 'isLeagueAdmin' | 'isGlobalAdmin' | 'leagueId'> | null | undefined,
  match: Pick<Match, 'leagueId' | 'status'> | null | undefined,
): boolean {
  if (!appUser || !match) return false;
  if (match.status === 'scheduled') return false;
  if (appUser.isGlobalAdmin) return true;
  return appUser.isLeagueAdmin && appUser.leagueId === match.leagueId;
}

// Client-side gate for the Confirm / Dispute actions on a reconciled match —
// mirrors the real enforcement: firestore.rules' confirmations/{teamId}
// create rule for Confirm, and the disputeMatch callable's own check
// (functions/src/index.ts) for Dispute. Both require the match to actually
// be pending_confirmation and the viewer to be a captain/VC of one of its
// two teams — there's nothing to confirm or dispute otherwise.
export function canActOnPendingConfirmation(
  appUser: Pick<AppUser, 'role' | 'teamId'> | null | undefined,
  match: Pick<Match, 'homeTeamId' | 'awayTeamId' | 'status'> | null | undefined,
): boolean {
  if (!appUser || !match) return false;
  if (match.status !== 'pending_confirmation') return false;
  if (appUser.role !== 'captain' && appUser.role !== 'viceCaptain') return false;
  return appUser.teamId === match.homeTeamId || appUser.teamId === match.awayTeamId;
}
