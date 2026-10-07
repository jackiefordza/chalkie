import * as admin from 'firebase-admin';
import {
  REAL_LEAGUE_ID, REAL_PILOT_ADMIN_EMAIL, REAL_TEAM_ID, REAL_VC_EMAIL,
  SMOKE_TEST_ACCOUNT_EMAIL, SMOKE_TEST_INVITE_ID, SMOKE_TEST_TEAM_ID,
} from './constants';
import { auditLogIsEntirelyInScope } from './firebaseAdmin';
import { CleanupResult } from './cleanupCore';

export interface VerificationCheck { label: string; pass: boolean; detail: string }
export interface VerificationReport { checks: VerificationCheck[]; overallPass: boolean }

// Re-reads everything from Firestore/Auth rather than trusting the deletes
// succeeded — same convention as every other script in scripts/. Also
// re-reads three real, untouched anchors (the existing pilot admin, Jake
// Fordham's real VC account, and Burnaby Arms B) purely to prove this run
// left them exactly as they were — never written to.
export async function verifyCleanup(
  db: admin.firestore.Firestore, auth: admin.auth.Auth, result: CleanupResult,
): Promise<VerificationReport> {
  const checks: VerificationCheck[] = [];

  const teamSnap = await db.collection('teams').doc(SMOKE_TEST_TEAM_ID).get();
  checks.push({ label: `teams/${SMOKE_TEST_TEAM_ID} no longer exists`, pass: !teamSnap.exists, detail: teamSnap.exists ? 'STILL EXISTS' : 'gone' });

  const inviteSnap = await db.collection('invites').doc(SMOKE_TEST_INVITE_ID).get();
  checks.push({ label: `invites/${SMOKE_TEST_INVITE_ID} no longer exists`, pass: !inviteSnap.exists, detail: inviteSnap.exists ? 'STILL EXISTS' : 'gone' });

  const userSnap = await db.collection('users').doc(result.deletedUserUid).get();
  checks.push({ label: `users/${result.deletedUserUid} no longer exists`, pass: !userSnap.exists, detail: userSnap.exists ? 'STILL EXISTS' : 'gone' });

  let authStillExists = true;
  try {
    await auth.getUserByEmail(SMOKE_TEST_ACCOUNT_EMAIL);
  } catch (e: unknown) {
    authStillExists = (e as { code?: string }).code !== 'auth/user-not-found';
    if (authStillExists) throw e;
  }
  checks.push({ label: `Auth account ${SMOKE_TEST_ACCOUNT_EMAIL} no longer exists`, pass: !authStillExists, detail: authStillExists ? 'STILL EXISTS' : 'gone' });

  // ── Read-only proof that real accounts/data were left untouched ────────
  try {
    const admin1 = await auth.getUserByEmail(REAL_PILOT_ADMIN_EMAIL);
    const adminDoc = (await db.collection('users').doc(admin1.uid).get()).data();
    checks.push({
      label: `${REAL_PILOT_ADMIN_EMAIL} unchanged`,
      pass: adminDoc?.isLeagueAdmin === true && adminDoc?.leagueId === REAL_LEAGUE_ID,
      detail: `isLeagueAdmin=${adminDoc?.isLeagueAdmin}, leagueId=${adminDoc?.leagueId}`,
    });
  } catch (e: unknown) {
    checks.push({ label: `${REAL_PILOT_ADMIN_EMAIL} unchanged`, pass: false, detail: `lookup failed: ${(e as Error).message}` });
  }

  try {
    const vc = await auth.getUserByEmail(REAL_VC_EMAIL);
    const vcDoc = (await db.collection('users').doc(vc.uid).get()).data();
    checks.push({
      label: `${REAL_VC_EMAIL} unchanged`,
      pass: vcDoc?.teamId === REAL_TEAM_ID && vcDoc?.role === 'viceCaptain' && vcDoc?.leagueId === REAL_LEAGUE_ID,
      detail: `role=${vcDoc?.role}, teamId=${vcDoc?.teamId}, leagueId=${vcDoc?.leagueId}`,
    });
  } catch (e: unknown) {
    checks.push({ label: `${REAL_VC_EMAIL} unchanged`, pass: false, detail: `lookup failed: ${(e as Error).message}` });
  }

  const realTeamSnap = await db.collection('teams').doc(REAL_TEAM_ID).get();
  const rt = realTeamSnap.data();
  checks.push({
    label: `teams/${REAL_TEAM_ID} (Burnaby Arms B) unchanged`,
    pass: realTeamSnap.exists && !!rt?.captainUserId && !!rt?.viceCaptainUserId,
    detail: `name=${rt?.name}, captainUserId set=${!!rt?.captainUserId}, viceCaptainUserId set=${!!rt?.viceCaptainUserId}`,
  });

  checks.push({
    label: 'ALL DELETES IN SCOPE (teams/smoke-test-team + invites/<id> + users/<uid> + 1 Auth account only)',
    pass: auditLogIsEntirelyInScope(),
    detail: '',
  });

  return { checks, overallPass: checks.every((c) => c.pass) };
}

export function printVerificationReport(report: VerificationReport): void {
  console.log('');
  console.log('SMOKE-TEST CLEANUP VERIFICATION');
  console.log('================================');
  for (const c of report.checks) {
    console.log(`${c.pass ? '✓' : '✗'} ${c.label}${c.detail ? `: ${c.detail}` : ''}`);
  }
  console.log('');
  console.log(report.overallPass ? 'SMOKE-TEST CLEANUP — PASS' : 'SMOKE-TEST CLEANUP — FAIL');
  console.log('');
}
