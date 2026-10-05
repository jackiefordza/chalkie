import * as admin from 'firebase-admin';
import {
  CAPTAIN_ROSTER_INDEX, PILOT_PASSWORD, PILOT_TEAMS, PLAYERS_PER_TEAM,
  PilotTeam, playerId, playerName,
} from './constants';
import { safeSet, registerPilotUserId } from './firebaseAdmin';

const FieldValue = admin.firestore.FieldValue;

// ── Small helpers — mirrors scripts/showcase-seed's own conventions ────────

async function ensureAuthUser(auth: admin.auth.Auth, email: string, displayName: string): Promise<string> {
  let uid: string;
  try {
    const existing = await auth.getUserByEmail(email);
    uid = existing.uid;
  } catch (e: unknown) {
    if ((e as { code?: string }).code !== 'auth/user-not-found') throw e;
    const created = await auth.createUser({ email, password: PILOT_PASSWORD, displayName });
    uid = created.uid;
  }
  registerPilotUserId(uid);
  return uid;
}

// Idempotent "create if missing, otherwise leave completely untouched" — a
// re-run of this script never resets a player a captain has since claimed,
// renamed, or otherwise changed.
async function createOnce(
  db: admin.firestore.Firestore,
  collectionPath: string,
  docId: string,
  data: FirebaseFirestore.DocumentData,
): Promise<boolean> {
  const existing = await db.collection(collectionPath).doc(docId).get();
  if (existing.exists) return false;
  await safeSet(db, collectionPath, docId, data);
  return true;
}

// ── Phase 1: placeholder players (unclaimed initially, except roster index
// CAPTAIN_ROSTER_INDEX which Phase 2 below claims for the captain) ────────

export async function seedPlayers(db: admin.firestore.Firestore, log: (msg: string) => void): Promise<void> {
  log(`Phase 1/2: ${PLAYERS_PER_TEAM} placeholder players per team (${PILOT_TEAMS.length} teams)…`);
  for (const team of PILOT_TEAMS) {
    for (let i = 1; i <= PLAYERS_PER_TEAM; i++) {
      await createOnce(db, 'players', playerId(team, i), {
        leagueId: 'bedford-kempston-district',
        divisionId: 'bedford-kempston-winter-2026-27-division-2',
        teamId: team.teamId,
        name: playerName(team, i),
        claimedByUserId: null,
        claimedAt: null,
        createdByUserId: null,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  }
}

// ── Phase 2: captain accounts — a real linked Auth user + users/{uid} doc +
// claimed players/{id} doc + teams/{teamId}.captainUserId, exactly the
// field combination firestore.rules (submissions allow create/update) and
// the real signup flow (authStore.ts register()) both require. Verified
// against the live, deployed firestore.rules before writing this — see the
// chat report accompanying this change. ────────────────────────────────────

async function linkCaptain(
  db: admin.firestore.Firestore, auth: admin.auth.Auth, team: PilotTeam,
): Promise<string> {
  const uid = await ensureAuthUser(auth, team.captainEmail, team.captainDisplayName);
  const pid = playerId(team, CAPTAIN_ROSTER_INDEX);

  await safeSet(db, 'users', uid, {
    email: team.captainEmail,
    displayName: team.captainDisplayName,
    role: 'captain',
    leagueId: 'bedford-kempston-district',
    seasonId: 'bedford-kempston-winter-2026-27',
    teamId: team.teamId,
    divisionId: 'bedford-kempston-winter-2026-27-division-2',
    playerId: pid,
    isLeagueAdmin: false,
    isGlobalAdmin: false,
    pendingRequestType: null,
    pendingRequestId: null,
    phone: null,
    phoneVisibility: null,
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  // Only write the claim if it isn't already exactly this — keeps a
  // re-seed from bumping claimedAt (or re-writing an identical claim).
  const playerSnap = await db.collection('players').doc(pid).get();
  if (playerSnap.data()?.claimedByUserId !== uid) {
    await safeSet(db, 'players', pid, { claimedByUserId: uid, claimedAt: FieldValue.serverTimestamp() });
  }

  await safeSet(db, 'teams', team.teamId, { captainUserId: uid });
  return uid;
}

export async function seedCaptains(
  db: admin.firestore.Firestore, auth: admin.auth.Auth, log: (msg: string) => void,
): Promise<Record<string, string>> {
  log(`Phase 2/2: ${PILOT_TEAMS.length} captain accounts…`);
  const uidByTeamKey: Record<string, string> = {};
  for (const team of PILOT_TEAMS) {
    uidByTeamKey[team.key] = await linkCaptain(db, auth, team);
  }
  return uidByTeamKey;
}
