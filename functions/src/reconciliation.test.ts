// Tests for the rewritten matchday reconciliation/confirmation model:
// two independent per-team submissions -> pairings+score reconciliation
// (never stats) -> merge -> pending_confirmation -> explicit two-team
// confirmation -> confirmed. Functions previously had NO test coverage at
// all; per the implementation spec, this harness is deliberately scoped to
// the rewritten surface (onSubmissionWrite/onConfirmationWrite/
// disputeMatch and their pure helpers), not a retroactive full-file suite.
// Also covers handleMatchConfirmed (the onMatchConfirmed trigger body) and
// performAdminResetMatchResult (the adminResetMatchResult callable body) —
// both pre-existing/adjacent pieces of the same match lifecycle that this
// PR's own changes depend on behaving correctly, extracted the same way for
// the same reason: direct testability without the Functions emulator.
//
// Two kinds of test here:
//  - PURE tests (isValidGamesShape, pairingsAndScoreAgree,
//    mergeSubmissionGames, computeTotals) — no Firestore, no emulator.
//  - INTEGRATION tests (handleSubmissionWrite/handleConfirmationWrite/
//    performDisputeMatch/handleMatchConfirmed/performAdminResetMatchResult)
//    — exercise the real trigger/callable BODIES directly (extracted from
//    the onDocumentWritten/onDocumentUpdated/onCall wrappers specifically so
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
  handleSubmissionWrite, handleConfirmationWrite, performDisputeMatch, handleMatchConfirmed,
  performAdminResetMatchResult,
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

// handleMatchConfirmed (unlike handleSubmissionWrite/handleConfirmationWrite
// above) takes before/after DocumentData directly rather than re-reading the
// match itself — matching what the real onDocumentUpdated trigger hands it.
// Reading it back from Firestore (rather than hand-constructing the object)
// is what gives scheduledDate a genuine Timestamp, since the function calls
// .toDate() on it exactly as the real trigger's event.data would provide.
const getMatchSnapshotData = getMatch;

