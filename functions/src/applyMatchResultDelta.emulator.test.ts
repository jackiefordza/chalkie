// Stats Rules audit (Season 1) — integration coverage for legsWon flowing
// through applyMatchResultDelta's real Firestore writes, across confirm ->
// admin correction -> delete. Requires a local Firestore emulator (see
// package.json's `test` script, which wraps this whole suite in
// `firebase-tools emulators:exec --only firestore --project demo-...` —
// FIRESTORE_EMULATOR_HOST and the project ID are supplied by that wrapper
// before this file's `import './index'` ever runs). Never touches the real
// chalkie-app project — this only ever talks to the emulator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMatchResultDelta, db, type MatchGame } from './index';

const SEASON_ID = 'season-1';
const DIVISION_ID = 'division-1';
const LEAGUE_ID = 'league-1';
const HOME_TEAM = 'team-home';
const AWAY_TEAM = 'team-away';
const DATE = new Date('2026-01-01T00:00:00Z');

function singlesGame(
  homePlayerId: string, awayPlayerId: string, winners: ('home' | 'away')[],
  highCheckout?: { side: 'home' | 'away'; legIndex: number; value: string },
): MatchGame {
  return {
    order: 1,
    type: 'singles',
    homePlayerIds: [homePlayerId],
    awayPlayerIds: [awayPlayerId],
    legs: winners.map((winner, i) => ({
      winner,
      oneEighties: [],
      highCheckout: highCheckout && highCheckout.legIndex === i
        ? { playerId: highCheckout.side === 'home' ? homePlayerId : awayPlayerId, value: highCheckout.value }
        : null,
    })),
  };
}

async function readStats(playerId: string) {
  const snap = await db.doc(`playerSeasonStats/${SEASON_ID}_${playerId}`).get();
  return snap.exists ? snap.data()! : null;
}

async function clearStats(...playerIds: string[]) {
  await Promise.all(playerIds.map((id) => db.doc(`playerSeasonStats/${SEASON_ID}_${id}`).delete().catch(() => {})));
}

test('applyMatchResultDelta: legsWon AND league-only leaderboard counters stay consistent through confirm -> admin correction -> delete', async () => {
  await clearStats('p1', 'p2');
  const matchId = 'match-consistency';

  // Confirm: p1 (home) wins 2-1.
  await applyMatchResultDelta({
    matchId, leagueId: LEAGUE_ID, seasonId: SEASON_ID, divisionId: DIVISION_ID,
    homeTeamId: HOME_TEAM, awayTeamId: AWAY_TEAM, scheduledDate: DATE, competitionType: 'league',
    oldGames: [], newGames: [singlesGame('p1', 'p2', ['home', 'home', 'away'])], playedDelta: 1,
  });
  let p1 = await readStats('p1');
  let p2 = await readStats('p2');
  assert.equal(p1!.legsWon, 2);
  assert.equal(p1!.won, 1);
  assert.equal(p1!.played, 1);
  assert.equal(p2!.legsWon, 1);
  assert.equal(p2!.lost, 1);
  assert.equal(p1!.leagueLegsWon, 2);
  assert.equal(p1!.leagueLegsPlayed, 3);
  assert.equal(p1!.leagueGamesWon, 1);
  assert.equal(p1!.leagueGamesPlayed, 1);
  assert.equal(p2!.leagueLegsWon, 1);
  assert.equal(p2!.leagueLegsPlayed, 3);
  assert.equal(p2!.leagueGamesWon, 0);
  assert.equal(p2!.leagueGamesPlayed, 1);

  // Admin correction: actually p2 (away) won 2-1, not p1.
  await applyMatchResultDelta({
    matchId, leagueId: LEAGUE_ID, seasonId: SEASON_ID, divisionId: DIVISION_ID,
    homeTeamId: HOME_TEAM, awayTeamId: AWAY_TEAM, scheduledDate: DATE, competitionType: 'league',
    oldGames: [singlesGame('p1', 'p2', ['home', 'home', 'away'])],
    newGames: [singlesGame('p1', 'p2', ['away', 'away', 'home'])],
    playedDelta: 0,
  });
  p1 = await readStats('p1');
  p2 = await readStats('p2');
  assert.equal(p1!.legsWon, 1, 'p1 now only won 1 leg after correction');
  assert.equal(p1!.won, 0);
  assert.equal(p1!.lost, 1);
  assert.equal(p1!.played, 1, 'playedDelta 0 on correction — still just the one game');
  assert.equal(p2!.legsWon, 2);
  assert.equal(p2!.won, 1);
  assert.equal(p1!.leagueLegsWon, 1, 'league leg count must also drop after correction');
  assert.equal(p1!.leagueGamesWon, 0);
  assert.equal(p1!.leagueLegsPlayed, 3, 'legs played unchanged — still one game, still 3 legs');
  assert.equal(p1!.leagueGamesPlayed, 1);
  assert.equal(p2!.leagueLegsWon, 2);
  assert.equal(p2!.leagueGamesWon, 1);

  // Delete: fully reverse.
  await applyMatchResultDelta({
    matchId, leagueId: LEAGUE_ID, seasonId: SEASON_ID, divisionId: DIVISION_ID,
    homeTeamId: HOME_TEAM, awayTeamId: AWAY_TEAM, scheduledDate: DATE, competitionType: 'league',
    oldGames: [singlesGame('p1', 'p2', ['away', 'away', 'home'])],
    newGames: [],
    playedDelta: -1,
  });
  p1 = await readStats('p1');
  p2 = await readStats('p2');
  assert.equal(p1!.legsWon, 0);
  assert.equal(p1!.played, 0);
  assert.equal(p2!.legsWon, 0);
  assert.equal(p2!.played, 0);
  assert.equal(p1!.leagueLegsWon, 0);
  assert.equal(p1!.leagueLegsPlayed, 0);
  assert.equal(p1!.leagueGamesWon, 0);
  assert.equal(p1!.leagueGamesPlayed, 0);
  assert.equal(p2!.leagueLegsWon, 0);
  assert.equal(p2!.leagueLegsPlayed, 0);
  assert.equal(p2!.leagueGamesWon, 0);
  assert.equal(p2!.leagueGamesPlayed, 0);
});

