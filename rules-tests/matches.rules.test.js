// Firestore security-rules regression tests for the Phase A fixture-exception
// work (postponed/cancelled MatchStatus values). Runs against a LOCAL
// Firestore emulator only, under a "demo-" project ID that
// @firebase/rules-unit-testing treats as never touching any real Firebase
// project — see README.md in this directory for how to run this.
//
// These are deliberately narrow: only the two rules clauses Phase A actually
// changed (the `matches` delete rule's status list, and the `submissions`
// sub-rule's status exclusion), plus the pre-existing `matches` update rule
// that admin fixture-status changes ride on unmodified. Everything else
// (UI bucketing, button gating, label/tone maps) is client logic already
// covered by mobile/src/lib/matchStatus.test.ts, not something a rules test
// can meaningfully exercise.
const { test, before, after, beforeEach } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');

const RULES_PATH = path.join(__dirname, '..', 'firestore.rules');

const LEAGUE_ID = 'league1';
const OTHER_LEAGUE_ID = 'league2';
const TEAM_HOME = 'team1';
const TEAM_AWAY = 'team2';
const MATCH_ID = 'match1';

const UID_CAPTAIN_HOME = 'captainHome';
const UID_CAPTAIN_AWAY = 'captainAway';
const UID_LEAGUE_ADMIN = 'leagueAdmin';
const UID_OTHER_LEAGUE_ADMIN = 'otherLeagueAdmin';
const UID_GLOBAL_ADMIN = 'globalAdmin';

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-chalkie-rules-test',
    firestore: {
      rules: fs.readFileSync(RULES_PATH, 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

after(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  // Seed users/teams/match as an admin context that bypasses rules entirely
  // — this is fixture setup, not part of what's under test.
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc(`users/${UID_CAPTAIN_HOME}`).set({
      role: 'captain', leagueId: LEAGUE_ID, teamId: TEAM_HOME, isLeagueAdmin: false,
    });
    await db.doc(`users/${UID_CAPTAIN_AWAY}`).set({
      role: 'captain', leagueId: LEAGUE_ID, teamId: TEAM_AWAY, isLeagueAdmin: false,
    });
    await db.doc(`users/${UID_LEAGUE_ADMIN}`).set({
      role: 'player', leagueId: LEAGUE_ID, teamId: null, isLeagueAdmin: true,
    });
    await db.doc(`users/${UID_OTHER_LEAGUE_ADMIN}`).set({
      role: 'player', leagueId: OTHER_LEAGUE_ID, teamId: null, isLeagueAdmin: true,
    });
    await db.doc(`users/${UID_GLOBAL_ADMIN}`).set({
      role: 'player', leagueId: null, teamId: null, isLeagueAdmin: false, isGlobalAdmin: true,
    });
  });
});

function seedMatch(status) {
  return testEnv.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc(`matches/${MATCH_ID}`).set({
      leagueId: LEAGUE_ID,
      seasonId: 'season1',
      divisionId: 'division1',
      round: 1,
      homeTeamId: TEAM_HOME,
      awayTeamId: TEAM_AWAY,
      scheduledDate: new Date('2026-10-01'),
      venue: null,
      status,
      homeGamesWon: status === 'confirmed' ? 4 : null,
      awayGamesWon: status === 'confirmed' ? 3 : null,
      homeLegsWon: status === 'confirmed' ? 12 : null,
      awayLegsWon: status === 'confirmed' ? 9 : null,
      games: null,
    });
  });
}

function sevenGames() {
  return Array.from({ length: 7 }, (_, i) => ({
    order: i + 1,
    type: i < 5 ? 'singles' : 'pairs',
    homePlayerIds: ['p1'],
    awayPlayerIds: ['p2'],
    legs: [
      { winner: 'home', oneEighties: [], highCheckout: null },
      { winner: 'home', oneEighties: [], highCheckout: null },
    ],
  }));
}

function asCaptainHome() {
  return testEnv.authenticatedContext(UID_CAPTAIN_HOME).firestore();
}
function asLeagueAdmin() {
  return testEnv.authenticatedContext(UID_LEAGUE_ADMIN).firestore();
}
function asOtherLeagueAdmin() {
  return testEnv.authenticatedContext(UID_OTHER_LEAGUE_ADMIN).firestore();
}
function asGlobalAdmin() {
  return testEnv.authenticatedContext(UID_GLOBAL_ADMIN).firestore();
}

// ── (1) & (2): postponed/cancelled fixtures cannot receive a result ────────

test('(1) a captain cannot submit a result against a postponed match', async () => {
  await seedMatch('postponed');
  await assertFails(
    asCaptainHome().doc(`matches/${MATCH_ID}/submissions/${TEAM_HOME}`).set({
      submittedByTeamId: TEAM_HOME,
      submittedByUserId: UID_CAPTAIN_HOME,
      games: sevenGames(),
    }),
  );
});

