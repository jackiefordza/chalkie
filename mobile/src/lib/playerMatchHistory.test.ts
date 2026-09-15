import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePlayerSinglesGames } from './playerMatchHistory';
import type { Match, MatchGame, MatchLeg } from '@/types';

function leg(winner: 'home' | 'away'): MatchLeg {
  return { winner, oneEighties: [], highCheckout: null };
}

function singlesGame(order: number, homePlayerId: string, awayPlayerId: string, legs: MatchLeg[]): MatchGame {
  return { order, type: 'singles', homePlayerIds: [homePlayerId], awayPlayerIds: [awayPlayerId], legs };
}

function pairsGame(order: number, homePlayerIds: string[], awayPlayerIds: string[], legs: MatchLeg[]): MatchGame {
  return { order, type: 'pairs', homePlayerIds, awayPlayerIds, legs };
}

function confirmedMatch(id: string, games: MatchGame[]): Match {
  return {
    id,
    leagueId: 'league-1',
    seasonId: 'season-1',
    divisionId: 'division-1',
    round: 1,
    homeTeamId: 'team-home',
    awayTeamId: 'team-away',
    scheduledDate: new Date('2026-09-01'),
    venue: null,
    status: 'confirmed',
    competitionType: 'league',
    homeGamesWon: 4,
    awayGamesWon: 3,
    homeLegsWon: 12,
    awayLegsWon: 10,
    games,
    createdAt: new Date('2026-08-01'),
  };
}

test('a player who won their singles game 2-1 shows legsWon=2, legsLost=1, won=true', () => {
  const match = confirmedMatch('m1', [
    singlesGame(1, 'player-a', 'player-b', [leg('home'), leg('away'), leg('home')]),
  ]);
  const result = computePlayerSinglesGames([match], 'player-a');
  assert.deepEqual(result, [{ match, won: true, legsWon: 2, legsLost: 1 }]);
});

test('a player who lost their singles game 1-2 shows legsWon=1, legsLost=2, won=false', () => {
  const match = confirmedMatch('m1', [
    singlesGame(1, 'player-a', 'player-b', [leg('away'), leg('home'), leg('away')]),
  ]);
  const result = computePlayerSinglesGames([match], 'player-b');
  assert.deepEqual(result, [{ match, won: true, legsWon: 2, legsLost: 1 }]);
  const asAway = computePlayerSinglesGames([match], 'player-a');
  assert.deepEqual(asAway, [{ match, won: false, legsWon: 1, legsLost: 2 }]);
});

test('a player who only played doubles (pairs) in a match is excluded entirely — doubles ignored', () => {
  const match = confirmedMatch('m1', [
    singlesGame(1, 'player-x', 'player-y', [leg('home'), leg('home')]),
    pairsGame(6, ['player-a', 'player-c'], ['player-b', 'player-d'], [leg('away'), leg('away')]),
  ]);
  const result = computePlayerSinglesGames([match], 'player-a');
  assert.deepEqual(result, []);
});

test('a player who played BOTH a singles game and a pairs game in the same match: only the singles result is returned — the doubles result never mixes in', () => {
  const match = confirmedMatch('m1', [
    // Won their singles 2-0
    singlesGame(1, 'player-a', 'player-b', [leg('home'), leg('home')]),
    // Lost their doubles 0-2 — must have zero effect on the returned entry
    pairsGame(6, ['player-a', 'player-c'], ['player-d', 'player-e'], [leg('away'), leg('away')]),
  ]);
  const result = computePlayerSinglesGames([match], 'player-a');
  assert.deepEqual(result, [{ match, won: true, legsWon: 2, legsLost: 0 }]);
});

test('an unconfirmed match is excluded even if games are present', () => {
  const match: Match = {
    ...confirmedMatch('m1', [singlesGame(1, 'player-a', 'player-b', [leg('home'), leg('home')])]),
    status: 'awaiting_confirmation',
  };
  const result = computePlayerSinglesGames([match], 'player-a');
  assert.deepEqual(result, []);
});

test('a player not part of any game in the match is excluded', () => {
  const match = confirmedMatch('m1', [
    singlesGame(1, 'player-x', 'player-y', [leg('home'), leg('home')]),
  ]);
  const result = computePlayerSinglesGames([match], 'player-a');
  assert.deepEqual(result, []);
});

test('multiple matches: one entry per match the player has a singles game in, in input order', () => {
  const m1 = confirmedMatch('m1', [singlesGame(1, 'player-a', 'player-b', [leg('home'), leg('home')])]);
  const m2 = confirmedMatch('m2', [singlesGame(1, 'player-c', 'player-a', [leg('away'), leg('away')])]);
  const result = computePlayerSinglesGames([m1, m2], 'player-a');
  assert.equal(result.length, 2);
  assert.equal(result[0].match.id, 'm1');
  assert.equal(result[0].won, true);
  assert.equal(result[1].match.id, 'm2');
  assert.equal(result[1].won, true); // player-a is away, and away won both legs
});
