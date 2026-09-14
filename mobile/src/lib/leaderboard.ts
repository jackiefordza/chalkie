import type { PlayerSeasonStats } from '@/types';

// Stats Rules audit (Season 1) — the Player Leaderboard's authoritative
// ranking order, and *only* this order:
//   1. total legs won, descending
//   2. total individual games won, descending (PlayerSeasonStats.won —
//      already game-level, not team-match-level; see the type's own comment)
//   3. leg win-percentage, descending
// Win percentage of individual games is never the primary criterion.
//
// Every game always plays all 3 legs (MatchGame.legs is always length 3,
// per the Match type's own comment) — so legs *played* is always
// `played * LEGS_PER_GAME`, not a separately stored/aggregated field.
const LEGS_PER_GAME = 3;

export function legsPlayed(stats: Pick<PlayerSeasonStats, 'played'>): number {
  return stats.played * LEGS_PER_GAME;
}

// Callers must pre-filter to `played > 0` (the leaderboard already does, to
// exclude players with no games yet) — legsPlayed(stats) would otherwise be
// 0 and the final tiebreak below would divide by zero.
export function compareLeaderboard(
  a: Pick<PlayerSeasonStats, 'legsWon' | 'won' | 'played'>,
  b: Pick<PlayerSeasonStats, 'legsWon' | 'won' | 'played'>,
): number {
  return (b.legsWon - a.legsWon)
    || (b.won - a.won)
    || (b.legsWon / legsPlayed(b) - a.legsWon / legsPlayed(a));
}