test('(2) a captain cannot submit a result against a cancelled match', async () => {
  await seedMatch('cancelled');
  await assertFails(
    asCaptainHome().doc(`matches/${MATCH_ID}/submissions/${TEAM_HOME}`).set({
      submittedByTeamId: TEAM_HOME,
      submittedByUserId: UID_CAPTAIN_HOME,
      games: sevenGames(),
    }),
  );
});

// ── (4): a postponed fixture can be rescheduled back to scheduled ──────────

test('(4) a league admin can reschedule a postponed match back to scheduled', async () => {
  await seedMatch('postponed');
  await assertSucceeds(
    asLeagueAdmin().doc(`matches/${MATCH_ID}`).update({
      status: 'scheduled',
      scheduledDate: new Date('2026-11-01'),
    }),
  );
});

// ── (5): only authorised league/global admins can change fixture status ────

test('(5) a captain (non-admin) cannot mark a scheduled match postponed', async () => {
  await seedMatch('scheduled');
  await assertFails(
    asCaptainHome().doc(`matches/${MATCH_ID}`).update({ status: 'postponed' }),
  );
});

test("(5) an admin from a DIFFERENT league cannot change this match's status", async () => {
  await seedMatch('scheduled');
  await assertFails(
    asOtherLeagueAdmin().doc(`matches/${MATCH_ID}`).update({ status: 'postponed' }),
  );
});

test('(5) this league\'s admin CAN mark a scheduled match postponed', async () => {
  await seedMatch('scheduled');
  await assertSucceeds(
    asLeagueAdmin().doc(`matches/${MATCH_ID}`).update({ status: 'postponed' }),
  );
});

test('(5) this league\'s admin CAN mark a scheduled match cancelled', async () => {
  await seedMatch('scheduled');
  await assertSucceeds(
    asLeagueAdmin().doc(`matches/${MATCH_ID}`).update({ status: 'cancelled' }),
  );
});

test('(5) a global admin CAN change fixture status in a league they do not belong to', async () => {
  await seedMatch('scheduled');
  await assertSucceeds(
    asGlobalAdmin().doc(`matches/${MATCH_ID}`).update({ status: 'postponed' }),
  );
});

// ── (6): existing scheduled/confirmed behaviour is unchanged ───────────────

test('(6) a captain CAN still submit a result against a plain scheduled match', async () => {
  await seedMatch('scheduled');
  await assertSucceeds(
    asCaptainHome().doc(`matches/${MATCH_ID}/submissions/${TEAM_HOME}`).set({
      submittedByTeamId: TEAM_HOME,
      submittedByUserId: UID_CAPTAIN_HOME,
      games: sevenGames(),
    }),
  );
});

test('(6) a captain still cannot submit against an already-confirmed match', async () => {
  await seedMatch('confirmed');
  await assertFails(
    asCaptainHome().doc(`matches/${MATCH_ID}/submissions/${TEAM_HOME}`).set({
      submittedByTeamId: TEAM_HOME,
      submittedByUserId: UID_CAPTAIN_HOME,
      games: sevenGames(),
    }),
  );
});

test('(6) admin can still delete a scheduled match (unchanged)', async () => {
  await seedMatch('scheduled');
  await assertSucceeds(asLeagueAdmin().doc(`matches/${MATCH_ID}`).delete());
});

test('(6) admin can still delete a confirmed match (unchanged)', async () => {
  await seedMatch('confirmed');
  await assertSucceeds(asLeagueAdmin().doc(`matches/${MATCH_ID}`).delete());
});

test('(6) admin still cannot delete a disputed match (unchanged)', async () => {
  await seedMatch('disputed');
  await assertFails(asLeagueAdmin().doc(`matches/${MATCH_ID}`).delete());
});

test('(6) admin still cannot delete an awaiting_confirmation match (unchanged)', async () => {
  await seedMatch('awaiting_confirmation');
  await assertFails(asLeagueAdmin().doc(`matches/${MATCH_ID}`).delete());
});

// ── New delete-rule coverage: postponed/cancelled may be deleted ───────────

test('a league admin can delete a postponed match', async () => {
  await seedMatch('postponed');
  await assertSucceeds(asLeagueAdmin().doc(`matches/${MATCH_ID}`).delete());
});

test('a league admin can delete a cancelled match', async () => {
  await seedMatch('cancelled');
  await assertSucceeds(asLeagueAdmin().doc(`matches/${MATCH_ID}`).delete());
});

test('a captain (non-admin) cannot delete a postponed match', async () => {
  await seedMatch('postponed');
  await assertFails(asCaptainHome().doc(`matches/${MATCH_ID}`).delete());
});