test('applyMatchResultDelta: a TKO match updates 180s/high checkouts/legsWon but leaves the League-only leaderboard counters at zero', async () => {
  await clearStats('p7', 'p8');
  await applyMatchResultDelta({
    matchId: 'match-tko', leagueId: LEAGUE_ID, seasonId: SEASON_ID, divisionId: DIVISION_ID,
    homeTeamId: HOME_TEAM, awayTeamId: AWAY_TEAM, scheduledDate: DATE, competitionType: 'tko',
    oldGames: [],
    newGames: [singlesGame('p7', 'p8', ['home', 'home', 'away'], { side: 'home', legIndex: 0, value: '100' })],
    playedDelta: 1,
  });
  const p7 = await readStats('p7');
  const p8 = await readStats('p8');
  // Season achievement scope (League + TKO) — these DO update for TKO.
  assert.equal(p7!.legsWon, 2);
  assert.equal(p7!.won, 1);
  assert.equal(p7!.played, 1);
  assert.deepEqual(p7!.highCheckouts.map((h: { value: string }) => h.value), ['100']);
  // Players Leaderboard scope (League only) — TKO must leave these at zero.
  assert.equal(p7!.leagueLegsWon, 0, 'TKO must not credit the League leaderboard');
  assert.equal(p7!.leagueLegsPlayed, 0);
  assert.equal(p7!.leagueGamesWon, 0);
  assert.equal(p7!.leagueGamesPlayed, 0);
  assert.equal(p8!.leagueLegsWon, 0);
  assert.equal(p8!.leagueLegsPlayed, 0);
  assert.equal(p8!.leagueGamesWon, 0);
  assert.equal(p8!.leagueGamesPlayed, 0);
});

test('applyMatchResultDelta: legsWon delta applies correctly even when highCheckouts change on the same correction', () => {
  // Regression guard: deltaLegsWon is computed twice in applyMatchResultDelta
  // (once for players whose highCheckouts didn't change, via statsBatch; once
  // for players whose highCheckouts DID change, via the read-rebuild-write
  // path) — this exercises the second path specifically.
  return (async () => {
    await clearStats('p5', 'p6');
    const matchId = 'match-checkout-and-legs';

    // Confirm: p5 wins legs 1 & 2 (legsWon=2), with a checkout of '100' on leg 1.
    await applyMatchResultDelta({
      matchId, leagueId: LEAGUE_ID, seasonId: SEASON_ID, divisionId: DIVISION_ID,
      homeTeamId: HOME_TEAM, awayTeamId: AWAY_TEAM, scheduledDate: DATE, competitionType: 'league',
      oldGames: [],
      newGames: [singlesGame('p5', 'p6', ['home', 'home', 'away'], { side: 'home', legIndex: 0, value: '100' })],
      playedDelta: 1,
    });
    let p5 = await readStats('p5');
    assert.equal(p5!.legsWon, 2);
    assert.deepEqual(p5!.highCheckouts.map((h: { value: string }) => h.value), ['100']);

    // Correction: p5 now only wins leg 1 (legsWon=1), and that leg's checkout
    // value changes to '140' — both the leg-win count AND the checkout
    // change in the same write.
    await applyMatchResultDelta({
      matchId, leagueId: LEAGUE_ID, seasonId: SEASON_ID, divisionId: DIVISION_ID,
      homeTeamId: HOME_TEAM, awayTeamId: AWAY_TEAM, scheduledDate: DATE, competitionType: 'league',
      oldGames: [singlesGame('p5', 'p6', ['home', 'home', 'away'], { side: 'home', legIndex: 0, value: '100' })],
      newGames: [singlesGame('p5', 'p6', ['home', 'away', 'away'], { side: 'home', legIndex: 0, value: '140' })],
      playedDelta: 0,
    });
    p5 = await readStats('p5');
    assert.equal(p5!.legsWon, 1, 'legsWon must drop to 1 even though this went through the checkout-rebuild path');
    assert.deepEqual(p5!.highCheckouts.map((h: { value: string }) => h.value), ['140']);
  })();
});

test('applyMatchResultDelta: a Friendly match never writes anything to playerSeasonStats', async () => {
  await clearStats('p3', 'p4');
  await applyMatchResultDelta({
    matchId: 'match-friendly', leagueId: LEAGUE_ID, seasonId: SEASON_ID, divisionId: DIVISION_ID,
    homeTeamId: HOME_TEAM, awayTeamId: AWAY_TEAM, scheduledDate: DATE, competitionType: 'friendly',
    oldGames: [], newGames: [singlesGame('p3', 'p4', ['home', 'home', 'away'])], playedDelta: 1,
  });
  assert.equal(await readStats('p3'), null);
  assert.equal(await readStats('p4'), null);
});
