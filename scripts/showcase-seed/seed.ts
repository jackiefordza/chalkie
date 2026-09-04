#!/usr/bin/env node
// Entry point for both the seed and reset operations. Deliberately ONE
// file for both, not a separate reset.ts — see the implementation report
// for why: it guarantees the project-ID check and the confirmation-flag
// gate are the exact same code for both operations, so there is only one
// place that safety logic could ever drift or be forgotten, rather than
// two files that have to be kept in sync by hand.
//
// This script NEVER accepts a league ID, project ID, or any other target
// identifier from argv or the environment — the only inputs it recognizes
// are the flags below. Any other argument causes it to refuse to run.
import { EXPECTED_PROJECT_ID, LEAGUE_ID, allShowcaseEmails } from './src/constants';
import { getResolvedProjectId, initializeShowcaseAdminApp } from './src/firebaseAdmin';
import {
  buildSchedule, createShowcaseRng, confirmMatchesSequentially, seedAdminPersonas,
  seedCoreStructure, seedPlayers, seedSpecialStates, seedTeamAccounts, seedTeams,
  writeAllFixturesAsScheduled,
} from './src/seedCore';
import { printVerificationReport, verifyShowcaseDataset } from './src/verify';
import { resetShowcaseDataset, verifyReset } from './src/resetCore';

const RECOGNIZED_FLAGS = new Set(['--confirm-showcase', '--confirm-reset', '--reset']);

function parseArgs(argv: string[]): { reset: boolean; confirmShowcase: boolean; confirmReset: boolean } {
  const unrecognized = argv.filter((a) => !RECOGNIZED_FLAGS.has(a));
  if (unrecognized.length > 0) {
    throw new Error(
      `Unrecognized argument(s): ${unrecognized.join(', ')}. This script accepts ONLY `
      + '--confirm-showcase, --confirm-reset, and --reset — it never accepts a league ID, '
      + 'project ID, or any other target identifier as an argument. Refusing to run.',
    );
  }
  return {
    reset: argv.includes('--reset'),
    confirmShowcase: argv.includes('--confirm-showcase'),
    confirmReset: argv.includes('--confirm-reset'),
  };
}

function printBanner(operation: 'SEED' | 'RESET'): void {
  console.log('');
  console.log('='.repeat(60));
  console.log(`TARGET FIREBASE PROJECT: ${EXPECTED_PROJECT_ID}`);
  console.log(`TARGET DATASET:          ${LEAGUE_ID}`);
  console.log(`OPERATION:               ${operation}`);
  console.log('='.repeat(60));
  console.log('');
}

function printResetWarning(): void {
  console.log('!'.repeat(60));
  console.log('!!  DESTRUCTIVE OPERATION — SHOWCASE RESET');
  console.log('!!');
  console.log('!!  This will PERMANENTLY DELETE every document and Auth');
  console.log('!!  account this seed system could have created, scoped');
  console.log(`!!  ONLY to leagueId "${LEAGUE_ID}" and the ${allShowcaseEmails().length} known`);
  console.log('!!  showcase @chalkie.test email addresses:');
  console.log('!!');
  console.log('!!    - leagues / seasons / divisions / teams / players');
  console.log('!!    - all showcase match documents AND their nested');
  console.log('!!      submissions subcollections');
  console.log('!!    - divisionTables / playerSeasonStats rows');
  console.log('!!    - all showcase users/ docs and Firebase Auth accounts');
  console.log('!!');
  console.log('!!  This does NOT touch any other league, team, player, or');
  console.log('!!  account — every deletion targets a fixed showcase-only');
  console.log('!!  ID, never a broad query. But within the showcase');
  console.log('!!  dataset itself, this is irreversible.');
  console.log('!'.repeat(60));
  console.log('');
}

async function runSeed(): Promise<void> {
  const { db, auth } = initializeShowcaseAdminApp();
  const log = (msg: string) => console.log(msg);

  await seedCoreStructure(db, log);
  await seedTeams(db, log);
  await seedPlayers(db, log);
  const captainUidByTeam = await seedTeamAccounts(db, auth, log);
  await seedAdminPersonas(db, auth, log);

  const schedule = buildSchedule();
  await writeAllFixturesAsScheduled(db, schedule, log);

  const rng = createShowcaseRng();
  const { confirmed, failed } = await confirmMatchesSequentially(db, rng, captainUidByTeam, schedule, log);
  if (failed.length > 0) {
    log(`  WARNING: ${failed.length} match(es) did not reach 'confirmed' — see verification report.`);
  }

  const specialResult = await seedSpecialStates(db, rng, captainUidByTeam, schedule, log);

  log('Phase 9/9: verifying the full dataset…');
  const report = await verifyShowcaseDataset(db, auth, schedule, confirmed, specialResult);
  printVerificationReport(report, 'SHOWCASE DATASET VERIFICATION');

  if (!report.overallPass) process.exitCode = 1;
}

async function runReset(): Promise<void> {
  const { db, auth } = initializeShowcaseAdminApp();
  const log = (msg: string) => console.log(msg);

  const summary = await resetShowcaseDataset(db, auth, log);
  console.log('\nDeletion summary:');
  console.log(`  submissions:     ${summary.submissionsDeleted}`);
  console.log(`  divisionTables:  ${summary.divisionTablesDeleted}`);
  console.log(`  playerStats:     ${summary.playerStatsDeleted}`);
  console.log(`  matches:         ${summary.matchesDeleted}`);
  console.log(`  players:         ${summary.playersDeleted}`);
  console.log(`  teams:           ${summary.teamsDeleted}`);
  console.log(`  division:        ${summary.divisionDeleted}`);
  console.log(`  season:          ${summary.seasonDeleted}`);
  console.log(`  league:          ${summary.leagueDeleted}`);
  console.log(`  auth accounts:   ${summary.authAccountsDeleted}`);

  const verification = await verifyReset(db, auth);
  console.log('\nSHOWCASE RESET VERIFICATION');
  console.log('===========================');
  console.log(`Showcase Firestore documents remaining: ${verification.firestoreRemaining}`);
  console.log(`Showcase Auth accounts remaining: ${verification.authRemaining}`);
  if (verification.remainingPaths.length > 0) {
    console.log('Remaining (this is a failure — investigate before re-seeding):');
    verification.remainingPaths.forEach((p) => console.log(`  - ${p}`));
  }
  const pass = verification.firestoreRemaining === 0 && verification.authRemaining === 0;
  console.log(`RESULT: ${pass ? 'PASS' : 'FAIL'}`);
  if (!pass) process.exitCode = 1;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.confirmShowcase) {
    throw new Error(
      'Refusing to run without --confirm-showcase. This flag exists so this script can never run '
      + 'by accident (e.g. as part of some other automated command). Pass it explicitly when you '
      + 'really mean to seed or reset the showcase dataset.',
    );
  }
  if (args.reset && !args.confirmReset) {
    throw new Error(
      'Refusing to run --reset without ALSO passing --confirm-reset. Reset is destructive — see '
      + 'README.md. Both --confirm-showcase and --confirm-reset are required together for a reset.',
    );
  }

  printBanner(args.reset ? 'RESET' : 'SEED');
  if (args.reset) printResetWarning();

  if (args.reset) {
    await runReset();
  } else {
    await runSeed();
  }

  console.log(`\n(Verified live against Firebase project: ${getResolvedProjectId()})`);
}

main().catch((e: unknown) => {
  console.error('\nFAILED:', (e as Error).message ?? e);
  process.exitCode = 1;
});
