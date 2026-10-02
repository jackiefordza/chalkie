import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canSignOffMatch, canResetMatch, canActOnPendingConfirmation } from './matchPermissions';
import type { AppUser, Match } from '@/types';

function admin(overrides: Partial<AppUser> = {}): Pick<AppUser, 'isLeagueAdmin' | 'isGlobalAdmin' | 'leagueId'> {
  return { isLeagueAdmin: false, isGlobalAdmin: false, leagueId: null, ...overrides };
}

function match(overrides: Partial<Match> = {}): Pick<Match, 'leagueId' | 'status'> {
  return { leagueId: 'league-1', status: 'awaiting_confirmation', ...overrides };
}

function captain(overrides: Partial<AppUser> = {}): Pick<AppUser, 'role' | 'teamId'> {
  return { role: 'captain', teamId: 'team-home', ...overrides };
}

function pendingMatch(overrides: Partial<Match> = {}): Pick<Match, 'homeTeamId' | 'awayTeamId' | 'status'> {
  return { homeTeamId: 'team-home', awayTeamId: 'team-away', status: 'pending_confirmation', ...overrides };
}

test('a global admin may sign off a match in any league', () => {
  assert.equal(canSignOffMatch(admin({ isGlobalAdmin: true, leagueId: 'other-league' }), match()), true);
});

test('a global admin may NOT sign off a match that is not awaiting confirmation', () => {
  assert.equal(canSignOffMatch(admin({ isGlobalAdmin: true }), match({ status: 'scheduled' })), false);
  assert.equal(canSignOffMatch(admin({ isGlobalAdmin: true }), match({ status: 'confirmed' })), false);
  assert.equal(canSignOffMatch(admin({ isGlobalAdmin: true }), match({ status: 'disputed' })), false);
});

test('a league admin may sign off a match in their own league', () => {
  assert.equal(
    canSignOffMatch(admin({ isLeagueAdmin: true, leagueId: 'league-1' }), match({ leagueId: 'league-1' })),
    true,
  );
});

test('a league admin may NOT sign off a match in a different league — the critical cross-league boundary', () => {
  assert.equal(
    canSignOffMatch(admin({ isLeagueAdmin: true, leagueId: 'league-1' }), match({ leagueId: 'league-2' })),
    false,
  );
});

test('a league admin may NOT sign off their own league\'s match unless it is awaiting confirmation', () => {
  const appUser = admin({ isLeagueAdmin: true, leagueId: 'league-1' });
  assert.equal(canSignOffMatch(appUser, match({ status: 'scheduled' })), false);
  assert.equal(canSignOffMatch(appUser, match({ status: 'confirmed' })), false);
  assert.equal(canSignOffMatch(appUser, match({ status: 'disputed' })), false);
});

test('a plain player (no admin flags) may never sign off', () => {
  assert.equal(canSignOffMatch(admin({ leagueId: 'league-1' }), match({ leagueId: 'league-1' })), false);
});

test('a captain/vice-captain (also not an admin) may never sign off', () => {
  assert.equal(
    canSignOffMatch(admin({ isLeagueAdmin: false, isGlobalAdmin: false, leagueId: 'league-1' }), match({ leagueId: 'league-1' })),
    false,
  );
});

test('null or undefined appUser/match is always rejected', () => {
  assert.equal(canSignOffMatch(null, match()), false);
  assert.equal(canSignOffMatch(undefined, match()), false);
  assert.equal(canSignOffMatch(admin({ isGlobalAdmin: true }), null), false);
  assert.equal(canSignOffMatch(admin({ isGlobalAdmin: true }), undefined), false);
});

test('a league admin with a null leagueId may not sign off any league\'s match', () => {
  assert.equal(
    canSignOffMatch(admin({ isLeagueAdmin: true, leagueId: null }), match({ leagueId: 'league-1' })),
    false,
  );
});

test('a global admin may reset a result in any league, in any non-scheduled status', () => {
  const appUser = admin({ isGlobalAdmin: true, leagueId: 'other-league' });
  assert.equal(canResetMatch(appUser, match({ status: 'awaiting_confirmation' })), true);
  assert.equal(canResetMatch(appUser, match({ status: 'disputed' })), true);
  assert.equal(canResetMatch(appUser, match({ status: 'confirmed' })), true);
});

