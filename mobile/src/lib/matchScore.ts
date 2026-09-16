import type { Match } from '@/types';

// A confirmed match's result from one specific team's point of view.
//
// THREE distinct concepts live on Match, and mixing them up is exactly the
// bug this helper exists to prevent:
//  - MATCH SCORE (legsFor/legsAgainst) — total legs won across all 7 games,
//    e.g. 12-9. This is "the score" when someone says "what was the match?"
//  - TEAM MATCH RECORD (gamesFor/gamesAgainst) — individual games won,
//    e.g. 4-3. This decides who won the match and seeds the league table,
//    but it is NOT the match score and must always be labeled as games.
//  - An individual player's own game score (e.g. 2-1) is a different concept
//    again — see computePlayerSinglesGames in playerMatchHistory.ts.
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
