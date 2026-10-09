import * as admin from 'firebase-admin';
import { DIVISION_2_ID, INVITE_ROLE, LEAGUE_ID, SEASON_ID, TEAM_ID, TEAM_NAME } from './constants';
import { auditLogIsEntirelyInScope } from './firebaseAdmin';
import { CreatedInvite } from './inviteCore';

export interface VerificationCheck { label: string; pass: boolean; detail: string }
export interface VerificationReport { checks: VerificationCheck[]; overallPass: boolean }

// Re-reads everything from Firestore rather than trusting the write
// succeeded — same convention as every other script in scripts/. Never
// reads back or prints the raw token, and never prints the tokenHash
// value itself — only whether one is present.
export async function verifyRealCaptainInvite(
  db: admin.firestore.Firestore, created: CreatedInvite,
): Promise<VerificationReport> {
  const checks: VerificationCheck[] = [];

  const inviteSnap = await db.collection('invites').doc(created.inviteId).get();
  const i = inviteSnap.data();
  checks.push({ label: `invites/${created.inviteId} exists`, pass: inviteSnap.exists, detail: inviteSnap.exists ? 'yes' : 'MISSING' });
  checks.push({ label: 'status == pending', pass: i?.status === 'pending', detail: String(i?.status) });
  checks.push({ label: 'role == captain', pass: i?.role === INVITE_ROLE, detail: String(i?.role) });
  checks.push({ label: `teamId == ${TEAM_ID}`, pass: i?.teamId === TEAM_ID, detail: String(i?.teamId) });
  checks.push({ label: 'leagueId/seasonId/divisionId match real Burnaby Arms C identity', pass: i?.leagueId === LEAGUE_ID && i?.seasonId === SEASON_ID && i?.divisionId === DIVISION_2_ID, detail: `${i?.leagueId}/${i?.seasonId}/${i?.divisionId}` });
  checks.push({ label: 'has a tokenHash (value itself never printed)', pass: typeof i?.tokenHash === 'string' && i.tokenHash.length > 0, detail: typeof i?.tokenHash === 'string' ? '(present, sha256 hex — not shown)' : 'MISSING' });
  checks.push({ label: 'createdByUserId == the existing pilot.admin account', pass: i?.createdByUserId === created.adminUid, detail: i?.createdByUserId === created.adminUid ? 'matches' : String(i?.createdByUserId) });
  checks.push({ label: 'acceptedAt/acceptedByUserId still null (not yet accepted)', pass: i?.acceptedAt === null && i?.acceptedByUserId === null, detail: `${i?.acceptedAt}/${i?.acceptedByUserId}` });

  const teamSnap = await db.collection('teams').doc(TEAM_ID).get();
  const t = teamSnap.data();
  checks.push({ label: `teams/${TEAM_ID} name still "${TEAM_NAME}" (sanity)`, pass: t?.name === TEAM_NAME, detail: String(t?.name) });
  checks.push({ label: 'captainUserId still empty/null (no overwrite happened)', pass: !t?.captainUserId, detail: String(t?.captainUserId) });
  checks.push({ label: 'viceCaptainUserId unchanged by this run', pass: (t?.viceCaptainUserId ?? null) === created.existingViceCaptainUserId, detail: `before=${created.existingViceCaptainUserId}, now=${t?.viceCaptainUserId ?? null}` });

  checks.push({ label: `ALL WRITES IN SCOPE (invites/${created.inviteId} only — zero team/user/player writes)`, pass: auditLogIsEntirelyInScope(), detail: '' });

  return { checks, overallPass: checks.every((c) => c.pass) };
}

export function printVerificationReport(report: VerificationReport): void {
  console.log('');
  console.log('REAL CAPTAIN INVITE VERIFICATION (Burnaby Arms C)');
  console.log('===================================================');
  for (const c of report.checks) {
    console.log(`${c.pass ? '✓' : '✗'} ${c.label}${c.detail ? `: ${c.detail}` : ''}`);
  }
  console.log('');
  console.log(report.overallPass ? 'REAL CAPTAIN INVITE — PASS' : 'REAL CAPTAIN INVITE — FAIL');
  console.log('');
}
