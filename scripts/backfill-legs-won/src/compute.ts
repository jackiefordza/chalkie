import type { CompetitionType, MatchDoc } from './types';

export interface PlayerLegsWonResult {
  seasonId: string;
  playerId: string;
  teamId: string;
  legsWon: number;
}

// Pure — no Firestore calls. Independently implemented from (never imports)
// computePlayerAccum in functions/src/index.ts — this script is deliberately
// standalone, matching every other script/tool in this repo (see
// scripts/showcase-seed/README.md). Proven equivalent to the live
// aggregation by compute.test.ts, which shares the exact same fixtures and
// expected legsWon numbers as functions/src/computePlayerAccum.test.ts.
//
// Same rule as the live aggregation: only confirmed League + TKO matches
// count; Friendly contributes nothing; a match with no competitionType
// field at all (written before the Stats Rules audit) is treated as League.
//
// Every player who appears in ANY counted game (home or away, win or lose)
// gets an explicit entry, even at legsWon: 0 — not just leg-winners. This
// is what makes a re-run of this script (e.g. after fixing a bug in this
// very computation) able to correct a player's legsWon back DOWN to 0, not
// just up from nothing.
export function computeLegsWonFromMatches(matches: MatchDoc[]): Map<string, PlayerLegsWonResult> {
  const result = new Map<string, PlayerLegsWonResult>();
  const key = (seasonId: string, playerId: string) => `${seasonId}_${playerId}`;

  const getEntry = (seasonId: string, playerId: string, teamId: string): PlayerLegsWonResult => {
    const k = key(seasonId, playerId);
    let entry = result.get(k);
    if (!entry) {
      entry = { seasonId, playerId, teamId, legsWon: 0 };
      result.set(k, entry);
    }
    return entry;
  };

  for (const match of matches) {
    if (match.status !== 'confirmed' || !match.games) continue;
    const competitionType: CompetitionType = match.competitionType ?? 'league';
    if (competitionType === 'friendly') continue;

    for (const game of match.games) {
      game.homePlayerIds.forEach((id) => getEntry(match.seasonId, id, match.homeTeamId));
      game.awayPlayerIds.forEach((id) => getEntry(match.seasonId, id, match.awayTeamId));

      for (const leg of game.legs) {
        // A leg's winner is recorded at the home/away SIDE — every player on
        // the winning side of THIS leg is credited, so a pairs-game leg win
        // credits both partnered players (matches computePlayerAccum exactly).
        const winningPlayerIds = leg.winner === 'home' ? game.homePlayerIds : game.awayPlayerIds;
        const winningTeamId = leg.winner === 'home' ? match.homeTeamId : match.awayTeamId;
        for (const playerId of winningPlayerIds) {
          getEntry(match.seasonId, playerId, winningTeamId).legsWon += 1;
        }
      }
    }
  }
  return result;
}
