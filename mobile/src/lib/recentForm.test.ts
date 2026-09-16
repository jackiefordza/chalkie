import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recentForm } from './recentForm';
import type { Match } from '@/types';

function match(overrides: Partial<Match> = {}): Match {
  return {
    id: 'm1',
    leagueId: 'league-1',
    seasonId: 'season-1',
    divisionId: 'division-1',
    round: 1,
    homeTeamId: 'team-a',
    awayTeamId: 'team-b',
    scheduledDate: new Date('2026-09-01'),
    venue: null,
    status: 'confirmed',
    competitionType: 'league',
    homeGamesWon: 4,
    awayGamesWon: 3,
    homeLegsWon: 12,
    awayLegsWon: 9,
    games: null,
    createdAt: new Date('2026-08-01'),
    ...overrides,
  };
}

test('a home win shows W for the home team, L for the away team', () => {
  const m = match({ homeGamesWon: 4, awayGamesWon: 3 });
  assert.deepEqual(recentForm([m], 'team-a'), ['W']);
  assert.deepEqual(recentForm([m], 'team-b'), ['L']);
});

test('an away win shows W for the away team, L for the home team', () => {
  const m = match({ homeGamesWon: 2, awayGamesWon: 5 });
  assert.deepEqual(recentForm([m], 'team-a'), ['L']);
  assert.deepEqual(recentForm([m], 'team-b'), ['W']);
});

test('only confirmed matches count — scheduled/awaiting/disputed are excluded even if most recent', () => {
  const matches = [
    match({ id: 'm1', status: 'confirmed', homeGamesWon: 4, awayGamesWon: 3 }),
    match({ id: 'm2', status: 'scheduled', homeGamesWon: null, awayGamesWon: null }),
    match({ id: 'm3', status: 'awaiting_confirmation', homeGamesWon: null, awayGamesWon: null }),
    match({ id: 'm4', status: 'disputed', homeGamesWon: null, awayGamesWon: null }),
  ];
  assert.deepEqual(recentForm(matches, 'team-a'), ['W']);
});

test('respects the count window, taking the most recent N (array-order) entries', () => {
  const matches = [
    match({ id: 'm1', homeGamesWon: 4, awayGamesWon: 3 }), // W for team-a
    match({ id: 'm2', homeGamesWon: 1, awayGamesWon: 5 }), // L for team-a
    match({ id: 'm3', homeGamesWon: 4, awayGamesWon: 3 }), // W for team-a
    match({ id: 'm4', homeGamesWon: 1, awayGamesWon: 5 }), // L for team-a
  ];
  assert.deepEqual(recentForm(matches, 'team-a', 3), ['L', 'W', 'L']);
});

test('fewer completed matches than the window just returns what is available, not fabricated', () => {
  const m = match({ homeGamesWon: 4, awayGamesWon: 3 });
  assert.deepEqual(recentForm([m], 'team-a', 3), ['W']);
});

test('no completed matches returns an empty array', () => {
  assert.deepEqual(recentForm([], 'team-a'), []);
});
