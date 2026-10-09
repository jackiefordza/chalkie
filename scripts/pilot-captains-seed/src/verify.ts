import * as admin from 'firebase-admin';
import {
  CAPTAIN_ROSTER_INDEX, PILOT_MATCH_ID, PILOT_TEAMS, PLAYERS_PER_TEAM, PilotTeam, playerId,
} from './constants';
import { auditLogIsEntirelyPilotScoped } from './firebaseAdmin';

export interface CheckResult { label: string; expected: string; actual: string; pass: boolean }
export interface VerificationReport { checks: CheckResult[]; overallPass: boolean }

function check(checks: CheckResult[], label: string, expected: string, actual: string): void {
  checks.push({ label, expected, actual, pass: expected === actual });
}

async function docExists(db: admin.firestore.Firestore, collectionPath: string, docId: string): Promise<boolean> {
  const snap = await db.collection(collectionPath).doc(docId).get();
  return snap.exists;
}

// The real thing we actually need to prove — that this account is
// recognised as this team's captain by exactly the fields the deployed
// firestore.rules / results-entry.tsx submission flow checks:
//   - users/{uid}.role === 'captain' AND users/{uid}.teamId === team.teamId
//     (this is what gates match-sheet submission — firestore.rules'
//     submissions allow create/update: me().teamId == submittedByTeamId)
//   - teams/{teamId}.captainUserId === uid (what the rest of the app's UI,
//     e.g. captains.tsx/admin screens, uses to display/identify "who is
//     the captain")
//   - players/{captainPlayerId}.claimedByUserId === uid (the "a captain is
//     always also a player" invariant every other screen assumes)
async function teamCaptainRecognised(
  auth: admin.auth.Auth, db: admin.firestore.Firestore, team: PilotTeam,
): Promise<{ ok: boolean; detail: string }> {
  let uid: string;
  try {
    uid = (await auth.getUserByEmail(team.captainEmail)).uid;
  } catch {
    return { ok: false, detail: 'no Auth account found for this email' };
  }

  const userDoc = await db.collection('users').doc(uid).get();
  if (!userDoc.exists) return { ok: false, detail: `users/${uid} does not exist` };
  const u = userDoc.data()!;
  if (u.role !== 'captain') return { ok: false, detail: `users/${uid}.role is "${u.role}", not "captain"` };
  if (u.teamId !== team.teamId) {
    return { ok: false, detail: `users/${uid}.teamId is "${u.teamId}", not "${team.teamId}"` };
  }

  const teamDoc = await db.collection('teams').doc(team.teamId).get();
  if (!teamDoc.exists) return { ok: false, detail: `teams/${team.teamId} does not exist` };
  if (teamDoc.data()?.captainUserId !== uid) {
    return { ok: false, detail: `teams/${team.teamId}.captainUserId is "${teamDoc.data()?.captainUserId}", not "${uid}"` };
  }

  const pid = playerId(team, CAPTAIN_ROSTER_INDEX);
  const playerDoc = await db.collection('players').doc(pid).get();
  if (!playerDoc.exists) return { ok: false, detail: `players/${pid} does not exist` };
  if (playerDoc.data()?.claimedByUserId !== uid) {
    return { ok: false, detail: `players/${pid}.claimedByUserId is "${playerDoc.data()?.claimedByUserId}", not "${uid}"` };
  }

  return { ok: true, detail: `uid=${uid}` };
}

export async function verifyPilotDataset(
  db: admin.firestore.Firestore, auth: admin.auth.Auth,
): Promise<VerificationReport> {
  const checks: CheckResult[] = [];

  for (const team of PILOT_TEAMS) {
    let playerCount = 0;
    for (let i = 1; i <= PLAYERS_PER_TEAM; i++) {
      if (await docExists(db, 'players', playerId(team, i))) playerCount += 1;
    }
    check(checks, `${team.teamName} — players`, `${PLAYERS_PER_TEAM}/${PLAYERS_PER_TEAM}`, `${playerCount}/${PLAYERS_PER_TEAM}`);

    const recognised = await teamCaptainRecognised(auth, db, team);
    check(checks, `${team.teamName} — captain recognised`, 'YES', recognised.ok ? 'YES' : `NO (${recognised.detail})`);
  }

  const matchExists = await docExists(db, 'matches', PILOT_MATCH_ID);
  check(checks, `Pilot fixture ${PILOT_MATCH_ID} exists`, 'YES', matchExists ? 'YES' : 'NO — run scripts/real-season-import-staging first');

  const scopedOk = auditLogIsEntirelyPilotScoped();
  check(checks, 'ALL WRITES PILOT-SCOPED ONLY', 'YES', scopedOk ? 'YES' : 'NO — SEE AUDIT LOG');

  const overallPass = checks.every((c) => c.pass);
  return { checks, overallPass };
}

export function printVerificationReport(report: VerificationReport): void {
  const title = 'PILOT CAPTAINS SEED VERIFICATION';
  console.log(`\n${title}`);
  console.log('='.repeat(title.length));
  for (const c of report.checks) {
    const marker = c.pass ? '✓' : '✗';
    console.log(`${marker} ${c.label}: ${c.actual}${c.pass ? '' : ` (expected ${c.expected})`}`);
  }
  console.log(report.overallPass ? '\nPILOT CAPTAINS SEED READY — PASS' : '\nPILOT CAPTAINS SEED VERIFICATION FAILED');
}
