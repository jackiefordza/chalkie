// Regression coverage for:
//  - BUG-007: 180s and high checkouts must be attributed to the correct
//    PLAYER, never fabricated or mixed up between players.
//  - Issue 6: the entry form no longer asks which leg a 180/checkout
//    happened in, so the leg each one lands on in the persisted MatchGame
//    must be derived deterministically from content alone (never from
//    entry order), so two independent submissions of the same real result
//    always compare equal (see onSubmissionWrite's gamesEqual in
//    functions/src/index.ts).
//
// Run with: npm test (see package.json) — compiles this file with tsc to
// plain CommonJS and runs it with Node's built-in test runner, so it needs
// no test framework dependency.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blankGames, toDraft, toMatchGame, isGameComplete, mergeGame,
  type DraftGame,
} from './matchResultDraft';
import type { MatchGame } from '@/types';

function matchGame(overrides: Partial<MatchGame> = {}): MatchGame {
  return {
    order: 1,
    type: 'singles',
    homePlayerIds: ['home-1'],
    awayPlayerIds: ['away-1'],
    legs: [
      { winner: 'home', oneEighties: [], highCheckout: null },
      { winner: 'home', oneEighties: [], highCheckout: null },
      { winner: 'away', oneEighties: [], highCheckout: null },
    ],
    ...overrides,
  };
}

function allOneEighties(g: MatchGame): string[] {
  return g.legs.flatMap((l) => l.oneEighties);
}

function allCheckouts(g: MatchGame): { playerId: string; value: string }[] {
  return g.legs.map((l) => l.highCheckout).filter((hc): hc is { playerId: string; value: string } => hc !== null);
}

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

function totalOneEighties(match: ReturnType<typeof toMatchGame>, playerId: string): number {
  return match.legs.reduce((n, l) => n + l.oneEighties.filter((id) => id === playerId).length, 0);
}

test('blankGames: 7 games, 5 singles then 2 pairs, all fields empty — 180 count starts at zero', () => {
  const games = blankGames();
  assert.equal(games.length, 7);
  assert.deepEqual(games.map((g) => g.type), ['singles', 'singles', 'singles', 'singles', 'singles', 'pairs', 'pairs']);
  games.forEach((g) => {
    assert.equal(g.score, null);
    assert.deepEqual(g.oneEighties, [], '180 count must start at zero, not look like one already happened');
    assert.deepEqual(g.highCheckouts, []);
  });
});

test('toMatchGame: a single 180 is attributed to the correct player, with no leg selected by the caller', () => {
  const draft = draftSinglesGame({ oneEighties: ['home-1'] });
  const match = toMatchGame(draft);
  assert.equal(totalOneEighties(match, 'home-1'), 1);
  assert.equal(totalOneEighties(match, 'away-1'), 0);
});

test('toMatchGame: incrementing a 180 count attributes it to the correct player, not the other one (BUG-007 attribution)', () => {
  const draft = draftSinglesGame({ oneEighties: ['home-1', 'home-1', 'away-1'] });
  const match = toMatchGame(draft);
  assert.equal(totalOneEighties(match, 'home-1'), 2);
  assert.equal(totalOneEighties(match, 'away-1'), 1);
});

test('toMatchGame: a high checkout is attributed to the correct player and keeps its value, with no leg selected', () => {
  const draft = draftSinglesGame({ highCheckouts: [{ playerId: 'away-1', value: '121' }] });
  const match = toMatchGame(draft);
  const checkouts = match.legs.map((l) => l.highCheckout).filter((hc) => hc !== null);
  assert.deepEqual(checkouts, [{ playerId: 'away-1', value: '121' }]);
});

test('toMatchGame: multiple 180s by different players in the same game are all kept, correctly attributed', () => {
  const draft = draftSinglesGame({
    type: 'pairs',
    homePlayerIds: ['home-1', 'home-2'],
    awayPlayerIds: ['away-1', 'away-2'],
    oneEighties: ['home-1', 'home-2'],
  });
  const match = toMatchGame(draft);
  assert.equal(totalOneEighties(match, 'home-1'), 1);
  assert.equal(totalOneEighties(match, 'home-2'), 1);
});

