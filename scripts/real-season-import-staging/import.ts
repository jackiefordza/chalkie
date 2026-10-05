#!/usr/bin/env node
// Entry point for importing the real Bedford & Kempston District Darts
// League Division 2 + Division 3 (Winter 2026/27) season into Chalkie's
// production Firestore. Creates League, Season, Division 2, Division 3, 16
// teams, and 112 fixtures ONLY — no players, no captains, per the explicit
// brief this script was built against. See README.md before running this
// against anything but a dry run.
//
// This script NEVER accepts a league ID, season ID, division ID, project
// ID, or any other target identifier from argv or the environment — the
// only inputs it recognizes are the two flags below. Any other argument
// causes it to refuse to run. Without --confirm, this is ALWAYS a dry run:
// the dataset is validated and the exact create/update/skip plan is
// printed, but nothing is written.
import { EXPECTED_PROJECT_ID, LEAGUE_ID, SEASON_ID } from './src/constants';
import { buildCanonicalDataset } from './src/dataset';
import { validateDataset, printValidationReport } from './src/validate';
import { guardedFirestore, initializeRealAdminApp, getAuditLog } from './src/firebaseAdmin';
import { runImport, printApplyResult } from './src/importer';

const RECOGNIZED_FLAGS = new Set(['--confirm', '--dry-run']);

function parseArgs(argv: string[]): { confirm: boolean } {
  const unrecognized = argv.filter((a) => !RECOGNIZED_FLAGS.has(a));
  if (unrecognized.length > 0) {
    throw new Error(
      `Unrecognized argument(s): ${unrecognized.join(', ')}. This script accepts ONLY `
      + '--confirm and --dry-run — it never accepts a league ID, project ID, or any other '
      + 'target identifier as an argument. Refusing to run.',
    );
  }
  if (argv.includes('--confirm') && argv.includes('--dry-run')) {
    throw new Error('Pass either --confirm or --dry-run, not both.');
  }
  return { confirm: argv.includes('--confirm') };
}

function printBanner(dryRun: boolean): void {
  console.log('');
  console.log('='.repeat(60));
  console.log(`TARGET FIREBASE PROJECT: ${EXPECTED_PROJECT_ID}`);
  console.log(`TARGET LEAGUE:           ${LEAGUE_ID}`);
  console.log(`TARGET SEASON:           ${SEASON_ID}`);
  console.log(`MODE:                    ${dryRun ? 'DRY RUN (no writes)' : 'LIVE — WILL WRITE'}`);
  console.log('='.repeat(60));
  console.log('');
}

async function main(): Promise<void> {
  const { confirm } = parseArgs(process.argv.slice(2));
  const dryRun = !confirm;
  printBanner(dryRun);

  const dataset = buildCanonicalDataset();
  const report = validateDataset(dataset);
  printValidationReport(report);
  if (!report.overallPass) {
    throw new Error('Dataset validation FAILED — refusing to import an invalid dataset. See failures above.');
  }

  const rawDb = initializeRealAdminApp();
  const db = guardedFirestore(rawDb);

  const result = await runImport(db, dataset, { dryRun });
  printApplyResult(result, dryRun);

  console.log('');
  console.log(`Writes performed this run: ${getAuditLog().length}`);
  if (dryRun) {
    console.log('This was a DRY RUN. Re-run with --confirm to actually write these changes.');
  }
}

main().catch((e: unknown) => {
  console.error('\nFAILED:', (e as Error).message ?? e);
  process.exitCode = 1;
});
