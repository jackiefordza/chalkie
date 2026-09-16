import type { Match } from '@/types';

// The one shared definition of "recent form" for a team — most recent
// confirmed results, oldest to newest, W/L per match decided the same way
// standings are (games won, not legs — see matchScore.ts). Only confirmed
// matches ever count: a scheduled/awaiting/disputed fixture is not a result
// yet, so it's never included even if it sorts into the most recent slots.
//
// `matches` must already be filtered to the team in question (typically via
// the Firestore query that fetched them) — this function doesn't re-filter
// by participant, only by status, so passing an unrelated team's matches
// will produce nonsense. See resolveOpponentInfo in opponentInfo.ts for the
// caller that has to get this scoping right for an opponent team.
export function recentForm(matches: Match[], teamId: string, count = 3): ('W' | 'L')[] {
  return matches
    .filter((m) => m.status === 'confirmed')
    .slice(-count)
    .map((m): 'W' | 'L' => {
      const isHome = m.homeTeamId === teamId;
      const won = isHome ? (m.homeGamesWon ?? 0) > (m.awayGamesWon ?? 0) : (m.awayGamesWon ?? 0) > (m.homeGamesWon ?? 0);
      return won ? 'W' : 'L';
    });
}
