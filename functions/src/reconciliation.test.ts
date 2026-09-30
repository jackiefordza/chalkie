// Tests for the rewritten matchday reconciliation/confirmation model:
// two independent per-team submissions -> pairings+score reconciliation
// (never stats) -> merge -> pending_confirmation -> explicit two-team
// confirmation -> confirmed. Functions previously had NO test coverage at
// all; per the implementation spec, this harness is deliberately scoped to
// the rewritten surface (onSubmissionWrite/onConfirmationWrite/
// disputeMatch and their pure helpers), not a retroactive full-file suite.
//
// Two kinds of test here:
//  - PURE tests (isValidGamesShape, pairingsAndScoreAgree,
//    mergeSubmissionGames, computeTotals) — no Firestore, no emulator.
//  - INTEGRATION tests (handleSubmissionWrite/handleConfirmationWrite/
//    performDisputeMatch) — exercise the real trigger BODIES directly
//    (extracted from the onDocumentWritten/onCall wrappers specifically so
//    this is possible) against a genuinely live Firestore emulator, not a
//    mock. Requires `firebase emulators:start --only firestore` already
//    running; defaults to 127.0.0.1:8080 (override with
//    FIRESTORE_EMULATOR_HOST) so `npm test` works out of the box against
//    the emulator this repo's other test harnesses already use.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'chalkie-app';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import {
  pairingsAndScoreAgree, mergeSubmissionGames, isValidGamesShape, isValidSubmission, computeTotals,
  handleSubmissionWrite, handleConfirmationWrite, performDisputeMatch,
} from './index'; // also runs index.ts's own initializeApp()

// A second, differently-named app pointed at the same emulator, purely so
// this test file can seed/read Firestore directly without exporting `db`
// from index.ts (which stays focused on the functions themselves).
const testApp = admin.apps.some((a) => a?.name === 'reconciliation-test')
  ? admin.app('reconciliation-test')
  : admin.initializeApp({ projectId: 'chalkie-app' }, 'reconciliation-test');
const db = getFirestore(testApp);

type MatchSide = 'home' | 'away';
interface HighCheckout { playerId: string; value: string }
interface MatchLeg { winner: MatchSide; oneEighties: string[]; highCheckout: HighCheckout | null }
interface MatchGame {
  order: number; type: 'singles' | 'pairs'; homePlayerIds: string[]; awayPlayerIds: string[]; legs: MatchLeg[];
}

let counter = 0;
function uniqueId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

// A single complete 7-game sheet: 5 singles (order 1-5) + 2 pairs (order
// 6-7), one home player and one away player per singles game (or 2 each for
// pairs), each game 2-1 to home unless overridden. Matches the app's own
// fixed match format (GAMES_PER_MATCH/SINGLES_GAMES/LEGS_PER_GAME in
// index.ts).
function sevenGames(opts: {
  homeIds: string[]; awayIds: string[];
  overrides?: Partial<Record<number, Partial<MatchGame>>>;
}): MatchGame[] {
  return Array.from({ length: 7 }, (_, i) => {
    const order = i + 1;
    const type = order > 5 ? 'pairs' : 'singles';
    const n = type === 'pairs' ? 2 : 1;
    const base: MatchGame = {
      order,
      type,
      homePlayerIds: opts.homeIds.slice(0, n),
      awayPlayerIds: opts.awayIds.slice(0, n),
      legs: [
        { winner: 'home', oneEighties: [], highCheckout: null },
        { winner: 'home', oneEighties: [], highCheckout: null },
        { winner: 'away', oneEighties: [], highCheckout: null },
      ],
    };
    return { ...base, ...(opts.overrides?.[order] ?? {}) };
  });
}

