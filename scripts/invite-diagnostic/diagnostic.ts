#!/usr/bin/env node
// Entry point. No arguments recognized — this is a fixed, read-only
// report, never parameterized by argv/env beyond the required
// GOOGLE_APPLICATION_CREDENTIALS. Any argument is rejected.
import { EXPECTED_PROJECT_ID } from './src/constants';
import { getResolvedProjectId, initializeInviteDiagnosticApp } from './src/firebaseAdmin';
import {
  buildUserReport, findBurnabyBViceCaptainInvites, findCandidateUserIds, lookUpJoinRequest,
} from './src/diagnostic';

function printBanner(): void {
  console.log('');
  console.log('='.repeat(70));
  console.log(`TARGET FIREBASE PROJECT: ${EXPECTED_PROJECT_ID}`);
  console.log('OPERATION:               READ-ONLY diagnostic — Burnaby Arms B');
  console.log('                         Vice Captain invite + test-account state.');
  console.log('Performs ZERO writes. Never prints a raw token or a tokenHash value.');
  console.log('='.repeat(70));
  console.log('');
}

function main(): void {
  if (process.argv.slice(2).length > 0) {
    throw new Error(`This script accepts no arguments. Got: ${process.argv.slice(2).join(', ')}`);
  }
}

async function run(): Promise<void> {
  main();
  printBanner();
  const { db, auth } = initializeInviteDiagnosticApp();

  console.log('--- INVITE(S): teams/bk-d3-team-2, role=viceCaptain ---');
  const invites = await findBurnabyBViceCaptainInvites(db);
  if (invites.length === 0) {
    console.log('No invite document found for teamId=bk-d3-team-2, role=viceCaptain.');
  } else {
    invites.forEach((inv) => console.log(JSON.stringify(inv, null, 2)));
  }

  console.log('\n--- CANDIDATE TEST ACCOUNT ---');
  const { referenceName, uids } = await findCandidateUserIds(db);
  console.log(`Reference teams/bk-d3-team-2.viceCaptainName: ${referenceName ?? '(none set)'}`);

  const acceptedUids = invites.map((i) => i.acceptedByUserId).filter((x): x is string => !!x);
  const candidateUids = Array.from(new Set([...uids, ...acceptedUids]));

  if (candidateUids.length === 0) {
    console.log('No matching users/{uid} doc found by displayName, and no invite has been accepted.');
  }

  for (const uid of candidateUids) {
    const report = await buildUserReport(db, auth, uid);
    console.log(JSON.stringify(report, null, 2));

    if (report.pendingRequestId) {
      const jr = await lookUpJoinRequest(db, report.pendingRequestId);
      console.log(`joinRequests/${report.pendingRequestId}:`, jr ? JSON.stringify(jr) : '(not found)');
    }
  }

  console.log(`\n(Read-only. Verified live against Firebase project: ${getResolvedProjectId()})`);
}

run().catch((e: unknown) => {
  console.error('\nFAILED:', (e as Error).message ?? e);
  process.exitCode = 1;
});
