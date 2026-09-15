// A standalone copy of just the shape this script reads — this script is
// intentionally independent of mobile/ and functions/ (same discipline as
// scripts/backfill-legs-won and scripts/showcase-seed): nothing here is
// imported by, or imports from, either of those packages.
export type MatchSide = 'home' | 'away';
export type GameType = 'singles' | 'pairs';
export type CompetitionType = 'league' | 'tko' | 'friendly';
export type MatchStatus = 'scheduled' | 'awaiting_confirmation' | 'disputed' | 'confirmed' | 'postponed' | 'cancelled';

export interface HighCheckout {
  playerId: string;
  value: string;
}
export interface MatchLeg {
  winner: MatchSide;
  oneEighties: string[];
  highCheckout: HighCheckout | null;
}
export interface MatchGame {
  order: number;
  type: GameType;
  homePlayerIds: string[];
  awayPlayerIds: string[];
  legs: MatchLeg[];
}

// Only the fields this script actually reads from a `matches/{id}` document.
export interface MatchDoc {
  id: string;
  seasonId: string;
  homeTeamId: string;
  awayTeamId: string;
  status: MatchStatus;
  // Absent on any match written before the Stats Rules audit — treated as
  // 'league' everywhere in this script, matching functions/src/index.ts's
  // own `competitionType ?? 'league'` default exactly.
  competitionType?: CompetitionType;
  games: MatchGame[] | null;
}
