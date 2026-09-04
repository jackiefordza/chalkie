#!/usr/bin/env node
// Offline, no-Firebase static/unit-level checks for the two blocking bugs a
// code review found (reset write-guard registration, unconditional match
// overwrite on re-seed) and two of the lower-severity issues (explicit
// admin flags, adminUserId schema correctness).
//
// Runs entirely against small in-memory fakes for Firestore/Auth — never
// initializes the real Admin SDK, never reads GOOGLE_APPLICATION_CREDENTIALS,
// never makes a network call. Run after `npm run build`:
//
//   node offline-checks.js
//
// This deliberately does NOT attempt to simulate onSubmissionWrite/
// onMatchConfirmed (the real Cloud Functions) — that pipeline can only be
// verified against live Firebase, and is called out as an unverified risk
// in the implementation report. What's checked here is this script's OWN
// logic: does it register uids correctly, does it leave already-existing
// documents alone on a re-run, does it write the fields it now claims to.
const assert = require('node:assert/strict');

const {
  registerShowcaseUserId, safeSet, safeDelete,
} = require('./dist/src/firebaseAdmin');
const {
  seedCoreStructure, seedTeams, seedPlayers, seedTeamAccounts, seedAdminPersonas,
  buildSchedule, writeAllFixturesAsScheduled,
} = require('./dist/src/seedCore');
const { resetShowcaseDataset } = require('./dist/src/resetCore');
const { LEAGUE_ID, teamId, matchId } = require('./dist/src/constants');

// ── Minimal in-memory Firestore fake ────────────────────────────────────
function makeFakeDb() {
  const store = new Map(); // `${collectionPath}/${docId}` -> data object

  function docHandle(collectionPath, docId) {
    const key = `${collectionPath}/${docId}`;
    return {
      async get() {
        const data = store.get(key);
        return { exists: data !== undefined, data: () => data };
      },
      async set(data, options) {
        const merge = options && options.merge;
        const existing = store.get(key);
        store.set(key, merge && existing ? { ...existing, ...data } : { ...data });
      },
      async delete() {
        store.delete(key);
      },
    };
  }

  return {
    collection(collectionPath) {
      return {
        doc: (docId) => docHandle(collectionPath, docId),
        listDocuments: async () => {
          const prefix = `${collectionPath}/`;
          const ids = [];
          for (const key of store.keys()) {
            if (key.startsWith(prefix) && !key.slice(prefix.length).includes('/')) {
              ids.push({ id: key.slice(prefix.length) });
            }
          }
          return ids;
        },
        where(field, _op, value) {
          const filters = [[field, value]];
          const self = {
            where: (f2, _op2, v2) => { filters.push([f2, v2]); return self; },
            get: async () => {
              const docs = [];
              for (const [key, data] of store.entries()) {
                if (!key.startsWith(`${collectionPath}/`)) continue;
                if (filters.every(([f, v]) => data[f] === v)) {
                  docs.push({ id: key.slice(collectionPath.length + 1), data: () => data });
                }
              }
              return { docs, size: docs.length, forEach: (fn) => docs.forEach(fn) };
            },
          };
          return self;
        },
      };
    },
    // Directly poke/read the store for assertions in this test file.
    _raw: store,
  };
}

// ── Minimal in-memory Auth fake ─────────────────────────────────────────
function makeFakeAuth() {
  const byEmail = new Map();
  const byUid = new Map();
  let nextUid = 1;
  return {
    async getUserByEmail(email) {
      const uid = byEmail.get(email);
      if (!uid) { const e = new Error('no user'); e.code = 'auth/user-not-found'; throw e; }
      return { uid, email };
    },
    async createUser({ email }) {
      const uid = `fake-uid-${nextUid++}`;
      byEmail.set(email, uid);
      byUid.set(uid, email);
      return { uid, email };
    },
    async deleteUser(uid) {
      const email = byUid.get(uid);
      byUid.delete(uid);
      if (email) byEmail.delete(email);
    },
    _emailCount: () => byEmail.size,
  };
}

const noopLog = () => {};
let failures = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures += 1;
    console.log(`  ✗ ${name}`);
    console.log(`      ${e.message}`);
  }
}

