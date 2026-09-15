import type { Match, MatchGame } from '@/types';

export interface PlayerGameResult {
  match: Match;
  won: boolean;
  legsWon: number;
  legsLost: number;
}

// This player's personal singles-game outcomes across a set of confirmed
// matches — player-profile.tsx's Recent Form and Match History both derive
// from this. Doubles are deliberately excluded: a player's own "did I win,
// and by how many legs" result should reflect their own singles game, not
// a pairs game they may have also played in the same match — mixing the
// two previously produced confusing tallies like "1-1" (won singles, lost
// doubles) that don't read as anyone's actual result.
//
// A player appears in at most one singles game per match (5 singles slots,
// one player each per side), so this never needs to aggregate multiple
// entries for the same match — unlike the old (doubles-inclusive) version.
export function computePlayerSinglesGames(matches: Match[], playerId: string): PlayerGameResult[] {
  const entries: PlayerGameResult[] = [];
  matches
    .filter((m) => m.status === 'confirmed' && m.games)
    .forEach((m) => {
      (m.games as MatchGame[])
        .filter((g) => g.type === 'singles')
        .forEach((g) => {
          const isHome = g.homePlayerIds.includes(playerId);
          const isAway = g.awayPlayerIds.includes(playerId);
          if (!isHome && !isAway) return;
          const homeLegs = g.legs.filter((l) => l.winner === 'home').length;
          const awayLegs = g.legs.filter((l) => l.winner === 'away').length;
          const legsWon = isHome ? homeLegs : awayLegs;
          const legsLost = isHome ? awayLegs : homeLegs;
          entries.push({ match: m, won: legsWon > legsLost, legsWon, legsLost });
        });
    });
  return entries;
}
