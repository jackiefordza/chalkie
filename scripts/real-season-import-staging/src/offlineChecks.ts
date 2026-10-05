#!/usr/bin/env node
// Guaranteed-to-run proof of correctness with ZERO network access, no
// Firebase project, no credentials, no emulator — mirrors
// scripts/showcase-seed/offline-checks.js's role for that script. Run via
// `npm run offline-checks`. Exercises the exact same importer.ts /
// firebaseAdmin.ts guard logic that the real CLI (import.ts) uses; only the
// Firestore backend underneath is swapped for the in-memory fake.
import { buildCanonicalDataset } from './dataset';
import { validateDataset, printValidationReport } from './validate';
import { FakeFirestore } from './fakeFirestore';
import { guardedFirestore, isAllowedWrite, resetAuditLog, getAuditLog } from './firebaseAdmin';
import { runImport, printApplyResult, PENDING_ADMIN_PLACEHOLDER } from './importer';

let failures = 0;
function assertTrue(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  [OK] ${message}`);
  } else {
    console.error(`  [FAIL] ${message}`);
    failures++;
  }
}

async function main(): Promise<void> {
  console.log('='.repeat(70));
  console.log('OFFLINE CHECKS — real-season-import (no network, no Firebase)');
  console.log('='.repeat(70));

  // ── 1. Dataset validation ────────────────────────────────────────────
  console.log('\n--- 1. Dataset validation ---');
  const dataset = buildCanonicalDataset();
  const validation = validateDataset(dataset);
  printValidationReport(validation);
  assertTrue(validation.overallPass, 'dataset validation passes all checks');
  assertTrue(dataset.teams.length === 16, 'dataset has 16 teams');
  assertTrue(dataset.fixtures.length === 112, 'dataset has 112 fixtures');

  const EXPECTED_DOC_COUNT = 1 /* league */ + 1 /* season */ + 2 /* divisions */ + 16 /* teams */ + 112 /* matches */;
  assertTrue(EXPECTED_DOC_COUNT === 132, `expected total doc count is 132 (got ${EXPECTED_DOC_COUNT})`);

  // ── 2. Dry run against an empty throwaway target ─────────────────────
  console.log('\n--- 2. Dry run against an empty in-memory throwaway Firestore ---');
  const fake1 = new FakeFirestore();
  const guarded1 = guardedFirestore(fake1);
  resetAuditLog();
  const dryRunResult = await runImport(guarded1, dataset, { dryRun: true });
  printApplyResult(dryRunResult, true);
  assertTrue(dryRunResult.created.length === EXPECTED_DOC_COUNT, `dry run reports ${EXPECTED_DOC_COUNT} would be created`);
  assertTrue(dryRunResult.updated.length === 0, 'dry run reports 0 updates (empty target)');
  assertTrue(dryRunResult.skipped.length === 0, 'dry run reports 0 skips (empty target)');
  assertTrue(fake1.size() === 0, 'dry run performed ZERO actual writes to the throwaway target');
  assertTrue(getAuditLog().length === 0, 'dry run made zero audited writes');

  // ── 3. First real (--confirm) run against the same empty target ─────
  console.log('\n--- 3. First real run (--confirm equivalent) ---');
  resetAuditLog();
  const firstRun = await runImport(guarded1, dataset, { dryRun: false });
  printApplyResult(firstRun, false);
  assertTrue(firstRun.created.length === EXPECTED_DOC_COUNT, `first real run creates exactly ${EXPECTED_DOC_COUNT} documents`);
  assertTrue(fake1.size() === EXPECTED_DOC_COUNT, `throwaway target now holds exactly ${EXPECTED_DOC_COUNT} documents`);
  assertTrue(getAuditLog().length === EXPECTED_DOC_COUNT, 'audit log recorded exactly one write per created document');
  const league = fake1.dump()[`leagues/${dataset.league.id}`];
  assertTrue(!!league && league.adminUserId === PENDING_ADMIN_PLACEHOLDER, 'league doc carries the adminUserId placeholder pending real admin onboarding');

  // ── 4. Second run proves idempotency ─────────────────────────────────
  console.log('\n--- 4. Second run (idempotency proof) ---');
  resetAuditLog();
  const secondRun = await runImport(guarded1, dataset, { dryRun: false });
  printApplyResult(secondRun, false);
  assertTrue(secondRun.created.length === 0, 'second run creates 0 new documents');
  assertTrue(secondRun.updated.length === 0, 'second run updates 0 documents (nothing changed)');
  assertTrue(secondRun.skipped.length === EXPECTED_DOC_COUNT, `second run reports all ${EXPECTED_DOC_COUNT} documents already up to date`);
  assertTrue(fake1.size() === EXPECTED_DOC_COUNT, 'target still holds exactly the same document count — no duplicates');
  assertTrue(getAuditLog().length === 0, 'second run performed ZERO writes — true no-op');

  // ── 5. A third, --dry-run-flagged run changes nothing either ─────────
  console.log('\n--- 5. Third run, explicit dry run again, on the now-populated target ---');
  const thirdRun = await runImport(guarded1, dataset, { dryRun: true });
  assertTrue(thirdRun.skipped.length === EXPECTED_DOC_COUNT, 'dry run on populated target reports all documents already up to date');
  assertTrue(fake1.size() === EXPECTED_DOC_COUNT, 'dry run never changes the document count');

  // ── 6. Safety guard refuses out-of-scope targets ─────────────────────
  console.log('\n--- 6. Write-guard refusal tests (invalid league/season/division targets) ---');
  const invalidTargets: Array<[string, string]> = [
    ['leagues', 'showcase-league'],
    ['leagues', 'some-other-real-league'],
    ['seasons', 'showcase-season'],
    ['divisions', 'showcase-division'],
    ['divisions', 'bedford-kempston-winter-2026-27-division-1'], // Division 1 — must never be touched
    ['divisions', 'bedford-kempston-winter-2026-27-division-4'], // Division 4 — must never be touched
    ['teams', 'showcase-team-1'],
    ['teams', 'bk-d1-team-1'], // well-formed-looking but Division 1, not 2/3
    ['matches', 'showcase-match-r1-1v2'],
    ['users', 'some-uid'], // this importer must never touch users/ at all
  ];
  const fakeForGuardTest = new FakeFirestore();
  const guardedForTest = guardedFirestore(fakeForGuardTest);
  for (const [collectionPath, docId] of invalidTargets) {
    assertTrue(!isAllowedWrite(collectionPath, docId), `isAllowedWrite() rejects ${collectionPath}/${docId}`);
    let threw = false;
    try {
      // eslint-disable-next-line no-await-in-loop
      await guardedForTest.collection(collectionPath).doc(docId).set({ tampered: true });
    } catch {
      threw = true;
    }
    assertTrue(threw, `guardedFirestore.set() THROWS for ${collectionPath}/${docId} instead of writing`);
  }
  assertTrue(fakeForGuardTest.size() === 0, 'none of the rejected writes actually landed in the target — guard test store is still empty');

  // ── 7. A real (valid) write still succeeds through the same guard ────
  console.log('\n--- 7. Guard still allows a legitimate in-scope write ---');
  await guardedForTest.collection('teams').doc('bk-d2-team-1').set({ name: 'Burnaby Arms C' });
  assertTrue(fakeForGuardTest.size() === 1, 'a legitimate bk-d2-team-1 write succeeds through the guard');

  // ── 8. Never clobbers a real captain assignment on re-import ─────────
  console.log('\n--- 8. Re-running the importer never clobbers a real captain/VC assignment ---');
  const someTeamId = dataset.teams[0].id;
  const teamKey = `teams/${someTeamId}`;
  const beforeAssign = fake1.dump()[teamKey];
  assertTrue(beforeAssign?.captainUserId === null, 'sanity: team starts with captainUserId null after import');
  // Simulate the normal app flow assigning a real captain directly (never
  // going through this importer or its guard — exactly as captains.tsx's
  // approveJoinRequest would in production).
  await fake1.collection('teams').doc(someTeamId).set({ captainUserId: 'real-captain-uid-123' }, { merge: true });
  resetAuditLog();
  await runImport(guarded1, dataset, { dryRun: false });
  const afterReimport = fake1.dump()[teamKey];
  assertTrue(afterReimport?.captainUserId === 'real-captain-uid-123', 're-running the importer leaves a real captain assignment untouched');

  // ── 9. Never resets an already-played match back to 'scheduled' ─────
  console.log('\n--- 9. Re-running the importer never resets an already-played match ---');
  const someMatchId = dataset.fixtures[0].id;
  const matchKey = `matches/${someMatchId}`;
  await fake1.collection('matches').doc(someMatchId).set({ status: 'confirmed', homeGamesWon: 4, awayGamesWon: 3 }, { merge: true });
  resetAuditLog();
  const runAfterPlay = await runImport(guarded1, dataset, { dryRun: false });
  const playedMatchTouched = [...runAfterPlay.created, ...runAfterPlay.updated].some((o) => o.id === someMatchId);
  const playedMatchSkipped = runAfterPlay.skippedPlayed.some((o) => o.id === someMatchId);
  assertTrue(!playedMatchTouched, `already-played match ${someMatchId} was NOT created/updated by the re-import`);
  assertTrue(playedMatchSkipped, `already-played match ${someMatchId} was correctly reported under skippedPlayed`);
  const afterReimportMatch = fake1.dump()[matchKey];
  assertTrue(afterReimportMatch?.status === 'confirmed', 'the played match\'s status is still \'confirmed\' after re-import — not reset');

  // ── Summary ────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(70));
  console.log(failures === 0 ? `ALL OFFLINE CHECKS PASSED` : `${failures} OFFLINE CHECK(S) FAILED`);
  console.log('='.repeat(70));
  if (failures > 0) process.exitCode = 1;
}

main().catch((e: unknown) => {
  console.error('\nOFFLINE CHECKS CRASHED:', (e as Error).message ?? e);
  process.exitCode = 1;
});
