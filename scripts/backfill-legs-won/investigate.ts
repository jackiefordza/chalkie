#!/usr/bin/env node
// Read-only investigation into the source of pre-existing legsWon values on
// real (non-showcase) playerSeasonStats documents, requested after the
// backfill's dry run found 225 such documents already populated. This
// entry point (and everything it imports) is structurally incapable of
// writing to Firestore — it never imports guardedUpdateLegsWon or any
// other write-capable helper. See README.md's "Investigating, not
// backfilling" section.
import { EXPECTED_PROJECT_ID } from './src/constants';
import { initializeBackfillAdminApp } from './src/firebaseAdmin';
import { investigate, printInvestigation } from './src/investigate';

const RECOGNIZED_FLAGS = new Set(['--confirm-investigate']);

function parseArgs(argv: string[]): { confirmInvestigate: boolean } {
  const unrecognized = argv.filter((a) => !RECOGNIZED_FLAGS.has(a));
  if (unrecognized.length > 0) {
    throw new Error(
      `Unrecognized argument(s): ${unrecognized.join(', ')}. This script accepts ONLY `
      + '--confirm-investigate. It has no write path at all — there is no --apply flag here.',
    );
  }
  return { confirmInvestigate: argv.includes('--confirm-investigate') };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.confirmInvestigate) {
    throw new Error('Refusing to run without --confirm-investigate.');
  }

  console.log('');
  console.log('='.repeat(60));
  console.log(`TARGET FIREBASE PROJECT: ${EXPECTED_PROJECT_ID}`);
  console.log('OPERATION:               legsWon investigation (READ-ONLY)');
  console.log('SCOPE:                   reads matches (status == confirmed) and');
  console.log('                         playerSeasonStats only; writes NOTHING.');
  console.log('='.repeat(60));
  console.log('');

  const { db } = initializeBackfillAdminApp();
  const { rows, missingDocs } = await investigate(db);
  printInvestigation(rows, missingDocs);
}

main().catch((e: unknown) => {
  console.error('\nFAILED:', (e as Error).message ?? e);
  process.exitCode = 1;
});
