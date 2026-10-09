#!/usr/bin/env node
// Entry point. This script NEVER accepts a team ID, project ID, or any
// other target identifier from argv or the environment — the only input
// it recognizes is the flag below. Any other argument causes it to refuse
// to run. Requires scripts/real-season-import-staging to have already
// created the league/season/division/teams/matches this script links
// captains onto — it never creates those itself.
import { EXPECTED_PROJECT_ID, PILOT_MATCH_ID, PILOT_TEAMS, allPilotEmails } from './src/constants';
import { getResolvedProjectId, initializePilotAdminApp } from './src/firebaseAdmin';
import { seedCaptains, seedPlayers } from './src/seedCore';
import { printVerificationReport, verifyPilotDataset } from './src/verify';

const RECOGNIZED_FLAGS = new Set(['--confirm-pilot-seed']);

function parseArgs(argv: string[]): { confirmPilotSeed: boolean } {
  const unrecognized = argv.filter((a) => !RECOGNIZED_FLAGS.has(a));
  if (unrecognized.length > 0) {
    throw new Error(
      `Unrecognized argument(s): ${unrecognized.join(', ')}. This script accepts ONLY `
      + '--confirm-pilot-seed — it never accepts a team ID, project ID, or any other '
      + 'target identifier as an argument. Refusing to run.',
    );
  }
  return { confirmPilotSeed: argv.includes('--confirm-pilot-seed') };
}

function printBanner(): void {
  console.log('');
  console.log('='.repeat(60));
  console.log(`TARGET FIREBASE PROJECT: ${EXPECTED_PROJECT_ID}`);
  console.log(`TARGET FIXTURE:          ${PILOT_MATCH_ID}`);
  console.log(`TARGET TEAMS:            ${PILOT_TEAMS.map((t) => t.teamName).join(' vs ')}`);
  console.log('OPERATION:               SEED (placeholder players + captain accounts)');
  console.log('='.repeat(60));
  console.log('');
}

async function main(): Promise<void> {
  const { confirmPilotSeed } = parseArgs(process.argv.slice(2));
  if (!confirmPilotSeed) {
    throw new Error(
      'Refusing to run without --confirm-pilot-seed. This flag exists so this script can never run '
      + 'by accident. Pass it explicitly when you really mean to seed the pilot captain accounts.',
    );
  }

  printBanner();

  const { db, auth } = initializePilotAdminApp();
  const log = (msg: string) => console.log(msg);

  await seedPlayers(db, log);
  const { newPassword } = await seedCaptains(db, auth, log);

  if (newPassword) {
    console.log('');
    console.log('='.repeat(60));
    console.log('NEW PASSWORD for any captain account(s) just created above');
    console.log(`(${allPilotEmails().join(', ')}) — generated this run, shown ONCE, never stored:`);
    console.log(newPassword);
    console.log('Copy this now. It is not written to Firestore, a file, or git — if you lose it,');
    console.log('see scripts/pilot-captains-seed/README.md\'s "If you lose the password" section.');
    console.log('='.repeat(60));
    console.log('');
  } else {
    console.log('\n(Both captain accounts already existed — their passwords were left unchanged, not reprinted.)');
  }

  log('Verifying…');
  const report = await verifyPilotDataset(db, auth);
  printVerificationReport(report);
  if (!report.overallPass) process.exitCode = 1;

  console.log(`\n(Verified live against Firebase project: ${getResolvedProjectId()})`);
}

main().catch((e: unknown) => {
  console.error('\nFAILED:', (e as Error).message ?? e);
  process.exitCode = 1;
});
