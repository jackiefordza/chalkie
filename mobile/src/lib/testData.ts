// Seeds a self-contained "Test Season / Test Division" inside the current
// league with two fixed teams, full rosters, two captain accounts, and one
// scheduled fixture between them — so results-entry and the dispute flow can
// be exercised without hand-creating teams/players or juggling real accounts.
// Re-running it resets the fixture to a clean 'scheduled' state; league/team/
// player docs are upserted so it's safe to call repeatedly.
import { initializeApp, deleteApp } from 'firebase/app';
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
} from 'firebase/auth';
import { getFirestore, doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db, firebaseConfig } from '@/config/firebase';

export const TEST_HOME_EMAIL = 'test.home.captain@chalkie.test';
export const TEST_AWAY_EMAIL = 'test.away.captain@chalkie.test';
export const TEST_PASSWORD = 'TestPass123!';

const SEASON_ID = 'test-season';
const DIVISION_ID = 'test-division';
const HOME_TEAM_ID = 'test-team-home';
const AWAY_TEAM_ID = 'test-team-away';
const MATCH_ID = 'test-match-1';

const HOME_PLAYER_NAMES = ['Alan Baker', 'Bev Carter', 'Colin Dean', 'Dawn Ellis', 'Eddie Fox', 'Fiona Gray', 'Greg Hall'];
const AWAY_PLAYER_NAMES = ['Harry Ivor', 'Ivy Jones', 'Jack King', 'Karen Lyle', 'Leo Moss', 'Mia Nash', 'Noah Owen'];

const homePlayerId = (i: number) => `test-player-home-${i}`;
const awayPlayerId = (i: number) => `test-player-away-${i}`;

// Creates (or signs into, if it already exists) a Firebase Auth account on a
// throwaway secondary app instance, so this never disturbs the admin's own
// signed-in session on the primary app.
async function ensureTestAuthUser(email: string): Promise<string> {
  const secondaryApp = initializeApp(firebaseConfig, `seed-${Date.now()}-${Math.random()}`);
  try {
    const secondaryAuth = getAuth(secondaryApp);
    let uid: string;
    try {
      const cred = await createUserWithEmailAndPassword(secondaryAuth, email, TEST_PASSWORD);
      uid = cred.user.uid;
      const secondaryDb = getFirestore(secondaryApp);
      await setDoc(doc(secondaryDb, 'users', uid), {
        email,
        displayName: email.split('@')[0],
        role: 'pending',
        leagueId: null,
        teamId: null,
        divisionId: null,
        playerId: null,
        pendingRequestType: null,
        createdAt: serverTimestamp(),
      });
    } catch (e: unknown) {
      if ((e as { code?: string }).code !== 'auth/email-already-in-use') throw e;
      uid = (await signInWithEmailAndPassword(secondaryAuth, email, TEST_PASSWORD)).user.uid;
    }
    await signOut(secondaryAuth);
    return uid;
  } finally {
    await deleteApp(secondaryApp);
  }
}

export async function seedTestLeague(leagueId: string): Promise<void> {
  await setDoc(doc(db, 'seasons', SEASON_ID), {
    leagueId, name: 'Test Season', status: 'active', createdAt: serverTimestamp(),
  }, { merge: true });
  await setDoc(doc(db, 'divisions', DIVISION_ID), {
    leagueId, seasonId: SEASON_ID, name: 'Test Division', order: 999, createdAt: serverTimestamp(),
  }, { merge: true });

  await Promise.all([
    setDoc(doc(db, 'teams', HOME_TEAM_ID), {
      leagueId, seasonId: SEASON_ID, divisionId: DIVISION_ID, name: 'Test Home Tigers',
      captainUserId: null, viceCaptainUserId: null, address: null, venuePhone: null,
      createdAt: serverTimestamp(),
    }, { merge: true }),
    setDoc(doc(db, 'teams', AWAY_TEAM_ID), {
      leagueId, seasonId: SEASON_ID, divisionId: DIVISION_ID, name: 'Test Away Eagles',
      captainUserId: null, viceCaptainUserId: null, address: null, venuePhone: null,
      createdAt: serverTimestamp(),
    }, { merge: true }),
    ...HOME_PLAYER_NAMES.map((name, i) => setDoc(doc(db, 'players', homePlayerId(i + 1)), {
      leagueId, seasonId: SEASON_ID, divisionId: DIVISION_ID, teamId: HOME_TEAM_ID, name,
      claimedByUserId: null, claimedAt: null, createdByUserId: null, createdAt: serverTimestamp(),
    }, { merge: true })),
    ...AWAY_PLAYER_NAMES.map((name, i) => setDoc(doc(db, 'players', awayPlayerId(i + 1)), {
      leagueId, seasonId: SEASON_ID, divisionId: DIVISION_ID, teamId: AWAY_TEAM_ID, name,
      claimedByUserId: null, claimedAt: null, createdByUserId: null, createdAt: serverTimestamp(),
    }, { merge: true })),
  ]);

  const [homeUid, awayUid] = await Promise.all([
    ensureTestAuthUser(TEST_HOME_EMAIL),
    ensureTestAuthUser(TEST_AWAY_EMAIL),
  ]);

  await Promise.all([
    setDoc(doc(db, 'players', homePlayerId(1)), { claimedByUserId: homeUid, claimedAt: serverTimestamp() }, { merge: true }),
    setDoc(doc(db, 'players', awayPlayerId(1)), { claimedByUserId: awayUid, claimedAt: serverTimestamp() }, { merge: true }),
    setDoc(doc(db, 'users', homeUid), {
      role: 'captain', leagueId, seasonId: SEASON_ID, teamId: HOME_TEAM_ID, divisionId: DIVISION_ID, playerId: homePlayerId(1),
      pendingRequestType: null, pendingRequestId: null,
    }, { merge: true }),
    setDoc(doc(db, 'users', awayUid), {
      role: 'captain', leagueId, seasonId: SEASON_ID, teamId: AWAY_TEAM_ID, divisionId: DIVISION_ID, playerId: awayPlayerId(1),
      pendingRequestType: null, pendingRequestId: null,
    }, { merge: true }),
    setDoc(doc(db, 'teams', HOME_TEAM_ID), { captainUserId: homeUid }, { merge: true }),
    setDoc(doc(db, 'teams', AWAY_TEAM_ID), { captainUserId: awayUid }, { merge: true }),
  ]);

  // Reset the one test fixture to a clean, unsubmitted state each run.
  await Promise.all([
    deleteDoc(doc(db, 'matches', MATCH_ID, 'submissions', HOME_TEAM_ID)),
    deleteDoc(doc(db, 'matches', MATCH_ID, 'submissions', AWAY_TEAM_ID)),
  ]);
  await setDoc(doc(db, 'matches', MATCH_ID), {
    leagueId, seasonId: SEASON_ID, divisionId: DIVISION_ID, round: 1,
    homeTeamId: HOME_TEAM_ID, awayTeamId: AWAY_TEAM_ID,
    scheduledDate: serverTimestamp(), venue: null, status: 'scheduled',
    homeGamesWon: null, awayGamesWon: null, homeLegsWon: null, awayLegsWon: null,
    games: null, createdAt: serverTimestamp(),
  });
}
