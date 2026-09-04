// Local, standalone mirrors of the Firestore document shapes this script
// writes — deliberately NOT imported from mobile/src/types/index.ts. This
// script has no dependency on the mobile app's source tree at all (see the
// implementation report for why); these are just enough of each shape for
// this script's own writes/reads to be type-checked, matching the real
// field names exactly (cross-checked against mobile/src/types/index.ts and
// functions/src/index.ts at design time).

export type MatchStatus = 'scheduled' | 'awaiting_confirmation' | 'disputed' | 'confirmed';
export type GameType = 'singles' | 'pairs';
export type MatchSide = 'home' | 'away';

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

export interface GeneratedFixture {
  round: number;
  homeTeamIndex: number;
  awayTeamIndex: number;
  scheduledDate: Date;
}
