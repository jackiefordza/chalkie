// Seeds a bigger, mid-season-realistic scenario for exercising standings/
// stats/fixtures against real data volume: 5 teams of 5 players, a full
// double round-robin (5 teams -> 8 games each), with the first leg (4 games
// per team) already played and confirmed, and the second leg (4 games per
// team) still sitting as scheduled fixtures.
//
// Unlike seedTestLeague, this drives results through the *real* submission ->
// onSubmissionWrite -> onMatchConfirmed Cloud Function pipeline (two matching
// submissions per match, written as each team's own captain) rather than
// writing confirmed match docs directly - the whole point is to prove the
// real pipeline computes standings/stats correctly at a more realistic scale,
// not to hand-fake the numbers.
import { initializeApp, deleteApp } from 'firebase/app';
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
} from 'firebase/auth';
import {
  getFirestore, doc, getDoc, setDoc, serverTimestamp, collection, writeBatch,
} from 'firebase/firestore';
import { db, firebaseConfig } from '@/config/firebase';
import { generateRoundRobinFixtures } from './fixtures';
import { TEST_PASSWORD } from './testData';
import type { MatchGame, MatchLeg, MatchSide } from '@/types';

const SEASON_ID = 'mock-season';
const DIVISION_ID = 'mock-division';

const TEAM_NAMES = ['The Anchor', 'Kings Head', 'The Crown', 'White Hart', 'Ship Inn'];
const TEAM_IDS = TEAM_NAMES.map((_, i) => `mock-team-${i + 1}`);

// 5 players per team, first one always the captain.
const PLAYER_NAMES = [
  ['Danny Shaw', 'Rob Cole', 'Sam Trent', 'Liam Poole', 'Jamie Dunn'],
  ['Chris Wade', 'Owen Frost', 'Nick Barrow', 'Ryan Voss', 'Marc Lowe'],
  ['Tom Reid', 'Dean Church', 'Josh Marsh', 'Adam Petts', 'Luke Farr'],
  ['Ben Hale', 'Craig Nash', 'Paul Ives', 'Scott Rea', 'Gary Finn'],
  ['Mark Otto', 'Lee Sands', 'Kevin Doe', 'Ian Marsh', 'Wayne Kerr'],
];

const CAPTAIN_EMAIL = (teamIndex: number) => `mock.captain.${teamIndex + 1}@chalkie.test`;
const playerId = (teamIndex: number, playerIndex: number) => `mock-player-${teamIndex + 1}-${playerIndex + 1}`;

const HIGH_CHECKOUT_VALUES = ['170', '164', '161', '158', '146', '140', '121', '116', '100', '96'];

function randInt(max: number) { return Math.floor(Math.random() * max); }
function pick<T>(arr: T[]): T { return arr[randInt(arr.length)]; }

// A single game's 3 legs: split weighted toward closer scores (2-1/1-2) over
// clean sweeps, each leg independently may carry a 180 (from either
// participant) and/or one high checkout for whoever won it.
function generateLegs(homePlayerIds: string[], awayPlayerIds: string[]): { legs: MatchLeg[]; homeLegs: number } {
  // All 3 legs are always played, so these are the only valid splits.
  const splits: [number, number][] = [[3, 0], [0, 3], [2, 1], [1, 2]];
  const [homeLegs, awayLegs] = pick(splits);
  const winners: MatchSide[] = [
    ...Array(homeLegs).fill('home' as MatchSide),
    ...Array(awayLegs).fill('away' as MatchSide),
  ];
  // Shuffle so the winning side isn't always the first N legs.
  for (let i = winners.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [winners[i], winners[j]] = [winners[j], winners[i]];
  }

  const legs: MatchLeg[] = winners.map((winner) => {
    const oneEighties: string[] = [];
    // ~1 in 6 legs, a random participant (either side) throws a 180.
    if (randInt(6) === 0) {
      const thrower = pick(winner === 'home' ? [...homePlayerIds, ...awayPlayerIds] : [...awayPlayerIds, ...homePlayerIds]);
      oneEighties.push(thrower);
    }
    // ~1 in 12 legs, the winner finishes on a notable checkout.
    const highCheckout = randInt(12) === 0
      ? { playerId: pick(winner === 'home' ? homePlayerIds : awayPlayerIds), value: pick(HIGH_CHECKOUT_VALUES) }
      : null;
    return { winner, oneEighties, highCheckout };
  });

  return { legs, homeLegs };
}

