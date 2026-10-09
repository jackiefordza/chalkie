#!/usr/bin/env node
// Links the user's EXISTING production admin account to the EXISTING
// Bedford & Kempston league by updating exactly two individual fields
// across two documents. Never creates an Auth account, never creates a
// document, never touches any field other than the two named below.
//
// This script NEVER accepts a UID, league ID, project ID, or any other
// target identifier from argv or the environment — every identifier below
// is a compile-time constant, per the user's own explicit approval. The
// only input it recognizes is the confirm flag; without it, this is always
// a dry run that only reads and reports.
import * as fs from 'node:fs';
import * as admin from 'firebase-admin';

const EXPECTED_PROJECT_ID = 'chalkie-app';
const LEAGUE_ID = 'bedford-kempston-district';
const ADMIN_UID = 'gkCs46bU9TWe3bMpcgZ198OppCh2';
const ADMIN_EMAIL = 'jfordham95@gmail.com'; // cross-check only, never written
const EXPECTED_CURRENT_ADMIN_USER_ID = 'PENDING_REAL_ADMIN_ACCOUNT';

const RECOGNIZED_FLAGS = new Set(['--confirm-admin-ownership-link']);

function parseArgs(argv: string[]): { confirm: boolean } {
  const unrecognized = argv.filter((a) => !RECOGNIZED_FLAGS.has(a));
  if (unrecognized.length > 0) {
    throw new Error(
      `Unrecognized argument(s): ${unrecognized.join(', ')}. This script accepts ONLY `
      + '--confirm-admin-ownership-link — it never accepts a UID, league ID, project ID, or any '
      + 'other target identifier as an argument. Refusing to run.',
    );
  }
  return { confirm: argv.includes('--confirm-admin-ownership-link') };
}

function initApp(): admin.firestore.Firestore {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) throw new Error('GOOGLE_APPLICATION_CREDENTIALS is not set.');
  if (!fs.existsSync(credPath)) throw new Error(`GOOGLE_APPLICATION_CREDENTIALS points at "${credPath}", which does not exist.`);

  let serviceAccount: { project_id?: string };
  try {
    serviceAccount = JSON.parse(fs.readFileSync(credPath, 'utf8'));
  } catch (e) {
    throw new Error(`Could not parse the service-account file at "${credPath}": ${(e as Error).message}`);
  }
  if (serviceAccount.project_id !== EXPECTED_PROJECT_ID) {
    throw new Error(
      `REFUSING TO RUN: credential belongs to project "${serviceAccount.project_id ?? '(missing)'}", `
      + `not the required "${EXPECTED_PROJECT_ID}".`,
    );
  }

  const app = admin.initializeApp({
    credential: admin.credential.cert(credPath),
    projectId: EXPECTED_PROJECT_ID,
  }, `admin-ownership-link-${Date.now()}`);

  if (app.options.projectId !== EXPECTED_PROJECT_ID) {
    throw new Error(`REFUSING TO RUN: initialized app resolved to "${app.options.projectId}", expected "${EXPECTED_PROJECT_ID}".`);
  }
  console.log(`Firebase Admin SDK initialized against project "${app.options.projectId}" — verified.`);
  return admin.firestore(app);
}

// Write guard: an allowlist of exactly the two (collection, docId, field)
// triples this script may ever touch. Any other write is rejected before
// it reaches Firestore.
const ALLOWED_WRITES: Record<string, { docId: string; fields: string[] }> = {
  leagues: { docId: LEAGUE_ID, fields: ['adminUserId'] },
  users: { docId: ADMIN_UID, fields: ['leagueId'] },
};

async function guardedUpdate(
  db: admin.firestore.Firestore,
  collectionPath: string,
  docId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const allowed = ALLOWED_WRITES[collectionPath];
  const keys = Object.keys(data);
  const onlyAllowedFields = allowed && allowed.docId === docId && keys.every((k) => allowed.fields.includes(k)) && keys.length > 0;
  if (!onlyAllowedFields) {
    throw new Error(
      `WRITE GUARD REJECTED: collection="${collectionPath}" docId="${docId}" fields="${keys.join(',')}" `
      + 'is outside the fixed two-field allowlist this script may touch. Aborting this write.',
    );
  }
  await db.collection(collectionPath).doc(docId).update(data);
}

function diffAllFields(before: Record<string, unknown>, after: Record<string, unknown>, intentionallyChanged: string[]): string[] {
  const unexpected: string[] = [];
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of allKeys) {
    if (intentionallyChanged.includes(k)) continue;
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) unexpected.push(k);
  }
  return unexpected;
}

