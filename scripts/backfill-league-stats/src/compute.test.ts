import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLeagueStatsFromMatches } from './compute';
import type { MatchDoc, MatchGame } from './types';

// Same fixtures — and, critically, the same EXPECTED numbers — as
// functions/src/computePlayerAccum.test.ts. This is what proves this
// standalone script's independent implementation produces results
// identical to the live Cloud Function aggregation, per the Stats Rules
// audit's explicit "backfill produces identical results to live
// aggregation" requirement.
function singlesGame(): MatchGame {
  return {
    order: 1,
    type: 'singles',
    homePlayerIds: ['h1'],
    awayPlayerIds: ['a1'],
    legs: [
      { winner: 'home', oneEighties: ['h1'], highCheckout: null },
      { winner: 'away', oneEighties: [], highCheckout: { playerId: 'a1', value: '121' } },
      { winner: 'home', oneEighties: [], highCheckout: null },
    ],
  };
}

function pairsGame(): MatchGame {
  return {
    order: 6,
    type: 'pairs',
    homePlayerIds: ['h2', 'h3'],
    awayPlayerIds: ['a2', 'a3'],
    legs: [
      { winner: 'away', oneEighties: [], highCheckout: null },
      { winner: 'away', oneEighties: [], highCheckout: null },
      { winner: 'away', oneEighties: [], highCheckout: null },
    ],
  };
}

function match(overrides: Partial<MatchDoc> = {}): MatchDoc {
  return {
    id: 'match-1',
    seasonId: 'season-1',
    homeTeamId: 'team-home',
    awayTeamId: 'team-away',
    status: 'confirmed',
    competitionType: 'league',
    games: [singlesGame(), pairsGame()],
    ...overrides,
  };
}

test('computeLeagueStatsFromMatches: matches functions/src computePlayerAccum numbers exactly (League)', () => {
  const result = computeLeagueStatsFromMatches([match()]);
  const h1 = result.get('season-1_h1')!;
  const a1 = result.get('season-1_a1')!;
  const h2 = result.get('season-1_h2')!;
  const a2 = result.get('season-1_a2')!;
  assert.equal(h1.leagueLegsWon, 2); // won legs 1 and 3
  assert.equal(h1.leagueLegsPlayed, 3);
  assert.equal(h1.leagueGamesWon, 1);
  assert.equal(h1.leagueGamesPlayed, 1);
  assert.equal(a1.leagueLegsWon, 1); // won leg 2 only
  assert.equal(a1.leagueGamesWon, 0);
  assert.equal(h2.leagueLegsWon, 0); // losing pairs side
  assert.equal(h2.leagueGamesWon, 0);
  assert.equal(a2.leagueLegsWon, 3, 'winning pairs side, swept 3-0 — BOTH partners credited'); // pairs credit
  assert.equal(a2.leagueGamesWon, 1);
});

// Corrected Stats Rules model: unlike the original legsWon field, TKO must
// contribute ZERO to these League-only counters — this is the exact
// discrepancy this backfill exists to correct.
test('computeLeagueStatsFromMatches: TKO matches contribute NOTHING (unlike the old League+TKO legsWon field)', () => {
  const tko = computeLeagueStatsFromMatches([match({ id: 'm-tko', competitionType: 'tko' })]);
  assert.equal(tko.size, 0, 'a TKO-only match must produce zero League-leaderboard entries');
});

test('computeLeagueStatsFromMatches: Friendly matches contribute nothing', () => {
  const result = computeLeagueStatsFromMatches([match({ competitionType: 'friendly' })]);
  assert.equal(result.size, 0);
});

test('computeLeagueStatsFromMatches: a match with no competitionType field at all (legacy) is treated as League', () => {
  const withoutField = match();
  delete (withoutField as { competitionType?: unknown }).competitionType;
  const result = computeLeagueStatsFromMatches([withoutField]);
  assert.equal(result.get('season-1_h1')!.leagueLegsWon, 2);
  assert.equal(result.get('season-1_h1')!.leagueGamesPlayed, 1);
});

test('computeLeagueStatsFromMatches: only confirmed League matches count — scheduled/disputed/TKO/Friendly contribute nothing', () => {
  const result = computeLeagueStatsFromMatches([
    match({ id: 'm-disputed', status: 'disputed' }),
    match({ id: 'm-scheduled', status: 'scheduled', games: null }),
    match({ id: 'm-tko', competitionType: 'tko' }),
    match({ id: 'm-friendly', competitionType: 'friendly' }),
  ]);
  assert.equal(result.size, 0);
});

test('computeLeagueStatsFromMatches: sums across multiple confirmed League matches for the same player/season', () => {
  const result = computeLeagueStatsFromMatches([match({ id: 'm1' }), match({ id: 'm2' })]);
  assert.equal(result.get('season-1_h1')!.leagueLegsWon, 4); // 2 legs won per match, 2 matches
  assert.equal(result.get('season-1_h1')!.leagueLegsPlayed, 6); // 3 legs played per match, 2 matches
  assert.equal(result.get('season-1_h1')!.leagueGamesPlayed, 2);
});

test('computeLeagueStatsFromMatches: mixing a League match and a TKO match only counts the League one', () => {
  const result = computeLeagueStatsFromMatches([
    match({ id: 'm-league', competitionType: 'league' }),
    match({ id: 'm-tko', competitionType: 'tko' }),
  ]);
  // Same numbers as the single League-match test above — the TKO match adds nothing.
  assert.equal(result.get('season-1_h1')!.leagueLegsWon, 2);
  assert.equal(result.get('season-1_h1')!.leagueGamesPlayed, 1);
});
