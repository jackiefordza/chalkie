import * as admin from 'firebase-admin';
import {
  ADMIN_EMAIL, DIVISION_3_ID, LEAGUE_ID, PLAYER_ID, SEASON_ID, TEAM_ID, TEAM_NAME,
} from './constants';
import { auditLogIsEntirelyInScope } from './firebaseAdmin';

export interface VerificationCheck { label: string; pass: boolean; detail: string }
export interface VerificationReport { checks: VerificationCheck[]; overallPass: boolean }

// Re-reads everything from Firestore/Auth rather than trusting the write
// succeeded — same convention as every other script in scripts/.
export async function verifyAdminVcLink(
  db: admin.firestore.Firestore, auth: admin.auth.Auth,
): Promise<VerificationReport> {
  const checks: VerificationCheck[] = [];

  let uid: string | null = null;
  try {
    const user = await auth.getUserByEmail(ADMIN_EMAIL);
    uid = user.uid;
    checks.push({ label: 'Auth account exists', pass: true, detail: ADMIN_EMAIL });
  } catch {
    checks.push({ label: 'Auth account exists', pass: false, detail: `${ADMIN_EMAIL} not found` });
  }

  if (uid) {
    const userSnap = await db.collection('users').doc(uid).get();
    const u = userSnap.data();
    checks.push({ label: `users/${uid} exists`, pass: userSnap.exists, detail: userSnap.exists ? 'yes' : 'MISSING' });
    checks.push({ label: 'isLeagueAdmin still true (unchanged)', pass: u?.isLeagueAdmin === true, detail: String(u?.isLeagueAdmin) });
    checks.push({ label: 'isGlobalAdmin still false (unchanged)', pass: u?.isGlobalAdmin === false, detail: String(u?.isGlobalAdmin) });
    checks.push({ label: 'leagueId unchanged', pass: u?.leagueId === LEAGUE_ID, detail: String(u?.leagueId) });
    checks.push({ label: 'role == viceCaptain', pass: u?.role === 'viceCaptain', detail: String(u?.role) });
    checks.push({ label: 'teamId == Burnaby Arms B', pass: u?.teamId === TEAM_ID, detail: String(u?.teamId) });
    checks.push({ label: 'divisionId == Division 3', pass: u?.divisionId === DIVISION_3_ID, detail: String(u?.divisionId) });
    checks.push({ label: 'seasonId correct', pass: u?.seasonId === SEASON_ID, detail: String(u?.seasonId) });
    checks.push({ label: 'playerId linked', pass: u?.playerId === PLAYER_ID, detail: String(u?.playerId) });

    const teamSnap = await db.collection('teams').doc(TEAM_ID).get();
    const t = teamSnap.data();
    checks.push({ label: `teams/${TEAM_ID}.viceCaptainUserId == this account`, pass: t?.viceCaptainUserId === uid, detail: String(t?.viceCaptainUserId) });
    checks.push({ label: `teams/${TEAM_ID}.name == "${TEAM_NAME}" (sanity)`, pass: t?.name === TEAM_NAME, detail: String(t?.name) });

    const playerSnap = await db.collection('players').doc(PLAYER_ID).get();
    const p = playerSnap.data();
    checks.push({ label: `players/${PLAYER_ID} exists and claimed by this account`, pass: playerSnap.exists && p?.claimedByUserId === uid, detail: playerSnap.exists ? String(p?.claimedByUserId) : 'MISSING' });
    checks.push({ label: `players/${PLAYER_ID}.teamId == Burnaby Arms B`, pass: p?.teamId === TEAM_ID, detail: String(p?.teamId) });
  }

  checks.push({ label: 'ALL WRITES IN SCOPE (users/<uid> + teams/<TEAM_ID> + players/<PLAYER_ID> only)', pass: auditLogIsEntirelyInScope(), detail: '' });

  return { checks, overallPass: checks.every((c) => c.pass) };
}

export function printVerificationReport(report: VerificationReport): void {
  console.log('');
  console.log('PILOT ADMIN VC-LINK VERIFICATION');
  console.log('=================================');
  for (const c of report.checks) {
    console.log(`${c.pass ? '✓' : '✗'} ${c.label}${c.detail ? `: ${c.detail}` : ''}`);
  }
  console.log('');
  console.log(report.overallPass ? 'PILOT ADMIN VC-LINK READY — PASS' : 'PILOT ADMIN VC-LINK — FAIL');
  console.log('');
}
