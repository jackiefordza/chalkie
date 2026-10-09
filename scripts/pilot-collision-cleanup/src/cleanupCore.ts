import * as admin from 'firebase-admin';
import {
  ADMIN_EMAIL, BURNABY_B_ADMIN_PLAYER_ID, BURNABY_B_TEAM_ID, BURNABY_C_CAPTAIN_EMAIL,
  BURNABY_C_TEAM_ID, OAKLEY_CAPTAIN_EMAIL, OAKLEY_TEAM_ID,
} from './constants';
import { registerAllowedUserId, safeDelete, safeSet } from './firebaseAdmin';

async function findExistingUid(auth: admin.auth.Auth, email: string): Promise<string | null> {
  try {
    const user = await auth.getUserByEmail(email);
    return user.uid;
  } catch (e: unknown) {
    if ((e as { code?: string }).code === 'auth/user-not-found') return null;
    throw e;
  }
}

// Clears exactly the fields that let a client be RECOGNISED as a captain/VC
// of a team (role/teamId/divisionId/seasonId/playerId) — never touches
// isLeagueAdmin/isGlobalAdmin/leagueId, and never deletes the Auth account
// itself. Matches the exact "pending, just signed up" shape authStore.ts's
// register() produces, so the account is left in a genuinely clean,
// reusable state rather than a half-reset one.
async function retireFromTeam(
  db: admin.firestore.Firestore, uid: string, keepLeagueId: boolean, log: (msg: string) => void,
): Promise<void> {
  const userSnap = await db.collection('users').doc(uid).get();
  const data = userSnap.data();
  if (!data) {
    log(`users/${uid} does not exist — nothing to retire.`);
    return;
  }
  if (data.role === 'pending' && data.teamId === null) {
    log(`users/${uid} is already retired (role:'pending', teamId:null) — leaving untouched.`);
    return;
  }
  await safeSet(db, 'users', uid, {
    role: 'pending',
    teamId: null,
    divisionId: null,
    seasonId: null,
    playerId: null,
    ...(keepLeagueId ? {} : { leagueId: null }),
  });
  log(`users/${uid}: retired to role:'pending', team/division/season/player cleared${keepLeagueId ? ' (leagueId kept)' : ''}.`);
}

async function clearTeamSlot(
  db: admin.firestore.Firestore, teamId: string, field: 'captainUserId' | 'viceCaptainUserId', expectedUid: string, log: (msg: string) => void,
): Promise<void> {
  const teamSnap = await db.collection('teams').doc(teamId).get();
  const data = teamSnap.data();
  if (!data) {
    log(`teams/${teamId} does not exist — nothing to clear.`);
    return;
  }
  if (data[field] === null) {
    log(`teams/${teamId}.${field} is already null — leaving untouched.`);
    return;
  }
  if (data[field] !== expectedUid) {
    throw new Error(
      `REFUSING TO CLEAR teams/${teamId}.${field}: it is set to "${data[field]}", not the expected pilot uid `
      + `"${expectedUid}" — someone else may already occupy this slot. Not touching it.`,
    );
  }
  await safeSet(db, 'teams', teamId, { [field]: null });
  log(`teams/${teamId}.${field}: cleared (was the pilot/test account).`);
}

export async function cleanupPilotCollisions(
  db: admin.firestore.Firestore, auth: admin.auth.Auth, log: (msg: string) => void,
): Promise<void> {
  log('Resolving the three pilot/test accounts…');
  const oakleyUid = await findExistingUid(auth, OAKLEY_CAPTAIN_EMAIL);
  const burnabyCUid = await findExistingUid(auth, BURNABY_C_CAPTAIN_EMAIL);
  const adminUid = await findExistingUid(auth, ADMIN_EMAIL);
  [oakleyUid, burnabyCUid, adminUid].forEach((uid) => { if (uid) registerAllowedUserId(uid); });

  if (oakleyUid) {
    log(`\n— Oakley Sports Club (${OAKLEY_TEAM_ID}) —`);
    await clearTeamSlot(db, OAKLEY_TEAM_ID, 'captainUserId', oakleyUid, log);
    await retireFromTeam(db, oakleyUid, false, log);
  } else {
    log(`\n${OAKLEY_CAPTAIN_EMAIL} does not exist — nothing to retire for Oakley Sports Club.`);
  }

  if (burnabyCUid) {
    log(`\n— Burnaby Arms C (${BURNABY_C_TEAM_ID}) —`);
    await clearTeamSlot(db, BURNABY_C_TEAM_ID, 'captainUserId', burnabyCUid, log);
    await retireFromTeam(db, burnabyCUid, false, log);
  } else {
    log(`\n${BURNABY_C_CAPTAIN_EMAIL} does not exist — nothing to retire for Burnaby Arms C.`);
  }

  if (adminUid) {
    log(`\n— Burnaby Arms B (${BURNABY_B_TEAM_ID}) —`);
    await clearTeamSlot(db, BURNABY_B_TEAM_ID, 'viceCaptainUserId', adminUid, log);
    // keepLeagueId=true — this account is still the real league admin
    // (isLeagueAdmin/leagueId are never touched by this script at all;
    // only its VC-specific team/role/player fields are retired).
    await retireFromTeam(db, adminUid, true, log);

    const playerSnap = await db.collection('players').doc(BURNABY_B_ADMIN_PLAYER_ID).get();
    if (playerSnap.exists) {
      if (playerSnap.data()?.claimedByUserId !== adminUid) {
        throw new Error(
          `REFUSING TO DELETE players/${BURNABY_B_ADMIN_PLAYER_ID}: claimedByUserId is not the admin uid — `
          + 'this doc may not be the one this script created. Not touching it.',
        );
      }
      await safeDelete(db, 'players', BURNABY_B_ADMIN_PLAYER_ID);
      log(`players/${BURNABY_B_ADMIN_PLAYER_ID}: deleted (bespoke pilot-admin-vc-link artifact, not real roster data).`);
    } else {
      log(`players/${BURNABY_B_ADMIN_PLAYER_ID} does not exist — nothing to delete.`);
    }
  } else {
    log(`\n${ADMIN_EMAIL} does not exist — nothing to retire for Burnaby Arms B.`);
  }
}
