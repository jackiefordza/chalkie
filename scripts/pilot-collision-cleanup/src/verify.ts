import * as admin from 'firebase-admin';
import {
  ADMIN_EMAIL, BURNABY_B_ADMIN_PLAYER_ID, BURNABY_B_TEAM_ID, BURNABY_C_CAPTAIN_EMAIL,
  BURNABY_C_TEAM_ID, OAKLEY_CAPTAIN_EMAIL, OAKLEY_TEAM_ID,
} from './constants';
import { auditLogIsEntirelyInScope } from './firebaseAdmin';

export interface VerificationCheck { label: string; pass: boolean; detail: string }
export interface VerificationReport { checks: VerificationCheck[]; overallPass: boolean }

async function uidFor(auth: admin.auth.Auth, email: string): Promise<string | null> {
  try {
    return (await auth.getUserByEmail(email)).uid;
  } catch {
    return null;
  }
}

export async function verifyCleanup(
  db: admin.firestore.Firestore, auth: admin.auth.Auth,
): Promise<VerificationReport> {
  const checks: VerificationCheck[] = [];

  const oakleyUid = await uidFor(auth, OAKLEY_CAPTAIN_EMAIL);
  const burnabyCUid = await uidFor(auth, BURNABY_C_CAPTAIN_EMAIL);
  const adminUid = await uidFor(auth, ADMIN_EMAIL);

  if (oakleyUid) {
    const u = (await db.collection('users').doc(oakleyUid).get()).data();
    const t = (await db.collection('teams').doc(OAKLEY_TEAM_ID).get()).data();
    checks.push({ label: 'Oakley pilot captain: users.role == pending', pass: u?.role === 'pending', detail: String(u?.role) });
    checks.push({ label: 'Oakley pilot captain: users.teamId == null', pass: u?.teamId === null, detail: String(u?.teamId) });
    checks.push({ label: `teams/${OAKLEY_TEAM_ID}.captainUserId == null`, pass: t?.captainUserId === null, detail: String(t?.captainUserId) });
  }

  if (burnabyCUid) {
    const u = (await db.collection('users').doc(burnabyCUid).get()).data();
    const t = (await db.collection('teams').doc(BURNABY_C_TEAM_ID).get()).data();
    checks.push({ label: 'Burnaby Arms C pilot captain: users.role == pending', pass: u?.role === 'pending', detail: String(u?.role) });
    checks.push({ label: 'Burnaby Arms C pilot captain: users.teamId == null', pass: u?.teamId === null, detail: String(u?.teamId) });
    checks.push({ label: `teams/${BURNABY_C_TEAM_ID}.captainUserId == null`, pass: t?.captainUserId === null, detail: String(t?.captainUserId) });
  }

  if (adminUid) {
    const u = (await db.collection('users').doc(adminUid).get()).data();
    const t = (await db.collection('teams').doc(BURNABY_B_TEAM_ID).get()).data();
    const p = await db.collection('players').doc(BURNABY_B_ADMIN_PLAYER_ID).get();
    checks.push({ label: 'Admin: isLeagueAdmin still true (unchanged)', pass: u?.isLeagueAdmin === true, detail: String(u?.isLeagueAdmin) });
    checks.push({ label: 'Admin: leagueId unchanged', pass: u?.leagueId === 'bedford-kempston-district', detail: String(u?.leagueId) });
    checks.push({ label: 'Admin: users.role == pending (VC retired)', pass: u?.role === 'pending', detail: String(u?.role) });
    checks.push({ label: 'Admin: users.teamId == null', pass: u?.teamId === null, detail: String(u?.teamId) });
    checks.push({ label: `teams/${BURNABY_B_TEAM_ID}.viceCaptainUserId == null`, pass: t?.viceCaptainUserId === null, detail: String(t?.viceCaptainUserId) });
    checks.push({ label: `players/${BURNABY_B_ADMIN_PLAYER_ID} deleted`, pass: !p.exists, detail: p.exists ? 'STILL EXISTS' : 'gone' });
  }

  checks.push({ label: 'ALL WRITES IN SCOPE (3 users + 3 teams + 1 player delete only)', pass: auditLogIsEntirelyInScope(), detail: '' });

  return { checks, overallPass: checks.every((c) => c.pass) };
}

export function printVerificationReport(report: VerificationReport): void {
  console.log('');
  console.log('PILOT COLLISION CLEANUP VERIFICATION');
  console.log('=====================================');
  for (const c of report.checks) {
    console.log(`${c.pass ? '✓' : '✗'} ${c.label}${c.detail ? `: ${c.detail}` : ''}`);
  }
  console.log('');
  console.log(report.overallPass ? 'PILOT COLLISION CLEANUP — PASS' : 'PILOT COLLISION CLEANUP — FAIL');
  console.log('');
}
