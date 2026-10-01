// Regression coverage for the duplicate-player-name fix: Add Player
// previously had no uniqueness check at all, so adding the same name twice
// silently created two separate player documents (see the PR #39 manual
// walkthrough report's COSMETIC finding). These tests cover the pure
// normalization/ID logic in players.ts; the transactional Firestore
// behaviour itself (the actual race-safety guarantee) is covered by the
// emulator-backed manual verification, not here — see players.ts for why
// this file has no Firebase import.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DuplicatePlayerNameError, normalizePlayerName, playerDocId, findDuplicateName } from './players';

test('normalizePlayerName trims leading/trailing whitespace', () => {
  assert.equal(normalizePlayerName('  Paul  '), 'paul');
});

test('normalizePlayerName is case-insensitive', () => {
  assert.equal(normalizePlayerName('PAUL'), normalizePlayerName('paul'));
  assert.equal(normalizePlayerName('Paul'), normalizePlayerName('pAUL'));
});

test('normalizePlayerName collapses internal run-on whitespace', () => {
  assert.equal(normalizePlayerName('Paul   Smith'), 'paul smith');
});

test('normalizePlayerName does not conflate similar-but-distinct names', () => {
  assert.notEqual(normalizePlayerName('Paul'), normalizePlayerName('Paula'));
  assert.notEqual(normalizePlayerName('Paul S'), normalizePlayerName('Paul'));
  assert.notEqual(normalizePlayerName('Jon'), normalizePlayerName('John'));
});

test('playerDocId is identical for case/whitespace variants of the same name on the same team', () => {
  assert.equal(playerDocId('team-1', 'Paul'), playerDocId('team-1', '  paul  '));
  assert.equal(playerDocId('team-1', 'Paul'), playerDocId('team-1', 'PAUL'));
});

test('playerDocId differs across teams for the identical name — same name, different teams, is allowed', () => {
  assert.notEqual(playerDocId('team-1', 'Paul'), playerDocId('team-2', 'Paul'));
});

test('playerDocId differs for similar-but-distinct names on the same team', () => {
  assert.notEqual(playerDocId('team-1', 'Paul'), playerDocId('team-1', 'Paula'));
});

test('findDuplicateName detects a case/whitespace-insensitive match within the given roster', () => {
  const roster = ['Jake Smith', 'Steve Jones'];
  assert.equal(findDuplicateName(roster, 'jake smith'), true);
  assert.equal(findDuplicateName(roster, '  STEVE JONES  '), true);
});

test('findDuplicateName does not flag a legitimate, similar-but-distinct name', () => {
  const roster = ['Jake Smith', 'Steve Jones'];
  assert.equal(findDuplicateName(roster, 'Jake Smyth'), false);
  assert.equal(findDuplicateName(roster, 'Steve'), false);
});

test('findDuplicateName on an empty roster never flags a duplicate', () => {
  assert.equal(findDuplicateName([], 'Jake Smith'), false);
});

test('DuplicatePlayerNameError carries the original (non-normalized) display name in its message', () => {
  const err = new DuplicatePlayerNameError('Paul');
  assert.match(err.message, /Paul/);
  assert.equal(err.name, 'DuplicatePlayerNameError');
});
