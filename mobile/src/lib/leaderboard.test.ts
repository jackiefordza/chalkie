import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareLeaderboard, legsPlayed } from './leaderboard';

// Minimal stats shape the comparator actually reads.
function stats(legsWon: number, won: number, played: number) {
  return { legsWon, won, played };
}

test('legsPlayed: always played * 3 (every game plays all 3 legs)', () => {
  assert.equal(legsPlayed({ played: 0 }), 0);
  assert.equal(legsPlayed({ played: 1 }), 3);
  assert.equal(legsPlayed({ played: 7 }), 21);
});

test('compareLeaderboard: legs won descending is the primary key', () => {
  const a = stats(20, 5, 10); // fewer legs won
  const b = stats(25, 5, 10); // more legs won
  assert.ok(compareLeaderboard(a, b) > 0, 'b (more legs won) should sort ahead of a');
  assert.ok(compareLeaderboard(b, a) < 0);
});

test('compareLeaderboard: tied on legs won falls back to individual games won', () => {
  const a = stats(20, 4, 10); // same legs won, fewer games won
  const b = stats(20, 6, 10); // same legs won, more games won
  assert.ok(compareLeaderboard(a, b) > 0, 'b (more games won) should sort ahead of a');
  assert.ok(compareLeaderboard(b, a) < 0);
});

test('compareLeaderboard: tied on legs won AND games won falls back to leg win-%', () => {
  // Same legsWon (15) and same won (5), but different played -> different leg win-%.
  const a = stats(15, 5, 10); // 15 / 30 = 50%
  const b = stats(15, 5, 8); // 15 / 24 = 62.5%
  assert.ok(compareLeaderboard(a, b) > 0, 'b (higher leg win-%) should sort ahead of a');
  assert.ok(compareLeaderboard(b, a) < 0);
});

test('compareLeaderboard: explicit case — higher individual-game win% but fewer legs won ranks LOWER', () => {
  // a: 4 games played, 4 won -> 100% game win-rate, but only 9 legs won (barely won each 3-0... actually
  // scraped narrow wins) out of a possible 12.
  const a = stats(9, 4, 4); // 100% games won, 9 legs won
  // b: 10 games played, 6 won -> 60% game win-rate, but 22 legs won out of a possible 30 (dominant play).
  const b = stats(22, 6, 10); // 60% games won, 22 legs won
  assert.ok(compareLeaderboard(a, b) > 0, 'b (fewer game wins, more legs won) must rank ABOVE a');
  assert.ok(compareLeaderboard(b, a) < 0, 'a (higher game win%, fewer legs won) must rank BELOW b');
});

test('compareLeaderboard: full ordering never uses win percentage as the primary key', () => {
  const players = [
    { id: 'low-legs-high-pct', ...stats(9, 4, 4) },
    { id: 'high-legs-low-pct', ...stats(22, 6, 10) },
    { id: 'mid', ...stats(15, 5, 9) },
  ];
  const sorted = [...players].sort(compareLeaderboard).map((p) => p.id);
  assert.deepEqual(sorted, ['high-legs-low-pct', 'mid', 'low-legs-high-pct']);
});
