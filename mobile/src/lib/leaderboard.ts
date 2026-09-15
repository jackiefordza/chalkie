import type { PlayerSeasonStats } from '@/types';

// Stats Rules audit (Season 1, corrected) — the Player Leaderboard's
// authoritative ranking order, and *only* this order:
//   1. League legs won, descending
//   2. League individual games won, descending (PlayerSeasonStats.
//      leagueGamesWon — already game-level, not team-match-level)
//   3. League leg win-percentage, descending (leagueLegsWon / leagueLegsPlayed)
// Win percentage of individual games is never the primary criterion.
//
// The Players Leaderboard is STRICTLY League-only — TKO and Friendly results
// have zero effect on it. leagueLegsWon/leagueLegsPlayed/leagueGamesWon/
// leagueGamesPlayed are separate, additive counters gated on
// competitionType === 'league' alone (see computePlayerAccum in
// functions/src/index.ts, the only place this is enforced) — they are NOT
// derived from the season-wide legsWon/won/played fields, which remain
// League + TKO combined for the season achievement totals (180s, high
// checkouts) and are never read here.
//
// Callers must pre-filter to `leagueLegsPlayed > 0` (a player who has only
// played TKO/Friendly matches has leagueLegsPlayed === 0 and must be
// excluded before sorting — the final tiebreak below would otherwise divide
// by zero).
export function compareLeaderboard(
  a: Pick<PlayerSeasonStats, 'leagueLegsWon' | 'leagueGamesWon' | 'leagueLegsPlayed'>,
  b: Pick<PlayerSeasonStats, 'leagueLegsWon' | 'leagueGamesWon' | 'leagueLegsPlayed'>,
): number {
  return (b.leagueLegsWon - a.leagueLegsWon)
    || (b.leagueGamesWon - a.leagueGamesWon)
    || (b.leagueLegsWon / b.leagueLegsPlayed - a.leagueLegsWon / a.leagueLegsPlayed);
}
