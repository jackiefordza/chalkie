import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareLeaderboard } from './leaderboard';

// Minimal stats shape the comparator actually reads — League-only fields.
function stats(leagueLegsWon: number, leagueGamesWon: number, leagueLegsPlayed: number) {
  return { leagueLegsWon, leagueGamesWon, leagueLegsPlayed };
}

test('compareLeaderboard: League legs won descending is the primary key', () => {
  const a = stats(20, 5, 30); // fewer legs won
  const b = stats(25, 5, 30); // more legs won
  assert.ok(compareLeaderboard(a, b) > 0, 'b (more legs won) should sort ahead of a');
  assert.ok(compareLeaderboard(b, a) < 0);
});

test('compareLeaderboard: tied on League legs won falls back to League individual games won', () => {
  const a = stats(20, 4, 30); // same legs won, fewer games won
  const b = stats(20, 6, 30); // same legs won, more games won
  assert.ok(compareLeaderboard(a, b) > 0, 'b (more games won) should sort ahead of a');
  assert.ok(compareLeaderboard(b, a) < 0);
});

test('compareLeaderboard: tied on League legs won AND games won falls back to League leg win-%', () => {
  // Same leagueLegsWon (15) and same leagueGamesWon (5), but different
  // leagueLegsPlayed -> different leg win-%.
  const a = stats(15, 5, 30); // 15 / 30 = 50%
  const b = stats(15, 5, 24); // 15 / 24 = 62.5%
  assert.ok(compareLeaderboard(a, b) > 0, 'b (higher leg win-%) should sort ahead of a');
  assert.ok(compareLeaderboard(b, a) < 0);
});

test('compareLeaderboard: explicit case — higher individual-game win% but fewer legs won ranks LOWER', () => {
  // a: 4 League games played, 4 won -> 100% game win-rate, but only 9 legs
  // won (barely won each, narrow wins) out of a possible 12.
  const a = stats(9, 4, 12); // 100% games won, 9 legs won
  // b: 10 League games played, 6 won -> 60% game win-rate, but 22 legs won
  // out of a possible 30 (dominant play).
  const b = stats(22, 6, 30); // 60% games won, 22 legs won
  assert.ok(compareLeaderboard(a, b) > 0, 'b (fewer game wins, more legs won) must rank ABOVE a');
  assert.ok(compareLeaderboard(b, a) < 0, 'a (higher game win%, fewer legs won) must rank BELOW b');
});

test('compareLeaderboard: full ordering never uses win percentage as the primary key', () => {
  const players = [
    { id: 'low-legs-high-pct', ...stats(9, 4, 12) },
    { id: 'high-legs-low-pct', ...stats(22, 6, 30) },
    { id: 'mid', ...stats(15, 5, 27) },
  ];
  const sorted = [...players].sort(compareLeaderboard).map((p) => p.id);
  assert.deepEqual(sorted, ['high-legs-low-pct', 'mid', 'low-legs-high-pct']);
});

// Corrected Stats Rules model (Players Leaderboard is STRICTLY League-only):
// adding TKO legs/games to a player must never change their leaderboard
// position, since the comparator only ever reads the League-only fields —
// this is exercised at the compareLeaderboard level by simply never letting
// a TKO contribution appear in leagueLegsWon/leagueGamesWon/leagueLegsPlayed
// in the first place (proven server-side in computePlayerAccum.test.ts's
// "TKO leaves the League-only leaderboard counters at zero" case). Here we
// confirm the comparator itself is blind to anything but those three fields:
// two players with identical League-only stats rank as a dead heat (order
// preserved) no matter what other (non-league) numbers might differ.
test('compareLeaderboard: only reads leagueLegsWon/leagueGamesWon/leagueLegsPlayed — nothing else can move the ranking', () => {
  const a = { leagueLegsWon: 20, leagueGamesWon: 6, leagueLegsPlayed: 30, legsWon: 999, won: 999, played: 999, oneEighties: 999 };
  const b = { leagueLegsWon: 20, leagueGamesWon: 6, leagueLegsPlayed: 30, legsWon: 0, won: 0, played: 0, oneEighties: 0 };
  assert.equal(compareLeaderboard(a, b), 0, 'identical League-only stats must tie, regardless of season-wide (League+TKO) totals');
});