test('toMatchGame: season-total counting sums across all legs regardless of how they were distributed', () => {
  const draft = draftSinglesGame({ oneEighties: ['home-1', 'home-1', 'home-1'] });
  const match = toMatchGame(draft);
  assert.equal(totalOneEighties(match, 'home-1'), 3);
});

test('toMatchGame: two independent submissions of the SAME real result produce byte-identical games, regardless of entry order', () => {
  // Captain A taps: home-1 (180), then away-1 (180), then home-1 again
  const submissionA = draftSinglesGame({
    oneEighties: ['home-1', 'away-1', 'home-1'],
    highCheckouts: [{ playerId: 'away-1', value: '121' }, { playerId: 'home-1', value: '100' }],
  });
  // Captain B, reporting the identical real facts, taps in a totally different order
  const submissionB = draftSinglesGame({
    oneEighties: ['home-1', 'home-1', 'away-1'],
    highCheckouts: [{ playerId: 'home-1', value: '100' }, { playerId: 'away-1', value: '121' }],
  });
  assert.deepEqual(toMatchGame(submissionA), toMatchGame(submissionB));
});

test('toMatchGame: a checkout entered for a game with no 180s still lands correctly, high checkout is not required to have a leg picked', () => {
  const draft = draftSinglesGame({ score: { home: 3, away: 0 }, highCheckouts: [{ playerId: 'home-1', value: '170' }] });
  const match = toMatchGame(draft);
  assert.equal(match.legs.length, 3);
  const checkouts = match.legs.map((l) => l.highCheckout).filter((hc) => hc !== null);
  assert.deepEqual(checkouts, [{ playerId: 'home-1', value: '170' }]);
});

