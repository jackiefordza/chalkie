// firestore.rules-level tests for the invites/{inviteId} collection: proves
// a client can never create an invite, never accept one (status can never
// become 'accepted' via a direct write), and never revoke/read one outside
// their own league — creation and acceptance are Cloud-Function-only (see
// performCreateTeamInvite/performAcceptTeamInvite in index.ts), so this
// collection's client-facing surface should be almost nothing.
//
// Uses @firebase/rules-unit-testing against the same live Firestore
// emulator reconciliation.test.ts/matchRules.test.ts use (127.0.0.1:8080 by
// default, overridable with FIRESTORE_EMULATOR_HOST), under its own project
// ID so it can push firestore.rules independently.
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
    projectId: 'chalkie-invite-rules-test',
    firestore: { host, port, rules: fs.readFileSync(rulesPath, 'utf8') },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

after(async () => {
  await testEnv.cleanup();
});

const LEAGUE_A = 'league-a';
const LEAGUE_B = 'league-b';
const ADMIN_UID = 'league-a-admin-uid';
const OTHER_LEAGUE_ADMIN_UID = 'league-b-admin-uid';
const CAPTAIN_UID = 'some-captain-uid';
const PENDING_UID = 'some-pending-uid';

async function seedUsers(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc(`users/${ADMIN_UID}`).set({ role: 'pending', leagueId: LEAGUE_A, isLeagueAdmin: true, isGlobalAdmin: false });
    await db.doc(`users/${OTHER_LEAGUE_ADMIN_UID}`).set({ role: 'pending', leagueId: LEAGUE_B, isLeagueAdmin: true, isGlobalAdmin: false });
    await db.doc(`users/${CAPTAIN_UID}`).set({ role: 'captain', leagueId: LEAGUE_A, teamId: 'team-x', isLeagueAdmin: false, isGlobalAdmin: false });
    await db.doc(`users/${PENDING_UID}`).set({ role: 'pending', leagueId: null, isLeagueAdmin: false, isGlobalAdmin: false });
  });
}

async function seedPendingInvite(inviteId: string): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`invites/${inviteId}`).set({
      leagueId: LEAGUE_A, seasonId: 's1', divisionId: 'd1', teamId: 'team-x', role: 'captain',
      tokenHash: 'deadbeef', status: 'pending', createdByUserId: ADMIN_UID, createdAt: new Date(),
      expiresAt: null, acceptedAt: null, acceptedByUserId: null,
    });
  });
}

test('no client — not even the league admin — can create an invite directly', async () => {
  await seedUsers();
  const admin = testEnv.authenticatedContext(ADMIN_UID).firestore();

  await assertFails(
    admin.doc('invites/fake-invite').set({
      leagueId: LEAGUE_A, seasonId: 's1', divisionId: 'd1', teamId: 'team-x', role: 'captain',
      tokenHash: 'anything', status: 'pending', createdByUserId: ADMIN_UID, createdAt: new Date(),
      expiresAt: null, acceptedAt: null, acceptedByUserId: null,
    }),
  );
});

test('a pending user can never directly set an invite\'s status to accepted', async () => {
  await seedUsers();
  const inviteId = 'invite-self-accept-attempt';
  await seedPendingInvite(inviteId);
  const pendingUser = testEnv.authenticatedContext(PENDING_UID).firestore();

  await assertFails(
    pendingUser.doc(`invites/${inviteId}`).update({ status: 'accepted', acceptedByUserId: PENDING_UID }),
  );
});

test('the league admin CAN revoke their own league\'s pending invite (positive control)', async () => {
  await seedUsers();
  const inviteId = 'invite-revoke-ok';
  await seedPendingInvite(inviteId);
  const admin = testEnv.authenticatedContext(ADMIN_UID).firestore();

  await assertSucceeds(admin.doc(`invites/${inviteId}`).update({ status: 'revoked' }));
});

test('revoking cannot smuggle in other field changes alongside status', async () => {
  await seedUsers();
  const inviteId = 'invite-revoke-smuggle';
  await seedPendingInvite(inviteId);
  const admin = testEnv.authenticatedContext(ADMIN_UID).firestore();

  await assertFails(
    admin.doc(`invites/${inviteId}`).update({ status: 'revoked', role: 'viceCaptain' }),
  );
});

test('an admin of a DIFFERENT league cannot read, revoke, or delete this invite', async () => {
  await seedUsers();
  const inviteId = 'invite-cross-league';
  await seedPendingInvite(inviteId);
  const otherAdmin = testEnv.authenticatedContext(OTHER_LEAGUE_ADMIN_UID).firestore();

  await assertFails(otherAdmin.doc(`invites/${inviteId}`).get());
  await assertFails(otherAdmin.doc(`invites/${inviteId}`).update({ status: 'revoked' }));
  await assertFails(otherAdmin.doc(`invites/${inviteId}`).delete());
});

test('a captain (not an admin) cannot read or revoke an invite for their own league', async () => {
  await seedUsers();
  const inviteId = 'invite-captain-no-access';
  await seedPendingInvite(inviteId);
  const captain = testEnv.authenticatedContext(CAPTAIN_UID).firestore();

  await assertFails(captain.doc(`invites/${inviteId}`).get());
  await assertFails(captain.doc(`invites/${inviteId}`).update({ status: 'revoked' }));
});

test('the league admin CAN read and delete their own league\'s invite (positive control)', async () => {
  await seedUsers();
  const inviteId = 'invite-admin-read-delete';
  await seedPendingInvite(inviteId);
  const admin = testEnv.authenticatedContext(ADMIN_UID).firestore();

  await assertSucceeds(admin.doc(`invites/${inviteId}`).get());
  await assertSucceeds(admin.doc(`invites/${inviteId}`).delete());
});