function generateMatchGames(homePlayerIds: string[], awayPlayerIds: string[]): MatchGame[] {
  const games: MatchGame[] = [];
  // 5 singles: straight 1-1 pairing.
  for (let i = 0; i < 5; i++) {
    const { legs } = generateLegs([homePlayerIds[i]], [awayPlayerIds[i]]);
    games.push({ order: i + 1, type: 'singles', homePlayerIds: [homePlayerIds[i]], awayPlayerIds: [awayPlayerIds[i]], legs });
  }
  // 2 pairs, reusing the same 5 players in two different partnerships.
  const pairsRosters: [number[], number[]][] = [[[0, 1], [2, 3]], [[3, 4], [0, 2]]];
  pairsRosters.forEach(([homeIdx, awayIdx], i) => {
    const home = homeIdx.map((idx) => homePlayerIds[idx]);
    const away = awayIdx.map((idx) => awayPlayerIds[idx]);
    const { legs } = generateLegs(home, away);
    games.push({ order: 6 + i, type: 'pairs', homePlayerIds: home, awayPlayerIds: away, legs });
  });
  return games;
}

// Mirrors testData.ts's ensureTestAuthUser — creates (or signs into, if it
// already exists) an auth account on a throwaway secondary app instance, so
// this never disturbs whichever admin session is running the seed.
//
// Critically, this also ensures the base Firestore users/{uid} doc exists
// (self-created here, satisfying the "fresh pending signup" create rule)
// *before* returning — the admin-driven promotion to captain that follows
// is an update, not a create, and there is no admin bypass on user-doc
// *creation*, only on update. A bare auth account with no Firestore doc at
// all can never be updated by anyone, including an admin. Checking (rather
// than assuming) also self-heals any account left in that broken state by
// an earlier failed run.
async function ensureMockAuthUser(email: string): Promise<string> {
  const secondaryApp = initializeApp(firebaseConfig, `seed-mock-${Date.now()}-${Math.random()}`);
  try {
    const secondaryAuth = getAuth(secondaryApp);
    const secondaryDb = getFirestore(secondaryApp);
    let uid: string;
    try {
      const cred = await createUserWithEmailAndPassword(secondaryAuth, email, TEST_PASSWORD);
      uid = cred.user.uid;
    } catch (e: unknown) {
      if ((e as { code?: string }).code !== 'auth/email-already-in-use') throw e;
      uid = (await signInWithEmailAndPassword(secondaryAuth, email, TEST_PASSWORD)).user.uid;
    }

    const existing = await getDoc(doc(secondaryDb, 'users', uid));
    if (!existing.exists()) {
      await setDoc(doc(secondaryDb, 'users', uid), {
        email, displayName: email.split('@')[0], role: 'pending',
        leagueId: null, teamId: null, divisionId: null, playerId: null,
        pendingRequestType: null, createdAt: serverTimestamp(),
      });
    }

    await signOut(secondaryAuth);
    return uid;
  } finally {
    await deleteApp(secondaryApp);
  }
}

// Submissions can only be written by the submitting team's own captain/VC
// (firestore.rules has no admin bypass here), so each match's identical
// "agreed" result gets written twice, once signed in as each side's captain.
async function submitAsTeam(email: string, matchId: string, teamId: string, games: MatchGame[]): Promise<void> {
  const secondaryApp = initializeApp(firebaseConfig, `submit-${Date.now()}-${Math.random()}`);
  try {
    const secondaryAuth = getAuth(secondaryApp);
    const secondaryDb = getFirestore(secondaryApp);
    const cred = await signInWithEmailAndPassword(secondaryAuth, email, TEST_PASSWORD);
    await setDoc(doc(secondaryDb, 'matches', matchId, 'submissions', teamId), {
      submittedByTeamId: teamId,
      submittedByUserId: cred.user.uid,
      games,
      createdAt: serverTimestamp(),
    });
    await signOut(secondaryAuth);
  } finally {
    await deleteApp(secondaryApp);
  }
}

