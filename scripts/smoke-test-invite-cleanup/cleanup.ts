#!/usr/bin/env node
// Entry point. This script NEVER accepts a team ID, project ID, email, or
// any other target identifier from argv or the environment — the only
// input it recognizes is the flag below. Any other argument causes it to
// refuse to run. Deletes exactly the two Firestore documents and the one
// Auth account created for the now-completed Captain Invite smoke test,
// after independently re-verifying (by reading Firestore, not by trusting
// the caller) that the Auth account is linked ONLY to the throwaway team.
import { EXPECTED_PROJECT_ID, SMOKE_TEST_INVITE_ID, SMOKE_TEST_TEAM_ID } from './src/constants';
import { getResolvedProjectId, initializeSmokeTestCleanupApp } from './src/firebaseAdmin';
import { performSmokeTestCleanup } from './src/cleanupCore';
import { printVerificationReport, verifyCleanup } from './src/verify';

const RECOGNIZED_FLAGS = new Set(['--confirm-smoke-test-cleanup']);

function parseArgs(argv: string[]): { confirm: boolean } {
  const unrecognized = argv.filter((a) => !RECOGNIZED_FLAGS.has(a));
  if (unrecognized.length > 0) {
    throw new Error(
      `Unrecognized argument(s): ${unrecognized.join(', ')}. This script accepts ONLY `
      + '--confirm-smoke-test-cleanup — it never accepts a team ID, project ID, or email as an argument. '
      + 'Refusing to run.',
    );
  }
  return { confirm: argv.includes('--confirm-smoke-test-cleanup') };
}

function printBanner(): void {
  console.log('');
  console.log('='.repeat(60));
  console.log(`TARGET FIREBASE PROJECT: ${EXPECTED_PROJECT_ID}`);
  console.log(`DELETING:                teams/${SMOKE_TEST_TEAM_ID}, invites/${SMOKE_TEST_INVITE_ID}, `
    + 'and the one throwaway Auth account that accepted the smoke-test invite');
  console.log('OPERATION:               DELETE (ownership re-verified against Firestore before any delete)');
  console.log('='.repeat(60));
  console.log('');
}

async function main(): Promise<void> {
  const { confirm } = parseArgs(process.argv.slice(2));
  if (!confirm) {
    throw new Error(
      'Refusing to run without --confirm-smoke-test-cleanup. This flag exists so this script can never run '
      + 'by accident. Pass it explicitly when you really mean to delete the throwaway smoke-test data.',
    );
  }

  printBanner();

  const { db, auth } = initializeSmokeTestCleanupApp();
  const log = (msg: string) => console.log(msg);

  const result = await performSmokeTestCleanup(db, auth, log);

  log('Verifying…');
  const report = await verifyCleanup(db, auth, result);
  printVerificationReport(report);
  if (!report.overallPass) process.exitCode = 1;

  console.log('SMOKE-TEST CLEANUP — DELIVERABLE');
  console.log('=================================');
  console.log(`Deleted: invites/${result.deletedInviteId}`);
  console.log(`Deleted: teams/${result.deletedTeamId}`);
  console.log(`Deleted: users/${result.deletedUserUid} (${result.deletedUserEmail})`);
  console.log(`Deleted: Auth account ${result.deletedUserUid} (${result.deletedUserEmail})`);
  console.log('');

  console.log(`(Verified live against Firebase project: ${getResolvedProjectId()})`);
}

main().catch((e: unknown) => {
  console.error('\nFAILED:', (e as Error).message ?? e);
  process.exitCode = 1;
});
