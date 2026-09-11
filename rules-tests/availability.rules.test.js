// Firestore security-rules regression tests for the Phase B player
// availability feature. Runs against a LOCAL Firestore emulator only, under
// a "demo-" project ID that @firebase/rules-unit-testing treats as never
// touching any real Firebase project — see README.md in this directory for
// how to run this.
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
const OTHER_LEAGUE_TEAM = 'team9';
const MATCH_ID = 'match1';

const PLAYER_HOME_1 = 'playerHome1'; // owns UID_PLAYER_HOME_1
const PLAYER_HOME_2 = 'playerHome2'; // owns UID_PLAYER_HOME_2 — the captain
const PLAYER_AWAY_1 = 'playerAway1';

const UID_PLAYER_HOME_1 = 'uidPlayerHome1';
const UID_CAPTAIN_HOME = 'uidCaptainHome'; // captain of TEAM_HOME, playerId PLAYER_HOME_2
const UID_PLAYER_AWAY_1 = 'uidPlayerAway1';
const UID_LEAGUE_ADMIN = 'uidLeagueAdmin';
const UID_GLOBAL_ADMIN = 'uidGlobalAdmin';
const UID_OTHER_LEAGUE_PLAYER = 'uidOtherLeaguePlayer';

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
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc(`users/${UID_PLAYER_HOME_1}`).set({
      role: 'player', leagueId: LEAGUE_ID, teamId: TEAM_HOME, playerId: PLAYER_HOME_1, isLeagueAdmin: false,
    });
    await db.doc(`users/${UID_CAPTAIN_HOME}`).set({
      role: 'captain', leagueId: LEAGUE_ID, teamId: TEAM_HOME, playerId: PLAYER_HOME_2, isLeagueAdmin: false,
    });
    await db.doc(`users/${UID_PLAYER_AWAY_1}`).set({
      role: 'player', leagueId: LEAGUE_ID, teamId: TEAM_AWAY, playerId: PLAYER_AWAY_1, isLeagueAdmin: false,
    });
    await db.doc(`users/${UID_LEAGUE_ADMIN}`).set({
      role: 'player', leagueId: LEAGUE_ID, teamId: null, playerId: null, isLeagueAdmin: true,
    });
    await db.doc(`users/${UID_GLOBAL_ADMIN}`).set({
      role: 'player', leagueId: null, teamId: null, playerId: null, isLeagueAdmin: false, isGlobalAdmin: true,
    });
    await db.doc(`users/${UID_OTHER_LEAGUE_PLAYER}`).set({
      role: 'player', leagueId: OTHER_LEAGUE_ID, teamId: OTHER_LEAGUE_TEAM, playerId: 'otherLeaguePlayer', isLeagueAdmin: false,
    });

    await db.doc(`matches/${MATCH_ID}`).set({
      leagueId: LEAGUE_ID,
      seasonId: 'season1',
      divisionId: 'division1',
      round: 1,
      homeTeamId: TEAM_HOME,
      awayTeamId: TEAM_AWAY,
      scheduledDate: new Date('2026-10-01'),
      venue: null,
      status: 'scheduled',
      homeGamesWon: null,
      awayGamesWon: null,
      homeLegsWon: null,
      awayLegsWon: null,
      games: null,
    });
  });
});

function docFor(playerId) {
  return `availability/${MATCH_ID}_${playerId}`;
}

function payload(playerId, teamId, leagueId, userId, status) {
  return {
    matchId: MATCH_ID, teamId, leagueId, playerId, userId, status, updatedAt: new Date(),
  };
}

function asPlayerHome1() { return testEnv.authenticatedContext(UID_PLAYER_HOME_1).firestore(); }
function asCaptainHome() { return testEnv.authenticatedContext(UID_CAPTAIN_HOME).firestore(); }
function asPlayerAway1() { return testEnv.authenticatedContext(UID_PLAYER_AWAY_1).firestore(); }
function asLeagueAdmin() { return testEnv.authenticatedContext(UID_LEAGUE_ADMIN).firestore(); }
function asGlobalAdmin() { return testEnv.authenticatedContext(UID_GLOBAL_ADMIN).firestore(); }
function asOtherLeaguePlayer() { return testEnv.authenticatedContext(UID_OTHER_LEAGUE_PLAYER).firestore(); }

async function seedOwnAvailability(playerId, teamId, userId, status) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc(docFor(playerId)).set(payload(playerId, teamId, LEAGUE_ID, userId, status));
  });
}

// ── 1. player can create their own availability ─────────────────────────

test('1. a player can create their own availability', async () => {
  await assertSucceeds(
    asPlayerHome1().doc(docFor(PLAYER_HOME_1)).set(
      payload(PLAYER_HOME_1, TEAM_HOME, LEAGUE_ID, UID_PLAYER_HOME_1, 'available'),
    ),
  );
});

// ── 2. player can update their own availability ──────────────────────────

test('2. a player can update their own availability', async () => {
  await seedOwnAvailability(PLAYER_HOME_1, TEAM_HOME, UID_PLAYER_HOME_1, 'available');
  await assertSucceeds(
    asPlayerHome1().doc(docFor(PLAYER_HOME_1)).set(
      payload(PLAYER_HOME_1, TEAM_HOME, LEAGUE_ID, UID_PLAYER_HOME_1, 'unsure'),
    ),
  );
});

// ── 3. player cannot write another player's availability ─────────────────

test("3. a player cannot create another player's availability", async () => {
  await assertFails(
    asPlayerHome1().doc(docFor(PLAYER_HOME_2)).set(
      payload(PLAYER_HOME_2, TEAM_HOME, LEAGUE_ID, UID_CAPTAIN_HOME, 'available'),
    ),
  );
});

