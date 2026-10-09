#!/usr/bin/env node
// Entry point. This script NEVER accepts a team ID, project ID, or any
// other target identifier from argv or the environment — the only input it
// recognizes is the flag below. Any other argument causes it to refuse to
// run.
import { ADMIN_EMAIL, BURNABY_C_CAPTAIN_EMAIL, EXPECTED_PROJECT_ID, OAKLEY_CAPTAIN_EMAIL } from './src/constants';
import { cleanupPilotCollisions } from './src/cleanupCore';
import { getResolvedProjectId, initializePilotCollisionCleanupApp } from './src/firebaseAdmin';
import { printVerificationReport, verifyCleanup } from './src/verify';

const RECOGNIZED_FLAGS = new Set(['--confirm-pilot-collision-cleanup']);

function parseArgs(argv: string[]): { confirm: boolean } {
  const unrecognized = argv.filter((a) => !RECOGNIZED_FLAGS.has(a));
  if (unrecognized.length > 0) {
    throw new Error(
      `Unrecognized argument(s): ${unrecognized.join(', ')}. This script accepts ONLY `
      + '--confirm-pilot-collision-cleanup — it never accepts a team ID, project ID, or any other '
      + 'target identifier as an argument. Refusing to run.',
    );
  }
  return { confirm: argv.includes('--confirm-pilot-collision-cleanup') };
}

function printBanner(): void {
  console.log('');
  console.log('='.repeat(60));
  console.log(`TARGET FIREBASE PROJECT: ${EXPECTED_PROJECT_ID}`);
  console.log('OPERATION:               RETIRE three pilot/test accounts\' team/role access:');
  console.log(`  - ${OAKLEY_CAPTAIN_EMAIL} (captain, Oakley Sports Club)`);
  console.log(`  - ${BURNABY_C_CAPTAIN_EMAIL} (captain, Burnaby Arms C)`);
  console.log(`  - ${ADMIN_EMAIL} (vice-captain, Burnaby Arms B — admin status untouched)`);
  console.log('Does NOT delete any Auth account, league, fixture, or match-result data.');
  console.log('='.repeat(60));
  console.log('');
}

async function main(): Promise<void> {
  const { confirm } = parseArgs(process.argv.slice(2));
  if (!confirm) {
    throw new Error(
      'Refusing to run without --confirm-pilot-collision-cleanup. This flag exists so this script can never run '
      + 'by accident. Pass it explicitly when you really mean to retire these three accounts\' team/role access.',
    );
  }

  printBanner();

  const { db, auth } = initializePilotCollisionCleanupApp();
  const log = (msg: string) => console.log(msg);

  await cleanupPilotCollisions(db, auth, log);

  log('\nVerifying…');
  const report = await verifyCleanup(db, auth);
  printVerificationReport(report);
  if (!report.overallPass) process.exitCode = 1;

  console.log(`\n(Verified live against Firebase project: ${getResolvedProjectId()})`);
}

main().catch((e: unknown) => {
  console.error('\nFAILED:', (e as Error).message ?? e);
  process.exitCode = 1;
});