// Seeds a scheduled league match (leagueId/seasonId/divisionId are dummy —
// no other collection needs to resolve them for these tests) plus, unless
// overridden, real `players` docs for every playerId used, each correctly
// attributed to its team — allPlayersLegitimate (called by isValidSubmission
// inside handleSubmissionWrite) requires this.
async function seedMatch(opts: {
  homeTeamId: string; awayTeamId: string; homeIds: string[]; awayIds: string[]; status?: string;
}): Promise<string> {
  const matchId = uniqueId('match');
  await db.doc(`matches/${matchId}`).set({
    leagueId: 'test-league',
    seasonId: 'test-season',
    divisionId: 'test-division',
    round: 1,
    homeTeamId: opts.homeTeamId,
    awayTeamId: opts.awayTeamId,
    scheduledDate: new Date('2026-10-14T00:00:00.000Z'),
    venue: null,
    status: opts.status ?? 'scheduled',
    competitionType: 'league',
    homeGamesWon: null,
    awayGamesWon: null,
    homeLegsWon: null,
    awayLegsWon: null,
    games: null,
    createdAt: new Date(),
  });
  const batch = db.batch();
  for (const id of opts.homeIds) batch.set(db.doc(`players/${id}`), { name: id, leagueId: 'test-league', teamId: opts.homeTeamId });
  for (const id of opts.awayIds) batch.set(db.doc(`players/${id}`), { name: id, leagueId: 'test-league', teamId: opts.awayTeamId });
  await batch.commit();
  return matchId;
}

async function submit(matchId: string, teamId: string, games: MatchGame[]): Promise<void> {
  await db.doc(`matches/${matchId}/submissions/${teamId}`).set({
    submittedByTeamId: teamId,
    submittedByUserId: `user-${teamId}`,
    games,
    createdAt: new Date(),
  });
}

async function confirm(matchId: string, teamId: string): Promise<void> {
  await db.doc(`matches/${matchId}/confirmations/${teamId}`).set({
    confirmedByTeamId: teamId,
    confirmedByUserId: `user-${teamId}`,
    createdAt: new Date(),
  });
}

async function getMatch(matchId: string): Promise<FirebaseFirestore.DocumentData> {
  const snap = await db.doc(`matches/${matchId}`).get();
  return snap.data()!;
}

// ── PURE tests ──────────────────────────────────────────────────────────

test('pairingsAndScoreAgree: identical pairings and scores agree', () => {
  const games = sevenGames({ homeIds: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'], awayIds: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'] });
  assert.equal(pairingsAndScoreAgree(games, games.map((g) => ({ ...g }))), true);
});

test('pairingsAndScoreAgree: a different score disagrees (test spec #5)', () => {
  const homeIds = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
  const awayIds = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
  const a = sevenGames({ homeIds, awayIds });
  const b = sevenGames({
    homeIds, awayIds,
    overrides: { 1: { legs: [{ winner: 'away', oneEighties: [], highCheckout: null }, { winner: 'away', oneEighties: [], highCheckout: null }, { winner: 'home', oneEighties: [], highCheckout: null }] } },
  });
  assert.equal(pairingsAndScoreAgree(a, b), false);
});

test('pairingsAndScoreAgree: a different pairing disagrees (test spec #6)', () => {
  const homeIds = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
  const awayIds = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
  const a = sevenGames({ homeIds, awayIds });
  const b = sevenGames({ homeIds, awayIds, overrides: { 1: { homePlayerIds: ['h2'] } } });
  assert.equal(pairingsAndScoreAgree(a, b), false);
});

test('pairingsAndScoreAgree: different 180s for the same team\'s player never disagrees (test spec #7)', () => {
  const homeIds = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
  const awayIds = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
  const a = sevenGames({ homeIds, awayIds, overrides: { 1: { legs: [{ winner: 'home', oneEighties: ['h1'], highCheckout: null }, { winner: 'home', oneEighties: [], highCheckout: null }, { winner: 'away', oneEighties: [], highCheckout: null }] } } });
  const b = sevenGames({ homeIds, awayIds }); // no 180 reported at all
  assert.equal(pairingsAndScoreAgree(a, b), true);
});

test('pairingsAndScoreAgree: different high checkouts for the same team\'s player never disagrees (test spec #8)', () => {
  const homeIds = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
  const awayIds = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
  const a = sevenGames({ homeIds, awayIds, overrides: { 1: { legs: [{ winner: 'home', oneEighties: [], highCheckout: { playerId: 'h1', value: '170' } }, { winner: 'home', oneEighties: [], highCheckout: null }, { winner: 'away', oneEighties: [], highCheckout: null }] } } });
  const b = sevenGames({ homeIds, awayIds });
  assert.equal(pairingsAndScoreAgree(a, b), true);
});

