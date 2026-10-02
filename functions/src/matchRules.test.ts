// firestore.rules-level tests for the two client-side security properties
// the reconciliation model depends on that Cloud Function logic ALONE can't
// enforce (a client never goes through a Cloud Function to write a
// submission or a confirmation doc — see firestore.rules' own comments on
// why full validation is done in functions/src/index.ts instead, and why
// matches/{matchId} itself stays admin-only):
//  - a captain can never directly write status:'confirmed' to a match doc
//    (test spec #13) — only onConfirmationWrite (Admin SDK, bypasses rules)
//    can.
//  - a captain can never resubmit once a match is pending_confirmation
//    (test spec #14) — they must dispute instead.
//
// Uses @firebase/rules-unit-testing against the same live Firestore
// emulator reconciliation.test.ts uses (127.0.0.1:8080 by default,
// overridable with FIRESTORE_EMULATOR_HOST), under its OWN project ID so it
// can push firestore.rules independently of whatever the emulator started
// with, and never touches reconciliation.test.ts's data.
import { test, before, beforeEach, after } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  initializeTestEnvironment, assertSucceeds, assertFails, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';

const [host, portStr] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const port = Number(portStr);
const rulesPath = path.join(__dirname, '..', '..', 'firestore.rules');

let testEnv: RulesTestEnvironment;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'chalkie-matchday-rules-test',
    firestore: { host, port, rules: fs.readFileSync(rulesPath, 'utf8') },
  });
});

// Tests use fixed doc IDs (readable failure messages > generated ones for a
// rules suite), so this project's Firestore data must be wiped before each
// test — otherwise a doc a previous run (or a previous test in this run)
// already created makes an intended CREATE look like an UPDATE to the rules
// engine (e.g. hitting confirmations' `allow update: if false`), a false
// failure that has nothing to do with the rule actually being tested.
beforeEach(async () => {
  await testEnv.clearFirestore();
});

after(async () => {
  await testEnv.cleanup();
});

const HOME_TEAM = 'home-team';
const AWAY_TEAM = 'away-team';
const HOME_UID = 'home-captain-uid';
const AWAY_UID = 'away-captain-uid';

async function seedPendingConfirmationMatch(matchId: string): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc(`users/${HOME_UID}`).set({
      role: 'captain', teamId: HOME_TEAM, leagueId: 'league-1', isLeagueAdmin: false,
    });
    await db.doc(`users/${AWAY_UID}`).set({
      role: 'captain', teamId: AWAY_TEAM, leagueId: 'league-1', isLeagueAdmin: false,
    });
    await db.doc(`matches/${matchId}`).set({
      leagueId: 'league-1', homeTeamId: HOME_TEAM, awayTeamId: AWAY_TEAM,
      status: 'pending_confirmation', games: [],
    });
  });
}

test('a captain can never directly write status:confirmed to a match doc (test spec #13)', async () => {
  const matchId = 'match-confirm-attempt';
  await seedPendingConfirmationMatch(matchId);
  const homeCaptain = testEnv.authenticatedContext(HOME_UID).firestore();

  await assertFails(homeCaptain.doc(`matches/${matchId}`).update({ status: 'confirmed' }));

  // Confirming the reconciled sheet through the SANCTIONED path — creating
  // their own confirmations doc — is allowed. This never sets status itself
  // (only onConfirmationWrite, via the Admin SDK, does that) — this
  // assertion just proves the sanctioned path exists and isn't accidentally
  // blocked by the same rule that (correctly) blocks the direct write above.
  await assertSucceeds(
    homeCaptain.doc(`matches/${matchId}/confirmations/${HOME_TEAM}`).set({
      confirmedByTeamId: HOME_TEAM, confirmedByUserId: HOME_UID, createdAt: new Date(),
    }),
  );
});

test('a captain cannot create a confirmation doc for the OTHER team', async () => {
  const matchId = 'match-confirm-wrong-team';
  await seedPendingConfirmationMatch(matchId);
  const homeCaptain = testEnv.authenticatedContext(HOME_UID).firestore();

  await assertFails(
    homeCaptain.doc(`matches/${matchId}/confirmations/${AWAY_TEAM}`).set({
      confirmedByTeamId: AWAY_TEAM, confirmedByUserId: HOME_UID, createdAt: new Date(),
    }),
  );
});

