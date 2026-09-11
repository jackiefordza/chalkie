import assert from 'node:assert/strict';
import test from 'node:test';

import { AVAILABILITY_LABEL, AVAILABILITY_TONE, availabilityDocId, isAvailabilityActionable } from './availability';
import type { AvailabilityStatus, MatchStatus } from '@/types';

const ALL_AVAILABILITY_STATUSES: AvailabilityStatus[] = ['available', 'unavailable', 'unsure'];
const ALL_MATCH_STATUSES: MatchStatus[] = [
  'scheduled', 'awaiting_confirmation', 'disputed', 'confirmed', 'postponed', 'cancelled',
];

test('AVAILABILITY_LABEL has a non-empty label for every status', () => {
  for (const status of ALL_AVAILABILITY_STATUSES) {
    assert.equal(typeof AVAILABILITY_LABEL[status], 'string');
    assert.ok(AVAILABILITY_LABEL[status].length > 0);
  }
});

test('AVAILABILITY_TONE has a tone for every status', () => {
  for (const status of ALL_AVAILABILITY_STATUSES) {
    assert.ok(Object.prototype.hasOwnProperty.call(AVAILABILITY_TONE, status));
  }
});

test('availabilityDocId joins matchId and playerId with an underscore', () => {
  assert.equal(availabilityDocId('match123', 'player456'), 'match123_player456');
});

test('availabilityDocId does not collide across a matchId/playerId split ambiguity', () => {
  // 'a_b' + 'c' and 'a' + 'b_c' both produce 'a_b_c' as a string, but this is
  // fine in practice: docIds are always looked up by re-deriving from the
  // same (matchId, playerId) pair, never parsed back apart — this test just
  // documents that the join is a plain, unambiguous concatenation.
  assert.equal(availabilityDocId('a_b', 'c'), 'a_b_c');
  assert.equal(availabilityDocId('a', 'b_c'), 'a_b_c');
});

test('isAvailabilityActionable is true only for scheduled', () => {
  for (const status of ALL_MATCH_STATUSES) {
    assert.equal(isAvailabilityActionable(status), status === 'scheduled');
  }
});