test("3. even the team's captain cannot write a teammate's availability", async () => {
  await assertFails(
    asCaptainHome().doc(docFor(PLAYER_HOME_1)).set(
      payload(PLAYER_HOME_1, TEAM_HOME, LEAGUE_ID, UID_PLAYER_HOME_1, 'available'),
    ),
  );
});

test("3. a player cannot update another player's existing availability", async () => {
  await seedOwnAvailability(PLAYER_HOME_1, TEAM_HOME, UID_PLAYER_HOME_1, 'available');
  await assertFails(
    asCaptainHome().doc(docFor(PLAYER_HOME_1)).set(
      payload(PLAYER_HOME_1, TEAM_HOME, LEAGUE_ID, UID_PLAYER_HOME_1, 'unavailable'),
    ),
  );
});

// ── 4. player cannot write availability for another team ─────────────────

test('4. a player cannot write availability claiming a different team than their own', async () => {
  await assertFails(
    asPlayerHome1().doc(`availability/${MATCH_ID}_${PLAYER_HOME_1}`).set(
      payload(PLAYER_HOME_1, TEAM_AWAY, LEAGUE_ID, UID_PLAYER_HOME_1, 'available'),
    ),
  );
});

// ── 5. player cannot write availability for another league ───────────────

test('5. a player cannot write availability claiming a different league than their own', async () => {
  await assertFails(
    asPlayerHome1().doc(docFor(PLAYER_HOME_1)).set(
      payload(PLAYER_HOME_1, TEAM_HOME, OTHER_LEAGUE_ID, UID_PLAYER_HOME_1, 'available'),
    ),
  );
});

test('5. a player from a different league entirely cannot write into this league', async () => {
  await assertFails(
    asOtherLeaguePlayer().doc(docFor(PLAYER_HOME_1)).set(
      payload(PLAYER_HOME_1, TEAM_HOME, LEAGUE_ID, UID_OTHER_LEAGUE_PLAYER, 'available'),
    ),
  );
});

// ── 6. captain can read their own team's availability ─────────────────────

test("6. a captain can read their own team's availability doc", async () => {
  await seedOwnAvailability(PLAYER_HOME_1, TEAM_HOME, UID_PLAYER_HOME_1, 'available');
  await assertSucceeds(asCaptainHome().doc(docFor(PLAYER_HOME_1)).get());
});

// ── 7. captain cannot read another team's availability ────────────────────

test("7. a captain cannot read the OTHER team's availability doc", async () => {
  await seedOwnAvailability(PLAYER_AWAY_1, TEAM_AWAY, UID_PLAYER_AWAY_1, 'available');
  await assertFails(asCaptainHome().doc(docFor(PLAYER_AWAY_1)).get());
});

test('7. a plain player (not captain/VC) cannot read a teammate\'s availability doc', async () => {
  await seedOwnAvailability(PLAYER_HOME_2, TEAM_HOME, UID_CAPTAIN_HOME, 'unsure');
  await assertFails(asPlayerHome1().doc(docFor(PLAYER_HOME_2)).get());
});

// ── 8. appropriate admin access still works ────────────────────────────────

test('8. a league admin can read availability in their own league', async () => {
  await seedOwnAvailability(PLAYER_HOME_1, TEAM_HOME, UID_PLAYER_HOME_1, 'available');
  await assertSucceeds(asLeagueAdmin().doc(docFor(PLAYER_HOME_1)).get());
});

test('8. a global admin can read availability in any league', async () => {
  await seedOwnAvailability(PLAYER_HOME_1, TEAM_HOME, UID_PLAYER_HOME_1, 'available');
  await assertSucceeds(asGlobalAdmin().doc(docFor(PLAYER_HOME_1)).get());
});

test('8. a league admin can delete an availability doc (data-hygiene escape hatch)', async () => {
  await seedOwnAvailability(PLAYER_HOME_1, TEAM_HOME, UID_PLAYER_HOME_1, 'available');
  await assertSucceeds(asLeagueAdmin().doc(docFor(PLAYER_HOME_1)).delete());
});

test('8. a plain player cannot delete an availability doc, even their own', async () => {
  await seedOwnAvailability(PLAYER_HOME_1, TEAM_HOME, UID_PLAYER_HOME_1, 'available');
  await assertFails(asPlayerHome1().doc(docFor(PLAYER_HOME_1)).delete());
});

// ── Extra: shape/status validation ──────────────────────────────────────

test('a write with a status outside the allowed enum is rejected', async () => {
  await assertFails(
    asPlayerHome1().doc(docFor(PLAYER_HOME_1)).set({
      matchId: MATCH_ID, teamId: TEAM_HOME, leagueId: LEAGUE_ID, playerId: PLAYER_HOME_1,
      userId: UID_PLAYER_HOME_1, status: 'maybe-later', updatedAt: new Date(),
    }),
  );
});

test('a write whose document ID does not match matchId_playerId is rejected', async () => {
  await assertFails(
    asPlayerHome1().doc('availability/wrong-doc-id').set(
      payload(PLAYER_HOME_1, TEAM_HOME, LEAGUE_ID, UID_PLAYER_HOME_1, 'available'),
    ),
  );
});

test('an update cannot change matchId/teamId/leagueId/playerId/userId to someone else\'s', async () => {
  await seedOwnAvailability(PLAYER_HOME_1, TEAM_HOME, UID_PLAYER_HOME_1, 'available');
  await assertFails(
    asPlayerHome1().doc(docFor(PLAYER_HOME_1)).set(
      payload(PLAYER_HOME_1, TEAM_AWAY, LEAGUE_ID, UID_PLAYER_HOME_1, 'available'),
    ),
  );
});
