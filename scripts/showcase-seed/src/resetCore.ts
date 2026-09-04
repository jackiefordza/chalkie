// Deletes every document this seed system could ever have created — and
// nothing else. Every deletion targets one of this script's own
// deterministic showcase IDs directly (never a broad/collection-group query
// across a collection that could touch another league's data) — see the
// per-step comments below for exactly why each step is safe.
import * as admin from 'firebase-admin';
import {
  DIVISION_ID, LEAGUE_ID, PLAYERS_PER_TEAM, SEASON_ID, TEAM_COUNT,
  allShowcaseEmails, matchId, playerId, teamId,
} from './constants';
import { registerShowcaseUserId, safeDelete } from './firebaseAdmin';
import { generateRoundRobinFixtures } from './fixtures';

// All 56 possible showcase match IDs, independent of any particular
// schedule run's actual dates — enough to know every ID this script could
// ever have written, which is all reset needs (it doesn't care about dates
// or which pairing was "special").
function allPossibleShowcaseMatchIds(): string[] {
  const fixtures = generateRoundRobinFixtures(TEAM_COUNT, { startDate: new Date(0), intervalDays: 1 });
  return fixtures.map((f) => matchId(f.homeTeamIndex, f.awayTeamIndex, f.round));
}

export interface ResetSummary {
  submissionsDeleted: number;
  divisionTablesDeleted: number;
  playerStatsDeleted: number;
  matchesDeleted: number;
  playersDeleted: number;
  teamsDeleted: number;
  divisionDeleted: boolean;
  seasonDeleted: boolean;
  leagueDeleted: boolean;
  authAccountsDeleted: number;
}

export async function resetShowcaseDataset(
  db: admin.firestore.Firestore,
  auth: admin.auth.Auth,
  log: (msg: string) => void,
): Promise<ResetSummary> {
  const summary: ResetSummary = {
    submissionsDeleted: 0, divisionTablesDeleted: 0, playerStatsDeleted: 0, matchesDeleted: 0,
    playersDeleted: 0, teamsDeleted: 0, divisionDeleted: false, seasonDeleted: false, leagueDeleted: false,
    authAccountsDeleted: 0,
  };

  const matchIds = allPossibleShowcaseMatchIds();

  // Step 1/2 — nested data first: every submission doc under every possible
  // showcase match. Firestore never cascade-deletes subcollections when a
  // parent doc is deleted, so this MUST happen before matches are deleted,
  // or these would become permanently orphaned, unreachable documents.
  log(`Step 1/7: deleting submission documents under all ${matchIds.length} possible showcase matches…`);
  for (const id of matchIds) {
    const refs = await db.collection(`matches/${id}/submissions`).listDocuments();
    for (const ref of refs) {
      await safeDelete(db, `matches/${id}/submissions`, ref.id);
      summary.submissionsDeleted += 1;
    }
  }

  // Step 3 (derived statistics) — divisionTables: 8 deterministic IDs.
  log('Step 2/7: deleting divisionTables rows…');
  for (let t = 0; t < TEAM_COUNT; t++) {
    const id = `${SEASON_ID}_${DIVISION_ID}_${teamId(t)}`;
    const exists = (await db.collection('divisionTables').doc(id).get()).exists;
    if (exists) {
      await safeDelete(db, 'divisionTables', id);
      summary.divisionTablesDeleted += 1;
    }
  }

  // playerSeasonStats — queried by seasonId (a single-field equality query,
  // scoped to the showcase season's own fixed ID only — never a broader
  // query across every season) rather than assumed present for all 48
  // players, since not every player necessarily got a stats doc.
  log('Step 3/7: deleting playerSeasonStats…');
  const statsSnap = await db.collection('playerSeasonStats').where('seasonId', '==', SEASON_ID).get();
  for (const doc of statsSnap.docs) {
    await safeDelete(db, 'playerSeasonStats', doc.id);
    summary.playerStatsDeleted += 1;
  }

  // Step 3 (match/submission data) — the 56 match docs themselves, now that
  // their submissions are already gone.
  log('Step 4/7: deleting match documents…');
  for (const id of matchIds) {
    const exists = (await db.collection('matches').doc(id).get()).exists;
    if (exists) {
      await safeDelete(db, 'matches', id);
      summary.matchesDeleted += 1;
    }
  }

  // Step 5 — teams/players/division/season/league.
  log('Step 5/7: deleting players, teams, division, season, league…');
  for (let t = 0; t < TEAM_COUNT; t++) {
    for (let p = 0; p < PLAYERS_PER_TEAM; p++) {
      const id = playerId(t, p);
      if ((await db.collection('players').doc(id).get()).exists) {
        await safeDelete(db, 'players', id);
        summary.playersDeleted += 1;
      }
    }
  }
  for (let t = 0; t < TEAM_COUNT; t++) {
    const id = teamId(t);
    if ((await db.collection('teams').doc(id).get()).exists) {
      await safeDelete(db, 'teams', id);
      summary.teamsDeleted += 1;
    }
  }
  if ((await db.collection('divisions').doc(DIVISION_ID).get()).exists) {
    await safeDelete(db, 'divisions', DIVISION_ID);
    summary.divisionDeleted = true;
  }
  if ((await db.collection('seasons').doc(SEASON_ID).get()).exists) {
    await safeDelete(db, 'seasons', SEASON_ID);
    summary.seasonDeleted = true;
  }
  if ((await db.collection('leagues').doc(LEAGUE_ID).get()).exists) {
    await safeDelete(db, 'leagues', LEAGUE_ID);
    summary.leagueDeleted = true;
  }

  // Step 6 — known showcase Auth accounts, found by email (never by a
  // query over `users` — the global-admin persona deliberately has no
  // leagueId to query on, and email lookup is unambiguous either way).
  //
  // The resolved uid must be registered with the write guard before
  // safeDelete will allow the users/{uid} deletion — registerShowcaseUserId
  // is the same mechanism seeding uses (seedCore.ts's ensureAuthUser), just
  // invoked here on the reset path instead. It is only ever called with a
  // uid that came from auth.getUserByEmail(email) for one of the fixed 19
  // emails in allShowcaseEmails() — there is no way for this loop to
  // register (and therefore become able to delete) any other account.
  log('Step 6/7: deleting showcase Auth accounts + their users/ docs…');
  for (const email of allShowcaseEmails()) {
    try {
      const user = await auth.getUserByEmail(email);
      registerShowcaseUserId(user.uid);
      const userDocExists = (await db.collection('users').doc(user.uid).get()).exists;
      if (userDocExists) await safeDelete(db, 'users', user.uid);
      await auth.deleteUser(user.uid);
      summary.authAccountsDeleted += 1;
    } catch (e: unknown) {
      if ((e as { code?: string }).code !== 'auth/user-not-found') throw e;
      // Already gone — fine, nothing to do for this email.
    }
  }

  log('Step 7/7: reset complete — see verification report below.');
  return summary;
}

