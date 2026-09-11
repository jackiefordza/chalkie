// Firestore security-rules regression tests for the Phase C Vice-Captain
// removal feature. Runs against a LOCAL Firestore emulator only, under a
// "demo-" project ID that @firebase/rules-unit-testing treats as never
// touching any real Firebase project — see README.md in this directory.
//
// The app performs the removal as one writeBatch (team.viceCaptainUserId
// -> null, plus the affected user's role -> 'player'), so most tests here
// exercise that same batch shape and then read back BOTH documents — proving
// the resulting state, not just that a single write was accepted, and (for
// the negative cases) that a rejected batch leaves NEITHER document changed.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');

const RULES_PATH = path.join(__dirname, '..', 'firestore.rules');

const LEAGUE_ID = 'league1';
const TEAM_1 = 'team1';
const TEAM_2 = 'team2';
const TEAM_3 = 'team3'; // no VC seeded — used for the approval-still-works regression test

const UID_CAPTAIN_1 = 'uidCaptain1';
const UID_VC_1 = 'uidVC1';
const UID_PLAYER_1 = 'uidPlayer1';
const UID_CAPTAIN_2 = 'uidCaptain2';
const UID_VC_2 = 'uidVC2';
const UID_CAPTAIN_3 = 'uidCaptain3';
const UID_PENDING_VC_REQUEST = 'uidPendingVCRequest'; // requests VC on team3
const UID_OUTSIDER = 'uidOutsider'; // signed in, not on either team
const UID_LEAGUE_ADMIN = 'uidLeagueAdmin';
const UID_GLOBAL_ADMIN = 'uidGlobalAdmin';

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-chalkie-rules-test',
    firestore: {
      rules: fs.readFileSync(RULES_PATH, 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

after(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await db.doc(`teams/${TEAM_1}`).set({
      leagueId: LEAGUE_ID, seasonId: 's1', divisionId: 'd1', name: 'Team One',
      captainUserId: UID_CAPTAIN_1, viceCaptainUserId: UID_VC_1, address: null, venuePhone: null,
    });
    await db.doc(`teams/${TEAM_2}`).set({
      leagueId: LEAGUE_ID, seasonId: 's1', divisionId: 'd1', name: 'Team Two',
      captainUserId: UID_CAPTAIN_2, viceCaptainUserId: UID_VC_2, address: null, venuePhone: null,
    });
    await db.doc(`teams/${TEAM_3}`).set({
      leagueId: LEAGUE_ID, seasonId: 's1', divisionId: 'd1', name: 'Team Three',
      captainUserId: UID_CAPTAIN_3, viceCaptainUserId: null, address: null, venuePhone: null,
    });

    // uid mirrored onto every user doc, same as the real app (AppUser.uid) —
    // several rules branches (e.g. `me().uid == resource.data.captainUserId`)
    // read it from the document's own fields, not just from request.auth.uid.
    await db.doc(`users/${UID_CAPTAIN_1}`).set({ uid: UID_CAPTAIN_1, role: 'captain', leagueId: LEAGUE_ID, teamId: TEAM_1, isLeagueAdmin: false });
    await db.doc(`users/${UID_VC_1}`).set({ uid: UID_VC_1, role: 'viceCaptain', leagueId: LEAGUE_ID, teamId: TEAM_1, isLeagueAdmin: false });
    await db.doc(`users/${UID_PLAYER_1}`).set({ uid: UID_PLAYER_1, role: 'player', leagueId: LEAGUE_ID, teamId: TEAM_1, isLeagueAdmin: false });
    await db.doc(`users/${UID_CAPTAIN_2}`).set({ uid: UID_CAPTAIN_2, role: 'captain', leagueId: LEAGUE_ID, teamId: TEAM_2, isLeagueAdmin: false });
    await db.doc(`users/${UID_VC_2}`).set({ uid: UID_VC_2, role: 'viceCaptain', leagueId: LEAGUE_ID, teamId: TEAM_2, isLeagueAdmin: false });
    await db.doc(`users/${UID_CAPTAIN_3}`).set({ uid: UID_CAPTAIN_3, role: 'captain', leagueId: LEAGUE_ID, teamId: TEAM_3, isLeagueAdmin: false });
    await db.doc(`users/${UID_PENDING_VC_REQUEST}`).set({
      uid: UID_PENDING_VC_REQUEST, role: 'pending', leagueId: LEAGUE_ID, teamId: null, isLeagueAdmin: false,
      pendingRequestType: 'captainRole', pendingRequestId: 'req1',
    });
    await db.doc(`users/${UID_OUTSIDER}`).set({ uid: UID_OUTSIDER, role: 'player', leagueId: LEAGUE_ID, teamId: null, isLeagueAdmin: false });
    await db.doc(`users/${UID_LEAGUE_ADMIN}`).set({ uid: UID_LEAGUE_ADMIN, role: 'player', leagueId: LEAGUE_ID, teamId: null, isLeagueAdmin: true });
    await db.doc(`users/${UID_GLOBAL_ADMIN}`).set({ uid: UID_GLOBAL_ADMIN, role: 'player', leagueId: null, teamId: null, isLeagueAdmin: false, isGlobalAdmin: true });
  });
});

function asUid(uid) { return testEnv.authenticatedContext(uid).firestore(); }

async function removeVCBatch(callerDb, teamId, vcUserId) {
  const batch = callerDb.batch();
  batch.update(callerDb.doc(`teams/${teamId}`), { viceCaptainUserId: null });
  batch.update(callerDb.doc(`users/${vcUserId}`), { role: 'player' });
  return batch.commit();
}

