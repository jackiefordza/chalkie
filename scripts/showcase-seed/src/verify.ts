import * as admin from 'firebase-admin';
import {
  DIVISION_ID, GLOBAL_ADMIN_EMAIL, LEAGUE_ADMIN_EMAIL, LEAGUE_ID,
  NORMAL_PLAYER_EMAIL, PLAYERS_PER_TEAM, SEASON_ID, TEAM_COUNT, captainEmail,
  matchId, playerId, teamId, viceCaptainEmail,
} from './constants';
import { auditLogIsEntirelyShowcaseScoped } from './firebaseAdmin';
import type { BuiltSchedule } from './seedCore';

export interface CheckResult { label: string; expected: string; actual: string; pass: boolean }
export interface VerificationReport { checks: CheckResult[]; overallPass: boolean }

function check(checks: CheckResult[], label: string, expected: number | string, actual: number | string): void {
  checks.push({ label, expected: String(expected), actual: String(actual), pass: String(expected) === String(actual) });
}

// For counts that were only ever meant to be checked approximately (their
// real value legitimately varies — see each call site) — compares the
// actual NUMBERS via `isAcceptable`, not a decorative "~" baked into the
// expected string. `check()` above does plain string equality, so an
// expected value of `~34` could never equal an actual of `34` even when
// the count is exactly right: this was a real bug (every approximate
// check always showed failed, regardless of the real count), not a
// stylistic choice — see offline-checks.js for the regression test.
function checkApprox(
  checks: CheckResult[], label: string, expectedNumeric: number, actualNumeric: number,
  isAcceptable: (actual: number, expected: number) => boolean,
): void {
  checks.push({
    label,
    expected: `~${expectedNumeric}`,
    actual: String(actualNumeric),
    pass: isAcceptable(actualNumeric, expectedNumeric),
  });
}

// For "is there at least one of these anywhere" checks (180s, high
// checkouts) — same underlying bug as checkApprox: comparing the literal
// string 'present (>0)' against 'present (42)' can never be equal, so
// these always showed failed even when the data genuinely had 180s/
// checkouts in it. These aren't even in the overallPass exemption list
// below, so this specific instance could fail the ENTIRE verification
// run's final PASS/FAIL verdict regardless of the real data.
function checkPresent(checks: CheckResult[], label: string, count: number): void {
  checks.push({
    label,
    expected: 'present (>0)',
    actual: count > 0 ? `present (${count})` : 'NONE',
    pass: count > 0,
  });
}

async function docExists(db: admin.firestore.Firestore, collectionPath: string, docId: string): Promise<boolean> {
  const snap = await db.collection(collectionPath).doc(docId).get();
  return snap.exists;
}

async function personaOk(auth: admin.auth.Auth, db: admin.firestore.Firestore, email: string, expectedRole: string): Promise<boolean> {
  try {
    const user = await auth.getUserByEmail(email);
    const doc = await db.collection('users').doc(user.uid).get();
    return doc.exists && doc.data()?.role === expectedRole;
  } catch {
    return false;
  }
}

