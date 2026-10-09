import * as admin from 'firebase-admin';
import * as crypto from 'node:crypto';
import {
  ADMIN_EMAIL, DIVISION_2_ID, INVITE_EXPIRY_MS, INVITE_ROLE, LEAGUE_ID, SEASON_ID, TEAM_ID, TEAM_NAME,
} from './constants';
import { safeSet, registerCreatedInviteId } from './firebaseAdmin';

const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

function hashInviteToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export class PreflightFailure extends Error {}

export interface PreflightResult {
  adminUid: string;
  existingViceCaptainUserId: string | null;
}

// Every check is read-only. Throws PreflightFailure (never proceeds to
// write anything) the instant any single check fails — mirrors the user's
// own numbered checklist exactly, in order.
export async function runPreflightChecks(
  db: admin.firestore.Firestore, auth: admin.auth.Auth, log: (msg: string) => void,
): Promise<PreflightResult> {
  log(`Looking up existing admin account "${ADMIN_EMAIL}" (read-only, for createdByUserId attribution + league-admin scope)…`);
  let adminUid: string;
  try {
    adminUid = (await auth.getUserByEmail(ADMIN_EMAIL)).uid;
  } catch (e: unknown) {
    if ((e as { code?: string }).code === 'auth/user-not-found') {
      throw new PreflightFailure(`No existing Auth user for "${ADMIN_EMAIL}". Run scripts/pilot-admin-seed first.`);
    }
    throw e;
  }
  const adminDoc = (await db.collection('users').doc(adminUid).get()).data();
  if (!(adminDoc?.isLeagueAdmin === true && adminDoc?.leagueId === LEAGUE_ID) && adminDoc?.isGlobalAdmin !== true) {
    throw new PreflightFailure(
      `${ADMIN_EMAIL} (uid ${adminUid}) is not a league admin scoped to "${LEAGUE_ID}" (and not a global admin). `
      + `Found: isLeagueAdmin=${adminDoc?.isLeagueAdmin}, leagueId=${adminDoc?.leagueId}, isGlobalAdmin=${adminDoc?.isGlobalAdmin}.`,
    );
  }

  log(`Check 1/7: teams/${TEAM_ID} exists…`);
  const teamSnap = await db.collection('teams').doc(TEAM_ID).get();
  if (!teamSnap.exists) {
    throw new PreflightFailure(`teams/${TEAM_ID} does not exist.`);
  }
  const team = teamSnap.data()!;

  log(`Check 2/7: name is "${TEAM_NAME}"…`);
  if (team.name !== TEAM_NAME) {
    throw new PreflightFailure(`teams/${TEAM_ID}.name is "${team.name}", expected "${TEAM_NAME}".`);
  }

  log(`Check 3/7: leagueId is "${LEAGUE_ID}"…`);
  if (team.leagueId !== LEAGUE_ID) {
    throw new PreflightFailure(`teams/${TEAM_ID}.leagueId is "${team.leagueId}", expected "${LEAGUE_ID}".`);
  }

  log('Check 4/7: belongs to Division 2…');
  if (team.divisionId !== DIVISION_2_ID || team.seasonId !== SEASON_ID) {
    throw new PreflightFailure(
      `teams/${TEAM_ID} divisionId/seasonId is "${team.divisionId}"/"${team.seasonId}", `
      + `expected "${DIVISION_2_ID}"/"${SEASON_ID}".`,
    );
  }

  log('Check 5/7: captainUserId is currently empty/null…');
  if (team.captainUserId) {
    throw new PreflightFailure(
      `teams/${TEAM_ID}.captainUserId is already set to "${team.captainUserId}" — refusing to create a Captain `
      + 'invite for a slot that is not empty. This would not overwrite it immediately (acceptance is what '
      + 'reassigns the slot), but creating the invite at all implies the slot is open, which it is not.',
    );
  }

  log(`Check 6/7: noting (not changing) current viceCaptainUserId = ${team.viceCaptainUserId ?? null}…`);
  const existingViceCaptainUserId = (team.viceCaptainUserId as string | null | undefined) ?? null;

  log('Check 7/7: no existing pending Captain invite for this team…');
  const existingPending = await db.collection('invites')
    .where('teamId', '==', TEAM_ID)
    .where('role', '==', INVITE_ROLE)
    .where('status', '==', 'pending')
    .get();
  if (!existingPending.empty) {
    throw new PreflightFailure(
      `${existingPending.size} existing pending Captain invite(s) already found for teams/${TEAM_ID}: `
      + `${existingPending.docs.map((d) => d.id).join(', ')}. Refusing to create a duplicate — decide whether `
      + 'to reuse or revoke the existing one first.',
    );
  }

  log('All 7 pre-flight checks passed.');
  return { adminUid, existingViceCaptainUserId };
}

export interface CreatedInvite {
  inviteId: string;
  token: string;
  role: string;
  teamId: string;
  teamName: string;
  expiresAt: Date;
  adminUid: string;
  existingViceCaptainUserId: string | null;
}

export async function createRealCaptainInvite(
  db: admin.firestore.Firestore, auth: admin.auth.Auth, log: (msg: string) => void,
): Promise<CreatedInvite> {
  const { adminUid, existingViceCaptainUserId } = await runPreflightChecks(db, auth, log);

  // Identical generation to functions/src/index.ts's performCreateTeamInvite:
  // a CSPRNG token, never client-supplied/predictable, only its sha256 hash
  // ever persisted.
  const token = crypto.randomBytes(24).toString('base64url');
  const inviteRef = db.collection('invites').doc();
  registerCreatedInviteId(inviteRef.id);
  const expiresAtMs = Date.now() + INVITE_EXPIRY_MS;

  log(`Creating the one Captain invite invites/${inviteRef.id} for teams/${TEAM_ID}…`);
  await safeSet(db, 'invites', inviteRef.id, {
    leagueId: LEAGUE_ID,
    seasonId: SEASON_ID,
    divisionId: DIVISION_2_ID,
    teamId: TEAM_ID,
    role: INVITE_ROLE,
    tokenHash: hashInviteToken(token),
    status: 'pending',
    createdByUserId: adminUid,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(expiresAtMs),
    acceptedAt: null,
    acceptedByUserId: null,
  }, { merge: false });

  return {
    inviteId: inviteRef.id,
    token,
    role: INVITE_ROLE,
    teamId: TEAM_ID,
    teamName: TEAM_NAME,
    expiresAt: new Date(expiresAtMs),
    adminUid,
    existingViceCaptainUserId,
  };
}