async function main() {
  console.log('Offline checks (no Firebase, no network)\n');

  // ── 1. Reset UID registration (Blocking Bug 1) ──────────────────────
  console.log('1. Reset write-guard UID registration');
  await check('safeDelete on an UNregistered uid is rejected by the write guard', async () => {
    const db = makeFakeDb();
    await assert.rejects(() => safeDelete(db, 'users', 'never-registered-uid'), /WRITE GUARD REJECTED/);
  });
  await check('safeDelete on a registered uid succeeds', async () => {
    const db = makeFakeDb();
    registerShowcaseUserId('offline-check-uid-1');
    await safeSet(db, 'users', 'offline-check-uid-1', { email: 'x@chalkie.test' });
    await safeDelete(db, 'users', 'offline-check-uid-1');
    const snap = await db.collection('users').doc('offline-check-uid-1').get();
    assert.equal(snap.exists, false, 'doc should be gone after safeDelete');
  });
  await check('resetShowcaseDataset deletes users/{uid} docs + Auth accounts without throwing', async () => {
    const db = makeFakeDb();
    const auth = makeFakeAuth();
    // Seed a minimal fake dataset directly (bypassing safeSet/registration
    // on purpose): this simulates reset running as a brand-new process
    // against data an earlier, separate seed run already wrote — which is
    // exactly the real scenario the original bug missed. allowedUserIds is
    // an in-memory Set with no persistence across process runs, so a
    // correct reset must register this uid itself, not rely on it having
    // been registered by whatever wrote the document.
    const { uid } = await auth.createUser({ email: 'showcase.player@chalkie.test' });
    db._raw.set(`users/${uid}`, { email: 'showcase.player@chalkie.test', role: 'player' });

    const summary = await resetShowcaseDataset(db, auth, noopLog);
    assert.ok(summary.authAccountsDeleted >= 1, 'expected at least the one seeded account to be deleted');
    const snap = await db.collection('users').doc(uid).get();
    assert.equal(snap.exists, false, 'users/{uid} doc should have been deleted by reset');
    assert.equal(auth._emailCount(), 0, 'Auth account should have been deleted by reset');
  });

  // ── 2. Repeated seed behaviour (Blocking Bug 2) ─────────────────────
  console.log('\n2. Idempotent re-seeding (matches are never reset once they exist)');
  await check('writeAllFixturesAsScheduled never rewrites an already-existing match', async () => {
    const db = makeFakeDb();
    const schedule = buildSchedule();
    await writeAllFixturesAsScheduled(db, schedule, noopLog);

    // Simulate what the real Cloud Function pipeline would have done to one
    // match by the time a second seed run happens: confirmed it, with real
    // totals/games data — exactly the state the original bug clobbered.
    const fx = schedule.toConfirm[0];
    const id = matchId(fx.homeTeamIndex, fx.awayTeamIndex, fx.round);
    const before = await db.collection('matches').doc(id).get();
    await db.collection('matches').doc(id).set(
      { ...before.data(), status: 'confirmed', homeGamesWon: 4, awayGamesWon: 3 },
      {},
    );

    await writeAllFixturesAsScheduled(db, schedule, noopLog);

    const after = await db.collection('matches').doc(id).get();
    assert.equal(after.data().status, 'confirmed', 'status must NOT be reset back to scheduled on re-seed');
    assert.equal(after.data().homeGamesWon, 4, 'confirmed totals must survive a re-seed untouched');
  });
  await check('re-running the core-structure/teams/players phases does not duplicate or reset createdAt', async () => {
    const db = makeFakeDb();
    await seedCoreStructure(db, noopLog);
    await seedTeams(db, noopLog);
    const before = (await db.collection('teams').doc(teamId(0)).get()).data();
    await seedCoreStructure(db, noopLog);
    await seedTeams(db, noopLog);
    const after = (await db.collection('teams').doc(teamId(0)).get()).data();
    assert.deepEqual(before, after, 'a second run of the same creation phase must leave existing docs byte-identical');
  });

  // ── 3. Explicit admin flags (Issue 3) ───────────────────────────────
  console.log('\n3. Explicit isLeagueAdmin/isGlobalAdmin on non-admin personas');
  await check('all 17 captain/VC/normal-player docs explicitly have isLeagueAdmin:false, isGlobalAdmin:false', async () => {
    const db = makeFakeDb();
    const auth = makeFakeAuth();
    await seedTeamAccounts(db, auth, noopLog);
    let checked = 0;
    for (const [key, data] of db._raw.entries()) {
      if (!key.startsWith('users/')) continue;
      checked += 1;
      assert.equal(data.isLeagueAdmin, false, `${key} must have isLeagueAdmin === false (was ${data.isLeagueAdmin})`);
      assert.equal(data.isGlobalAdmin, false, `${key} must have isGlobalAdmin === false (was ${data.isGlobalAdmin})`);
    }
    assert.equal(checked, 17, `expected 17 user docs (8 captains + 8 VCs + 1 player), found ${checked}`);
  });

  // ── 4. adminUserId schema correctness (Issue 5) ─────────────────────
  console.log('\n4. League.adminUserId is a real, non-null string');
  await check('leagues/{LEAGUE_ID}.adminUserId is a non-null string equal to the league admin\'s uid', async () => {
    const db = makeFakeDb();
    const auth = makeFakeAuth();
    await seedCoreStructure(db, noopLog);
    await seedAdminPersonas(db, auth, noopLog);
    const league = (await db.collection('leagues').doc(LEAGUE_ID).get()).data();
    assert.equal(typeof league.adminUserId, 'string', `adminUserId must be a string, was ${typeof league.adminUserId}`);
    assert.ok(league.adminUserId.length > 0, 'adminUserId must not be empty');
    const { uid: leagueAdminUid } = await auth.getUserByEmail('showcase.leagueadmin@chalkie.test');
    assert.equal(league.adminUserId, leagueAdminUid, 'adminUserId must be the league-admin persona\'s own uid');
  });
  await check('re-running seedAdminPersonas does not change adminUserId (stable across re-seed)', async () => {
    const db = makeFakeDb();
    const auth = makeFakeAuth();
    await seedCoreStructure(db, noopLog);
    await seedAdminPersonas(db, auth, noopLog);
    const first = (await db.collection('leagues').doc(LEAGUE_ID).get()).data().adminUserId;
    await seedAdminPersonas(db, auth, noopLog);
    const second = (await db.collection('leagues').doc(LEAGUE_ID).get()).data().adminUserId;
    assert.equal(first, second);
  });

  console.log(`\n${failures === 0 ? 'ALL OFFLINE CHECKS PASSED' : `${failures} OFFLINE CHECK(S) FAILED`}`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((e) => { console.error('FAILED (unexpected):', e); process.exitCode = 1; });
