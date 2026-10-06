// Integration tests for the Captain/VC invite flow (performCreateTeamInvite/
// performAcceptTeamInvite in index.ts) — exercises the real callable BODIES
// directly against a genuinely live Firestore emulator, same convention as
// reconciliation.test.ts. Requires `firebase emulators:start --only
// firestore,auth` already running; defaults to 127.0.0.1:8080 (override
// with FIRESTORE_EMULATOR_HOST).
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'chalkie-app';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { performAcceptTeamInvite, performCreateTeamInvite } from './index'; // also runs index.ts's own initializeApp()

const testApp = admin.apps.some((a) => a?.name === 'invites-test')
  ? admin.app('invites-test')
  : admin.initializeApp({ projectId: 'chalkie-app' }, 'invites-test');
const db = getFirestore(testApp);

let counter = 0;
function uniqueId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

async function seedLeagueAdmin(): Promise<string> {
  const uid = uniqueId('admin');
  await db.doc(`users/${uid}`).set({ role: 'pending', leagueId: 'test-league', isLeagueAdmin: true, isGlobalAdmin: false });
  return uid;
}

async function seedTeam(opts: { leagueId?: string } = {}): Promise<string> {
  const teamId = uniqueId('team');
  await db.doc(`teams/${teamId}`).set({
    leagueId: opts.leagueId ?? 'test-league', seasonId: 'test-season', divisionId: 'test-division',
    name: teamId, captainUserId: null, viceCaptainUserId: null, address: null, venuePhone: null,
  });
  return teamId;
}

async function seedPendingAccount(): Promise<string> {
  const uid = uniqueId('pending-user');
  await db.doc(`users/${uid}`).set({
    role: 'pending', leagueId: null, teamId: null, divisionId: null, seasonId: null, playerId: null,
    isLeagueAdmin: false, isGlobalAdmin: false,
  });
  return uid;
}

async function getHttpsErrorCode(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'NO_ERROR_THROWN';
  } catch (e) {
    return e instanceof HttpsError ? e.code : `non-HttpsError: ${(e as Error).message}`;
  }
}

test('createTeamInvite: a genuine league admin can create a captain invite', async () => {
  const adminUid = await seedLeagueAdmin();
  const teamId = await seedTeam();

  const { inviteId, token } = await performCreateTeamInvite(teamId, 'captain', adminUid);

  assert.ok(inviteId);
  assert.ok(token.length >= 20);
  const inviteSnap = await db.doc(`invites/${inviteId}`).get();
  const invite = inviteSnap.data()!;
  assert.equal(invite.teamId, teamId);
  assert.equal(invite.role, 'captain');
  assert.equal(invite.status, 'pending');
  // The raw token is never stored — only its hash, and the hash must not
  // equal the plaintext token (sanity against a no-op "hash" function).
  assert.notEqual(invite.tokenHash, token);
  assert.equal(typeof invite.tokenHash, 'string');
});

test('createTeamInvite: a non-admin cannot create an invite', async () => {
  const teamId = await seedTeam();
  const nonAdminUid = await seedPendingAccount();

  const code = await getHttpsErrorCode(() => performCreateTeamInvite(teamId, 'captain', nonAdminUid));
  assert.equal(code, 'permission-denied');
});

test('createTeamInvite: an admin of a DIFFERENT league cannot create an invite for this team', async () => {
  const otherLeagueAdminUid = uniqueId('other-admin');
  await db.doc(`users/${otherLeagueAdminUid}`).set({ role: 'pending', leagueId: 'a-different-league', isLeagueAdmin: true, isGlobalAdmin: false });
  const teamId = await seedTeam({ leagueId: 'test-league' });

  const code = await getHttpsErrorCode(() => performCreateTeamInvite(teamId, 'captain', otherLeagueAdminUid));
  assert.equal(code, 'permission-denied');
});

test('acceptTeamInvite: happy path links a pending account to the team as captain, playerId stays null', async () => {
  const adminUid = await seedLeagueAdmin();
  const teamId = await seedTeam();
  const captainUid = await seedPendingAccount();
  const { inviteId, token } = await performCreateTeamInvite(teamId, 'captain', adminUid);

  await performAcceptTeamInvite(inviteId, token, captainUid);

  const user = (await db.doc(`users/${captainUid}`).get()).data()!;
  assert.equal(user.role, 'captain');
  assert.equal(user.teamId, teamId);
  assert.equal(user.playerId, null);
  assert.equal(user.isLeagueAdmin, false);
  assert.equal(user.isGlobalAdmin, false);

  const team = (await db.doc(`teams/${teamId}`).get()).data()!;
  assert.equal(team.captainUserId, captainUid);

  const invite = (await db.doc(`invites/${inviteId}`).get()).data()!;
  assert.equal(invite.status, 'accepted');
  assert.equal(invite.acceptedByUserId, captainUid);
});

test('acceptTeamInvite: viceCaptain role sets viceCaptainUserId, not captainUserId', async () => {
  const adminUid = await seedLeagueAdmin();
  const teamId = await seedTeam();
  const vcUid = await seedPendingAccount();
  const { inviteId, token } = await performCreateTeamInvite(teamId, 'viceCaptain', adminUid);

  await performAcceptTeamInvite(inviteId, token, vcUid);

  const user = (await db.doc(`users/${vcUid}`).get()).data()!;
  assert.equal(user.role, 'viceCaptain');
  const team = (await db.doc(`teams/${teamId}`).get()).data()!;
  assert.equal(team.viceCaptainUserId, vcUid);
  assert.equal(team.captainUserId, null);
});