test('mergeSubmissionGames: combines each side\'s own 180s/checkouts, and the result is valid input to the unchanged stats pipeline (test spec #16)', () => {
  const homeIds = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
  const awayIds = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
  const home = sevenGames({
    homeIds, awayIds,
    overrides: { 1: { legs: [{ winner: 'home', oneEighties: ['h1'], highCheckout: null }, { winner: 'home', oneEighties: [], highCheckout: { playerId: 'h1', value: '100' } }, { winner: 'away', oneEighties: [], highCheckout: null }] } },
  });
  const away = sevenGames({
    homeIds, awayIds,
    overrides: { 1: { legs: [{ winner: 'home', oneEighties: [], highCheckout: null }, { winner: 'home', oneEighties: [], highCheckout: null }, { winner: 'away', oneEighties: ['a1'], highCheckout: { playerId: 'a1', value: '121' } }] } },
  });
  const merged = mergeSubmissionGames(home, away);

  const game1OneEighties = merged.find((g) => g.order === 1)!.legs.flatMap((l) => l.oneEighties);
  assert.deepEqual(game1OneEighties.sort(), ['a1', 'h1']);
  const game1Checkouts = merged.find((g) => g.order === 1)!.legs.map((l) => l.highCheckout).filter((hc) => hc !== null);
  assert.deepEqual(game1Checkouts.sort((x, y) => x!.playerId.localeCompare(y!.playerId)), [{ playerId: 'a1', value: '121' }, { playerId: 'h1', value: '100' }]);

  // Handoff correctness (spec #16): the merged games array is exactly what
  // onMatchConfirmed re-validates and hands to computeTotals/
  // computePlayerAccum (unchanged) — it must pass the SAME unrestricted
  // validation those functions use, and produce sane totals.
  assert.equal(isValidGamesShape(merged), true);
  const totals = computeTotals(merged as never);
  assert.equal(totals.homeGamesWon + totals.awayGamesWon, 7);
  assert.equal(totals.homeLegsWon + totals.awayLegsWon, 21);
});

test('isValidGamesShape: a submission cannot attribute a 180 to the opposing team\'s player (test spec #2/#3)', () => {
  const homeIds = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
  const awayIds = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
  const gamesClaimingAwayPlayersFor180 = sevenGames({
    homeIds, awayIds,
    overrides: { 1: { legs: [{ winner: 'home', oneEighties: ['a1'], highCheckout: null }, { winner: 'home', oneEighties: [], highCheckout: null }, { winner: 'away', oneEighties: [], highCheckout: null }] } },
  });
  // As a raw HOME submission, this must be rejected — a1 is away's player.
  assert.equal(
    isValidGamesShape(gamesClaimingAwayPlayersFor180 as never, { submittedByTeamId: 'home-team', matchHomeTeamId: 'home-team' }),
    false,
  );
  // The identical games array IS valid as a raw AWAY submission — a1 really
  // is one of away's own players.
  assert.equal(
    isValidGamesShape(gamesClaimingAwayPlayersFor180 as never, { submittedByTeamId: 'away-team', matchHomeTeamId: 'home-team' }),
    true,
  );
  // And valid as a FINAL/MERGED record with no statScope — either side's
  // player is legitimately eligible there.
  assert.equal(isValidGamesShape(gamesClaimingAwayPlayersFor180 as never), true);
});

// ── INTEGRATION tests (real Firestore emulator) ────────────────────────

test('handleSubmissionWrite: one submission leaves the match awaiting the second (test spec #9)', async () => {
  const homeIds = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
  const awayIds = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
  const homeTeamId = uniqueId('team-home');
  const awayTeamId = uniqueId('team-away');
  const matchId = await seedMatch({ homeTeamId, awayTeamId, homeIds, awayIds });
  await submit(matchId, homeTeamId, sevenGames({ homeIds, awayIds }));

  await handleSubmissionWrite(matchId);

  const match = await getMatch(matchId);
  assert.equal(match.status, 'awaiting_confirmation');
  assert.equal(match.games, null);
});

test('handleSubmissionWrite: identical pairings/scores produce pending_confirmation, NOT confirmed (test spec #4/#10)', async () => {
  const homeIds = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
  const awayIds = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
  const homeTeamId = uniqueId('team-home');
  const awayTeamId = uniqueId('team-away');
  const matchId = await seedMatch({ homeTeamId, awayTeamId, homeIds, awayIds });
  const games = sevenGames({ homeIds, awayIds });
  await submit(matchId, homeTeamId, games);
  await submit(matchId, awayTeamId, games.map((g) => ({ ...g })));

  await handleSubmissionWrite(matchId);

  const match = await getMatch(matchId);
  assert.equal(match.status, 'pending_confirmation');
  assert.notEqual(match.status, 'confirmed');
  assert.equal(match.games.length, 7);
});

