export type UserRole = 'admin' | 'captain' | 'viceCaptain' | 'player' | 'pending';

export type PhoneVisibility = 'private' | 'captains' | 'public';

export interface AppUser {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  leagueId: string | null;
  teamId: string | null;
  divisionId: string | null;
  playerId: string | null;
  pendingRequestType: 'team' | 'join' | null;
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

export interface Season {
  id: string;
  leagueId: string;
  name: string;
  startDate: Date;
  endDate: Date;
  isActive: boolean;
}

export interface Division {
  id: string;
  leagueId: string;
  seasonId: string;
  name: string;
}

export interface Team {
  id: string;
  leagueId: string;
  divisionId: string;
  name: string;
  captainUserId: string | null;
  viceCaptainUserId: string | null;
  address: string | null;
}

export interface Player {
  id: string;
  leagueId: string;
  teamId: string;
  name: string;
  claimedByUserId: string | null;
  claimedAt: Date | null;
}

export interface JoinCode {
  id: string;
  leagueId: string;
  teamId: string;
  role: UserRole;
  usedByUserId: string | null;
  usedAt: Date | null;
  createdAt: Date;
}