async function main(): Promise<void> {
  const { confirm } = parseArgs(process.argv.slice(2));

  console.log('');
  console.log('='.repeat(60));
  console.log(`TARGET FIREBASE PROJECT: ${EXPECTED_PROJECT_ID}`);
  console.log(`TARGET LEAGUE DOC:       leagues/${LEAGUE_ID}`);
  console.log(`TARGET USER DOC:         users/${ADMIN_UID} (${ADMIN_EMAIL})`);
  console.log(`MODE:                    ${confirm ? 'LIVE — WILL WRITE 2 FIELDS' : 'DRY RUN (verify only, no writes)'}`);
  console.log('='.repeat(60));

  const db = initApp();

  // ── STEP 1: verify before writing ──
  const leagueRef = db.collection('leagues').doc(LEAGUE_ID);
  const userRef = db.collection('users').doc(ADMIN_UID);

  const [leagueSnapBefore, userSnapBefore] = await Promise.all([leagueRef.get(), userRef.get()]);

  console.log('\nSTEP 1 — PREFLIGHT VERIFICATION');
  console.log('='.repeat(60));

  if (!leagueSnapBefore.exists) {
    throw new Error(`REFUSING TO RUN: leagues/${LEAGUE_ID} does not exist.`);
  }
  const leagueBefore = leagueSnapBefore.data()!;
  console.log(`leagues/${LEAGUE_ID}: EXISTS`);
  console.log(`  name: ${JSON.stringify(leagueBefore.name)}`);
  console.log(`  adminUserId: ${JSON.stringify(leagueBefore.adminUserId)}`);
  if (leagueBefore.adminUserId === ADMIN_UID) {
    console.log('  NOTE: adminUserId is already this account — this field update would be a no-op.');
  } else if (leagueBefore.adminUserId !== EXPECTED_CURRENT_ADMIN_USER_ID) {
    throw new Error(
      `REFUSING TO RUN: leagues/${LEAGUE_ID}.adminUserId is "${leagueBefore.adminUserId}", `
      + `not the expected placeholder "${EXPECTED_CURRENT_ADMIN_USER_ID}" (and not already this account). `
      + 'Someone/something else may already own this league — stopping without writing.',
    );
  }

  if (!userSnapBefore.exists) {
    throw new Error(`REFUSING TO RUN: users/${ADMIN_UID} does not exist.`);
  }
  const userBefore = userSnapBefore.data()!;
  console.log(`\nusers/${ADMIN_UID}: EXISTS`);
  console.log(`  email: ${JSON.stringify(userBefore.email)}`);
  console.log(`  role: ${JSON.stringify(userBefore.role)}`);
  console.log(`  leagueId: ${JSON.stringify(userBefore.leagueId)}`);
  console.log(`  isLeagueAdmin: ${JSON.stringify(userBefore.isLeagueAdmin)}`);
  console.log(`  isGlobalAdmin: ${JSON.stringify(userBefore.isGlobalAdmin)}`);

  if (userBefore.email !== ADMIN_EMAIL) {
    throw new Error(`REFUSING TO RUN: users/${ADMIN_UID}.email is "${userBefore.email}", not the expected "${ADMIN_EMAIL}".`);
  }
  if (userBefore.isLeagueAdmin !== true) {
    throw new Error(`REFUSING TO RUN: users/${ADMIN_UID}.isLeagueAdmin is ${JSON.stringify(userBefore.isLeagueAdmin)}, not true.`);
  }
  if (userBefore.leagueId === LEAGUE_ID) {
    console.log('  NOTE: leagueId is already the target league — this field update would be a no-op.');
  }

  console.log('\nAll preflight checks PASSED.');

  if (!confirm) {
    console.log('\nThis was a DRY RUN — no writes performed. Re-run with --confirm-admin-ownership-link to apply.');
    return;
  }

  // ── STEP 2: apply only the two approved field updates ──
  console.log('\nSTEP 2 — APPLYING THE TWO APPROVED FIELD UPDATES');
  console.log('='.repeat(60));
  await guardedUpdate(db, 'leagues', LEAGUE_ID, { adminUserId: ADMIN_UID });
  console.log(`Updated leagues/${LEAGUE_ID}.adminUserId -> "${ADMIN_UID}"`);
  await guardedUpdate(db, 'users', ADMIN_UID, { leagueId: LEAGUE_ID });
  console.log(`Updated users/${ADMIN_UID}.leagueId -> "${LEAGUE_ID}"`);

  // ── STEP 3: read both documents back and verify ──
  console.log('\nSTEP 3 — POST-WRITE VERIFICATION');
  console.log('='.repeat(60));
  const [leagueSnapAfter, userSnapAfter] = await Promise.all([leagueRef.get(), userRef.get()]);
  const leagueAfter = leagueSnapAfter.data()!;
  const userAfter = userSnapAfter.data()!;

  console.log(`leagues/${LEAGUE_ID}.adminUserId: ${JSON.stringify(leagueAfter.adminUserId)} (expected "${ADMIN_UID}")`);
  console.log(`users/${ADMIN_UID}.leagueId: ${JSON.stringify(userAfter.leagueId)} (expected "${LEAGUE_ID}")`);
  console.log(`users/${ADMIN_UID}.isLeagueAdmin: ${JSON.stringify(userAfter.isLeagueAdmin)} (expected true, unchanged)`);

  const leagueOk = leagueAfter.adminUserId === ADMIN_UID;
  const userLeagueOk = userAfter.leagueId === LEAGUE_ID;
  const userAdminFlagOk = userAfter.isLeagueAdmin === true;

  const leagueUnexpectedDiffs = diffAllFields(leagueBefore, leagueAfter, ['adminUserId']);
  const userUnexpectedDiffs = diffAllFields(userBefore, userAfter, ['leagueId']);

  console.log(`\nleagues/${LEAGUE_ID} — fields other than adminUserId unchanged: ${leagueUnexpectedDiffs.length === 0 ? 'YES' : `NO (changed: ${leagueUnexpectedDiffs.join(', ')})`}`);
  console.log(`users/${ADMIN_UID} — fields other than leagueId unchanged: ${userUnexpectedDiffs.length === 0 ? 'YES' : `NO (changed: ${userUnexpectedDiffs.join(', ')})`}`);

  const overallPass = leagueOk && userLeagueOk && userAdminFlagOk && leagueUnexpectedDiffs.length === 0 && userUnexpectedDiffs.length === 0;
  console.log(`\nOVERALL: ${overallPass ? 'PASS' : 'FAIL'}`);
  if (!overallPass) process.exitCode = 1;
}

main().catch((e: unknown) => {
  console.error('\nFAILED:', (e as Error).message ?? e);
  process.exitCode = 1;
});
