import * as admin from 'firebase-admin';
import * as crypto from 'node:crypto';
import {
  ADMIN_EMAIL, DIVISION_ID, INVITE_EXPIRY_MS, INVITE_ROLE, LEAGUE_ID, SEASON_ID, TEAM_ID, TEAM_NAME,
} from './constants';
import { safeSet, registerCreatedInviteId } from './firebaseAdmin';

const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

// Same hash — functions/src/index.ts's hashInviteToken is sha256(token),
// hex-encoded. Mirrored here, not imported, since this script intentionally
// has zero dependency on functions/ (consistent with every other
// scripts/* tool in this repo).
function hashInviteToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Finds the EXISTING admin account by email. Never calls auth.createUser —
// this script only reads this account, to attribute createdByUserId on the
// invite it creates (the same field every real invite has). If
// pilot-admin-seed hasn't been run, this fails loudly rather than
// fabricating a uid.
async function findExistingAdmin(auth: admin.auth.Auth): Promise<string> {
  try {
    const existing = await auth.getUserByEmail(ADMIN_EMAIL);
    return existing.uid;
  } catch (e: unknown) {
    if ((e as { code?: string }).code === 'auth/user-not-found') {
      throw new Error(
        `REFUSING TO RUN: no existing Auth user for "${ADMIN_EMAIL}". This script attributes the invite's `
        + 'createdByUserId to an existing admin account — it never creates one. Run scripts/pilot-admin-seed first.',
      );
    }
    throw e;
  }
}

async function ensureSmokeTestTeam(db: admin.firestore.Firestore, log: (msg: string) => void): Promise<boolean> {
  const teamRef = db.collection('teams').doc(TEAM_ID);
  const teamSnap = await teamRef.get();

  if (!teamSnap.exists) {
    log(`Creating throwaway team teams/${TEAM_ID} (${TEAM_NAME})…`);
    await safeSet(db, 'teams', TEAM_ID, {
      name: TEAM_NAME,
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
      divisionId: DIVISION_ID,
      captainUserId: null,
      viceCaptainUserId: null,
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: false });
    return true;
  }

  const t = teamSnap.data()!;
  if (t.name !== TEAM_NAME || t.leagueId !== LEAGUE_ID || t.seasonId !== SEASON_ID || t.divisionId !== DIVISION_ID) {
    throw new Error(
      `REFUSING TO RUN: teams/${TEAM_ID} already exists but does not match this script's expected identity. `
      + `Found: ${JSON.stringify({ name: t.name, leagueId: t.leagueId, seasonId: t.seasonId, divisionId: t.divisionId })}. `
      + 'This should be impossible for a fresh namespace — stop and investigate before proceeding.',
    );
  }
  if (t.captainUserId || t.viceCaptainUserId) {
    throw new Error(
      `REFUSING TO RUN: teams/${TEAM_ID}.captainUserId/viceCaptainUserId is already set `
      + `(captainUserId=${String(t.captainUserId)}, viceCaptainUserId=${String(t.viceCaptainUserId)}). `
      + 'This throwaway team must have both slots empty — refusing to create another invite on top of an occupied slot.',
    );
  }
  log(`teams/${TEAM_ID} already exists and matches expected identity, both slots empty — leaving it untouched.`);
  return false;
}

export interface CreatedInvite {
  inviteId: string;
  token: string;
  role: string;
  teamId: string;
  teamName: string;
  teamCreated: boolean;
  adminUid: string;
}

export async function createSmokeTestInvite(
  db: admin.firestore.Firestore, auth: admin.auth.Auth, log: (msg: string) => void,
): Promise<CreatedInvite> {
  log(`Looking up existing admin account "${ADMIN_EMAIL}" (read-only, for createdByUserId attribution only)…`);
  const adminUid = await findExistingAdmin(auth);

  const teamCreated = await ensureSmokeTestTeam(db, log);

  // Identical generation to functions/src/index.ts's performCreateTeamInvite:
  // a CSPRNG token, never client-supplied/predictable, only its sha256 hash
  // ever persisted.
  const token = crypto.randomBytes(24).toString('base64url');
  const inviteRef = db.collection('invites').doc();
  registerCreatedInviteId(inviteRef.id);

  log(`Creating pending invite invites/${inviteRef.id} (team=${TEAM_ID}, role=${INVITE_ROLE})…`);
  await safeSet(db, 'invites', inviteRef.id, {
    leagueId: LEAGUE_ID,
    seasonId: SEASON_ID,
    divisionId: DIVISION_ID,
    teamId: TEAM_ID,
    role: INVITE_ROLE,
    tokenHash: hashInviteToken(token),
    status: 'pending',
    createdByUserId: adminUid,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + INVITE_EXPIRY_MS),
    acceptedAt: null,
    acceptedByUserId: null,
  }, { merge: false });

  return {
    inviteId: inviteRef.id,
    token,
    role: INVITE_ROLE,
    teamId: TEAM_ID,
    teamName: TEAM_NAME,
    teamCreated,
    adminUid,
  };
}