// NOTE: this installed @firebase/rules-unit-testing version discards
// withSecurityRulesDisabled's callback return value (confirmed in its own
// source — the generator-transpiled implementation never propagates it), so
// the result is captured via an outer closure variable instead of `return`.
async function readTeamAndUser(teamId, userId) {
  let result;
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const [teamSnap, userSnap] = await Promise.all([db.doc(`teams/${teamId}`).get(), db.doc(`users/${userId}`).get()]);
    result = { team: teamSnap.data(), user: userSnap.data() };
  });
  return result;
}

// ── 1, 5, 6: captain can remove own team's VC; reference cleared; role demoted ──

test("1/5/6. current captain can remove their own team's VC — both writes take effect together", async () => {
  await assertSucceeds(removeVCBatch(asUid(UID_CAPTAIN_1), TEAM_1, UID_VC_1));
  const { team, user } = await readTeamAndUser(TEAM_1, UID_VC_1);
  assert.equal(team.viceCaptainUserId, null);
  assert.equal(user.role, 'player');
});

// ── 2: captain cannot remove another team's VC ──────────────────────────────

test("2. a captain cannot remove ANOTHER team's VC (batch rejected, nothing changes)", async () => {
  await assertFails(removeVCBatch(asUid(UID_CAPTAIN_1), TEAM_2, UID_VC_2));
  const { team, user } = await readTeamAndUser(TEAM_2, UID_VC_2);
  assert.equal(team.viceCaptainUserId, UID_VC_2);
  assert.equal(user.role, 'viceCaptain');
});

test("2b. a captain cannot demote another team's VC user doc alone (team doc untouched)", async () => {
  await assertFails(
    asUid(UID_CAPTAIN_1).doc(`users/${UID_VC_2}`).set({ role: 'player' }, { merge: true }),
  );
});

// ── 3: normal player cannot perform the action ──────────────────────────────

test('3. a normal player cannot remove their own team\'s VC', async () => {
  await assertFails(removeVCBatch(asUid(UID_PLAYER_1), TEAM_1, UID_VC_1));
  const { team, user } = await readTeamAndUser(TEAM_1, UID_VC_1);
  assert.equal(team.viceCaptainUserId, UID_VC_1);
  assert.equal(user.role, 'viceCaptain');
});

// ── 4: a VC cannot remove via this action unless they are the actual captain ──

test('4. the VC themself cannot remove/demote themselves — only the actual captain can', async () => {
  await assertFails(removeVCBatch(asUid(UID_VC_1), TEAM_1, UID_VC_1));
  const { team, user } = await readTeamAndUser(TEAM_1, UID_VC_1);
  assert.equal(team.viceCaptainUserId, UID_VC_1);
  assert.equal(user.role, 'viceCaptain');
});

test('4b. a completely uninvolved signed-in user cannot remove a VC', async () => {
  await assertFails(removeVCBatch(asUid(UID_OUTSIDER), TEAM_1, UID_VC_1));
});

// ── 7: existing VC-request/approval behaviour still works ───────────────────

test('7. approving a NEW vice-captain request still works (regression)', async () => {
  const captain3Db = asUid(UID_CAPTAIN_3);
  const batch = captain3Db.batch();
  batch.update(captain3Db.doc(`teams/${TEAM_3}`), { viceCaptainUserId: UID_PENDING_VC_REQUEST });
  batch.update(captain3Db.doc(`users/${UID_PENDING_VC_REQUEST}`), {
    role: 'viceCaptain', teamId: TEAM_3, isLeagueAdmin: false,
  });
  await assertSucceeds(batch.commit());
  const { team, user } = await readTeamAndUser(TEAM_3, UID_PENDING_VC_REQUEST);
  assert.equal(team.viceCaptainUserId, UID_PENDING_VC_REQUEST);
  assert.equal(user.role, 'viceCaptain');
});

// ── 8: existing captain/team permissions remain unchanged ───────────────────

test("8. captain can still edit their own team's venue info (unrelated field, unchanged)", async () => {
  await assertSucceeds(
    asUid(UID_CAPTAIN_1).doc(`teams/${TEAM_1}`).set(
      { address: '12 High St', venuePhone: '01234 567890' },
      { merge: true },
    ),
  );
});

test('8b. captain still cannot change captainUserId itself (unchanged invariant)', async () => {
  await assertFails(
    asUid(UID_CAPTAIN_1).doc(`teams/${TEAM_1}`).set({ captainUserId: UID_VC_1 }, { merge: true }),
  );
});

test('8c. captain still cannot set viceCaptainUserId to an arbitrary user with no pending request and no existing VC to remove', async () => {
  await assertFails(
    asUid(UID_CAPTAIN_3).doc(`teams/${TEAM_3}`).set({ viceCaptainUserId: UID_OUTSIDER }, { merge: true }),
  );
});

// ── 9: global/league admin behaviour remains unchanged ───────────────────────

test('9. a league admin can still update a team in their own league', async () => {
  await assertSucceeds(
    asUid(UID_LEAGUE_ADMIN).doc(`teams/${TEAM_1}`).set({ name: 'Renamed Team' }, { merge: true }),
  );
});

test('9b. a global admin can still clear a VC directly (bypassing the captain-only path)', async () => {
  await assertSucceeds(
    asUid(UID_GLOBAL_ADMIN).doc(`teams/${TEAM_1}`).set({ viceCaptainUserId: null }, { merge: true }),
  );
});

test('9c. a league admin can still demote a user directly', async () => {
  await assertSucceeds(
    asUid(UID_LEAGUE_ADMIN).doc(`users/${UID_VC_1}`).set({ role: 'player' }, { merge: true }),
  );
});
