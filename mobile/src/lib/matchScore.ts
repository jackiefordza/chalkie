import type { Match } from '@/types';

// A confirmed match's result from one specific team's point of view.
//
// THREE distinct concepts live on Match, and mixing them up is exactly the
// bug this helper exists to prevent:
//  - MATCH SCORE (legsFor/legsAgainst) — total legs won across all 7 games,
//    e.g. 12-9. This is "the score" when someone says "what was the match?"
//  - GAMES (gamesFor/gamesAgainst) — individual games won WITHIN this one
//    match, e.g. 4-3 (always sums to 7). This decides who won the match and
//    seeds the league table, but it is NOT the match score and must always
//    be labeled as games.
//  - An individual player's own game score (e.g. 2-1) is a different concept
//    again — see computePlayerSinglesGames in playerMatchHistory.ts.
//
// A FOURTH, unrelated concept lives on DivisionTable, not Match — see
// formatTeamRecord below: a team's SEASON-LONG record of MATCHES (not
// individual games) won and lost, e.g. "W4 · L2" after 6 matches played.
// Never confuse this with the per-match GAMES figure above — "4-3 games in
// this one match" and "W4 · L2 matches across the season" can both be true
// at once and mean completely different things.
export interface TeamMatchScore {
  won: boolean;
  legsFor: number;
  legsAgainst: number;
  gamesFor: number;
  gamesAgainst: number;
}

type ScoredMatch = Pick<
  Match,
  'homeTeamId' | 'homeGamesWon' | 'awayGamesWon' | 'homeLegsWon' | 'awayLegsWon'
>;

// Null for a match with no result yet (any of the four totals unset) —
// callers should already be gating on match.status === 'confirmed', but this
// guards against calling it too early regardless.
export function teamMatchScore(match: ScoredMatch, teamId: string): TeamMatchScore | null {
  if (
    match.homeGamesWon == null || match.awayGamesWon == null
    || match.homeLegsWon == null || match.awayLegsWon == null
  ) {
    return null;
  }
  const isHome = match.homeTeamId === teamId;
  const gamesFor = isHome ? match.homeGamesWon : match.awayGamesWon;
  const gamesAgainst = isHome ? match.awayGamesWon : match.homeGamesWon;
  const legsFor = isHome ? match.homeLegsWon : match.awayLegsWon;
  const legsAgainst = isHome ? match.awayLegsWon : match.homeLegsWon;
  return { won: gamesFor > gamesAgainst, legsFor, legsAgainst, gamesFor, gamesAgainst };
}

// A team's season-long record of MATCHES won/lost (DivisionTable.won/lost —
// NOT Match.homeGamesWon/awayGamesWon, a different per-match figure — see
// the file header). Always explicit "W{n} · L{n}", never a bare "4-2":
// unprefixed, that reads identically to a match score or individual game
// score, which is exactly the ambiguity this format exists to remove.
export function formatTeamRecord(won: number, lost: number): string {
  return `W${won} · L${lost}`;
}
