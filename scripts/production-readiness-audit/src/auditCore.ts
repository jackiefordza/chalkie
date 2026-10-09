import * as admin from 'firebase-admin';
import {
  DIVISION_2_ID, DIVISION_3_ID, EXPECTED_FIXTURE_COUNT, EXPECTED_TEAM_COUNT,
  KNOWN_TEST_EMAILS, LEAGUE_ID, REAL_USER_EMAIL_TO_CHECK, SEASON_ID,
} from './constants';

// Every function in this file performs ONLY get-style reads (including
// Firestore's count aggregate, which never transfers document contents)
// and Auth email lookups/listing (counts only — see below). Nothing here
// writes, mutates, or creates anything, anywhere. prove-read-only.sh greps
// this whole file (and every other file in src/) for any write-capable
// call before the workflow is allowed to run it.

export interface CollectionCount { collection: string; count: number; }

async function countCollection(db: admin.firestore.Firestore, collection: string): Promise<CollectionCount> {
  const snap = await db.collection(collection).count().get();
  return { collection, count: snap.data().count };
}

async function countWhereLeague(
  db: admin.firestore.Firestore, collection: string,
): Promise<CollectionCount> {
  const snap = await db.collection(collection).where('leagueId', '==', LEAGUE_ID).count().get();
  return { collection: `${collection} (leagueId=${LEAGUE_ID})`, count: snap.data().count };
}

export interface FirestoreAuditResult {
  collectionCounts: CollectionCount[];
  leagueExists: boolean;
  leagueName: string | null;
  seasonExists: boolean;
  division2Exists: boolean;
  division3Exists: boolean;
  teamsUnderLeague: number;
  matchesUnderLeague: number;
}

export async function auditFirestore(db: admin.firestore.Firestore): Promise<FirestoreAuditResult> {
  const [leagues, seasons, divisions, teams, players, matches, invites, users] = await Promise.all([
    countCollection(db, 'leagues'),
    countCollection(db, 'seasons'),
    countCollection(db, 'divisions'),
    countCollection(db, 'teams'),
    countCollection(db, 'players'),
    countCollection(db, 'matches'),
    countCollection(db, 'invites'),
    countCollection(db, 'users'),
  ]);

  const leagueSnap = await db.collection('leagues').doc(LEAGUE_ID).get();
  const seasonSnap = await db.collection('seasons').doc(SEASON_ID).get();
  const division2Snap = await db.collection('divisions').doc(DIVISION_2_ID).get();
  const division3Snap = await db.collection('divisions').doc(DIVISION_3_ID).get();

  const teamsUnderLeague = await countWhereLeague(db, 'teams');
  const matchesUnderLeague = await countWhereLeague(db, 'matches');

  return {
    collectionCounts: [leagues, seasons, divisions, teams, players, matches, invites, users],
    leagueExists: leagueSnap.exists,
    leagueName: leagueSnap.exists ? (leagueSnap.data()?.name ?? null) : null,
    seasonExists: seasonSnap.exists,
    division2Exists: division2Snap.exists,
    division3Exists: division3Snap.exists,
    teamsUnderLeague: teamsUnderLeague.count,
    matchesUnderLeague: matchesUnderLeague.count,
  };
}

export interface AuthAuditResult {
  totalUserCount: number;
  knownTestEmailsFound: { email: string; exists: boolean }[];
  realUserEmailExists: boolean;
  passwordProviderUserCount: number;
  sampledUserCount: number;
}

// Reports only aggregate counts and existence booleans — never an email,
// uid, displayName, or phone number for any account other than the exact
// known test addresses and the one real address the user themselves gave
// us (and even then, only whether it exists, nothing else about it).
export async function auditAuth(auth: admin.auth.Auth): Promise<AuthAuditResult> {
  let totalUserCount = 0;
  let passwordProviderUserCount = 0;
  let pageToken: string | undefined;
  do {
    // eslint-disable-next-line no-await-in-loop
    const page = await auth.listUsers(1000, pageToken);
    totalUserCount += page.users.length;
    for (const u of page.users) {
      if (u.providerData.some((p) => p.providerId === 'password')) passwordProviderUserCount += 1;
    }
    pageToken = page.pageToken;
  } while (pageToken);

  const knownTestEmailsFound: { email: string; exists: boolean }[] = [];
  for (const email of KNOWN_TEST_EMAILS) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await userExistsByEmail(auth, email);
    knownTestEmailsFound.push({ email, exists });
  }

  const realUserEmailExists = await userExistsByEmail(auth, REAL_USER_EMAIL_TO_CHECK);

  return {
    totalUserCount,
    knownTestEmailsFound,
    realUserEmailExists,
    passwordProviderUserCount,
    sampledUserCount: totalUserCount,
  };
}

async function userExistsByEmail(auth: admin.auth.Auth, email: string): Promise<boolean> {
  try {
    await auth.getUserByEmail(email);
    return true;
  } catch (e: unknown) {
    if ((e as { code?: string }).code === 'auth/user-not-found') return false;
    throw e;
  }
}

export interface ProjectConfigAuditResult {
  readable: boolean;
  detail: string;
}

// Best-effort — the Identity Platform "which sign-in providers are
// enabled" setting is not always exposed the same way across Admin SDK
// versions/project configurations. Never throws; reports what it could or
// couldn't determine.
export async function auditProjectConfig(auth: admin.auth.Auth): Promise<ProjectConfigAuditResult> {
  try {
    const config = await auth.projectConfigManager().getProjectConfig();
    return { readable: true, detail: JSON.stringify(config.toJSON ? config.toJSON() : config) };
  } catch (e: unknown) {
    return { readable: false, detail: (e as Error).message ?? String(e) };
  }
}

export { EXPECTED_TEAM_COUNT, EXPECTED_FIXTURE_COUNT };
