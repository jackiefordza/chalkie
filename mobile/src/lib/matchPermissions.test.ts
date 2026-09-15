import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canSignOffMatch } from './matchPermissions';
import type { AppUser, Match } from '@/types';

function admin(overrides: Partial<AppUser> = {}): Pick<AppUser, 'isLeagueAdmin' | 'isGlobalAdmin' | 'leagueId'> {
  return { isLeagueAdmin: false, isGlobalAdmin: false, leagueId: null, ...overrides };
}

function match(overrides: Partial<Match> = {}): Pick<Match, 'leagueId' | 'status'> {
  return { leagueId: 'league-1', status: 'awaiting_confirmation', ...overrides };
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