function uniqueIds(prefix: string, n: number): string[] {
  return Array.from({ length: n }, () => uniqueId(prefix));
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

// handleMatchConfirmed is the extracted body of the onMatchConfirmed trigger
// (functions/src/index.ts) — pulled out specifically so the standings/
// player-stats pipeline a confirmed result feeds into could be exercised
// directly against a real Firestore emulator, the same way the three
// reconciliation triggers above already are. Previously nothing in this
// suite touched it at all, despite a comment beside the extraction claiming
// it did — these tests close that gap for real.

test('handleMatchConfirmed: a first confirmation updates divisionTables and playerSeasonStats for both teams (test spec #17)', async () => {
  const homeIds = uniqueIds('h', 6);
  const awayIds = uniqueIds('a', 6);
  const homeTeamId = uniqueId('team-home');
  const awayTeamId = uniqueId('team-away');
  const matchId = await seedMatch({ homeTeamId, awayTeamId, homeIds, awayIds, status: 'pending_confirmation' });
  const before = await getMatchSnapshotData(matchId);

  const games = sevenGames({
    homeIds, awayIds,
    overrides: {
      1: {
        legs: [
          { winner: 'home', oneEighties: [homeIds[0]], highCheckout: null },
          { winner: 'home', oneEighties: [], highCheckout: { playerId: homeIds[0], value: '140' } },
          { winner: 'away', oneEighties: [awayIds[0]], highCheckout: null },
        ],
      },
    },
  });
  await db.doc(`matches/${matchId}`).update({ status: 'confirmed', games, confirmedVia: 'captains' });
  const after = await getMatchSnapshotData(matchId);

  await handleMatchConfirmed(matchId, before, after);

  const match = await getMatch(matchId);
  assert.equal(match.homeGamesWon + match.awayGamesWon, 7);

  const homeTable = (await db.doc(`divisionTables/test-season_test-division_${homeTeamId}`).get()).data()!;
  const awayTable = (await db.doc(`divisionTables/test-season_test-division_${awayTeamId}`).get()).data()!;
  assert.equal(homeTable.played, 1);
  assert.equal(awayTable.played, 1);
  assert.equal(homeTable.won + awayTable.won, 1); // exactly one side won the match

  // sevenGames() (the shared fixture helper above) always slices each
  // game's lineup from the START of homeIds/awayIds rather than rotating
  // through them, so homeIds[0]/awayIds[0] are the one player on each side
  // who appears in every one of the 7 games (5 singles + both pairs) —
  // played: 7, not 1. That's a fixture-helper quirk (it exists for the
  // reconciliation tests above, which don't care which specific players are
  // involved), not anything handleMatchConfirmed itself does.
  const h0Stats = (await db.doc(`playerSeasonStats/test-season_${homeIds[0]}`).get()).data()!;
  assert.equal(h0Stats.played, 7);
  assert.equal(h0Stats.oneEighties, 1);
  const a0Stats = (await db.doc(`playerSeasonStats/test-season_${awayIds[0]}`).get()).data()!;
  assert.equal(a0Stats.played, 7);
  assert.equal(a0Stats.oneEighties, 1);
});

test('handleMatchConfirmed: does nothing when after.status is not \'confirmed\'', async () => {
  const homeTeamId = uniqueId('team-home');
  const awayTeamId = uniqueId('team-away');
  const matchId = await seedMatch({ homeTeamId, awayTeamId, homeIds: [], awayIds: [], status: 'pending_confirmation' });
  const before = await getMatchSnapshotData(matchId);

  await handleMatchConfirmed(matchId, before, before); // after.status is still 'pending_confirmation'

  const match = await getMatch(matchId);
  assert.equal(match.homeGamesWon, null);
  const tableSnap = await db.doc(`divisionTables/test-season_test-division_${homeTeamId}`).get();
  assert.equal(tableSnap.exists, false);
});

test('handleMatchConfirmed: refuses to touch statistics when a confirmed match\'s games reference a player not on that team (defense in depth)', async () => {
  const homeIds = uniqueIds('h', 6);
  const awayIds = uniqueIds('a', 6);
  const homeTeamId = uniqueId('team-home');
  const awayTeamId = uniqueId('team-away');
  const matchId = await seedMatch({ homeTeamId, awayTeamId, homeIds, awayIds, status: 'pending_confirmation' });
  const before = await getMatchSnapshotData(matchId);

  // Tamper: game 1's home slot is a player who was never registered on
  // EITHER team — simulating a manual Console edit, or any path other than
  // the validated submission/dispute-resolution flows that would normally
  // reach 'confirmed'. allPlayersLegitimate must reject this.
  const ghostId = uniqueId('ghost-player');
  const bogusGames = sevenGames({ homeIds: [ghostId, ...homeIds.slice(1)], awayIds });
  await db.doc(`matches/${matchId}`).update({ status: 'confirmed', games: bogusGames, confirmedVia: 'adminOverride' });
  const after = await getMatchSnapshotData(matchId);

  await handleMatchConfirmed(matchId, before, after);

  const match = await getMatch(matchId);
  assert.equal(match.homeGamesWon, null, 'computeTotals must never be written for invalid games');
  const tableSnap = await db.doc(`divisionTables/test-season_test-division_${homeTeamId}`).get();
  assert.equal(tableSnap.exists, false, 'no statistics should be created from an invalid confirmed result');
});

test('handleMatchConfirmed: re-invoking with no actual games change makes no further stat changes (idempotent)', async () => {
  const homeIds = uniqueIds('h', 6);
  const awayIds = uniqueIds('a', 6);
  const homeTeamId = uniqueId('team-home');
  const awayTeamId = uniqueId('team-away');
  const matchId = await seedMatch({ homeTeamId, awayTeamId, homeIds, awayIds, status: 'pending_confirmation' });
  const before = await getMatchSnapshotData(matchId);
  const games = sevenGames({ homeIds, awayIds });
  await db.doc(`matches/${matchId}`).update({ status: 'confirmed', games, confirmedVia: 'captains' });
  const afterFirst = await getMatchSnapshotData(matchId);

  await handleMatchConfirmed(matchId, before, afterFirst);
  const tableAfterFirst = (await db.doc(`divisionTables/test-season_test-division_${homeTeamId}`).get()).data()!;
  assert.equal(tableAfterFirst.played, 1);

  // Simulate the trigger firing again for the same already-confirmed match
  // with unchanged games (e.g. a retry, or an unrelated field edit that
  // still matches onDocumentUpdated) — beforeGames and afterGames are
  // identical, so this must be a no-op rather than double-counting.
  const afterSecond = await getMatchSnapshotData(matchId);
  await handleMatchConfirmed(matchId, afterFirst, afterSecond);

  const tableAfterSecond = (await db.doc(`divisionTables/test-season_test-division_${homeTeamId}`).get()).data()!;
  assert.equal(tableAfterSecond.played, 1, 'calling handleMatchConfirmed again with unchanged games must not double-count');
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

// performAdminResetMatchResult (the adminResetMatchResult callable, body
// extracted the same way as performDisputeMatch above — see index.ts).
// Pre-existing logic, unmodified by this PR; these tests close a gap this
// PR's own review found (no automated coverage existed at all).

async function seedUser(uid: string, data: Record<string, unknown>): Promise<void> {
  await db.doc(`users/${uid}`).set(data);
}

// Confirms a match with a real result (via the genuine handleMatchConfirmed
// pipeline, not a hand-rolled stats write) so a reset test has real
// divisionTables/playerSeasonStats contributions to verify get reversed.
async function confirmWithRealResult(
  matchId: string, homeTeamId: string, awayTeamId: string, games: MatchGame[],
): Promise<void> {
  const before = await getMatchSnapshotData(matchId);
  await db.doc(`matches/${matchId}`).update({ status: 'confirmed', games, confirmedVia: 'captains' });
  const after = await getMatchSnapshotData(matchId);
  await handleMatchConfirmed(matchId, before, after);
}

test('performAdminResetMatchResult: a league admin can reset a confirmed match, and standings/stats are reversed (not just the match doc)', async () => {
  const homeIds = uniqueIds('h', 6);
  const awayIds = uniqueIds('a', 6);
  const homeTeamId = uniqueId('team-home');
  const awayTeamId = uniqueId('team-away');
  const adminUid = uniqueId('admin');
  const matchId = await seedMatch({ homeTeamId, awayTeamId, homeIds, awayIds, status: 'pending_confirmation' });
  await seedUser(adminUid, { isLeagueAdmin: true, isGlobalAdmin: false, leagueId: 'test-league' });

  const games = sevenGames({
    homeIds, awayIds,
    overrides: {
      1: {
        legs: [
          { winner: 'home', oneEighties: [homeIds[0]], highCheckout: { playerId: homeIds[0], value: '140' } },
          { winner: 'home', oneEighties: [], highCheckout: null },
          { winner: 'away', oneEighties: [], highCheckout: null },
        ],
      },
    },
  });
  await confirmWithRealResult(matchId, homeTeamId, awayTeamId, games);

  // Leftover submissions/confirmations docs, as a real confirmed-via-
  // captains match would have — the reset must clear these too, not just
  // flip the match doc's status.
  await db.doc(`matches/${matchId}/submissions/${homeTeamId}`).set({ submittedByTeamId: homeTeamId, games });
  await db.doc(`matches/${matchId}/submissions/${awayTeamId}`).set({ submittedByTeamId: awayTeamId, games });
  await db.doc(`matches/${matchId}/confirmations/${homeTeamId}`).set({ confirmedByTeamId: homeTeamId });
  await db.doc(`matches/${matchId}/confirmations/${awayTeamId}`).set({ confirmedByTeamId: awayTeamId });

  const homeTableBefore = (await db.doc(`divisionTables/test-season_test-division_${homeTeamId}`).get()).data()!;
  const h0StatsBefore = (await db.doc(`playerSeasonStats/test-season_${homeIds[0]}`).get()).data()!;
  assert.equal(homeTableBefore.played, 1, 'precondition: the confirm actually applied a real result');
  assert.equal(h0StatsBefore.oneEighties, 1, 'precondition: the confirm actually applied real player stats');

  await performAdminResetMatchResult(matchId, adminUid);

  const match = await getMatch(matchId);
  assert.equal(match.status, 'scheduled');
  assert.equal(match.games, null);
  assert.equal(match.homeGamesWon, null);
  assert.equal(match.awayGamesWon, null);
  assert.equal(match.homeLegsWon, null);
  assert.equal(match.awayLegsWon, null);
  assert.equal('confirmedVia' in match, false, 'confirmedVia must be removed entirely, not just set to null');

  const [homeSub, awaySub, homeConf, awayConf] = await Promise.all([
    db.doc(`matches/${matchId}/submissions/${homeTeamId}`).get(),
    db.doc(`matches/${matchId}/submissions/${awayTeamId}`).get(),
    db.doc(`matches/${matchId}/confirmations/${homeTeamId}`).get(),
    db.doc(`matches/${matchId}/confirmations/${awayTeamId}`).get(),
  ]);
  assert.equal(homeSub.exists, false, 'home submission must be deleted');
  assert.equal(awaySub.exists, false, 'away submission must be deleted');
  assert.equal(homeConf.exists, false, 'home confirmation must be deleted');
  assert.equal(awayConf.exists, false, 'away confirmation must be deleted');

  const homeTableAfter = (await db.doc(`divisionTables/test-season_test-division_${homeTeamId}`).get()).data()!;
  const awayTableAfter = (await db.doc(`divisionTables/test-season_test-division_${awayTeamId}`).get()).data()!;
  assert.equal(homeTableAfter.played, 0, 'played must be reversed back to 0, not left at 1');
  assert.equal(homeTableAfter.won + homeTableAfter.lost, 0);
  assert.equal(homeTableAfter.legsFor, 0);
  assert.equal(homeTableAfter.legsAgainst, 0);
  assert.equal(awayTableAfter.played, 0);

  const h0StatsAfter = (await db.doc(`playerSeasonStats/test-season_${homeIds[0]}`).get()).data()!;
  assert.equal(h0StatsAfter.played, 0, 'player stats must be reversed, not left from the confirmed result');
  assert.equal(h0StatsAfter.oneEighties, 0);
  assert.deepEqual(h0StatsAfter.highCheckouts, []);
});

test('performAdminResetMatchResult: a non-admin (plain player) is refused (permission-denied), and nothing changes', async () => {
  const homeTeamId = uniqueId('team-home');
  const awayTeamId = uniqueId('team-away');
  const playerUid = uniqueId('player');
  const matchId = await seedMatch({ homeTeamId, awayTeamId, homeIds: [], awayIds: [], status: 'confirmed' });
  await db.doc(`matches/${matchId}`).update({ games: [] });
  await seedUser(playerUid, { isLeagueAdmin: false, isGlobalAdmin: false, leagueId: 'test-league', role: 'player' });

  await assertRejectsWithCode(() => performAdminResetMatchResult(matchId, playerUid), 'permission-denied');

  const match = await getMatch(matchId);
  assert.equal(match.status, 'confirmed', 'a refused reset must leave the match untouched');
});

// Asserts on HttpsError's own `.code` property — the same field a real
// client's httpsCallable sees (as `error.code`) — rather than string-
// matching the thrown error's message, which HttpsError's own toString()
// doesn't even include (confirmed: `new HttpsError('permission-denied',
// 'x').toString()` is just `'Error: x'`, no code).
async function assertRejectsWithCode(fn: () => Promise<unknown>, expectedCode: string): Promise<void> {
  try {
    await fn();
    assert.fail(`expected a rejection with code ${expectedCode}, but it resolved`);
  } catch (e) {
    assert.equal((e as { code?: string }).code, expectedCode);
  }
}

test('performAdminResetMatchResult: a league admin of a DIFFERENT league is refused (permission-denied)', async () => {
  const homeTeamId = uniqueId('team-home');
  const awayTeamId = uniqueId('team-away');
  const otherLeagueAdminUid = uniqueId('other-league-admin');
  const matchId = await seedMatch({ homeTeamId, awayTeamId, homeIds: [], awayIds: [], status: 'confirmed' });
  await db.doc(`matches/${matchId}`).update({ games: [] });
  await seedUser(otherLeagueAdminUid, { isLeagueAdmin: true, isGlobalAdmin: false, leagueId: uniqueId('other-league') });

  await assertRejectsWithCode(() => performAdminResetMatchResult(matchId, otherLeagueAdminUid), 'permission-denied');

  const match = await getMatch(matchId);
  assert.equal(match.status, 'confirmed');
});

test('performAdminResetMatchResult: an unauthenticated caller is refused (unauthenticated)', async () => {
  const homeTeamId = uniqueId('team-home');
  const awayTeamId = uniqueId('team-away');
  const matchId = await seedMatch({ homeTeamId, awayTeamId, homeIds: [], awayIds: [], status: 'confirmed' });
  await db.doc(`matches/${matchId}`).update({ games: [] });

  await assertRejectsWithCode(() => performAdminResetMatchResult(matchId, undefined), 'unauthenticated');

  const match = await getMatch(matchId);
  assert.equal(match.status, 'confirmed');
});

test('performAdminResetMatchResult: resetting an already-scheduled (no-result) match is refused safely, not a silent no-op success', async () => {
  const homeTeamId = uniqueId('team-home');
  const awayTeamId = uniqueId('team-away');
  const adminUid = uniqueId('admin');
  const matchId = await seedMatch({ homeTeamId, awayTeamId, homeIds: [], awayIds: [], status: 'scheduled' });
  await seedUser(adminUid, { isLeagueAdmin: true, isGlobalAdmin: false, leagueId: 'test-league' });

  await assertRejectsWithCode(() => performAdminResetMatchResult(matchId, adminUid), 'failed-precondition');
});

test('performAdminResetMatchResult: refuses to reset a confirmed match whose games are invalid, rather than reversing an unsafe/unknown contribution', async () => {
  const homeIds = uniqueIds('h', 6);
  const awayIds = uniqueIds('a', 6);
  const homeTeamId = uniqueId('team-home');
  const awayTeamId = uniqueId('team-away');
  const adminUid = uniqueId('admin');
  const matchId = await seedMatch({ homeTeamId, awayTeamId, homeIds, awayIds, status: 'confirmed' });
  await seedUser(adminUid, { isLeagueAdmin: true, isGlobalAdmin: false, leagueId: 'test-league' });

  // A ghost player who was never registered on either team — same tamper
  // scenario as handleMatchConfirmed's own defense-in-depth test above.
  const ghostId = uniqueId('ghost-player');
  const bogusGames = sevenGames({ homeIds: [ghostId, ...homeIds.slice(1)], awayIds });
  await db.doc(`matches/${matchId}`).update({ games: bogusGames });

  await assertRejectsWithCode(() => performAdminResetMatchResult(matchId, adminUid), 'failed-precondition');

  const match = await getMatch(matchId);
  assert.equal(match.status, 'confirmed', 'refusing to reset must leave the match exactly as it was');
  const tableSnap = await db.doc(`divisionTables/test-season_test-division_${homeTeamId}`).get();
  assert.equal(tableSnap.exists, false, 'no reversal (or anything else) should have been attempted');
});

test('performAdminResetMatchResult: resetting a disputed match (never confirmed, no stats to reverse) still clears submissions/confirmations and returns it to scheduled', async () => {
  const homeTeamId = uniqueId('team-home');
  const awayTeamId = uniqueId('team-away');
  const adminUid = uniqueId('admin');
  const matchId = await seedMatch({ homeTeamId, awayTeamId, homeIds: [], awayIds: [], status: 'disputed' });
  await seedUser(adminUid, { isLeagueAdmin: true, isGlobalAdmin: false, leagueId: 'test-league' });
  await db.doc(`matches/${matchId}/submissions/${homeTeamId}`).set({ submittedByTeamId: homeTeamId, games: [] });
  await db.doc(`matches/${matchId}/submissions/${awayTeamId}`).set({ submittedByTeamId: awayTeamId, games: [] });

  await performAdminResetMatchResult(matchId, adminUid);

  const match = await getMatch(matchId);
  assert.equal(match.status, 'scheduled');
  const [homeSub, awaySub] = await Promise.all([
    db.doc(`matches/${matchId}/submissions/${homeTeamId}`).get(),
    db.doc(`matches/${matchId}/submissions/${awayTeamId}`).get(),
  ]);
  assert.equal(homeSub.exists, false);
  assert.equal(awaySub.exists, false);
  // No divisionTables row should ever have been created for this team by
  // this reset — a disputed match was never confirmed, so there was nothing
  // to reverse, and the code path that would reverse it must never run here.
  const tableSnap = await db.doc(`divisionTables/test-season_test-division_${homeTeamId}`).get();
  assert.equal(tableSnap.exists, false);
});

test('performAdminResetMatchResult: calling it again on an already-reset match is refused, not a silent double-apply', async () => {
  const homeIds = uniqueIds('h', 6);
  const awayIds = uniqueIds('a', 6);
  const homeTeamId = uniqueId('team-home');
  const awayTeamId = uniqueId('team-away');
  const adminUid = uniqueId('admin');
  const matchId = await seedMatch({ homeTeamId, awayTeamId, homeIds, awayIds, status: 'pending_confirmation' });
  await seedUser(adminUid, { isLeagueAdmin: true, isGlobalAdmin: false, leagueId: 'test-league' });
  const games = sevenGames({ homeIds, awayIds });
  await confirmWithRealResult(matchId, homeTeamId, awayTeamId, games);

  await performAdminResetMatchResult(matchId, adminUid); // first reset — succeeds
  const tableAfterFirst = (await db.doc(`divisionTables/test-season_test-division_${homeTeamId}`).get()).data()!;
  assert.equal(tableAfterFirst.played, 0);

  // Second call on the now-scheduled match — must be refused, and must NOT
  // touch divisionTables/playerSeasonStats a second time (there is nothing
  // left to reverse; a bug here would show up as a negative `played` count).
  await assertRejectsWithCode(() => performAdminResetMatchResult(matchId, adminUid), 'failed-precondition');

  const tableAfterSecond = (await db.doc(`divisionTables/test-season_test-division_${homeTeamId}`).get()).data()!;
  assert.equal(tableAfterSecond.played, 0, 'a refused second reset must not further modify divisionTables');
});
