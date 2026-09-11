import assert from 'node:assert/strict';
import test from 'node:test';

import { STATUS_LABEL, STATUS_TONE, isFixtureException } from './matchStatus';
import type { MatchStatus } from '@/types';

const ALL_STATUSES: MatchStatus[] = [
  'scheduled',
  'awaiting_confirmation',
  'disputed',
  'confirmed',
  'postponed',
  'cancelled',
];

test('STATUS_LABEL has a non-empty label for every status', () => {
  for (const status of ALL_STATUSES) {
    assert.equal(typeof STATUS_LABEL[status], 'string');
    assert.ok(STATUS_LABEL[status].length > 0);
  }
});

test('STATUS_TONE has an entry (tone or null) for every status', () => {
  for (const status of ALL_STATUSES) {
    assert.ok(Object.prototype.hasOwnProperty.call(STATUS_TONE, status));
  }
});

test('isFixtureException is true only for postponed and cancelled', () => {
  assert.equal(isFixtureException('postponed'), true);
  assert.equal(isFixtureException('cancelled'), true);
  assert.equal(isFixtureException('scheduled'), false);
  assert.equal(isFixtureException('awaiting_confirmation'), false);
  assert.equal(isFixtureException('disputed'), false);
  assert.equal(isFixtureException('confirmed'), false);
});
