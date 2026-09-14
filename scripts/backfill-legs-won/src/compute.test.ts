import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLegsWonFromMatches } from './compute';
import type { MatchDoc, MatchGame } from './types';

// Same fixtures — and, critically, the same EXPECTED legsWon numbers — as
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

test('computeLegsWonFromMatches: matches functions/src computePlayerAccum numbers exactly (League)', () => {
  const result = computeLegsWonFromMatches([match()]);
  assert.equal(result.get('season-1_h1')!.legsWon, 2); // won legs 1 and 3
  assert.equal(result.get('season-1_a1')!.legsWon, 1); // won leg 2 only
  assert.equal(result.get('season-1_h2')!.legsWon, 0); // losing pairs side
  assert.equal(result.get('season-1_h3')!.legsWon, 0);
  assert.equal(result.get('season-1_a2')!.legsWon, 3); // winning pairs side, swept 3-0
  assert.equal(result.get('season-1_a3')!.legsWon, 3);
});

test('computeLegsWonFromMatches: TKO matches accumulate identically to League', () => {
  const league = computeLegsWonFromMatches([match({ id: 'm-league', competitionType: 'league' })]);
  const tko = computeLegsWonFromMatches([match({ id: 'm-tko', competitionType: 'tko' })]);
  assert.equal(tko.get('season-1_h1')!.legsWon, league.get('season-1_h1')!.legsWon);
  assert.equal(tko.get('season-1_a2')!.legsWon, league.get('season-1_a2')!.legsWon);
});

test('computeLegsWonFromMatches: Friendly matches contribute nothing', () => {
  const result = computeLegsWonFromMatches([match({ competitionType: 'friendly' })]);
  assert.equal(result.size, 0);
});

test('computeLegsWonFromMatches: a match with no competitionType field at all (legacy) is treated as League', () => {
  const withoutField = match();
  delete (withoutField as { competitionType?: unknown }).competitionType;
  const result = computeLegsWonFromMatches([withoutField]);
  assert.equal(result.get('season-1_h1')!.legsWon, 2);
});

test('computeLegsWonFromMatches: only confirmed matches count — scheduled/disputed/etc contribute nothing', () => {
  const result = computeLegsWonFromMatches([
    match({ id: 'm-disputed', status: 'disputed' }),
    match({ id: 'm-scheduled', status: 'scheduled', games: null }),
  ]);
  assert.equal(result.size, 0);
});

test('computeLegsWonFromMatches: sums across multiple confirmed matches for the same player/season', () => {
  const result = computeLegsWonFromMatches([match({ id: 'm1' }), match({ id: 'm2' })]);
  assert.equal(result.get('season-1_h1')!.legsWon, 4); // 2 legs won per match, 2 matches
});
