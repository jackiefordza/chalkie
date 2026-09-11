// Coverage for MW-001's storage envelope: building/parsing a persisted
// result-entry draft, and the "is there anything worth protecting"
// heuristic that gates both autosave and the MW-002 leave-warning.
//
// Run with: npm test — see matchResultDraft.test.ts for the runner setup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankGames, hasAnyProgress, type DraftGame } from './matchResultDraft';
import { buildDraftPayload, parseDraftPayload, DRAFT_VERSION } from './resultDraftCodec';

function withOneSelection(): DraftGame[] {
  const games = blankGames();
  games[0] = { ...games[0], homePlayerIds: ['home-1'] };
  return games;
}

test('hasAnyProgress: false for a completely blank draft', () => {
  assert.equal(hasAnyProgress(blankGames()), false);
});

test('hasAnyProgress: true once a single player is selected', () => {
  assert.equal(hasAnyProgress(withOneSelection()), true);
});

test('hasAnyProgress: true for a 180 or high checkout alone, even with no players/score set', () => {
  const games = blankGames();
  games[0] = { ...games[0], oneEighties: [{ playerId: 'home-1', legIndex: 0 }] };
  assert.equal(hasAnyProgress(games), true);

  const games2 = blankGames();
  games2[0] = { ...games2[0], highCheckouts: [{ playerId: 'home-1', value: '121', legIndex: 0 }] };
  assert.equal(hasAnyProgress(games2), true);
});

test('buildDraftPayload -> parseDraftPayload round-trips for the same matchId', () => {
  const games = withOneSelection();
  const payload = buildDraftPayload('match-1', games, [2, 4], { 0: 1 });
  const restored = parseDraftPayload(JSON.stringify(payload), 'match-1');
  assert.ok(restored);
  assert.equal(restored?.version, DRAFT_VERSION);
  assert.equal(restored?.matchId, 'match-1');
  assert.deepEqual(restored?.games, games);
  assert.deepEqual(restored?.editedGameIndexes, [2, 4]);
  assert.deepEqual(restored?.activeLeg, { 0: 1 });
});

test('parseDraftPayload: a draft saved for a different match must never be restored (no cross-match leakage)', () => {
  const payload = buildDraftPayload('match-1', withOneSelection(), [], {});
  const restored = parseDraftPayload(JSON.stringify(payload), 'match-2');
  assert.equal(restored, null);
});

test('parseDraftPayload: missing/empty storage value returns null, not a crash', () => {
  assert.equal(parseDraftPayload(null, 'match-1'), null);
  assert.equal(parseDraftPayload(undefined, 'match-1'), null);
  assert.equal(parseDraftPayload('', 'match-1'), null);
});

test('parseDraftPayload: malformed JSON is ignored rather than thrown', () => {
  assert.equal(parseDraftPayload('{not valid json', 'match-1'), null);
});

test('parseDraftPayload: well-formed JSON with the wrong shape (missing fields) is ignored', () => {
  assert.equal(parseDraftPayload(JSON.stringify({ matchId: 'match-1' }), 'match-1'), null);
  assert.equal(parseDraftPayload(JSON.stringify({ version: DRAFT_VERSION, matchId: 'match-1' }), 'match-1'), null);
});

test('parseDraftPayload: a games array of the wrong length (corrupted/old format) is ignored', () => {
  const payload = buildDraftPayload('match-1', withOneSelection().slice(0, 3), [], {});
  assert.equal(parseDraftPayload(JSON.stringify(payload), 'match-1'), null);
});

test('parseDraftPayload: a future/older version number is ignored rather than partially trusted', () => {
  const payload = { ...buildDraftPayload('match-1', blankGames(), [], {}), version: DRAFT_VERSION + 1 };
  assert.equal(parseDraftPayload(JSON.stringify(payload), 'match-1'), null);
});