test('nobody may reset a scheduled fixture — there is nothing to reset', () => {
  assert.equal(canResetMatch(admin({ isGlobalAdmin: true }), match({ status: 'scheduled' })), false);
  assert.equal(
    canResetMatch(admin({ isLeagueAdmin: true, leagueId: 'league-1' }), match({ leagueId: 'league-1', status: 'scheduled' })),
    false,
  );
});

test('a league admin may reset a result in their own league', () => {
  const appUser = admin({ isLeagueAdmin: true, leagueId: 'league-1' });
  assert.equal(canResetMatch(appUser, match({ leagueId: 'league-1', status: 'confirmed' })), true);
  assert.equal(canResetMatch(appUser, match({ leagueId: 'league-1', status: 'disputed' })), true);
  assert.equal(canResetMatch(appUser, match({ leagueId: 'league-1', status: 'awaiting_confirmation' })), true);
});

test('a league admin may NOT reset a result in a different league — the critical cross-league boundary', () => {
  assert.equal(
    canResetMatch(admin({ isLeagueAdmin: true, leagueId: 'league-1' }), match({ leagueId: 'league-2', status: 'confirmed' })),
    false,
  );
});

test('a plain player or captain/VC may never reset a result', () => {
  assert.equal(canResetMatch(admin({ leagueId: 'league-1' }), match({ leagueId: 'league-1', status: 'confirmed' })), false);
});

test('canResetMatch: null or undefined appUser/match is always rejected', () => {
  assert.equal(canResetMatch(null, match({ status: 'confirmed' })), false);
  assert.equal(canResetMatch(undefined, match({ status: 'confirmed' })), false);
  assert.equal(canResetMatch(admin({ isGlobalAdmin: true }), null), false);
  assert.equal(canResetMatch(admin({ isGlobalAdmin: true }), undefined), false);
});

test('canResetMatch: a league admin with a null leagueId may not reset any league\'s match', () => {
  assert.equal(
    canResetMatch(admin({ isLeagueAdmin: true, leagueId: null }), match({ leagueId: 'league-1', status: 'confirmed' })),
    false,
  );
});

test('canActOnPendingConfirmation: the home captain may act on their own pending_confirmation match', () => {
  assert.equal(canActOnPendingConfirmation(captain({ teamId: 'team-home' }), pendingMatch()), true);
});

test('canActOnPendingConfirmation: the away vice-captain may act too', () => {
  assert.equal(
    canActOnPendingConfirmation(captain({ role: 'viceCaptain', teamId: 'team-away' }), pendingMatch()),
    true,
  );
});

test('canActOnPendingConfirmation: a captain of neither team may not act', () => {
  assert.equal(canActOnPendingConfirmation(captain({ teamId: 'team-other' }), pendingMatch()), false);
});

test('canActOnPendingConfirmation: a plain player on the home team (not captain/VC) may not act', () => {
  assert.equal(canActOnPendingConfirmation(captain({ role: 'player', teamId: 'team-home' }), pendingMatch()), false);
});

test('canActOnPendingConfirmation: the home captain may not act unless the match is genuinely pending_confirmation', () => {
  assert.equal(canActOnPendingConfirmation(captain(), pendingMatch({ status: 'awaiting_confirmation' })), false);
  assert.equal(canActOnPendingConfirmation(captain(), pendingMatch({ status: 'disputed' })), false);
  assert.equal(canActOnPendingConfirmation(captain(), pendingMatch({ status: 'confirmed' })), false);
});

test('canActOnPendingConfirmation: null or undefined appUser/match is always rejected', () => {
  assert.equal(canActOnPendingConfirmation(null, pendingMatch()), false);
  assert.equal(canActOnPendingConfirmation(undefined, pendingMatch()), false);
  assert.equal(canActOnPendingConfirmation(captain(), null), false);
  assert.equal(canActOnPendingConfirmation(captain(), undefined), false);
});
