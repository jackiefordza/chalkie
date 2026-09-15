import type { CompetitionType, MatchDoc } from './types';

export interface PlayerLeagueStatsResult {
  seasonId: string;
  playerId: string;
  teamId: string;
  leagueLegsWon: number;
  leagueLegsPlayed: number;
  leagueGamesWon: number;
  leagueGamesPlayed: number;
}

// Pure — no Firestore calls. Independently implemented from (never imports)
// computePlayerAccum in functions/src/index.ts — this script is deliberately
// standalone, matching every other script/tool in this repo (see
// scripts/backfill-legs-won/src/compute.ts). Proven equivalent to the live
// aggregation by compute.test.ts, which shares the exact same fixtures and
// expected numbers as functions/src/computePlayerAccum.test.ts.
//
// Corrected Stats Rules model: the Players Leaderboard is STRICTLY League
// only — a confirmed TKO or Friendly match contributes NOTHING to any of
// these four counters (unlike the original legsWon field, which counted
// League + TKO). A match with no competitionType field at all (written
// before the Stats Rules audit) is treated as League, matching
// computePlayerAccum and every other reader in the app.
//
// Every player who appears in ANY League game (home or away, win or lose)
// gets an explicit entry, even at 0 legs/games won — not just leg/game
// winners. This is what makes a re-run of this script able to correct a
// player's counters back DOWN, not just up from nothing.
export function computeLeagueStatsFromMatches(matches: MatchDoc[]): Map<string, PlayerLeagueStatsResult> {
  const result = new Map<string, PlayerLeagueStatsResult>();
  const key = (seasonId: string, playerId: string) => `${seasonId}_${playerId}`;

  const getEntry = (seasonId: string, playerId: string, teamId: string): PlayerLeagueStatsResult => {
    const k = key(seasonId, playerId);
    let entry = result.get(k);
    if (!entry) {
      entry = {
        seasonId, playerId, teamId, leagueLegsWon: 0, leagueLegsPlayed: 0, leagueGamesWon: 0, leagueGamesPlayed: 0,
      };
      result.set(k, entry);
    }
    return entry;
  };

  for (const match of matches) {
    if (match.status !== 'confirmed' || !match.games) continue;
    const competitionType: CompetitionType = match.competitionType ?? 'league';
    if (competitionType !== 'league') continue; // TKO and Friendly contribute zero — League only.

    for (const game of match.games) {
      const gameLegsPlayed = game.legs.length; // actual recorded leg count, never assumed
      const gameHomeWon = game.legs.filter((l) => l.winner === 'home').length
        > game.legs.filter((l) => l.winner === 'away').length;

      game.homePlayerIds.forEach((id) => {
        const e = getEntry(match.seasonId, id, match.homeTeamId);
        e.leagueGamesPlayed += 1;
        e.leagueLegsPlayed += gameLegsPlayed;
        if (gameHomeWon) e.leagueGamesWon += 1;
      });
      game.awayPlayerIds.forEach((id) => {
        const e = getEntry(match.seasonId, id, match.awayTeamId);
        e.leagueGamesPlayed += 1;
        e.leagueLegsPlayed += gameLegsPlayed;
        if (!gameHomeWon) e.leagueGamesWon += 1;
      });

      for (const leg of game.legs) {
        // A leg's winner is recorded at the home/away SIDE — every player on
        // the winning side of THIS leg is credited, so a pairs-game leg win
        // credits both partnered players (matches computePlayerAccum exactly).
        const winningPlayerIds = leg.winner === 'home' ? game.homePlayerIds : game.awayPlayerIds;
        const winningTeamId = leg.winner === 'home' ? match.homeTeamId : match.awayTeamId;
        for (const playerId of winningPlayerIds) {
          getEntry(match.seasonId, playerId, winningTeamId).leagueLegsWon += 1;
        }
      }
    }
  }
  return result;
}
