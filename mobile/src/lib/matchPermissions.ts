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