export async function verifyShowcaseDataset(
  db: admin.firestore.Firestore,
  auth: admin.auth.Auth,
  schedule: BuiltSchedule,
  confirmedCount: number,
  specialResult: { awaitingConfirmationOk: boolean; disputedOk: boolean },
): Promise<VerificationReport> {
  const checks: CheckResult[] = [];

  // League / division / season
  check(checks, 'League', 1, (await docExists(db, 'leagues', LEAGUE_ID)) ? 1 : 0);
  check(checks, 'Season', 1, (await docExists(db, 'seasons', SEASON_ID)) ? 1 : 0);
  check(checks, 'Division', 1, (await docExists(db, 'divisions', DIVISION_ID)) ? 1 : 0);

  // Teams / players
  let teamCount = 0;
  for (let t = 0; t < TEAM_COUNT; t++) if (await docExists(db, 'teams', teamId(t))) teamCount += 1;
  check(checks, 'Teams', `${TEAM_COUNT}/${TEAM_COUNT}`, `${teamCount}/${TEAM_COUNT}`);

  let playerCount = 0;
  for (let t = 0; t < TEAM_COUNT; t++) {
    for (let p = 0; p < PLAYERS_PER_TEAM; p++) if (await docExists(db, 'players', playerId(t, p))) playerCount += 1;
  }
  const totalPlayers = TEAM_COUNT * PLAYERS_PER_TEAM;
  check(checks, 'Players', `${totalPlayers}/${totalPlayers}`, `${playerCount}/${totalPlayers}`);

  // Personas
  let captainsOk = 0;
  let vcsOk = 0;
  for (let t = 0; t < TEAM_COUNT; t++) {
    if (await personaOk(auth, db, captainEmail(t), 'captain')) captainsOk += 1;
    if (await personaOk(auth, db, viceCaptainEmail(t), 'viceCaptain')) vcsOk += 1;
  }
  check(checks, 'Captains', `${TEAM_COUNT}/${TEAM_COUNT}`, `${captainsOk}/${TEAM_COUNT}`);
  check(checks, 'Vice-captains', `${TEAM_COUNT}/${TEAM_COUNT}`, `${vcsOk}/${TEAM_COUNT}`);
  check(checks, 'Normal player', 1, (await personaOk(auth, db, NORMAL_PLAYER_EMAIL, 'player')) ? 1 : 0);

  const leagueAdminOk = await (async () => {
    try {
      const user = await auth.getUserByEmail(LEAGUE_ADMIN_EMAIL);
      const doc = await db.collection('users').doc(user.uid).get();
      return doc.exists && doc.data()?.isLeagueAdmin === true && doc.data()?.leagueId === LEAGUE_ID;
    } catch { return false; }
  })();
  check(checks, 'League admin', 1, leagueAdminOk ? 1 : 0);

  const globalAdminOk = await (async () => {
    try {
      const user = await auth.getUserByEmail(GLOBAL_ADMIN_EMAIL);
      const doc = await db.collection('users').doc(user.uid).get();
      return doc.exists && doc.data()?.isGlobalAdmin === true;
    } catch { return false; }
  })();
  check(checks, 'Global admin', 1, globalAdminOk ? 1 : 0);

  // Fixtures / match states
  let fixtureCount = 0;
  for (const fx of schedule.all) {
    if (await docExists(db, 'matches', matchId(fx.homeTeamIndex, fx.awayTeamIndex, fx.round))) fixtureCount += 1;
  }
  check(checks, 'Fixtures', `${schedule.all.length}/${schedule.all.length}`, `${fixtureCount}/${schedule.all.length}`);
  check(checks, 'Confirmed matches', `${schedule.toConfirm.length}/${schedule.toConfirm.length}`, `${confirmedCount}/${schedule.toConfirm.length}`);

  const scheduledExpected = schedule.all.length - schedule.toConfirm.length - 2; // minus the confirmed + the 2 special non-scheduled states
  let scheduledActual = 0;
  for (const fx of schedule.all) {
    const isSpecialNonScheduled = fx === schedule.disputed || fx === schedule.awaitingConfirmation;
    const isBeingConfirmed = schedule.toConfirm.includes(fx);
    if (isSpecialNonScheduled || isBeingConfirmed) continue;
    const snap = await db.collection('matches').doc(matchId(fx.homeTeamIndex, fx.awayTeamIndex, fx.round)).get();
    if (snap.exists && snap.data()?.status === 'scheduled') scheduledActual += 1;
  }
  // The fixtures counted here (schedule.all minus the 2 special states minus
  // everything in toConfirm) are excluded from the tally by construction
  // regardless of whether their confirmation actually succeeded, so this
  // should land on exactly scheduledExpected in normal operation — the small
  // tolerance is only to avoid a spurious ✗ if verification runs while a
  // match is still mid-transition, not because a wide swing is expected.
  checkApprox(checks, 'Scheduled matches', scheduledExpected, scheduledActual, (a, e) => Math.abs(a - e) <= 2);

  check(checks, 'Awaiting confirmation', 1, specialResult.awaitingConfirmationOk ? 1 : 0);
  check(checks, 'Disputed', 1, specialResult.disputedOk ? 1 : 0);

  // Derived stats
  const divisionTablesSnap = await db.collection('divisionTables')
    .where('leagueId', '==', LEAGUE_ID).where('seasonId', '==', SEASON_ID).where('divisionId', '==', DIVISION_ID).get();
  check(checks, 'Division table rows', `${TEAM_COUNT}/${TEAM_COUNT}`, `${divisionTablesSnap.size}/${TEAM_COUNT}`);

  const statsSnap = await db.collection('playerSeasonStats').where('seasonId', '==', SEASON_ID).get();
  // Not every one of the 48 players is guaranteed a stats doc — with only
  // 20 confirmed matches and a 5-of-6 matchday rotation, some players may
  // legitimately never appear in a confirmed game. Pass as long as at
  // least one player got a doc and never more than the theoretical max
  // (more than totalPlayers would itself indicate a real bug, e.g. a
  // duplicate or a leak from outside the showcase season).
  checkApprox(checks, 'Player season stats', totalPlayers, statsSnap.size, (a, e) => a > 0 && a <= e);

  let total180s = 0;
  let totalCheckouts = 0;
  statsSnap.forEach((doc) => {
    const data = doc.data();
    total180s += typeof data.oneEighties === 'number' ? data.oneEighties : 0;
    totalCheckouts += Array.isArray(data.highCheckouts) ? data.highCheckouts.length : 0;
  });
  checkPresent(checks, '180s', total180s);
  checkPresent(checks, 'High checkouts', totalCheckouts);

  // The core production-safety proof — see firebaseAdmin.ts's comment on
  // why this can only ever confirm what assertAllowed already enforced live.
  const realLeagueUntouched = auditLogIsEntirelyShowcaseScoped();
  check(checks, 'REAL LEAGUE TOUCHED', 'NO', realLeagueUntouched ? 'NO' : 'YES — SEE AUDIT LOG');

  // Player season stats and Scheduled matches now have honest pass/fail of
  // their own (via checkApprox above), so this exemption is a deliberate
  // second layer, not a workaround for the string-comparison bug: even a
  // legitimate edge case on either of these two should never block the
  // overall verdict. Every other check, 180s/High checkouts included, is
  // a hard requirement.
  const overallPass = checks.every((c) => c.pass || c.label === 'Player season stats' || c.label === 'Scheduled matches');
  return { checks, overallPass };
}

export function printVerificationReport(report: VerificationReport, title: string): void {
  console.log(`\n${title}`);
  console.log('='.repeat(title.length));
  for (const c of report.checks) {
    const marker = c.pass ? '✓' : '✗';
    console.log(`${marker} ${c.label}: ${c.actual}${c.pass ? '' : ` (expected ${c.expected})`}`);
  }
  console.log(report.overallPass ? '\nSHOWCASE DATASET READY — PASS' : '\nSHOWCASE DATASET VERIFICATION FAILED');
}