test('toDraft is the inverse of toMatchGame for total 180 counts and checkout content (round trip)', () => {
  const original = draftSinglesGame({
    oneEighties: ['home-1', 'away-1', 'home-1'],
    highCheckouts: [{ playerId: 'home-1', value: '100' }],
  });
  const roundTripped = toDraft([toMatchGame(original)])[0];
  assert.deepEqual([...roundTripped.oneEighties].sort(), [...original.oneEighties].sort());
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

test('mergeGame: combines each side\'s OWN players\' 180s/checkouts, pairings/score from home', () => {
  const home = matchGame({
    legs: [
      { winner: 'home', oneEighties: ['home-1'], highCheckout: null },
      { winner: 'home', oneEighties: [], highCheckout: { playerId: 'home-1', value: '100' } },
      { winner: 'away', oneEighties: [], highCheckout: null },
    ],
  });
  const away = matchGame({
    legs: [
      { winner: 'home', oneEighties: [], highCheckout: null },
      { winner: 'home', oneEighties: [], highCheckout: null },
      { winner: 'away', oneEighties: ['away-1'], highCheckout: { playerId: 'away-1', value: '121' } },
    ],
  });
  const merged = mergeGame(home, away);
  assert.deepEqual(allOneEighties(merged).sort(), ['away-1', 'home-1']);
  assert.deepEqual(
    allCheckouts(merged).sort((x, y) => x.playerId.localeCompare(y.playerId)),
    [{ playerId: 'away-1', value: '121' }, { playerId: 'home-1', value: '100' }],
  );
  assert.equal(merged.homePlayerIds[0], 'home-1');
  assert.equal(merged.awayPlayerIds[0], 'away-1');
});

test('mergeGame: ignores a stat wrongly present for the opponent\'s player, as a defense-in-depth re-check', () => {
  // Should never happen (server-side validation refuses this at write
  // time) but the merge itself must never trust it either.
  const home = matchGame({
    legs: [
      { winner: 'home', oneEighties: ['away-1'], highCheckout: null }, // not home's own player
      { winner: 'home', oneEighties: [], highCheckout: null },
      { winner: 'away', oneEighties: [], highCheckout: null },
    ],
  });
  const away = matchGame({ legs: matchGame().legs });
  const merged = mergeGame(home, away);
  assert.deepEqual(allOneEighties(merged), []);
});

// Own-team-only model (test spec: "matching scores reconcile correctly" /
// "the merged result contains both teams' independently submitted
// players") — a real home submission never contains away's player at all,
// and vice versa. This is the actual shape handleSubmissionWrite's two
// submissions take; the earlier "pairings/score from home" test above still
// passes with the old shared-both-sides fixture, but doesn't by itself
// prove the merge reaches into AWAY's own submission for away's pairing.
test('mergeGame: a disjoint own-side-only submission from each team still merges both real players in', () => {
  const home = matchGame({ homePlayerIds: ['home-1'], awayPlayerIds: [] });
  const away = matchGame({ homePlayerIds: [], awayPlayerIds: ['away-1'] });
  const merged = mergeGame(home, away);
  assert.deepEqual(merged.homePlayerIds, ['home-1']);
  assert.deepEqual(merged.awayPlayerIds, ['away-1']);
});

test('mergeGame: legWinnerSource picks whose score is authoritative, independent of pairings', () => {
  const home = matchGame({
    homePlayerIds: ['home-1'], awayPlayerIds: [],
    legs: [
      { winner: 'home', oneEighties: [], highCheckout: null },
      { winner: 'home', oneEighties: [], highCheckout: null },
      { winner: 'away', oneEighties: [], highCheckout: null },
    ],
  });
  const away = matchGame({
    homePlayerIds: [], awayPlayerIds: ['away-1'],
    legs: [
      { winner: 'away', oneEighties: [], highCheckout: null },
      { winner: 'away', oneEighties: [], highCheckout: null },
      { winner: 'home', oneEighties: [], highCheckout: null },
    ],
  });
  const mergedHomeScore = mergeGame(home, away, home);
  assert.deepEqual(mergedHomeScore.legs.map((l) => l.winner), ['home', 'home', 'away']);
  assert.deepEqual(mergedHomeScore.homePlayerIds, ['home-1']);
  assert.deepEqual(mergedHomeScore.awayPlayerIds, ['away-1']);

  const mergedAwayScore = mergeGame(home, away, away);
  assert.deepEqual(mergedAwayScore.legs.map((l) => l.winner), ['away', 'away', 'home']);
  assert.deepEqual(mergedAwayScore.homePlayerIds, ['home-1']);
  assert.deepEqual(mergedAwayScore.awayPlayerIds, ['away-1']);
});

test('isGameComplete: with no ownSide, requires both sides + score (admin correction of the full record)', () => {
  const incomplete = draftSinglesGame({ score: null });
  const complete = draftSinglesGame();
  assert.equal(isGameComplete(incomplete), false);
  assert.equal(isGameComplete(complete), true);
});

// Own-team-only model: a captain's own draft is complete once THEIR side's
// slots + score are filled — the opponent's side is never touched at all.
test('isGameComplete: with ownSide, only that side\'s player count + score is required', () => {
  const homeOnly = draftSinglesGame({ homePlayerIds: ['home-1'], awayPlayerIds: [] });
  assert.equal(isGameComplete(homeOnly, 'home'), true);
  assert.equal(isGameComplete(homeOnly, 'away'), false);

  const awayOnly = draftSinglesGame({ homePlayerIds: [], awayPlayerIds: ['away-1'] });
  assert.equal(isGameComplete(awayOnly, 'away'), true);
  assert.equal(isGameComplete(awayOnly, 'home'), false);

  const noScore = draftSinglesGame({ homePlayerIds: ['home-1'], awayPlayerIds: [], score: null });
  assert.equal(isGameComplete(noScore, 'home'), false);
});
