import * as admin from 'firebase-admin';
import {
  SMOKE_TEST_ACCOUNT_EMAIL, SMOKE_TEST_DIVISION_ID, SMOKE_TEST_INVITE_ID,
  SMOKE_TEST_LEAGUE_ID, SMOKE_TEST_SEASON_ID, SMOKE_TEST_TEAM_ID,
} from './constants';
import { registerVerifiedSmokeTestUserId, safeDelete, safeDeleteAuthUser } from './firebaseAdmin';

export interface SmokeTestAccountIdentity {
  uid: string;
  email: string;
}

// Looks up the throwaway smoke-test Auth account by its fixed email and
// verifies — by re-reading Firestore, never by trusting the caller — that
// it is linked ONLY to the throwaway smoke-test team/league/season/
// division before this script allows anything to delete it. Refuses to
// proceed (deletes nothing) if the account does not exist, or if it is
// linked to ANYTHING other than the exact throwaway namespace — e.g. if it
// were ever (by mistake) linked to a real team, this check fails closed.
export async function verifySmokeTestAccountOwnership(
  db: admin.firestore.Firestore, auth: admin.auth.Auth, log: (msg: string) => void,
): Promise<SmokeTestAccountIdentity> {
  log(`Looking up Auth account "${SMOKE_TEST_ACCOUNT_EMAIL}"…`);
  let uid: string;
  try {
    const user = await auth.getUserByEmail(SMOKE_TEST_ACCOUNT_EMAIL);
    uid = user.uid;
  } catch (e: unknown) {
    if ((e as { code?: string }).code === 'auth/user-not-found') {
      throw new Error(
        `REFUSING TO DELETE ANYTHING: no Auth account found for "${SMOKE_TEST_ACCOUNT_EMAIL}". `
        + 'If the smoke-test account was registered under a different email, stop and check before re-running '
        + 'with a corrected constant — this script will not guess.',
      );
    }
    throw e;
  }

  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) {
    throw new Error(
      `REFUSING TO DELETE ANYTHING: Auth account ${uid} (${SMOKE_TEST_ACCOUNT_EMAIL}) exists but has no `
      + `users/${uid} document. This is not the expected shape of a completed smoke-test registration — stop `
      + 'and investigate manually rather than deleting an Auth account with no matching Firestore record.',
    );
  }
  const u = userSnap.data()!;

  const isSmokeTestOnly = (
    u.teamId === SMOKE_TEST_TEAM_ID
    && u.leagueId === SMOKE_TEST_LEAGUE_ID
    && u.seasonId === SMOKE_TEST_SEASON_ID
    && u.divisionId === SMOKE_TEST_DIVISION_ID
    && u.isLeagueAdmin !== true
    && u.isGlobalAdmin !== true
  );
  if (!isSmokeTestOnly) {
    throw new Error(
      `REFUSING TO DELETE ANYTHING: users/${uid} (${SMOKE_TEST_ACCOUNT_EMAIL}) is not linked ONLY to the `
      + `throwaway smoke-test namespace. Found: ${JSON.stringify({
        teamId: u.teamId, leagueId: u.leagueId, seasonId: u.seasonId, divisionId: u.divisionId,
        isLeagueAdmin: u.isLeagueAdmin, isGlobalAdmin: u.isGlobalAdmin,
      })}. This is exactly the check that prevents ever deleting an account linked to a real team — `
      + 'stopping without deleting anything.',
    );
  }

  const teamSnap = await db.collection('teams').doc(SMOKE_TEST_TEAM_ID).get();
  if (!teamSnap.exists || teamSnap.data()?.captainUserId !== uid) {
    throw new Error(
      `REFUSING TO DELETE ANYTHING: teams/${SMOKE_TEST_TEAM_ID}.captainUserId does not equal ${uid}. `
      + `Found: ${JSON.stringify(teamSnap.data() ?? null)}. This account must be the one that actually accepted `
      + 'the smoke-test invite as captain of the throwaway team — stopping without deleting anything.',
    );
  }

  log(`Confirmed: ${uid} (${SMOKE_TEST_ACCOUNT_EMAIL}) is linked ONLY to teams/${SMOKE_TEST_TEAM_ID}, in the `
    + 'isolated smoke-test namespace, and is that team\'s captainUserId. Safe to delete.');

  registerVerifiedSmokeTestUserId(uid);
  return { uid, email: SMOKE_TEST_ACCOUNT_EMAIL };
}

export interface CleanupResult {
  deletedInviteId: string;
  deletedTeamId: string;
  deletedUserUid: string;
  deletedUserEmail: string;
}

export async function performSmokeTestCleanup(
  db: admin.firestore.Firestore, auth: admin.auth.Auth, log: (msg: string) => void,
): Promise<CleanupResult> {
  const { uid, email } = await verifySmokeTestAccountOwnership(db, auth, log);

  log(`Deleting invites/${SMOKE_TEST_INVITE_ID}…`);
  await safeDelete(db, 'invites', SMOKE_TEST_INVITE_ID);

  log(`Deleting teams/${SMOKE_TEST_TEAM_ID}…`);
  await safeDelete(db, 'teams', SMOKE_TEST_TEAM_ID);

  log(`Deleting users/${uid}…`);
  await safeDelete(db, 'users', uid);

  log(`Deleting Auth account ${uid} (${email})…`);
  await safeDeleteAuthUser(auth, uid);

  return {
    deletedInviteId: SMOKE_TEST_INVITE_ID,
    deletedTeamId: SMOKE_TEST_TEAM_ID,
    deletedUserUid: uid,
    deletedUserEmail: email,
  };
}