test('acceptTeamInvite: wrong token is rejected and the invite is left pending', async () => {
  const adminUid = await seedLeagueAdmin();
  const teamId = await seedTeam();
  const captainUid = await seedPendingAccount();
  const { inviteId } = await performCreateTeamInvite(teamId, 'captain', adminUid);

  const code = await getHttpsErrorCode(() => performAcceptTeamInvite(inviteId, 'totally-wrong-token', captainUid));
  assert.equal(code, 'permission-denied');

  const invite = (await db.doc(`invites/${inviteId}`).get()).data()!;
  assert.equal(invite.status, 'pending');
  const user = (await db.doc(`users/${captainUid}`).get()).data()!;
  assert.equal(user.role, 'pending');
});

test('acceptTeamInvite: an already-accepted invite cannot be accepted again (idempotent, not double-applied)', async () => {
  const adminUid = await seedLeagueAdmin();
  const teamId = await seedTeam();
  const firstCaptainUid = await seedPendingAccount();
  const secondCaptainUid = await seedPendingAccount();
  const { inviteId, token } = await performCreateTeamInvite(teamId, 'captain', adminUid);

  await performAcceptTeamInvite(inviteId, token, firstCaptainUid);
  const code = await getHttpsErrorCode(() => performAcceptTeamInvite(inviteId, token, secondCaptainUid));
  assert.equal(code, 'failed-precondition');

  // The team's captain slot still belongs to whoever accepted first.
  const team = (await db.doc(`teams/${teamId}`).get()).data()!;
  assert.equal(team.captainUserId, firstCaptainUid);
  const secondUser = (await db.doc(`users/${secondCaptainUid}`).get()).data()!;
  assert.equal(secondUser.role, 'pending');
});

test('acceptTeamInvite: a revoked invite cannot be accepted', async () => {
  const adminUid = await seedLeagueAdmin();
  const teamId = await seedTeam();
  const captainUid = await seedPendingAccount();
  const { inviteId, token } = await performCreateTeamInvite(teamId, 'captain', adminUid);
  await db.doc(`invites/${inviteId}`).update({ status: 'revoked' });

  const code = await getHttpsErrorCode(() => performAcceptTeamInvite(inviteId, token, captainUid));
  assert.equal(code, 'failed-precondition');
});

test('acceptTeamInvite: an expired invite cannot be accepted', async () => {
  const adminUid = await seedLeagueAdmin();
  const teamId = await seedTeam();
  const captainUid = await seedPendingAccount();
  const { inviteId, token } = await performCreateTeamInvite(teamId, 'captain', adminUid);
  await db.doc(`invites/${inviteId}`).update({ expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() - 1000) });

  const code = await getHttpsErrorCode(() => performAcceptTeamInvite(inviteId, token, captainUid));
  assert.equal(code, 'failed-precondition');
});

test('acceptTeamInvite: an account that already has a non-pending role is refused, not clobbered', async () => {
  const adminUid = await seedLeagueAdmin();
  const teamId = await seedTeam();
  const { inviteId, token } = await performCreateTeamInvite(teamId, 'captain', adminUid);

  // adminUid itself is role:'pending' with isLeagueAdmin:true — not what
  // we're testing here. Seed a genuinely non-pending account instead.
  const existingCaptainUid = uniqueId('existing-captain');
  const otherTeamId = await seedTeam();
  await db.doc(`users/${existingCaptainUid}`).set({
    role: 'captain', leagueId: 'test-league', teamId: otherTeamId, divisionId: 'test-division',
    seasonId: 'test-season', playerId: null, isLeagueAdmin: false, isGlobalAdmin: false,
  });

  const code = await getHttpsErrorCode(() => performAcceptTeamInvite(inviteId, token, existingCaptainUid));
  assert.equal(code, 'failed-precondition');

  // Their existing team is untouched.
  const theirTeam = (await db.doc(`teams/${otherTeamId}`).get()).data()!;
  assert.equal(theirTeam.captainUserId, null); // never set in this test — just confirms no side effect fired
  const team = (await db.doc(`teams/${teamId}`).get()).data()!;
  assert.equal(team.captainUserId, null);
});

test('acceptTeamInvite: replacing an existing captain via a new invite detaches the outgoing account from the team', async () => {
  const adminUid = await seedLeagueAdmin();
  const teamId = await seedTeam();
  const outgoingCaptainUid = await seedPendingAccount();
  const firstInvite = await performCreateTeamInvite(teamId, 'captain', adminUid);
  await performAcceptTeamInvite(firstInvite.inviteId, firstInvite.token, outgoingCaptainUid);

  const incomingCaptainUid = await seedPendingAccount();
  const secondInvite = await performCreateTeamInvite(teamId, 'captain', adminUid);
  await performAcceptTeamInvite(secondInvite.inviteId, secondInvite.token, incomingCaptainUid);

  const team = (await db.doc(`teams/${teamId}`).get()).data()!;
  assert.equal(team.captainUserId, incomingCaptainUid);
  const outgoing = (await db.doc(`users/${outgoingCaptainUid}`).get()).data()!;
  assert.equal(outgoing.role, 'pending');
  assert.equal(outgoing.teamId, null);
});
