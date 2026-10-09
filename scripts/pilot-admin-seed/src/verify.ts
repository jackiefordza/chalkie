import * as admin from 'firebase-admin';
import { ADMIN_EMAIL, LEAGUE_ID } from './constants';
import { auditLogIsEntirelyInScope } from './firebaseAdmin';

export interface CheckResult { label: string; expected: string; actual: string; pass: boolean }
export interface VerificationReport { checks: CheckResult[]; overallPass: boolean }

function check(checks: CheckResult[], label: string, expected: string, actual: string): void {
  checks.push({ label, expected, actual, pass: expected === actual });
}

// The real thing we actually need to prove — that this account is
// recognised as a league admin by exactly the fields the deployed
// firestore.rules / functions' assertLeagueAdmin / mobile's
// matchPermissions.ts actually check:
//   - users/{uid}.isLeagueAdmin === true AND users/{uid}.leagueId === LEAGUE_ID
//     (assertLeagueAdmin's isScopedLeagueAdmin check; matchPermissions.ts's
//     canResetMatch/canSignOffMatch use the identical check client-side)
//   - users/{uid}.isGlobalAdmin === false (this account is deliberately
//     league-scoped only, never global)
//   - leagues/{LEAGUE_ID}.adminUserId === uid (the placeholder onboarding
//     this script exists to perform)
export async function verifyPilotAdmin(
  db: admin.firestore.Firestore, auth: admin.auth.Auth,
): Promise<VerificationReport> {
  const checks: CheckResult[] = [];

  let uid: string | null = null;
  try {
    uid = (await auth.getUserByEmail(ADMIN_EMAIL)).uid;
    check(checks, 'Auth account exists', 'YES', 'YES');
  } catch {
    check(checks, 'Auth account exists', 'YES', 'NO');
  }

  if (uid) {
    const userDoc = await db.collection('users').doc(uid).get();
    const u = userDoc.data();
    check(checks, 'users/{uid} exists', 'YES', userDoc.exists ? 'YES' : 'NO');
    check(checks, 'users/{uid}.isLeagueAdmin', 'true', String(u?.isLeagueAdmin));
    check(checks, 'users/{uid}.leagueId', LEAGUE_ID, String(u?.leagueId));
    check(checks, 'users/{uid}.isGlobalAdmin (must stay scoped, not global)', 'false', String(u?.isGlobalAdmin));

    const leagueDoc = await db.collection('leagues').doc(LEAGUE_ID).get();
    check(checks, `leagues/${LEAGUE_ID}.adminUserId`, uid, String(leagueDoc.data()?.adminUserId));
  }

  const scopedOk = auditLogIsEntirelyInScope();
  check(checks, 'ALL WRITES IN SCOPE (users/{uid} + leagues/{LEAGUE_ID} only)', 'YES', scopedOk ? 'YES' : 'NO — SEE AUDIT LOG');

  const overallPass = checks.every((c) => c.pass);
  return { checks, overallPass };
}

export function printVerificationReport(report: VerificationReport): void {
  const title = 'PILOT ADMIN SEED VERIFICATION';
  console.log(`\n${title}`);
  console.log('='.repeat(title.length));
  for (const c of report.checks) {
    const marker = c.pass ? '✓' : '✗';
    console.log(`${marker} ${c.label}: ${c.actual}${c.pass ? '' : ` (expected ${c.expected})`}`);
  }
  console.log(report.overallPass ? '\nPILOT ADMIN SEED READY — PASS' : '\nPILOT ADMIN SEED VERIFICATION FAILED');
}
