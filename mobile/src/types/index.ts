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
