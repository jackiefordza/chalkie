// Coverage for the ChalkiePN format (Phase 9) — see assignChalkiePN.ts for
// the Firestore-touching uniqueness check, which needs a real backend and
// isn't unit-tested here (same split as resultDraftCodec/resultDraftStorage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateChalkiePNCandidate, isValidChalkiePN } from './chalkiePN';

test('generateChalkiePNCandidate: produces a valid CH-###### value', () => {
  for (let i = 0; i < 50; i++) {
    const candidate = generateChalkiePNCandidate();
    assert.match(candidate, /^CH-\d{6}$/);
    assert.equal(isValidChalkiePN(candidate), true);
  }
});

test('isValidChalkiePN: rejects malformed values', () => {
  assert.equal(isValidChalkiePN('CH-12345'), false); // too short
  assert.equal(isValidChalkiePN('CH-1234567'), false); // too long
  assert.equal(isValidChalkiePN('ch-123456'), false); // wrong case
  assert.equal(isValidChalkiePN('CH123456'), false); // missing dash
  assert.equal(isValidChalkiePN('CH-12345A'), false); // non-digit
  assert.equal(isValidChalkiePN(''), false);
});
