#!/usr/bin/env node
// Entry point. This script NEVER accepts a league ID, project ID, or any
// other target identifier from argv or the environment — the only input it
// recognizes is the flag below. Any other argument causes it to refuse to
// run. Requires scripts/real-season-import-staging to have already created
// the league this script onboards an admin onto — it never creates the
// league itself.
import { EXPECTED_PROJECT_ID, LEAGUE_ID, ADMIN_EMAIL } from './src/constants';
import { getResolvedProjectId, initializePilotAdminSeedApp } from './src/firebaseAdmin';
import { seedPilotAdmin } from './src/seedCore';
import { printVerificationReport, verifyPilotAdmin } from './src/verify';

const RECOGNIZED_FLAGS = new Set(['--confirm-pilot-admin-seed']);

function parseArgs(argv: string[]): { confirm: boolean } {
  const unrecognized = argv.filter((a) => !RECOGNIZED_FLAGS.has(a));
  if (unrecognized.length > 0) {
    throw new Error(
      `Unrecognized argument(s): ${unrecognized.join(', ')}. This script accepts ONLY `
      + '--confirm-pilot-admin-seed — it never accepts a league ID, project ID, or any other '
      + 'target identifier as an argument. Refusing to run.',
    );
  }
  return { confirm: argv.includes('--confirm-pilot-admin-seed') };
}

function printBanner(): void {
  console.log('');
  console.log('='.repeat(60));
  console.log(`TARGET FIREBASE PROJECT: ${EXPECTED_PROJECT_ID}`);
  console.log(`TARGET LEAGUE:           ${LEAGUE_ID}`);
  console.log(`ACCOUNT:                 ${ADMIN_EMAIL} (temporary, staging-only)`);
  console.log('OPERATION:               SEED (one league-scoped admin account)');
  console.log('='.repeat(60));
  console.log('');
}

async function main(): Promise<void> {
  const { confirm } = parseArgs(process.argv.slice(2));
  if (!confirm) {
    throw new Error(
      'Refusing to run without --confirm-pilot-admin-seed. This flag exists so this script can never run '
      + 'by accident. Pass it explicitly when you really mean to seed the pilot admin account.',
    );
  }

  printBanner();

  const { db, auth } = initializePilotAdminSeedApp();
  const log = (msg: string) => console.log(msg);

  const { newPassword } = await seedPilotAdmin(db, auth, log);

  if (newPassword) {
    console.log('');
    console.log('='.repeat(60));
    console.log(`NEW PASSWORD for ${ADMIN_EMAIL} (generated this run — shown ONCE, never stored):`);
    console.log(newPassword);
    console.log('Copy this now. It is not written to Firestore, a file, or git — if you lose it,');
    console.log('see scripts/pilot-admin-seed/README.md\'s "If you lose the password" section.');
    console.log('='.repeat(60));
    console.log('');
  } else {
    console.log(`\n(${ADMIN_EMAIL} already existed — its password was left unchanged, not reprinted.)`);
  }

  log('Verifying…');
  const report = await verifyPilotAdmin(db, auth);
  printVerificationReport(report);
  if (!report.overallPass) process.exitCode = 1;

  console.log(`\n(Verified live against Firebase project: ${getResolvedProjectId()})`);
}

main().catch((e: unknown) => {
  console.error('\nFAILED:', (e as Error).message ?? e);
  process.exitCode = 1;
});
