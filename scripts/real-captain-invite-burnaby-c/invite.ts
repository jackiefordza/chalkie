#!/usr/bin/env node
// Entry point. This script NEVER accepts a team ID, project ID, or any
// other target identifier from argv or the environment — the only input
// it recognizes is the flag below. Any other argument causes it to refuse
// to run. Creates exactly ONE real Captain invite for teams/bk-d2-team-1
// (Burnaby Arms C, Division 2, Bedford & Kempston District), after 7
// read-only pre-flight checks. If any check fails, this script throws
// before writing anything — see src/inviteCore.ts's runPreflightChecks.
// Never creates an Auth account, a users/{uid} document, or a player
// record, and never writes to the team doc (captainUserId is set only
// when the invite is later accepted, by the real acceptTeamInvite
// function — not by this script).
import { EXPECTED_PROJECT_ID, STAGING_PREVIEW_BASE_URL, TEAM_ID, TEAM_NAME } from './src/constants';
import { getResolvedProjectId, initializeRealCaptainInviteApp } from './src/firebaseAdmin';
import { createRealCaptainInvite, PreflightFailure } from './src/inviteCore';
import { printVerificationReport, verifyRealCaptainInvite } from './src/verify';

const RECOGNIZED_FLAGS = new Set(['--confirm-real-captain-invite']);

function parseArgs(argv: string[]): { confirm: boolean } {
  const unrecognized = argv.filter((a) => !RECOGNIZED_FLAGS.has(a));
  if (unrecognized.length > 0) {
    throw new Error(
      `Unrecognized argument(s): ${unrecognized.join(', ')}. This script accepts ONLY `
      + '--confirm-real-captain-invite — it never accepts a team ID, project ID, or any other target '
      + 'identifier as an argument. Refusing to run.',
    );
  }
  return { confirm: argv.includes('--confirm-real-captain-invite') };
}

function printBanner(): void {
  console.log('');
  console.log('='.repeat(60));
  console.log(`TARGET FIREBASE PROJECT: ${EXPECTED_PROJECT_ID}`);
  console.log(`TARGET TEAM:             ${TEAM_ID} (${TEAM_NAME}) — Division 2, Bedford & Kempston District`);
  console.log('OPERATION:               7 read-only pre-flight checks, then CREATE one Captain invite');
  console.log('='.repeat(60));
  console.log('');
}

async function main(): Promise<void> {
  const { confirm } = parseArgs(process.argv.slice(2));
  if (!confirm) {
    throw new Error(
      'Refusing to run without --confirm-real-captain-invite. This flag exists so this script can never run '
      + 'by accident. Pass it explicitly when you really mean to create this real Captain invite.',
    );
  }

  printBanner();

  const { db, auth } = initializeRealCaptainInviteApp();
  const log = (msg: string) => console.log(msg);

  let created;
  try {
    created = await createRealCaptainInvite(db, auth, log);
  } catch (e: unknown) {
    if (e instanceof PreflightFailure) {
      console.error('');
      console.error('PRE-FLIGHT CHECK FAILED — NOTHING WAS CREATED OR MODIFIED.');
      console.error(e.message);
      console.error('');
      process.exitCode = 1;
      return;
    }
    throw e;
  }

  log('Verifying…');
  const report = await verifyRealCaptainInvite(db, created);
  printVerificationReport(report);
  if (!report.overallPass) process.exitCode = 1;

  const inviteUrl = `${STAGING_PREVIEW_BASE_URL}/invite/${created.inviteId}?t=${encodeURIComponent(created.token)}`;

  console.log('REAL CAPTAIN INVITE — DELIVERABLE');
  console.log('==================================');
  console.log(`Invite ID:         ${created.inviteId}`);
  console.log(`Invite URL:        ${inviteUrl}`);
  console.log(`Expires:           ${created.expiresAt.toISOString()}`);
  console.log(`Team:              ${created.teamName} (teamId=${created.teamId})`);
  console.log(`Role:              ${created.role}`);
  console.log('captainUserId was empty before this run and was NOT written to — no existing captain was overwritten.');
  console.log('No Firebase Auth account was created. No users/{uid} document was created. No player record was created.');
  console.log(`Pre-existing viceCaptainUserId (${created.existingViceCaptainUserId ?? 'null'}) was left untouched.`);
  console.log('');

  console.log(`(Verified live against Firebase project: ${getResolvedProjectId()})`);
}

main().catch((e: unknown) => {
  console.error('\nFAILED:', (e as Error).message ?? e);
  process.exitCode = 1;
});
