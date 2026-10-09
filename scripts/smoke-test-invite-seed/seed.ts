#!/usr/bin/env node
// Entry point. This script NEVER accepts a team ID, project ID, recipient
// email, or any other target identifier from argv or the environment — the
// only input it recognizes is the flag below. Any other argument causes it
// to refuse to run. Creates exactly one brand-new, wholly isolated
// throwaway team and one pending Captain Invite on it, for a one-off
// manual smoke test of the Captain Invite registration flow on staging.
// Never creates or modifies any Firebase Auth account, never touches any
// real league/season/division/team/captain/VC data, never deploys
// anything.
import { EXPECTED_PROJECT_ID, STAGING_PREVIEW_BASE_URL, TEAM_ID, TEAM_NAME } from './src/constants';
import { getResolvedProjectId, initializeSmokeTestInviteSeedApp } from './src/firebaseAdmin';
import { createSmokeTestInvite } from './src/inviteCore';
import { printVerificationReport, verifySmokeTestInvite } from './src/verify';

const RECOGNIZED_FLAGS = new Set(['--confirm-smoke-test-invite']);

function parseArgs(argv: string[]): { confirm: boolean } {
  const unrecognized = argv.filter((a) => !RECOGNIZED_FLAGS.has(a));
  if (unrecognized.length > 0) {
    throw new Error(
      `Unrecognized argument(s): ${unrecognized.join(', ')}. This script accepts ONLY `
      + '--confirm-smoke-test-invite — it never accepts a team ID, project ID, recipient email, or any other '
      + 'target identifier as an argument. Refusing to run.',
    );
  }
  return { confirm: argv.includes('--confirm-smoke-test-invite') };
}

function printBanner(): void {
  console.log('');
  console.log('='.repeat(60));
  console.log(`TARGET FIREBASE PROJECT: ${EXPECTED_PROJECT_ID}`);
  console.log(`TARGET TEAM:             ${TEAM_ID} (${TEAM_NAME}) — brand-new, isolated, created if missing`);
  console.log('OPERATION:               CREATE one pending Captain Invite (no Auth account created)');
  console.log('='.repeat(60));
  console.log('');
}

async function main(): Promise<void> {
  const { confirm } = parseArgs(process.argv.slice(2));
  if (!confirm) {
    throw new Error(
      'Refusing to run without --confirm-smoke-test-invite. This flag exists so this script can never run '
      + 'by accident. Pass it explicitly when you really mean to create the throwaway smoke-test invite.',
    );
  }

  printBanner();

  const { db, auth } = initializeSmokeTestInviteSeedApp();
  const log = (msg: string) => console.log(msg);

  const created = await createSmokeTestInvite(db, auth, log);

  log('Verifying…');
  const report = await verifySmokeTestInvite(db, created.inviteId, created.adminUid);
  printVerificationReport(report);
  if (!report.overallPass) process.exitCode = 1;

  const inviteUrl = `${STAGING_PREVIEW_BASE_URL}/invite/${created.inviteId}?t=${encodeURIComponent(created.token)}`;

  console.log('SMOKE-TEST INVITE — DELIVERABLE');
  console.log('================================');
  console.log(`Invite URL (open signed-out):  ${inviteUrl}`);
  console.log(`Team:                           ${created.teamName} (teamId=${created.teamId})`);
  console.log(`Role:                           ${created.role}`);
  console.log(`Team doc was newly created:     ${created.teamCreated}`);
  console.log(`invites/${created.inviteId} was newly created in chalkie-app-staging.`);
  console.log('No Firebase Auth account was created, looked up, or reserved for any recipient — the invite');
  console.log('is not bound to any email; any not-yet-registered email may be used during manual registration.');
  console.log('');

  console.log(`(Verified live against Firebase project: ${getResolvedProjectId()})`);
}

main().catch((e: unknown) => {
  console.error('\nFAILED:', (e as Error).message ?? e);
  process.exitCode = 1;
});
