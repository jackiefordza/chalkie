import assert from 'node:assert/strict';
import test from 'node:test';

import { friendlyFirestoreError } from './friendlyFirestoreError';

function firestoreError(code: string, message = 'internal firestore message'): unknown {
  const e = new Error(message) as Error & { code: string };
  e.code = code;
  return e;
}

test('permission-denied gets a plain-English permission message', () => {
  assert.equal(friendlyFirestoreError(firestoreError('permission-denied')), "You don't have permission to do that.");
});

test('not-found gets a plain-English missing-item message', () => {
  assert.equal(
    friendlyFirestoreError(firestoreError('not-found')),
    'That item could not be found. It may have been removed or changed.',
  );
});

test('unavailable gets a connectivity message', () => {
  assert.equal(
    friendlyFirestoreError(firestoreError('unavailable')),
    "We couldn't connect to Chalkie. Please check your connection and try again.",
  );
});

// deadline-exceeded is this SDK's practical network/offline equivalent — a
// request that couldn't reach the backend in time reads the same to a user
// as one that couldn't reach it at all, so it shares unavailable's message.
test('deadline-exceeded (the network/offline equivalent for this SDK) gets the same connectivity message', () => {
  assert.equal(
    friendlyFirestoreError(firestoreError('deadline-exceeded')),
    "We couldn't connect to Chalkie. Please check your connection and try again.",
  );
});

test('unauthenticated gets a sign-in-again message', () => {
  assert.equal(friendlyFirestoreError(firestoreError('unauthenticated')), 'Please sign in again to continue.');
});

test('already-exists gets a plain-English duplicate message', () => {
  assert.equal(friendlyFirestoreError(firestoreError('already-exists')), 'That already exists.');
});

test('an unrecognized Firestore code falls back to the generic message, not its raw text', () => {
  assert.equal(friendlyFirestoreError(firestoreError('internal', 'INTERNAL ASSERTION FAILED')), 'Something went wrong. Please try again.');
});

test('a plain unknown Error (no code) falls back to the generic message, not its raw text', () => {
  assert.equal(friendlyFirestoreError(new Error('TypeError: Cannot read property of undefined')), 'Something went wrong. Please try again.');
});

test('a non-Error thrown value (string) is handled safely', () => {
  assert.equal(friendlyFirestoreError('just a string'), 'Something went wrong. Please try again.');
});

test('a non-Error thrown value (plain object with no code) is handled safely', () => {
  assert.equal(friendlyFirestoreError({ foo: 'bar' }), 'Something went wrong. Please try again.');
});

test('null and undefined are handled safely without throwing', () => {
  assert.equal(friendlyFirestoreError(null), 'Something went wrong. Please try again.');
  assert.equal(friendlyFirestoreError(undefined), 'Something went wrong. Please try again.');
});

test('a non-string code is handled safely', () => {
  assert.equal(friendlyFirestoreError({ code: 42 }), 'Something went wrong. Please try again.');
});
