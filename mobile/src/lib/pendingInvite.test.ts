import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasUsableInviteToken } from './pendingInvite';

test('hasUsableInviteToken: no inviteId at all is never usable, regardless of token/storage', () => {
  assert.equal(hasUsableInviteToken({ inviteId: undefined, token: 'tok', stored: { inviteId: 'inv1', token: 'tok' } }), false);
  assert.equal(hasUsableInviteToken({ inviteId: undefined, token: undefined, stored: null }), false);
});

test('hasUsableInviteToken: a live token in the URL is always usable', () => {
  assert.equal(hasUsableInviteToken({ inviteId: 'inv1', token: 'tok', stored: null }), true);
  assert.equal(hasUsableInviteToken({ inviteId: 'inv1', token: 'tok', stored: { inviteId: 'some-other-invite', token: 'other' } }), true);
});

test('hasUsableInviteToken: no live token, but storage holds this exact invite — usable', () => {
  assert.equal(
    hasUsableInviteToken({ inviteId: 'inv1', token: undefined, stored: { inviteId: 'inv1', token: 'saved-token' } }),
    true,
  );
});

test('hasUsableInviteToken: no live token and nothing in storage — NOT usable (the bug this guards against)', () => {
  assert.equal(hasUsableInviteToken({ inviteId: 'inv1', token: undefined, stored: null }), false);
});

test('hasUsableInviteToken: no live token and storage holds a DIFFERENT invite — NOT usable', () => {
  assert.equal(
    hasUsableInviteToken({ inviteId: 'inv1', token: undefined, stored: { inviteId: 'some-other-invite', token: 'saved-token' } }),
    false,
  );
});
