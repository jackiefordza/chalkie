import { test } from 'node:test';
import assert from 'node:assert/strict';
import { teamMatchScore } from './matchScore';

function match(overrides: Partial<Parameters<typeof teamMatchScore>[0]> = {}) {
  return {
    homeTeamId: 'team-home',
    homeGamesWon: 4,
    awayGamesWon: 3,
    homeLegsWon: 12,
    awayLegsWon: 9,
    ...overrides,
  };
}

test('match score uses total legs, not games won — home perspective', () => {
  const result = teamMatchScore(match(), 'team-home');
  assert.deepEqual(result, { won: true, legsFor: 12, legsAgainst: 9, gamesFor: 4, gamesAgainst: 3 });
});

test('match score uses total legs, not games won — away perspective (legs and games swap)', () => {
  const result = teamMatchScore(match(), 'team-away');
  assert.deepEqual(result, { won: false, legsFor: 9, legsAgainst: 12, gamesFor: 3, gamesAgainst: 4 });
});

test('a team can win fewer legs overall but still win the match on games', () => {
  // 4 games to 3, but the losing side ran up bigger leg margins in the games it won
  const m = match({ homeGamesWon: 4, awayGamesWon: 3, homeLegsWon: 10, awayLegsWon: 11 });
  const result = teamMatchScore(m, 'team-home');
  assert.equal(result!.won, true, 'won on games despite fewer legs');
  assert.equal(result!.legsFor, 10);
  assert.equal(result!.legsAgainst, 11);
});

test('returns null when the match has no result yet (any total unset)', () => {
  assert.equal(teamMatchScore(match({ homeGamesWon: null }), 'team-home'), null);
  assert.equal(teamMatchScore(match({ awayGamesWon: null }), 'team-home'), null);
  assert.equal(teamMatchScore(match({ homeLegsWon: null }), 'team-home'), null);
  assert.equal(teamMatchScore(match({ awayLegsWon: null }), 'team-home'), null);
});

test('a drawn games count (e.g. postponed edge case) is not "won"', () => {
  const m = match({ homeGamesWon: 3, awayGamesWon: 3, homeLegsWon: 9, awayLegsWon: 9 });
  assert.equal(teamMatchScore(m, 'team-home')!.won, false);
  assert.equal(teamMatchScore(m, 'team-away')!.won, false);
});