test('handleSubmissionWrite: a genuine score disagreement disputes the match, never silently picks one side', async () => {
  const homeIds = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
  const awayIds = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
  const homeTeamId = uniqueId('team-home');
  const awayTeamId = uniqueId('team-away');
  const matchId = await seedMatch({ homeTeamId, awayTeamId, homeIds, awayIds });
  await submit(matchId, homeTeamId, sevenGames({ homeIds, awayIds }));
  await submit(matchId, awayTeamId, sevenGames({
    homeIds, awayIds,
    overrides: { 1: { legs: [{ winner: 'away', oneEighties: [], highCheckout: null }, { winner: 'away', oneEighties: [], highCheckout: null }, { winner: 'home', oneEighties: [], highCheckout: null }] } },
  }));

  await handleSubmissionWrite(matchId);

  const match = await getMatch(matchId);
  assert.equal(match.status, 'disputed');
  assert.equal(match.games, null); // never silently confirmed either side's version
});

test('handleSubmissionWrite: different own-team 180s/checkouts reconcile (never dispute) and are both preserved in the merge', async () => {
  const homeIds = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
  const awayIds = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
  const homeTeamId = uniqueId('team-home');
  const awayTeamId = uniqueId('team-away');
  const matchId = await seedMatch({ homeTeamId, awayTeamId, homeIds, awayIds });
  await submit(matchId, homeTeamId, sevenGames({
    homeIds, awayIds,
    overrides: { 1: { legs: [{ winner: 'home', oneEighties: ['h1'], highCheckout: null }, { winner: 'home', oneEighties: [], highCheckout: null }, { winner: 'away', oneEighties: [], highCheckout: null }] } },
  }));
  await submit(matchId, awayTeamId, sevenGames({
    homeIds, awayIds,
    overrides: { 1: { legs: [{ winner: 'home', oneEighties: [], highCheckout: null }, { winner: 'home', oneEighties: [], highCheckout: null }, { winner: 'away', oneEighties: ['a1'], highCheckout: { playerId: 'a1', value: '121' } }] } },
  }));

  await handleSubmissionWrite(matchId);

  const match = await getMatch(matchId);
  assert.equal(match.status, 'pending_confirmation');
  const game1 = match.games.find((g: MatchGame) => g.order === 1);
  const oneEighties = game1.legs.flatMap((l: MatchLeg) => l.oneEighties);
  assert.deepEqual(oneEighties.sort(), ['a1', 'h1']);
  const checkouts = game1.legs.map((l: MatchLeg) => l.highCheckout).filter((hc: unknown) => hc !== null);
  assert.deepEqual(checkouts, [{ playerId: 'a1', value: '121' }]);
});

test('handleSubmissionWrite: a submission claiming the opponent\'s player\'s 180 is quarantined, not trusted', async () => {
  const homeIds = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
  const awayIds = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
  const homeTeamId = uniqueId('team-home');
  const awayTeamId = uniqueId('team-away');
  const matchId = await seedMatch({ homeTeamId, awayTeamId, homeIds, awayIds });
  // Home's own submission claims a 180 for a1 — an AWAY player.
  await submit(matchId, homeTeamId, sevenGames({
    homeIds, awayIds,
    overrides: { 1: { legs: [{ winner: 'home', oneEighties: ['a1'], highCheckout: null }, { winner: 'home', oneEighties: [], highCheckout: null }, { winner: 'away', oneEighties: [], highCheckout: null }] } },
  }));

  await handleSubmissionWrite(matchId);

  const submissionSnap = await db.doc(`matches/${matchId}/submissions/${homeTeamId}`).get();
  assert.equal(submissionSnap.exists, false, 'the invalid submission should have been quarantined (deleted)');
  const match = await getMatch(matchId);
  assert.equal(match.status, 'scheduled'); // never even reached awaiting_confirmation
});

test('handleConfirmationWrite: one confirmation keeps the match pending_confirmation (test spec #11)', async () => {
  const homeIds = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
  const awayIds = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
  const homeTeamId = uniqueId('team-home');
  const awayTeamId = uniqueId('team-away');
  const games = sevenGames({ homeIds, awayIds });
  const matchId = await seedMatch({ homeTeamId, awayTeamId, homeIds, awayIds, status: 'pending_confirmation' });
  await db.doc(`matches/${matchId}`).update({ games });
  await confirm(matchId, homeTeamId);

  await handleConfirmationWrite(matchId);

  const match = await getMatch(matchId);
  assert.equal(match.status, 'pending_confirmation');
});

