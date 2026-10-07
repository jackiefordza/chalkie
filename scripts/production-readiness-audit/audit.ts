#!/usr/bin/env node
// Entry point. STRICTLY READ-ONLY — see README.md and prove-read-only.sh.
// This script accepts ONLY the one flag below; any other argument causes
// it to refuse to run. It never accepts a project ID, league ID, or any
// other target identifier from argv or the environment.
import { EXPECTED_PROJECT_ID } from './src/constants';
import { getResolvedProjectId, initializeProductionReadonlyAuditApp } from './src/firebaseAdmin';
import {
  auditAuth, auditFirestore, auditProjectConfig, EXPECTED_FIXTURE_COUNT, EXPECTED_TEAM_COUNT,
} from './src/auditCore';

const RECOGNIZED_FLAGS = new Set(['--confirm-production-readonly-audit']);

function parseArgs(argv: string[]): { confirm: boolean } {
  const unrecognized = argv.filter((a) => !RECOGNIZED_FLAGS.has(a));
  if (unrecognized.length > 0) {
    throw new Error(
      `Unrecognized argument(s): ${unrecognized.join(', ')}. This script accepts ONLY `
      + '--confirm-production-readonly-audit. Refusing to run.',
    );
  }
  return { confirm: argv.includes('--confirm-production-readonly-audit') };
}

function printBanner(): void {
  console.log('');
  console.log('='.repeat(70));
  console.log(`TARGET FIREBASE PROJECT: ${EXPECTED_PROJECT_ID}  (PRODUCTION)`);
  console.log('OPERATION:               READ-ONLY AUDIT — zero writes anywhere in this script');
  console.log('='.repeat(70));
  console.log('');
}

async function main(): Promise<void> {
  const { confirm } = parseArgs(process.argv.slice(2));
  if (!confirm) {
    throw new Error(
      'Refusing to run without --confirm-production-readonly-audit. This flag exists so this script can '
      + 'never run by accident against production, even though it is read-only.',
    );
  }

  printBanner();

  const { db, auth } = initializeProductionReadonlyAuditApp();

  console.log('--- FIRESTORE ---');
  const fsResult = await auditFirestore(db);
  console.log('Collection counts:');
  for (const c of fsResult.collectionCounts) {
    console.log(`  ${c.collection}: ${c.count}`);
  }
  console.log(`leagues/bedford-kempston-district exists: ${fsResult.leagueExists} (name: ${fsResult.leagueName ?? 'n/a'})`);
  console.log(`season doc exists: ${fsResult.seasonExists}`);
  console.log(`Division 2 doc exists: ${fsResult.division2Exists}`);
  console.log(`Division 3 doc exists: ${fsResult.division3Exists}`);
  console.log(`teams under this league: ${fsResult.teamsUnderLeague} / expected ${EXPECTED_TEAM_COUNT}`);
  console.log(`matches under this league: ${fsResult.matchesUnderLeague} / expected ${EXPECTED_FIXTURE_COUNT}`);

  console.log('');
  console.log('--- AUTH ---');
  const authResult = await auditAuth(auth);
  console.log(`Total Auth user count: ${authResult.totalUserCount}`);
  console.log(`Users with a 'password' provider credential: ${authResult.passwordProviderUserCount}`);
  console.log('Known test/pilot email existence (boolean only):');
  for (const e of authResult.knownTestEmailsFound) {
    console.log(`  ${e.email}: ${e.exists}`);
  }
  console.log(`jfordham95@gmail.com exists in production: ${authResult.realUserEmailExists}`);

  const cfg = await auditProjectConfig(auth);
  console.log('');
  console.log(`Project Auth config readable via Admin SDK: ${cfg.readable}`);
  if (cfg.readable) console.log(`Project config: ${cfg.detail}`);
  else console.log(`(not readable this way: ${cfg.detail})`);

  console.log('');
  console.log(`No writes were performed. (Verified live, read-only, against Firebase project: ${getResolvedProjectId()})`);
}

main().catch((e: unknown) => {
  console.error('\nFAILED:', (e as Error).message ?? e);
  process.exitCode = 1;
});
