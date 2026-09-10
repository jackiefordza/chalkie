// Regression coverage for BUG-007: 180s and high checkouts submitted through
// the result-entry form must land on the leg they were actually entered
// against, not be fabricated onto leg 0 / mapped by array position.
//
// Run with: npm test (see package.json) — compiles this file with tsc to
// plain CommonJS and runs it with Node's built-in test runner, so it needs
// no test framework dependency.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blankGames, toDraft, toMatchGame, normalizeGameForCompare, isGameComplete, type DraftGame,
} from './matchResultDraft';

function draftSinglesGame(overrides: Partial<DraftGame> = {}): DraftGame {
  return {
    order: 1,
    type: 'singles',
    homePlayerIds: ['home-1'],
    awayPlayerIds: ['away-1'],
    score: { home: 2, away: 1 },
    oneEighties: [],
    highCheckouts: [],
    ...overrides,
  };
}

test('blankGames: 7 games, 5 singles then 2 pairs, all fields empty', () => {
  const games = blankGames();
  assert.equal(games.length, 7);
  assert.deepEqual(games.map((g) => g.type), ['singles', 'singles', 'singles', 'singles', 'singles', 'pairs', 'pairs']);
  games.forEach((g) => {
    assert.equal(g.score, null);
    assert.deepEqual(g.oneEighties, []);
    assert.deepEqual(g.highCheckouts, []);
  });
});

test('toMatchGame: a 180 entered for leg 2 lands on legs[1], not legs[0] (BUG-007)', () => {
  // score 2-1 => winners = [home, home, away] => legs[0]/[1] home, legs[2] away
  const draft = draftSinglesGame({
    oneEighties: [{ playerId: 'home-1', legIndex: 1 }],
  });
  const match = toMatchGame(draft);
  assert.deepEqual(match.legs[0].oneEighties, [], 'leg 1 must stay empty — this is exactly the old fabrication bug');
  assert.deepEqual(match.legs[1].oneEighties, ['home-1']);
  assert.deepEqual(match.legs[2].oneEighties, []);
});

test('toMatchGame: a high checkout entered for leg 3 lands on legs[2], not mapped by array index', () => {
  const draft = draftSinglesGame({
    highCheckouts: [{ playerId: 'away-1', value: '121', legIndex: 2 }],
  });
  const match = toMatchGame(draft);
  assert.equal(match.legs[0].highCheckout, null);
  assert.equal(match.legs[1].highCheckout, null);
  assert.deepEqual(match.legs[2].highCheckout, { playerId: 'away-1', value: '121' });
});

test('toMatchGame: multiple 180s in the same leg by different players are both kept', () => {
  const draft = draftSinglesGame({
    type: 'pairs',
    homePlayerIds: ['home-1', 'home-2'],
    awayPlayerIds: ['away-1', 'away-2'],
    oneEighties: [
      { playerId: 'home-1', legIndex: 0 },
      { playerId: 'home-2', legIndex: 0 },
    ],
  });
  const match = toMatchGame(draft);
  assert.deepEqual(new Set(match.legs[0].oneEighties), new Set(['home-1', 'home-2']));
  assert.deepEqual(match.legs[1].oneEighties, []);
  assert.deepEqual(match.legs[2].oneEighties, []);
});

test('toMatchGame: the same player throwing 180s in two different legs is attributed to both, correctly', () => {
  const draft = draftSinglesGame({
    oneEighties: [
      { playerId: 'home-1', legIndex: 0 },
      { playerId: 'home-1', legIndex: 1 },
    ],
  });
  const match = toMatchGame(draft);
  assert.deepEqual(match.legs[0].oneEighties, ['home-1']);
  assert.deepEqual(match.legs[1].oneEighties, ['home-1']);
  assert.deepEqual(match.legs[2].oneEighties, []);
  // Season-total counting (functions/src/index.ts computePlayerAccum) sums
  // across all legs, so this player's total-180 contribution from this game
  // is still exactly 2 — unaffected by the per-leg fix.
  const totalFromThisGame = match.legs.reduce((n, l) => n + l.oneEighties.filter((id) => id === 'home-1').length, 0);
  assert.equal(totalFromThisGame, 2);
});

test('toDraft is the inverse of toMatchGame for per-leg 180s/checkouts (round trip)', () => {
  const original = draftSinglesGame({
    oneEighties: [
      { playerId: 'home-1', legIndex: 0 },
      { playerId: 'away-1', legIndex: 2 },
    ],
    highCheckouts: [{ playerId: 'home-1', value: '100', legIndex: 1 }],
  });
  const roundTripped = toDraft([toMatchGame(original)])[0];
  assert.deepEqual(
    new Set(roundTripped.oneEighties.map((o) => `${o.legIndex}:${o.playerId}`)),
    new Set(original.oneEighties.map((o) => `${o.legIndex}:${o.playerId}`)),
  );
  assert.deepEqual(roundTripped.highCheckouts, original.highCheckouts);
  assert.deepEqual(roundTripped.score, original.score);
});

test('toMatchGame: a game with no 180s/checkouts at all still produces the right number of legs with empty detail', () => {
  const draft = draftSinglesGame({ score: { home: 3, away: 0 } });
  const match = toMatchGame(draft);
  assert.equal(match.legs.length, 3);
  match.legs.forEach((leg) => {
    assert.deepEqual(leg.oneEighties, []);
    assert.equal(leg.highCheckout, null);
    assert.equal(leg.winner, 'home');
  });
});

test('normalizeGameForCompare: same 180s/checkouts in different entry order compare equal', () => {
  const a = draftSinglesGame({
    oneEighties: [{ playerId: 'home-1', legIndex: 0 }, { playerId: 'away-1', legIndex: 1 }],
  });
  const b = draftSinglesGame({
    oneEighties: [{ playerId: 'away-1', legIndex: 1 }, { playerId: 'home-1', legIndex: 0 }],
  });
  assert.equal(normalizeGameForCompare(a), normalizeGameForCompare(b));
});

test('normalizeGameForCompare: same player/value but a DIFFERENT leg compares unequal (regression guard for the leg-dropping bug)', () => {
  const a = draftSinglesGame({ oneEighties: [{ playerId: 'home-1', legIndex: 0 }] });
  const b = draftSinglesGame({ oneEighties: [{ playerId: 'home-1', legIndex: 1 }] });
  assert.notEqual(normalizeGameForCompare(a), normalizeGameForCompare(b));
});

test('isGameComplete: unaffected by this fix — still just player counts + score', () => {
  const incomplete = draftSinglesGame({ score: null });
  const complete = draftSinglesGame();
  assert.equal(isGameComplete(incomplete), false);
  assert.equal(isGameComplete(complete), true);
});
