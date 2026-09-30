import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveOpponentInfo } from './opponentInfo';
import type { DivisionTable, Match } from '@/types';

const NEXT_MATCH = {
  homeTeamId: 'red-lion',
  awayTeamId: 'railway-tavern',
  seasonId: 'season-1',
  divisionId: 'division-1',
  leagueId: 'league-1',
};

function tableRow(overrides: Partial<DivisionTable> = {}): DivisionTable {
  return {
    id: 'row',
    leagueId: 'league-1',
    seasonId: 'season-1',
    divisionId: 'division-1',
    teamId: 'red-lion',
    played: 6,
    won: 4,
    lost: 2,
    points: 8,
    legsFor: 60,
    legsAgainst: 44,
    legDiff: 16,
    position: 7,
    ...overrides,
  };
}

function confirmedMatch(overrides: Partial<Match> = {}): Match {
  return {
    id: 'm',
    leagueId: 'league-1',
    seasonId: 'season-1',
    divisionId: 'division-1',
    round: 1,
    homeTeamId: 'railway-tavern',
    awayTeamId: 'some-other-team',
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

test('TEST 1 — resolves the OPPONENT\'s position, never the viewer\'s own (the core regression)', () => {
  const tableRows = [
    tableRow({ teamId: 'red-lion', position: 7 }),
    tableRow({ teamId: 'railway-tavern', position: 5 }),
  ];
  const result = resolveOpponentInfo(NEXT_MATCH, 'red-lion', tableRows, []);
  assert.equal(result.opponentId, 'railway-tavern');
  assert.equal(result.tableRow?.position, 5);
  assert.notEqual(result.tableRow?.position, 7, 'must not resolve to the viewer\'s own 7th place');
});

test('TEST 1b — works symmetrically when the viewer is the away team', () => {
  const tableRows = [
    tableRow({ teamId: 'red-lion', position: 7 }),
    tableRow({ teamId: 'railway-tavern', position: 5 }),
  ];
  // Viewer this time is Railway Tavern, so the opponent is Red Lion (7th)
  const result = resolveOpponentInfo(NEXT_MATCH, 'railway-tavern', tableRows, []);
  assert.equal(result.opponentId, 'red-lion');
  assert.equal(result.tableRow?.position, 7);
});

test('TEST 2 — opponent recent form comes from the opponent\'s own matches, not the viewer\'s', () => {
  const leagueMatches = [
    // Red Lion's own matches — all losses. Must NOT leak into the opponent's form.
    confirmedMatch({ id: 'rl1', homeTeamId: 'red-lion', awayTeamId: 'x', homeGamesWon: 1, awayGamesWon: 6 }),
    confirmedMatch({ id: 'rl2', homeTeamId: 'red-lion', awayTeamId: 'y', homeGamesWon: 2, awayGamesWon: 5 }),
    // Railway Tavern's own matches — all wins.
    confirmedMatch({ id: 'rt1', homeTeamId: 'railway-tavern', awayTeamId: 'x', homeGamesWon: 5, awayGamesWon: 2 }),
    confirmedMatch({ id: 'rt2', homeTeamId: 'railway-tavern', awayTeamId: 'y', homeGamesWon: 4, awayGamesWon: 3 }),
  ];
  const result = resolveOpponentInfo(NEXT_MATCH, 'red-lion', [], leagueMatches);
  assert.deepEqual(result.form, ['W', 'W'], 'should be Railway Tavern\'s wins, not Red Lion\'s losses');
});

test('TEST 3 — table row lookup is scoped to the fixture\'s own league/season/division, not just teamId', () => {
  const tableRows = [
    // Correct row for this fixture
    tableRow({ teamId: 'railway-tavern', seasonId: 'season-1', divisionId: 'division-1', leagueId: 'league-1', position: 5 }),
    // Same team, but a DIFFERENT division — must not be picked
    tableRow({ teamId: 'railway-tavern', seasonId: 'season-1', divisionId: 'division-9', leagueId: 'league-1', position: 1 }),
    // Same team, but a DIFFERENT season — must not be picked
    tableRow({ teamId: 'railway-tavern', seasonId: 'season-0', divisionId: 'division-1', leagueId: 'league-1', position: 3 }),
    // Same team, but a DIFFERENT league entirely — must not be picked
    tableRow({ teamId: 'railway-tavern', seasonId: 'season-1', divisionId: 'division-1', leagueId: 'league-9', position: 9 }),
  ];
  const result = resolveOpponentInfo(NEXT_MATCH, 'red-lion', tableRows, []);
  assert.equal(result.tableRow?.position, 5);
});

test('TEST 3b — opponent match history is scoped to the fixture\'s own league, cross-league matches excluded', () => {
  const leagueMatches = [
    confirmedMatch({ id: 'in-league', leagueId: 'league-1', homeTeamId: 'railway-tavern', awayTeamId: 'x', homeGamesWon: 5, awayGamesWon: 2 }),
    // Same opponent team, but a completely different league (e.g. they also
    // play in a friendly/cup elsewhere) — must be excluded from form.
    confirmedMatch({ id: 'cross-league', leagueId: 'league-9', homeTeamId: 'railway-tavern', awayTeamId: 'x', homeGamesWon: 1, awayGamesWon: 6 }),
  ];
  const result = resolveOpponentInfo(NEXT_MATCH, 'red-lion', [], leagueMatches);
  assert.deepEqual(result.form, ['W']);
});

test('no table row yet for the opponent (early season) resolves to null, not a crash or fabricated value', () => {
  const result = resolveOpponentInfo(NEXT_MATCH, 'red-lion', [], []);
  assert.equal(result.tableRow, null);
});

test('scheduled/unplayed opponent fixtures are not treated as completed form', () => {
  const leagueMatches = [
    confirmedMatch({ id: 'played', homeTeamId: 'railway-tavern', awayTeamId: 'x', homeGamesWon: 5, awayGamesWon: 2 }),
    confirmedMatch({ id: 'not-played', status: 'scheduled', homeTeamId: 'railway-tavern', awayTeamId: 'z', homeGamesWon: null, awayGamesWon: null }),
  ];
  const result = resolveOpponentInfo(NEXT_MATCH, 'red-lion', [], leagueMatches);
  assert.deepEqual(result.form, ['W']);
});

test('fewer completed opponent matches than the form window displays what is available, not fabricated', () => {
  const leagueMatches = [
    confirmedMatch({ id: 'only-one', homeTeamId: 'railway-tavern', awayTeamId: 'x', homeGamesWon: 5, awayGamesWon: 2 }),
  ];
  const result = resolveOpponentInfo(NEXT_MATCH, 'red-lion', [], leagueMatches);
  assert.deepEqual(result.form, ['W']);
});