export async function seedMockSeason(leagueId: string, onProgress?: (msg: string) => void): Promise<void> {
  const report = (msg: string) => onProgress?.(msg);

  report('Creating season, division, teams, players…');
  await setDoc(doc(db, 'seasons', SEASON_ID), {
    leagueId, name: 'Mock Mid-Season', status: 'active', createdAt: serverTimestamp(),
  }, { merge: true });
  await setDoc(doc(db, 'divisions', DIVISION_ID), {
    leagueId, seasonId: SEASON_ID, name: 'Mock Division', order: 998, createdAt: serverTimestamp(),
  }, { merge: true });

  await Promise.all(TEAM_IDS.map((teamId, i) => setDoc(doc(db, 'teams', teamId), {
    leagueId, seasonId: SEASON_ID, divisionId: DIVISION_ID, name: TEAM_NAMES[i],
    captainUserId: null, viceCaptainUserId: null, address: null, venuePhone: null,
    createdAt: serverTimestamp(),
  }, { merge: true })));

  await Promise.all(TEAM_IDS.flatMap((teamId, ti) => PLAYER_NAMES[ti].map((name, pi) => setDoc(
    doc(db, 'players', playerId(ti, pi)),
    {
      leagueId, seasonId: SEASON_ID, divisionId: DIVISION_ID, teamId, name,
      claimedByUserId: null, claimedAt: null, createdByUserId: null, createdAt: serverTimestamp(),
    },
    { merge: true },
  ))));

  report('Creating captain accounts…');
  const captainUids = await Promise.all(TEAM_IDS.map((_, i) => ensureMockAuthUser(CAPTAIN_EMAIL(i))));

  await Promise.all(TEAM_IDS.map((teamId, i) => Promise.all([
    setDoc(doc(db, 'players', playerId(i, 0)), { claimedByUserId: captainUids[i], claimedAt: serverTimestamp() }, { merge: true }),
    setDoc(doc(db, 'users', captainUids[i]), {
      role: 'captain', leagueId, seasonId: SEASON_ID, teamId, divisionId: DIVISION_ID, playerId: playerId(i, 0),
      // Overwrites the placeholder email-prefix name ensureMockAuthUser gave
      // this account at signup — this write runs unconditionally on every
      // seed run (admin-privileged update, not gated on first-creation), so
      // it also repairs any account already left with the wrong name by an
      // earlier run.
      displayName: PLAYER_NAMES[i][0],
      pendingRequestType: null, pendingRequestId: null,
    }, { merge: true }),
    setDoc(doc(db, 'teams', teamId), { captainUserId: captainUids[i] }, { merge: true }),
  ])));

  report('Generating fixture schedule…');
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 5 * 7); // first leg lands entirely in the past
  const fixtures = generateRoundRobinFixtures(
    TEAM_IDS.map((id) => ({ id })),
    { startDate, intervalDays: 7 },
  );
  // 5 teams -> padded to 6 with a bye -> 5 rounds per leg, 10 rounds total.
  const firstLeg = fixtures.filter((f) => f.round <= 5);
  const secondLeg = fixtures.filter((f) => f.round > 5);

  report(`Playing out ${firstLeg.length} confirmed matches…`);
  for (const fixture of firstLeg) {
    const matchRef = doc(collection(db, 'matches'));
    await setDoc(matchRef, {
      leagueId, seasonId: SEASON_ID, divisionId: DIVISION_ID, round: fixture.round,
      homeTeamId: fixture.homeTeamId, awayTeamId: fixture.awayTeamId,
      scheduledDate: fixture.scheduledDate, venue: null, status: 'scheduled',
      homeGamesWon: null, awayGamesWon: null, homeLegsWon: null, awayLegsWon: null,
      games: null, createdAt: serverTimestamp(),
    });

    const homeIdx = TEAM_IDS.indexOf(fixture.homeTeamId);
    const awayIdx = TEAM_IDS.indexOf(fixture.awayTeamId);
    const homePlayerIds = PLAYER_NAMES[homeIdx].map((_, pi) => playerId(homeIdx, pi));
    const awayPlayerIds = PLAYER_NAMES[awayIdx].map((_, pi) => playerId(awayIdx, pi));
    const games = generateMatchGames(homePlayerIds, awayPlayerIds);

    // Both sides submit the identical agreed result — triggers real auto-confirm.
    await submitAsTeam(CAPTAIN_EMAIL(homeIdx), matchRef.id, fixture.homeTeamId, games);
    await submitAsTeam(CAPTAIN_EMAIL(awayIdx), matchRef.id, fixture.awayTeamId, games);
  }

  report(`Scheduling ${secondLeg.length} remaining fixtures…`);
  const batch = writeBatch(db);
  secondLeg.forEach((fixture) => {
    const matchRef = doc(collection(db, 'matches'));
    batch.set(matchRef, {
      leagueId, seasonId: SEASON_ID, divisionId: DIVISION_ID, round: fixture.round,
      homeTeamId: fixture.homeTeamId, awayTeamId: fixture.awayTeamId,
      scheduledDate: fixture.scheduledDate, venue: null, status: 'scheduled',
      homeGamesWon: null, awayGamesWon: null, homeLegsWon: null, awayLegsWon: null,
      games: null, createdAt: serverTimestamp(),
    });
  });
  await batch.commit();

  report('Done — waiting a moment for standings/stats to finish aggregating…');
}

export const MOCK_CAPTAIN_EMAILS = TEAM_IDS.map((_, i) => CAPTAIN_EMAIL(i));
