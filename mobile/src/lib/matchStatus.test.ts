// Regression coverage for HomeDashboard's "Next Match" CTA label — the
// own-team-only model replaced the old "Review Their Result" wording (a
// leftover from the removed full-opponent-entry/review-mode flow) with
// labels derived from actual match/submission state. See
// nextMatchCtaLabel's own comment in matchStatus.ts for the state machine
// this is testing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextMatchCtaLabel } from './matchStatus';

test('nextMatchCtaLabel: scheduled always reads "Enter Your Result" — neither team has submitted yet', () => {
  assert.equal(nextMatchCtaLabel('scheduled', null, 'Oakley'), 'Enter Your Result');
  assert.equal(nextMatchCtaLabel('scheduled', false, 'Oakley'), 'Enter Your Result');
});

test('nextMatchCtaLabel: awaiting_confirmation + I have NOT submitted reads "Enter Your Result", never "Review Their Result"', () => {
  const label = nextMatchCtaLabel('awaiting_confirmation', false, 'Oakley');
  assert.equal(label, 'Enter Your Result');
  assert.doesNotMatch(label, /review/i);
});

test('nextMatchCtaLabel: awaiting_confirmation + I HAVE submitted reads a waiting message naming the opponent', () => {
  assert.equal(nextMatchCtaLabel('awaiting_confirmation', true, 'Oakley'), 'Waiting on Oakley');
});

test('nextMatchCtaLabel: awaiting_confirmation with submission state not yet resolved falls back to a neutral label', () => {
  const label = nextMatchCtaLabel('awaiting_confirmation', null, 'Oakley');
  assert.doesNotMatch(label, /review their result/i);
  assert.doesNotMatch(label, /enter/i); // not yet known whether I've submitted — don't claim either state
});

test('nextMatchCtaLabel: pending_confirmation (both sides submitted and reconciled) reads "Review Result"', () => {
  assert.equal(nextMatchCtaLabel('pending_confirmation', true, 'Oakley'), 'Review Result');
  // Reconciliation only reaches pending_confirmation once BOTH sides have
  // valid submissions, so the label must not depend on hasSubmitted here.
  assert.equal(nextMatchCtaLabel('pending_confirmation', null, 'Oakley'), 'Review Result');
});

test('nextMatchCtaLabel: confirmed reads "View Result"', () => {
  assert.equal(nextMatchCtaLabel('confirmed', true, 'Oakley'), 'View Result');
});

test('nextMatchCtaLabel: disputed reads "Resolve Differences", unaffected by submission state (unchanged behavior)', () => {
  assert.equal(nextMatchCtaLabel('disputed', null, 'Oakley'), 'Resolve Differences');
  assert.equal(nextMatchCtaLabel('disputed', true, 'Oakley'), 'Resolve Differences');
});