// Independent re-check after reset — re-reads everything reset just deleted
// and confirms it's actually gone, rather than trusting the delete calls
// succeeded. Any single leftover fails this outright.
export async function verifyReset(
  db: admin.firestore.Firestore,
  auth: admin.auth.Auth,
): Promise<{ firestoreRemaining: number; authRemaining: number; remainingPaths: string[] }> {
  const remainingPaths: string[] = [];

  const matchIds = allPossibleShowcaseMatchIds();
  for (const id of matchIds) {
    if ((await db.collection('matches').doc(id).get()).exists) remainingPaths.push(`matches/${id}`);
    const subs = await db.collection(`matches/${id}/submissions`).listDocuments();
    subs.forEach((ref) => remainingPaths.push(`matches/${id}/submissions/${ref.id}`));
  }
  for (let t = 0; t < TEAM_COUNT; t++) {
    if ((await db.collection('teams').doc(teamId(t)).get()).exists) remainingPaths.push(`teams/${teamId(t)}`);
    if ((await db.collection('divisionTables').doc(`${SEASON_ID}_${DIVISION_ID}_${teamId(t)}`).get()).exists) {
      remainingPaths.push(`divisionTables/${SEASON_ID}_${DIVISION_ID}_${teamId(t)}`);
    }
    for (let p = 0; p < PLAYERS_PER_TEAM; p++) {
      if ((await db.collection('players').doc(playerId(t, p)).get()).exists) remainingPaths.push(`players/${playerId(t, p)}`);
    }
  }
  if ((await db.collection('divisions').doc(DIVISION_ID).get()).exists) remainingPaths.push(`divisions/${DIVISION_ID}`);
  if ((await db.collection('seasons').doc(SEASON_ID).get()).exists) remainingPaths.push(`seasons/${SEASON_ID}`);
  if ((await db.collection('leagues').doc(LEAGUE_ID).get()).exists) remainingPaths.push(`leagues/${LEAGUE_ID}`);
  const statsSnap = await db.collection('playerSeasonStats').where('seasonId', '==', SEASON_ID).get();
  statsSnap.forEach((doc) => remainingPaths.push(`playerSeasonStats/${doc.id}`));

  let authRemaining = 0;
  for (const email of allShowcaseEmails()) {
    try {
      await auth.getUserByEmail(email);
      authRemaining += 1;
      remainingPaths.push(`auth:${email}`);
    } catch (e: unknown) {
      if ((e as { code?: string }).code !== 'auth/user-not-found') throw e;
    }
  }

  return { firestoreRemaining: remainingPaths.length - authRemaining, authRemaining, remainingPaths };
}
