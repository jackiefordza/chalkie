#!/usr/bin/env node
// Entry point. This script NEVER accepts a team ID, project ID, or any
// other target identifier from argv or the environment — the only input it
// recognizes is the flag below. The data it writes lives in
// src/contacts.ts, a compile-time constant, not an argument.
import { EXPECTED_PROJECT_ID } from './src/constants';
import { TEAM_CONTACTS } from './src/contacts';
import { getResolvedProjectId, initializeRealTeamContactsSeedApp } from './src/firebaseAdmin';
import { seedRealTeamContacts } from './src/seedCore';
import { printVerificationReport, verifyRealTeamContacts } from './src/verify';

const RECOGNIZED_FLAGS = new Set(['--confirm-real-team-contacts-seed']);

function parseArgs(argv: string[]): { confirm: boolean } {
  const unrecognized = argv.filter((a) => !RECOGNIZED_FLAGS.has(a));
  if (unrecognized.length > 0) {
    throw new Error(
      `Unrecognized argument(s): ${unrecognized.join(', ')}. This script accepts ONLY `
      + '--confirm-real-team-contacts-seed — it never accepts a team ID, project ID, or any other '
      + 'target identifier as an argument. Refusing to run.',
    );
  }
  return { confirm: argv.includes('--confirm-real-team-contacts-seed') };
}

function printBanner(): void {
  console.log('');
  console.log('='.repeat(60));
  console.log(`TARGET FIREBASE PROJECT: ${EXPECTED_PROJECT_ID}`);
  console.log(`OPERATION:               write real address/captain/VC contact info`);
  console.log(`                         onto all ${TEAM_CONTACTS.length} real Division 2/3 teams`);
  console.log('Never writes a venue telephone number.');
  console.log('='.repeat(60));
  console.log('');
}

async function main(): Promise<void> {
  const { confirm } = parseArgs(process.argv.slice(2));
  if (!confirm) {
    throw new Error(
      'Refusing to run without --confirm-real-team-contacts-seed. This flag exists so this script can never run '
      + 'by accident. Pass it explicitly when you really mean to write this contact data.',
    );
  }

  printBanner();

  const { db } = initializeRealTeamContactsSeedApp();
  const log = (msg: string) => console.log(msg);

  await seedRealTeamContacts(db, log);

  log('\nVerifying…');
  const report = await verifyRealTeamContacts(db);
  printVerificationReport(report);
  if (!report.overallPass) process.exitCode = 1;

  console.log(`\n(Verified live against Firebase project: ${getResolvedProjectId()})`);
}

main().catch((e: unknown) => {
  console.error('\nFAILED:', (e as Error).message ?? e);
  process.exitCode = 1;
});
