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
// own), matching the real enforcement in performMatchResultReset
// (functions/src/index.ts, run from the onAdminTaskCreated trigger), which
// re-checks this server-side via assertLeagueAdmin regardless of what this
// returns. There's nothing to
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
