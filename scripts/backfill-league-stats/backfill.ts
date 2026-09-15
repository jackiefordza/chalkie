#!/usr/bin/env node
// Entry point — the League-only leaderboard stats backfill (Stats Rules
// audit, Season 1, correction). Defaults to a read-only dry run; only
// --apply performs any write. See README.md.
import { EXPECTED_PROJECT_ID } from './src/constants';
import { initializeBackfillAdminApp, getAuditLog } from './src/firebaseAdmin';
import { buildBackfillPlan, printPlan, applyPlan, rowsNeedingWrite } from './src/runner';

const RECOGNIZED_FLAGS = new Set(['--confirm-backfill', '--apply']);

function parseArgs(argv: string[]): { confirmBackfill: boolean; apply: boolean } {
  const unrecognized = argv.filter((a) => !RECOGNIZED_FLAGS.has(a));
  if (unrecognized.length > 0) {
    throw new Error(
      `Unrecognized argument(s): ${unrecognized.join(', ')}. This script accepts ONLY `
      + '--confirm-backfill and --apply — it never accepts a league ID, season ID, project ID, '
      + 'or any other target identifier as an argument. Refusing to run.',
    );
  }
  return { confirmBackfill: argv.includes('--confirm-backfill'), apply: argv.includes('--apply') };
}

function printBanner(mode: 'DRY RUN' | 'APPLY'): void {
  console.log('');
  console.log('='.repeat(60));
  console.log(`TARGET FIREBASE PROJECT: ${EXPECTED_PROJECT_ID}`);
  console.log('OPERATION:               Stats Rules audit — League-only leaderboard stats backfill');
  console.log(`MODE:                    ${mode}${mode === 'DRY RUN' ? ' (read-only — no writes)' : ' — WILL WRITE league stats'}`);
  console.log('SCOPE:                   reads matches (status == confirmed) only;');
  console.log('                         writes ONLY leagueLegsWon/leagueLegsPlayed/leagueGamesWon/');
  console.log('                         leagueGamesPlayed on playerSeasonStats;');
  console.log('                         never touches matches, fixtures, legsWon, or any other field.');
  console.log('='.repeat(60));
  console.log('');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.confirmBackfill) {
    throw new Error(
      'Refusing to run without --confirm-backfill. Pass it explicitly when you really mean to read '
      + "chalkie-app's confirmed matches and compute/preview the League-only stats backfill. Add --apply "
      + 'on top of that to actually write — omitting it always produces a dry run, never a write.',
    );
  }

  printBanner(args.apply ? 'APPLY' : 'DRY RUN');

  const { db } = initializeBackfillAdminApp();
  const { plan, missingDocs } = await buildBackfillPlan(db);
  printPlan(plan, missingDocs);

  if (!args.apply) {
    console.log('\nDry run complete. No writes were made. Re-run with --apply to write the above.');
    return;
  }

  const needsWrite = rowsNeedingWrite(plan);
  if (needsWrite.length === 0) {
    console.log('\nNothing to write — every playerSeasonStats document already has the correct League-only stats.');
    return;
  }

  console.log(`\nApplying ${needsWrite.length} write(s)...`);
  const written = await applyPlan(db, plan);
  console.log(`\nWrote League-only stats to ${written} playerSeasonStats document(s).`);
  console.log('\nAudit log:');
  getAuditLog().forEach((e) => console.log(`  ${e.docPath}: ${JSON.stringify(e.old)} -> ${JSON.stringify(e.next)}`));
}

main().catch((e: unknown) => {
  console.error('\nFAILED:', (e as Error).message ?? e);
  process.exitCode = 1;
});
