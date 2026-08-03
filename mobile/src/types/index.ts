export type UserRole = 'captain' | 'viceCaptain' | 'player' | 'pending';

export type PhoneVisibility = 'private' | 'captains' | 'public';

export type PendingRequestType = 'join' | 'claim' | 'captainRole';

export interface AppUser {
  uid: string;
  email: string;
  displayName: string;
  nickname: string | null;
  role: UserRole;
  isLeagueAdmin: boolean;
  leagueId: string | null;
  seasonId: string | null;
  teamId: string | null;
  divisionId: string | null;
  playerId: string | null;
  pendingRequestType: PendingRequestType | null;
  pendingRequestId: string | null;
  phone: string | null;
  phoneVisibility: PhoneVisibility | null;
  expoPushToken: string | null;
  createdAt: Date;
}

export interface League {
  id: string;
  name: string;
  adminUserId: string;
  createdAt: Date;
}

export type SeasonStatus = 'upcoming' | 'active' | 'completed';

// A blackout window fixtures should never be scheduled in (Christmas, a
// venue closure, etc.) — the fixture generator's date cursor skips forward
// past `end` whenever a round would otherwise land inside one.
export interface SeasonBreak {
  start: Date;
  end: Date;
  label: string;
}

export interface Season {
  id: string;
  leagueId: string;
  name: string;
  status: SeasonStatus;
  // Both null until an admin sets them on the Schedule panel — older seasons
  // (and the generator's own manual override) work fine without these.
  startDate: Date | null;
  breaks: SeasonBreak[];
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

// A physical location teams play home fixtures at. Shared many-to-one with
// Team (several teams can share one venue) — boardCount is what the fixture
// generator uses to detect and auto-resolve same-day home-fixture clashes.
export interface Venue {
  id: string;
  leagueId: string;
  name: string;
  address: string | null;
  venuePhone: string | null;
  boardCount: number;
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
  venueId: string | null;
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
  // Admin pre-assigns a captain/VC to an unclaimed roster slot before that
  // person has registered. Only meaningful while claimedByUserId is null —
  // the claim-approval flow reads this to promote them straight to the role
  // instead of leaving them as a plain player, then clears it.
  designatedRole: 'captain' | 'viceCaptain' | null;
}

export type JoinRequestStatus = 'pending' | 'approved' | 'rejected';

// A single request-and-approve model covers everyone joining a league after
// admin has created the team: a plain new player, a player claiming a
// placeholder record their captain already added ('claim'), or someone
// asking to become a team's captain/VC ('captainRole'). Who approves depends
// on requestType — see firestore.rules and the Roles & Permissions section
// of PLAN.md: 'join'/'claim' → that team's captain/VC; 'captainRole' with
// requestedRole 'captain' (or 'viceCaptain' when the team has no captain yet)
// → league admin; 'captainRole' with requestedRole 'viceCaptain' on a team
// that already has a captain → that captain specifically, not just any VC.
export interface JoinRequest {
  id: string;
  leagueId: string;
  teamId: string;
  teamName: string;
  userId: string;
  displayName: string;
  requestType: 'join' | 'claim' | 'captainRole';
  claimPlayerId: string | null; // set when requestType === 'claim'
  requestedRole: 'captain' | 'viceCaptain' | null; // set when requestType === 'captainRole'
  status: JoinRequestStatus;
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

// Team Knockout Cup — single-elimination, cross-division draw. Reuses the
// exact same match/results/confirmation shape as a league Match (see
// CupTie below) so results-entry.tsx and the submission-comparison logic
// work unmodified against either collection; cup ties never touch
// divisionTables/playerSeasonStats, only their own bracket.
export type CupStatus = 'draft' | 'active' | 'completed';

export interface Cup {
  id: string;
  leagueId: string;
  seasonId: string;
  name: string;
  teamIds: string[]; // the drawn field, fixed once the bracket is created
  status: CupStatus;
  winnerTeamId: string | null; // set once the Final is confirmed
  createdAt: Date;
}

export interface CupRound {
  id: string;
  leagueId: string;
  cupId: string;
  name: string; // "Round of 16", "Quarter-Final", "Semi-Final", "Final", etc.
  order: number; // 1-based, 1 = earliest round
  scheduledDate: Date;
  createdAt: Date;
}

export type CupTieStatus = 'pending' | 'scheduled' | 'awaiting_confirmation' | 'disputed' | 'confirmed' | 'bye';

// A single bracket slot. homeTeamId/awayTeamId are null until the previous
// round's winner (or the initial draw) fills them in — status stays
// 'pending' until both sides are known. A 'bye' tie has exactly one side
// filled and is resolved immediately (no games played) by adminCreateCup /
// onCupTieConfirmed, advancing that team straight to nextTieId.
export interface CupTie {
  id: string;
  leagueId: string;
  cupId: string;
  cupRoundId: string;
  round: number; // = CupRound.order, denormalized for sorting without a join
  homeTeamId: string | null;
  awayTeamId: string | null;
  winnerTeamId: string | null;
  scheduledDate: Date | null;
  venue: string | null; // home team's own name, same convention as Match.venue
  status: CupTieStatus;
  homeGamesWon: number | null;
  awayGamesWon: number | null;
  homeLegsWon: number | null;
  awayLegsWon: number | null;
  games: MatchGame[] | null;
  // Where this tie's winner feeds into — null for the Final.
  nextTieId: string | null;
  nextTieSlot: MatchSide | null;
  createdAt: Date;
}

// One captain/VC's version of a cup tie result — identical shape to
// MatchSubmission, just scoped under cupTies/{tieId}/submissions instead of
// matches/{id}/submissions.
export interface CupTieSubmission {
  id: string; // = submittedByTeamId
  submittedByTeamId: string;
  submittedByUserId: string;
  games: MatchGame[];
  createdAt: Date;
}

// Singles Knockout — individual players, not teams, single-elimination.
// Deliberately structured differently from the Team Cup rather than forced
// into the same shape: this is run as one event on one night (the real
// league's own printed schedule lists a single date for it, unlike the Team
// K.O.'s separate date per round), so there's no per-round scheduledDate,
// and the admin/organiser running the night enters each tie's result
// directly and it's confirmed immediately — no dual-submission/dispute flow,
// since there's no captain on each side to submit independently the way a
// league or cup team match has. Best-of-3 legs, same MatchLeg shape
// (winner/oneEighties/highCheckout) as everywhere else, just not wrapped in
// a 7-game Match — a singles tie *is* one game.
export type SinglesTieStatus = 'pending' | 'ready' | 'confirmed' | 'bye';

export interface SinglesCompetition {
  id: string;
  leagueId: string;
  seasonId: string;
  name: string;
  eventDate: Date;
  playerIds: string[]; // the drawn field, fixed once the bracket is created
  status: 'active' | 'completed';
  winnerPlayerId: string | null; // set once the Final is confirmed
  createdAt: Date;
}

export interface SinglesTie {
  id: string;
  leagueId: string;
  competitionId: string;
  round: number;
  homePlayerId: string | null;
  awayPlayerId: string | null;
  winnerPlayerId: string | null;
  status: SinglesTieStatus;
  homeLegsWon: number | null;
  awayLegsWon: number | null;
  legs: MatchLeg[] | null; // 'home'/'away' here mean homePlayerId/awayPlayerId, not a team side
  nextTieId: string | null;
  nextTieSlot: MatchSide | null;
  createdAt: Date;
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
