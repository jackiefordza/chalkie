#!/usr/bin/env node
// Entry point. This script NEVER accepts a team ID, project ID, or any
// other target identifier from argv or the environment — the only input it
// recognizes is the flag below. Any other argument causes it to refuse to
// run. Requires scripts/pilot-admin-seed (the existing admin account) and
// scripts/real-season-import-staging (Burnaby Arms B / Division 3) to have
// already run — this script creates neither.
import { ADMIN_EMAIL, EXPECTED_PROJECT_ID, TEAM_NAME } from './src/constants';
import { getResolvedProjectId, initializePilotAdminVcLinkApp } from './src/firebaseAdmin';
import { linkAdminAsViceCaptain } from './src/linkCore';
import { printVerificationReport, verifyAdminVcLink } from './src/verify';

const RECOGNIZED_FLAGS = new Set(['--confirm-pilot-admin-vc-link']);

function parseArgs(argv: string[]): { confirm: boolean } {
  const unrecognized = argv.filter((a) => !RECOGNIZED_FLAGS.has(a));
  if (unrecognized.length > 0) {
    throw new Error(
      `Unrecognized argument(s): ${unrecognized.join(', ')}. This script accepts ONLY `
      + '--confirm-pilot-admin-vc-link — it never accepts a team ID, project ID, or any other '
      + 'target identifier as an argument. Refusing to run.',
    );
  }
  return { confirm: argv.includes('--confirm-pilot-admin-vc-link') };
}

function printBanner(): void {
  console.log('');
  console.log('='.repeat(60));
  console.log(`TARGET FIREBASE PROJECT: ${EXPECTED_PROJECT_ID}`);
  console.log(`EXISTING ADMIN ACCOUNT:  ${ADMIN_EMAIL} (never created here)`);
  console.log(`LINKING TO TEAM:         ${TEAM_NAME} (Division 3) as viceCaptain`);
  console.log('OPERATION:               LINK (no new Auth account, no rules/schema change)');
  console.log('='.repeat(60));
  console.log('');
}

async function main(): Promise<void> {
  const { confirm } = parseArgs(process.argv.slice(2));
  if (!confirm) {
    throw new Error(
      'Refusing to run without --confirm-pilot-admin-vc-link. This flag exists so this script can never run '
      + 'by accident. Pass it explicitly when you really mean to link the existing admin account.',
    );
  }

  printBanner();

  const { db, auth } = initializePilotAdminVcLinkApp();
  const log = (msg: string) => console.log(msg);

  await linkAdminAsViceCaptain(db, auth, log);

  log('Verifying…');
  const report = await verifyAdminVcLink(db, auth);
  printVerificationReport(report);
  if (!report.overallPass) process.exitCode = 1;

  console.log(`\n(Verified live against Firebase project: ${getResolvedProjectId()})`);
}

main().catch((e: unknown) => {
  console.error('\nFAILED:', (e as Error).message ?? e);
  process.exitCode = 1;
});
