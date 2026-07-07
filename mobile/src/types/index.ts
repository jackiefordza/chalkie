export type UserRole = 'admin' | 'captain' | 'viceCaptain' | 'player' | 'pending';

export type PhoneVisibility = 'private' | 'captains' | 'public';

export type PendingRequestType = 'team' | 'join';

export interface AppUser {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  leagueId: string | null;
  seasonId: string | null;
  teamId: string | null;
  divisionId: string | null;
  playerId: string | null;
  pendingRequestType: PendingRequestType | null;
  pendingRequestId: string | null;
  phone: string | null;
  phoneVisibility: PhoneVisibility | null;
  createdAt: Date;
}

export interface League {
  id: string;
  name: string;
  adminUserId: string;
  captainInviteCode: string | null;
  createdAt: Date;
}

export type SeasonStatus = 'upcoming' | 'active' | 'completed';

export interface Season {
  id: string;
  leagueId: string;
  name: string;
  status: SeasonStatus;
  createdAt: Date;
}

export interface Division {
  id: string;
  leagueId: string;
  seasonId: string;
  name: string;
  order: number;
  createdAt: Date;
}

export interface Team {
  id: string;
  leagueId: string;
  seasonId: string;
  divisionId: string;
  name: string;
  captainUserId: string | null;
  viceCaptainUserId: string | null;
  playerInviteCode: string | null;
  address: string | null;
  createdAt: Date;
}

export interface Player {
  id: string;
  leagueId: string;
  seasonId: string | null;
  divisionId: string | null;
  teamId: string;
  name: string;
  claimedByUserId: string | null;
  claimedAt: Date | null;
  createdByUserId: string | null;
  createdAt: Date;
}

export interface JoinCode {
  id: string;
  leagueId: string;
  seasonId: string | null;
  divisionId: string | null;
  teamId: string;
  role: UserRole;
  createdByUserId: string;
  usedByUserId: string | null;
  usedAt: Date | null;
  createdAt: Date;
}

export interface ClaimCode {
  id: string;
  leagueId: string;
  teamId: string;
  playerId: string;
  createdByUserId: string;
  usedByUserId: string | null;
  usedAt: Date | null;
  createdAt: Date;
}

// A league match: 7 games (5 singles then 2 pairs), all 501, 3 legs per game,
// all 3 legs always played. Match winner = team that wins more games (odd
// count, so no draws are possible at match level).
export type MatchStatus = 'scheduled' | 'awaiting_confirmation' | 'disputed' | 'confirmed';
export type GameType = 'singles' | 'pairs';
export type MatchSide = 'home' | 'away';

export interface Match {
  id: string;
  leagueId: string;
  seasonId: string;
  divisionId: string;
  round: number;
  homeTeamId: string;
  awayTeamId: string;
  scheduledDate: Date;
  venue: string | null;
  status: MatchStatus;
  // Set once confirmed (by the onSubmissionWrite/dispute-resolution Cloud Function path)
  homeGamesWon: number | null;
  awayGamesWon: number | null;
  homeLegsWon: number | null;
  awayLegsWon: number | null;
  // The agreed-upon (or admin-resolved) game-by-game detail — only set once confirmed
  games: MatchGame[] | null;
  createdAt: Date;
}

export interface HighCheckout {
  playerId: string;
  // Free text, captain's own call — no fixed threshold or numeric validation (e.g. "121")
  value: string;
}

export interface MatchLeg {
  winner: MatchSide;
  // playerIds of anyone who threw a 180 in this leg
  oneEighties: string[];
  highCheckout: HighCheckout | null;
}

export interface MatchGame {
  order: number; // 1-5 singles, 6-7 pairs
  type: GameType;
  homePlayerIds: string[];
  awayPlayerIds: string[];
  legs: MatchLeg[]; // always length 3
}

// One captain/VC's version of a match result. Auto-confirmed when both
// teams' submissions agree; otherwise the match is flagged disputed for
// the admin to resolve.
export interface MatchSubmission {
  id: string; // = submittedByTeamId, one submission doc per team per match
  submittedByTeamId: string;
  submittedByUserId: string;
  games: MatchGame[];
  createdAt: Date;
}

// Server-computed only (Cloud Function) — see firestore.rules `allow write: if false`.
export interface DivisionTable {
  id: string; // = `${seasonId}_${divisionId}_${teamId}`
  leagueId: string;
  seasonId: string;
  divisionId: string;
  teamId: string;
  played: number;
  won: number;
  lost: number;
  points: number;
  legsFor: number;
  legsAgainst: number;
  legDiff: number;
  position: number;
}

export interface PlayerHighCheckout {
  value: string;
  matchId: string;
  date: Date;
}

// Server-computed only (Cloud Function). played/won/lost count individual
// games (singles + pairs), not matches — a player can play more than one
// game per match.
export interface PlayerSeasonStats {
  id: string; // = `${seasonId}_${playerId}`
  leagueId: string;
  seasonId: string;
  divisionId: string;
  teamId: string;
  playerId: string;
  played: number;
  won: number;
  lost: number;
  oneEighties: number;
  highCheckouts: PlayerHighCheckout[];
}