test('handleConfirmationWrite: two confirmations produce confirmed, stamped confirmedVia:captains (test spec #12)', async () => {
  const homeIds = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
  const awayIds = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
  const homeTeamId = uniqueId('team-home');
  const awayTeamId = uniqueId('team-away');
  const games = sevenGames({ homeIds, awayIds });
  const matchId = await seedMatch({ homeTeamId, awayTeamId, homeIds, awayIds, status: 'pending_confirmation' });
  await db.doc(`matches/${matchId}`).update({ games });
  await confirm(matchId, homeTeamId);
  await confirm(matchId, awayTeamId);

  await handleConfirmationWrite(matchId);

  const match = await getMatch(matchId);
  assert.equal(match.status, 'confirmed');
  assert.equal(match.confirmedVia, 'captains');
});

test('handleConfirmationWrite: a confirmation is inert once the match is no longer pending_confirmation', async () => {
  const homeIds = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
  const awayIds = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
  const homeTeamId = uniqueId('team-home');
  const awayTeamId = uniqueId('team-away');
  const matchId = await seedMatch({ homeTeamId, awayTeamId, homeIds, awayIds, status: 'disputed' });
  await confirm(matchId, homeTeamId);
  await confirm(matchId, awayTeamId);

  await handleConfirmationWrite(matchId);

  const match = await getMatch(matchId);
  assert.equal(match.status, 'disputed'); // never flipped to confirmed by stray confirmation docs
});

test('performDisputeMatch: a captain/VC of one of the two teams may dispute a pending_confirmation match', async () => {
  const homeTeamId = uniqueId('team-home');
  const awayTeamId = uniqueId('team-away');
  const matchId = await seedMatch({ homeTeamId, awayTeamId, homeIds: [], awayIds: [], status: 'pending_confirmation' });
  const uid = uniqueId('user');
  await db.doc(`users/${uid}`).set({ role: 'captain', teamId: homeTeamId });

  await performDisputeMatch(matchId, uid);

  const match = await getMatch(matchId);
  assert.equal(match.status, 'disputed');
});

test('performDisputeMatch: a captain of neither team is refused (permission-denied)', async () => {
  const homeTeamId = uniqueId('team-home');
  const awayTeamId = uniqueId('team-away');
  const matchId = await seedMatch({ homeTeamId, awayTeamId, homeIds: [], awayIds: [], status: 'pending_confirmation' });
  const uid = uniqueId('user');
  await db.doc(`users/${uid}`).set({ role: 'captain', teamId: uniqueId('other-team') });

  await assert.rejects(() => performDisputeMatch(matchId, uid), /permission-denied|captain or vice-captain/);
  const match = await getMatch(matchId);
  assert.equal(match.status, 'pending_confirmation'); // unchanged
});

test('performDisputeMatch: cannot dispute a match that is not pending_confirmation', async () => {
  const homeTeamId = uniqueId('team-home');
  const awayTeamId = uniqueId('team-away');
  const matchId = await seedMatch({ homeTeamId, awayTeamId, homeIds: [], awayIds: [], status: 'scheduled' });
  const uid = uniqueId('user');
  await db.doc(`users/${uid}`).set({ role: 'captain', teamId: homeTeamId });

  await assert.rejects(() => performDisputeMatch(matchId, uid), /failed-precondition|awaiting confirmation/);
});

// isValidSubmission (item #1 — a real, fully valid own-team submission is
// accepted) exercises allPlayersLegitimate too, which needs seeded
// `players` docs — covered end-to-end by the handleSubmissionWrite
// "reconcile" test above (both submissions ARE valid submissions, or the
// match would never have left 'scheduled'). This direct call is the same
// check in isolation, for a clearer failure message if it ever regresses.
test('isValidSubmission: a genuinely valid own-team submission is accepted (test spec #1)', async () => {
  const homeIds = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
  const awayIds = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
  const homeTeamId = uniqueId('team-home');
  const awayTeamId = uniqueId('team-away');
  await seedMatch({ homeTeamId, awayTeamId, homeIds, awayIds });
  const games = sevenGames({ homeIds, awayIds });
  const valid = await isValidSubmission({ games }, homeTeamId, awayTeamId, homeTeamId);
  assert.equal(valid, true);
});