test('a captain cannot confirm a match that is not pending_confirmation', async () => {
  const matchId = 'match-confirm-too-early';
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc(`users/${HOME_UID}`).set({ role: 'captain', teamId: HOME_TEAM, leagueId: 'league-1', isLeagueAdmin: false });
    await db.doc(`matches/${matchId}`).set({
      leagueId: 'league-1', homeTeamId: HOME_TEAM, awayTeamId: AWAY_TEAM, status: 'awaiting_confirmation', games: null,
    });
  });
  const homeCaptain = testEnv.authenticatedContext(HOME_UID).firestore();

  await assertFails(
    homeCaptain.doc(`matches/${matchId}/confirmations/${HOME_TEAM}`).set({
      confirmedByTeamId: HOME_TEAM, confirmedByUserId: HOME_UID, createdAt: new Date(),
    }),
  );
});

test('a confirmation doc is immutable once created — no un-confirming from the client', async () => {
  const matchId = 'match-confirm-immutable';
  await seedPendingConfirmationMatch(matchId);
  const homeCaptain = testEnv.authenticatedContext(HOME_UID).firestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`matches/${matchId}/confirmations/${HOME_TEAM}`).set({
      confirmedByTeamId: HOME_TEAM, confirmedByUserId: HOME_UID, createdAt: new Date(),
    });
  });

  await assertFails(
    homeCaptain.doc(`matches/${matchId}/confirmations/${HOME_TEAM}`).update({ confirmedByUserId: 'someone-else' }),
  );
});

test('a captain cannot resubmit once the match is pending_confirmation (test spec #14) — must dispute instead', async () => {
  const matchId = 'match-resubmit-blocked';
  await seedPendingConfirmationMatch(matchId);
  const homeCaptain = testEnv.authenticatedContext(HOME_UID).firestore();

  await assertFails(
    homeCaptain.doc(`matches/${matchId}/submissions/${HOME_TEAM}`).set({
      submittedByTeamId: HOME_TEAM, submittedByUserId: HOME_UID, games: Array(7).fill({}), createdAt: new Date(),
    }),
  );
});

test('a captain CAN still resubmit while the match is disputed (existing adopt-their-version flow preserved)', async () => {
  const matchId = 'match-resubmit-while-disputed';
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc(`users/${HOME_UID}`).set({ role: 'captain', teamId: HOME_TEAM, leagueId: 'league-1', isLeagueAdmin: false });
    await db.doc(`matches/${matchId}`).set({
      leagueId: 'league-1', homeTeamId: HOME_TEAM, awayTeamId: AWAY_TEAM, status: 'disputed', games: null,
    });
  });
  const homeCaptain = testEnv.authenticatedContext(HOME_UID).firestore();

  await assertSucceeds(
    homeCaptain.doc(`matches/${matchId}/submissions/${HOME_TEAM}`).set({
      submittedByTeamId: HOME_TEAM, submittedByUserId: HOME_UID, games: Array(7).fill({}), createdAt: new Date(),
    }),
  );
});

test('a captain can still resubmit while the match is scheduled/awaiting_confirmation (unchanged from before)', async () => {
  const matchId = 'match-resubmit-normal';
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc(`users/${HOME_UID}`).set({ role: 'captain', teamId: HOME_TEAM, leagueId: 'league-1', isLeagueAdmin: false });
    await db.doc(`matches/${matchId}`).set({
      leagueId: 'league-1', homeTeamId: HOME_TEAM, awayTeamId: AWAY_TEAM, status: 'scheduled', games: null,
    });
  });
  const homeCaptain = testEnv.authenticatedContext(HOME_UID).firestore();

  await assertSucceeds(
    homeCaptain.doc(`matches/${matchId}/submissions/${HOME_TEAM}`).set({
      submittedByTeamId: HOME_TEAM, submittedByUserId: HOME_UID, games: Array(7).fill({}), createdAt: new Date(),
    }),
  );
});
