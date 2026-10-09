import * as admin from 'firebase-admin';
import { DIVISION_ID, INVITE_ROLE, LEAGUE_ID, SEASON_ID, TEAM_ID, TEAM_NAME } from './constants';
import { auditLogIsEntirelyInScope } from './firebaseAdmin';

export interface VerificationCheck { label: string; pass: boolean; detail: string }
export interface VerificationReport { checks: VerificationCheck[]; overallPass: boolean }

// Re-reads everything from Firestore rather than trusting the write
// succeeded — same convention as every other script in scripts/. Never
// reads back or prints the raw token (it only ever existed in this run's
// own in-memory return value) and never prints the tokenHash value itself
// — only whether one is present, same discipline scripts/invite-diagnostic
// used.
export async function verifySmokeTestInvite(
  db: admin.firestore.Firestore, inviteId: string, expectedAdminUid: string,
): Promise<VerificationReport> {
  const checks: VerificationCheck[] = [];

  const teamSnap = await db.collection('teams').doc(TEAM_ID).get();
  const t = teamSnap.data();
  checks.push({ label: `teams/${TEAM_ID} exists`, pass: teamSnap.exists, detail: teamSnap.exists ? 'yes' : 'MISSING' });
  checks.push({ label: 'team name matches', pass: t?.name === TEAM_NAME, detail: String(t?.name) });
  checks.push({ label: 'team leagueId/seasonId/divisionId are the isolated smoke-test namespace', pass: t?.leagueId === LEAGUE_ID && t?.seasonId === SEASON_ID && t?.divisionId === DIVISION_ID, detail: `${t?.leagueId}/${t?.seasonId}/${t?.divisionId}` });
  checks.push({ label: 'team captainUserId is still null', pass: t?.captainUserId === null, detail: String(t?.captainUserId) });
  checks.push({ label: 'team viceCaptainUserId is still null', pass: t?.viceCaptainUserId === null, detail: String(t?.viceCaptainUserId) });

  const inviteSnap = await db.collection('invites').doc(inviteId).get();
  const i = inviteSnap.data();
  checks.push({ label: `invites/${inviteId} exists`, pass: inviteSnap.exists, detail: inviteSnap.exists ? 'yes' : 'MISSING' });
  checks.push({ label: 'invite status == pending', pass: i?.status === 'pending', detail: String(i?.status) });
  checks.push({ label: 'invite role matches', pass: i?.role === INVITE_ROLE, detail: String(i?.role) });
  checks.push({ label: 'invite teamId matches', pass: i?.teamId === TEAM_ID, detail: String(i?.teamId) });
  checks.push({ label: 'invite leagueId/seasonId/divisionId match the isolated namespace', pass: i?.leagueId === LEAGUE_ID && i?.seasonId === SEASON_ID && i?.divisionId === DIVISION_ID, detail: `${i?.leagueId}/${i?.seasonId}/${i?.divisionId}` });
  checks.push({ label: 'invite has a tokenHash (value itself never printed)', pass: typeof i?.tokenHash === 'string' && i.tokenHash.length > 0, detail: typeof i?.tokenHash === 'string' ? '(present, sha256 hex — not shown)' : 'MISSING' });
  checks.push({ label: 'invite createdByUserId == the existing pilot.admin account', pass: i?.createdByUserId === expectedAdminUid, detail: i?.createdByUserId === expectedAdminUid ? 'matches' : String(i?.createdByUserId) });
  checks.push({ label: 'invite acceptedAt/acceptedByUserId still null (not yet accepted)', pass: i?.acceptedAt === null && i?.acceptedByUserId === null, detail: `${i?.acceptedAt}/${i?.acceptedByUserId}` });

  checks.push({ label: `ALL WRITES IN SCOPE (teams/${TEAM_ID} + invites/${inviteId} only)`, pass: auditLogIsEntirelyInScope(), detail: '' });

  return { checks, overallPass: checks.every((c) => c.pass) };
}

export function printVerificationReport(report: VerificationReport): void {
  console.log('');
  console.log('SMOKE-TEST INVITE VERIFICATION');
  console.log('===============================');
  for (const c of report.checks) {
    console.log(`${c.pass ? '✓' : '✗'} ${c.label}${c.detail ? `: ${c.detail}` : ''}`);
  }
  console.log('');
  console.log(report.overallPass ? 'SMOKE-TEST INVITE READY — PASS' : 'SMOKE-TEST INVITE — FAIL');
  console.log('');
}
