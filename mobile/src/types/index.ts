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
  /** Platform-wide admin: manages data across every league, not just leagueId below. Console-granted only, same as isLeagueAdmin. */
  isGlobalAdmin: boolean;
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
  address: string | null;
  venuePhone: string | null;
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
//
// 'awaiting_confirmation' means exactly one team has submitted and the other
// hasn't yet — distinct from 'pending_confirmation', which means BOTH teams
// submitted and their pairings/scores reconciled, and it's now waiting on
// one or both teams' explicit Confirm (see MatchConfirmation below). Only a
// Cloud Function (onConfirmationWrite) ever moves a match into 'confirmed' —
// no client write can set that status directly (see firestore.rules).
export type MatchStatus = 'scheduled' | 'awaiting_confirmation' | 'pending_confirmation' | 'disputed' | 'confirmed';
export type GameType = 'singles' | 'pairs';
export type MatchSide = 'home' | 'away';

// Stats Rules audit (Season 1): Season 180s/High Checkouts count League + TKO
// matches, never Friendlies — see computePlayerAccum in functions/src/index.ts,
// the only place this is enforced. The only match-creation path today
// (admin-fixtures.tsx's round-robin generator) always stamps 'league' —
// there's no UI yet for creating a TKO or Friendly match. Matches written
// before this field existed have no value for it at all; every reader
// treats a missing value as 'league' (see functions/src/index.ts) rather
// than requiring a migration write.
export type CompetitionType = 'league' | 'tko' | 'friendly';

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
  competitionType: CompetitionType;
  // Set once confirmed (by onConfirmationWrite, admin sign-off, or dispute resolution)
  homeGamesWon: number | null;
  awayGamesWon: number | null;
  homeLegsWon: number | null;
  awayLegsWon: number | null;
  // The reconciled game-by-game detail. Set as soon as the match reaches
  // 'pending_confirmation' (onSubmissionWrite merges both teams' own-reported
  // stats into it at that point) — NOT only once confirmed. It never changes
  // again between 'pending_confirmation' and 'confirmed' (onConfirmationWrite
  // only flips status), so it's safe to display as "the match sheet" the
  // moment pending_confirmation is reached, before either captain confirms.
  games: MatchGame[] | null;
  // Who most recently produced the 'confirmed' status — 'captains' when both
  // teams' MatchConfirmation docs did it (onConfirmationWrite), 'adminOverride'
  // when a league admin confirmed unilaterally (one-sided sign-off, dispute
  // resolution, or a direct correction of an already-confirmed result).
  // Undefined on any match confirmed before this field existed, and on a
  // match that isn't confirmed at all — never backfilled.
  confirmedVia?: 'captains' | 'adminOverride';
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

// One captain/VC's version of a match result — their OWN team's pairings,
// all 7 game/leg scores as they observed them, and their OWN players' 180s/
// checkouts only (never the opponent's — enforced server-side, see
// functions/src/index.ts). When both teams' submissions agree on pairings
// and scores, the match moves to 'pending_confirmation' with a merged
// Match.games combining each side's own-reported stats; a genuine pairing/
// score disagreement flags the match 'disputed' for a captain to fix or an
// admin to resolve. Blocked from further writes once the match leaves
// 'scheduled'/'awaiting_confirmation'/'disputed' — see firestore.rules.
export interface MatchSubmission {
  id: string; // = submittedByTeamId, one submission doc per team per match
  submittedByTeamId: string;
  submittedByUserId: string;
  games: MatchGame[];
  createdAt: Date;
}

// One team's explicit confirmation of the reconciled match sheet shown at
// Match.games once status is 'pending_confirmation'. A match only becomes
// 'confirmed' once BOTH teams' confirmation docs exist — enforced by
// onConfirmationWrite (functions/src/index.ts), never by a client write
// (see firestore.rules — status can never be set to 'confirmed' directly).
// Immutable once created (no un-confirming) — a team that changes its mind
// must use the dispute path (disputeMatch callable) instead.
export interface MatchConfirmation {
  id: string; // = confirmedByTeamId, one confirmation doc per team per match
  confirmedByTeamId: string;
  confirmedByUserId: string;
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
// game per match. legsWon is at the LEG level, not the game level — a leg
// won by a pairs game credits BOTH partnered players. All of played/won/
// lost/oneEighties/highCheckouts/legsWon only ever accumulate from
// confirmed League + TKO matches — Friendlies contribute nothing
// (computePlayerAccum). This is the SEASON ACHIEVEMENT scope (180s, high
// checkouts) — legsWon itself is kept for backward compatibility but is no
// longer read by the Player Leaderboard (see leagueLegsWon below); nothing
// in the app currently displays it.
//
// Stats Rules audit (Season 1, corrected): the Players Leaderboard is a
// SEPARATE, STRICTLY LEAGUE-ONLY scope — TKO and Friendly must have zero
// effect on it. Rather than making legsWon/won/played ambiguous (sometimes
// League-only, sometimes League+TKO), the leaderboard has its own explicit,
// additive counters below, gated on competitionType === 'league' alone
// (computePlayerAccum). Every game always plays all 3 legs today (Match's
// own invariant, see MatchGame.legs), but leagueLegsPlayed is accumulated
// from the actual recorded leg count per game rather than assumed, so it
// stays correct if that invariant ever changes.
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
  legsWon: number;
  oneEighties: number;
  highCheckouts: PlayerHighCheckout[];
  // Players Leaderboard scope — League matches ONLY (see the comment above).
  leagueLegsWon: number;
  leagueLegsPlayed: number;
  leagueGamesWon: number;
  leagueGamesPlayed: number;
}
