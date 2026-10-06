import * as admin from 'firebase-admin';
import {
  ADMIN_EMAIL, DIVISION_3_ID, LEAGUE_ID, PLAYER_ID, SEASON_ID, TEAM_ID, TEAM_NAME,
} from './constants';
import { safeSet, registerLinkedAdminUserId } from './firebaseAdmin';

const FieldValue = admin.firestore.FieldValue;

// Finds the EXISTING admin account by email. Never calls auth.createUser —
// per explicit instruction, this script must never create another Auth
// account. If pilot-admin-seed hasn't been run yet, this fails loudly
// rather than silently creating one.
async function findExistingAdmin(auth: admin.auth.Auth): Promise<string> {
  let uid: string;
  try {
    const existing = await auth.getUserByEmail(ADMIN_EMAIL);
    uid = existing.uid;
  } catch (e: unknown) {
    if ((e as { code?: string }).code === 'auth/user-not-found') {
      throw new Error(
        `REFUSING TO RUN: no existing Auth user for "${ADMIN_EMAIL}". This script links an EXISTING admin `
        + 'account to a team/player — it never creates one. Run scripts/pilot-admin-seed first.',
      );
    }
    throw e;
  }
  registerLinkedAdminUserId(uid);
  return uid;
}

export async function linkAdminAsViceCaptain(
  db: admin.firestore.Firestore, auth: admin.auth.Auth, log: (msg: string) => void,
): Promise<string> {
  log(`Looking up existing admin account "${ADMIN_EMAIL}"…`);
  const uid = await findExistingAdmin(auth);

  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) {
    throw new Error(`REFUSING TO RUN: users/${uid} does not exist, even though the Auth account does.`);
  }
  const userData = userSnap.data()!;
  if (userData.isLeagueAdmin !== true) {
    throw new Error(
      `REFUSING TO RUN: users/${uid}.isLeagueAdmin is not true. This script only links an EXISTING `
      + 'league admin — it never grants admin status itself (see scripts/pilot-admin-seed for that).',
    );
  }
  if (userData.leagueId !== LEAGUE_ID) {
    throw new Error(
      `REFUSING TO RUN: users/${uid}.leagueId is "${userData.leagueId}", not the expected "${LEAGUE_ID}".`,
    );
  }

  log(`Reading teams/${TEAM_ID} (${TEAM_NAME})…`);
  const teamSnap = await db.collection('teams').doc(TEAM_ID).get();
  if (!teamSnap.exists) {
    throw new Error(`REFUSING TO RUN: teams/${TEAM_ID} does not exist — run scripts/real-season-import-staging first.`);
  }
  const teamData = teamSnap.data()!;
  if (teamData.name !== TEAM_NAME || teamData.leagueId !== LEAGUE_ID
    || teamData.seasonId !== SEASON_ID || teamData.divisionId !== DIVISION_3_ID) {
    throw new Error(
      `REFUSING TO RUN: teams/${TEAM_ID} does not match the expected identity (name="${TEAM_NAME}", `
      + `league/season/division as in src/constants.ts). Found: ${JSON.stringify({
        name: teamData.name, leagueId: teamData.leagueId, seasonId: teamData.seasonId, divisionId: teamData.divisionId,
      })}.`,
    );
  }
  if (teamData.viceCaptainUserId && teamData.viceCaptainUserId !== uid) {
    throw new Error(
      `REFUSING TO RUN: teams/${TEAM_ID}.viceCaptainUserId is already set to a different account `
      + `("${teamData.viceCaptainUserId}"). This script never reassigns an existing VC — clear it first `
      + '(deliberately, via the admin app or Firebase Console) if you really mean to replace them.',
    );
  }

  log(`Ensuring players/${PLAYER_ID} is claimed by this account…`);
  const playerSnap = await db.collection('players').doc(PLAYER_ID).get();
  if (!playerSnap.exists) {
    await safeSet(db, 'players', PLAYER_ID, {
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
      divisionId: DIVISION_3_ID,
      teamId: TEAM_ID,
      name: userData.displayName,
      claimedByUserId: uid,
      claimedAt: FieldValue.serverTimestamp(),
      createdByUserId: uid,
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: false });
  } else if (playerSnap.data()?.claimedByUserId !== uid) {
    throw new Error(
      `REFUSING TO RUN: players/${PLAYER_ID} already exists and is claimed by a different account `
      + `("${playerSnap.data()?.claimedByUserId}"). This script never reassigns an existing claim.`,
    );
  } else {
    log(`players/${PLAYER_ID} already claimed by this account — leaving it untouched.`);
  }

  if (teamData.viceCaptainUserId !== uid) {
    log(`teams/${TEAM_ID}: setting viceCaptainUserId → this account…`);
    await safeSet(db, 'teams', TEAM_ID, { viceCaptainUserId: uid });
  } else {
    log(`teams/${TEAM_ID}.viceCaptainUserId is already this account — leaving it untouched.`);
  }

  log(`users/${uid}: setting role=viceCaptain + team/division/season/player — isLeagueAdmin/leagueId untouched…`);
  await safeSet(db, 'users', uid, {
    role: 'viceCaptain',
    teamId: TEAM_ID,
    divisionId: DIVISION_3_ID,
    seasonId: SEASON_ID,
    playerId: PLAYER_ID,
  });

  return uid;
}
