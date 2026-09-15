// Stats Rules audit (Season 1) coverage for computePlayerAccum — the pure
// core of applyMatchResultDelta. No Firestore/emulator needed here; see
// applyMatchResultDelta.emulator.test.ts for the confirm/correct/delete
// integration coverage against a real (emulated) Firestore.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePlayerAccum, type MatchGame } from './index';

const MATCH_ID = 'match-1';
const DATE = new Date('2026-01-01T00:00:00Z');
const HOME_TEAM = 'team-home';
const AWAY_TEAM = 'team-away';

// Singles game: home wins legs 1 & 3, away wins leg 2 (2-1 to home).
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

// Pairs game: away sweeps 3-0.
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

test('computePlayerAccum: singles legs-won attribution', () => {
  const accum = computePlayerAccum([singlesGame()], HOME_TEAM, AWAY_TEAM, MATCH_ID, DATE, 'league');
  const h1 = accum.get('h1')!;
  const a1 = accum.get('a1')!;
  assert.equal(h1.played, 1);
  assert.equal(h1.won, 1);
  assert.equal(h1.lost, 0);
  assert.equal(h1.legsWon, 2); // won legs 1 and 3
  assert.equal(h1.oneEighties, 1);
  assert.equal(a1.played, 1);
  assert.equal(a1.won, 0);
  assert.equal(a1.lost, 1);
  assert.equal(a1.legsWon, 1); // won leg 2 only
  assert.deepEqual(a1.highCheckouts, [{ value: '121', matchId: MATCH_ID, date: DATE }]);
  // League-only leaderboard counters: a League match updates these too.
  assert.equal(h1.leagueGamesPlayed, 1);
  assert.equal(h1.leagueGamesWon, 1);
  assert.equal(h1.leagueLegsPlayed, 3);
  assert.equal(h1.leagueLegsWon, 2);
  assert.equal(a1.leagueGamesPlayed, 1);
  assert.equal(a1.leagueGamesWon, 0);
  assert.equal(a1.leagueLegsPlayed, 3);
  assert.equal(a1.leagueLegsWon, 1);
});

test('computePlayerAccum: pairs legs-won attribution credits BOTH partnered players on every winning leg (League and league-only counters alike)', () => {
  const accum = computePlayerAccum([pairsGame()], HOME_TEAM, AWAY_TEAM, MATCH_ID, DATE, 'league');
  for (const id of ['h2', 'h3']) {
    const p = accum.get(id)!;
    assert.equal(p.played, 1);
    assert.equal(p.won, 0);
    assert.equal(p.lost, 1);
    assert.equal(p.legsWon, 0, `${id} (losing side) should have 0 legs won`);
    assert.equal(p.leagueGamesPlayed, 1);
    assert.equal(p.leagueGamesWon, 0);
    assert.equal(p.leagueLegsPlayed, 3);
    assert.equal(p.leagueLegsWon, 0);
  }
  for (const id of ['a2', 'a3']) {
    const p = accum.get(id)!;
    assert.equal(p.played, 1);
    assert.equal(p.won, 1);
    assert.equal(p.lost, 0);
    assert.equal(p.legsWon, 3, `${id} (winning side, swept 3-0) should be credited all 3 legs`);
    assert.equal(p.leagueGamesPlayed, 1);
    assert.equal(p.leagueGamesWon, 1);
    assert.equal(p.leagueLegsPlayed, 3);
    assert.equal(p.leagueLegsWon, 3, `${id} (pairs partner) should ALSO be credited all 3 legs on the League leaderboard counter`);
  }
});

test('computePlayerAccum: League and TKO accumulate identically on played/won/lost/legsWon/180s/checkouts, but TKO leaves the League-only leaderboard counters at zero', () => {
  const games = [singlesGame(), pairsGame()];
  const league = computePlayerAccum(games, HOME_TEAM, AWAY_TEAM, MATCH_ID, DATE, 'league');
  const tko = computePlayerAccum(games, HOME_TEAM, AWAY_TEAM, MATCH_ID, DATE, 'tko');

  for (const id of ['h1', 'a1', 'h2', 'h3', 'a2', 'a3']) {
    const l = league.get(id)!;
    const t = tko.get(id)!;
    assert.equal(t.played, l.played, `${id}: played should match between League and TKO`);
    assert.equal(t.won, l.won, `${id}: won should match between League and TKO`);
    assert.equal(t.lost, l.lost, `${id}: lost should match between League and TKO`);
    assert.equal(t.legsWon, l.legsWon, `${id}: legsWon should match between League and TKO`);
    assert.equal(t.oneEighties, l.oneEighties, `${id}: oneEighties should match between League and TKO`);
    assert.deepEqual(t.highCheckouts, l.highCheckouts, `${id}: highCheckouts should match between League and TKO`);

    // The Players Leaderboard is strictly League-only — a TKO match must
    // leave every one of these four at zero, even though its League
    // counterpart is nonzero for the same game data.
    assert.equal(t.leagueGamesPlayed, 0, `${id}: TKO must not affect leagueGamesPlayed`);
    assert.equal(t.leagueGamesWon, 0, `${id}: TKO must not affect leagueGamesWon`);
    assert.equal(t.leagueLegsPlayed, 0, `${id}: TKO must not affect leagueLegsPlayed`);
    assert.equal(t.leagueLegsWon, 0, `${id}: TKO must not affect leagueLegsWon`);
    assert.ok(l.leagueGamesPlayed > 0, `${id}: sanity check — League itself must actually update leagueGamesPlayed`);
  }
});

test('computePlayerAccum: Friendly contributes zero accumulation (played/won/lost/legsWon/180s/checkouts)', () => {
  const games = [singlesGame(), pairsGame()];
  const friendly = computePlayerAccum(games, HOME_TEAM, AWAY_TEAM, MATCH_ID, DATE, 'friendly');
  assert.equal(friendly.size, 0);
});

test('computePlayerAccum: 180s and high checkouts included for League + TKO, excluded entirely for Friendly', () => {
  const games = [singlesGame()];
  const league = computePlayerAccum(games, HOME_TEAM, AWAY_TEAM, MATCH_ID, DATE, 'league');
  const tko = computePlayerAccum(games, HOME_TEAM, AWAY_TEAM, MATCH_ID, DATE, 'tko');
  assert.equal(league.get('h1')!.oneEighties, 1);
  assert.equal(tko.get('h1')!.oneEighties, 1);
  assert.equal(league.get('a1')!.highCheckouts.length, 1);
  assert.equal(tko.get('a1')!.highCheckouts.length, 1);

  const friendly = computePlayerAccum(games, HOME_TEAM, AWAY_TEAM, MATCH_ID, DATE, 'friendly');
  assert.equal(friendly.get('h1'), undefined);
  assert.equal(friendly.get('a1'), undefined);
});
