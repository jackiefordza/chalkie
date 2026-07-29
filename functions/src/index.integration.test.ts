// Integration tests — require the Firebase Emulator Suite (Firestore + Auth +
// Functions) actually running, which is why these are a separate test file/
// config from index.test.ts (pure unit tests, no emulator needed, run in CI).
// Run with `npm run test:integration`. These exercise the parts index.test.ts
// explicitly couldn't: the Firestore triggers themselves
// (onSubmissionWrite/onMatchConfirmed/onMatchDeleted) and the Firestore
// writes inside applyMatchResultDelta/recomputeDivisionPositions.
//
// Each test uses its own unique league/season/division/team ids (via a
// per-test nonce) rather than a shared fixture + a "clear everything between
// tests" reset — Cloud Function triggers run asynchronously relative to the
// test that provoked them, so two tests sharing one set of ids can
// cross-contaminate if a previous test's trigger is still landing writes
// when the next test starts. Unique ids per test make that impossible
// regardless of timing.
import * as admin from 'firebase-admin';

const PROJECT_ID = 'demo-chalkie';

if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: PROJECT_ID });
}
const db = admin.firestore();

let nonceCounter = 0;
function nonce(): string {
  nonceCounter += 1;
  return `${Date.now()}-${nonceCounter}`;
}

async function waitFor<T>(fn: () => Promise<T | undefined | null | false>, timeoutMs = 15000, intervalMs = 200): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await fn();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

// Minimal 7-game match (5 singles, 2 pairs, 3 legs each) where one side sweeps
// every game 3-0 — real match shape from PLAN.md's "Match format" section.
// Player ids are namespaced per-test (via the `p` prefix) for the same
// isolation reason as the team/season/division ids.
function sweepGames(winner: 'home' | 'away', p: string) {
  const sweepLegs = [{ winner, oneEighties: [], highCheckout: null }, { winner, oneEighties: [], highCheckout: null }, { winner, oneEighties: [], highCheckout: null }];
  return [
    { order: 1, type: 'singles', homePlayerIds: [`${p}-h1`], awayPlayerIds: [`${p}-a1`], legs: sweepLegs },
    { order: 2, type: 'singles', homePlayerIds: [`${p}-h2`], awayPlayerIds: [`${p}-a2`], legs: sweepLegs },
    { order: 3, type: 'singles', homePlayerIds: [`${p}-h3`], awayPlayerIds: [`${p}-a3`], legs: sweepLegs },
    { order: 4, type: 'singles', homePlayerIds: [`${p}-h4`], awayPlayerIds: [`${p}-a4`], legs: sweepLegs },
    { order: 5, type: 'singles', homePlayerIds: [`${p}-h5`], awayPlayerIds: [`${p}-a5`], legs: sweepLegs },
    { order: 6, type: 'pairs', homePlayerIds: [`${p}-h1`, `${p}-h2`], awayPlayerIds: [`${p}-a1`, `${p}-a2`], legs: sweepLegs },
    { order: 7, type: 'pairs', homePlayerIds: [`${p}-h3`, `${p}-h4`], awayPlayerIds: [`${p}-a3`, `${p}-a4`], legs: sweepLegs },
  ];
}

interface Fixture {
  leagueId: string; seasonId: string; divisionId: string;
  homeTeamId: string; awayTeamId: string; matchId: string; p: string;
}

function makeFixture(): Fixture {
  const n = nonce();
  return {
    leagueId: `league-${n}`, seasonId: `season-${n}`, divisionId: `division-${n}`,
    homeTeamId: `home-${n}`, awayTeamId: `away-${n}`, matchId: `match-${n}`, p: n,
  };
}

async function createScheduledMatch(f: Fixture) {
  await db.doc(`matches/${f.matchId}`).set({
    leagueId: f.leagueId, seasonId: f.seasonId, divisionId: f.divisionId,
    homeTeamId: f.homeTeamId, awayTeamId: f.awayTeamId,
    scheduledDate: admin.firestore.Timestamp.fromDate(new Date('2026-09-01')),
    venue: null, status: 'scheduled',
    homeGamesWon: null, awayGamesWon: null, homeLegsWon: null, awayLegsWon: null, games: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

function divisionTableRef(f: Fixture, teamId: string) {
  return db.doc(`divisionTables/${f.seasonId}_${f.divisionId}_${teamId}`);
}
async function getDivisionTable(f: Fixture, teamId: string) {
  const snap = await divisionTableRef(f, teamId).get();
  return snap.exists ? snap.data() : null;
}
async function getPlayerStats(f: Fixture, playerId: string) {
  const snap = await db.doc(`playerSeasonStats/${f.seasonId}_${playerId}`).get();
  return snap.exists ? snap.data() : null;
}

afterAll(async () => {
  await admin.app().delete();
});

describe('onSubmissionWrite + onMatchConfirmed (auto-confirm path)', () => {
  it('auto-confirms when both submissions agree, and updates divisionTables + playerSeasonStats', async () => {
    const f = makeFixture();
    await createScheduledMatch(f);

    await db.doc(`matches/${f.matchId}/submissions/home`).set({
      submittedByTeamId: f.homeTeamId, submittedByUserId: 'home-captain', games: sweepGames('home', f.p),
    });
    await waitFor(async () => (await db.doc(`matches/${f.matchId}`).get()).data()?.status === 'awaiting_confirmation');

    await db.doc(`matches/${f.matchId}/submissions/away`).set({
      submittedByTeamId: f.awayTeamId, submittedByUserId: 'away-captain', games: sweepGames('home', f.p),
    });

    // Wait for onMatchConfirmed's own follow-up write (computeTotals), not just
    // onSubmissionWrite's status:'confirmed' — those are two separate writes,
    // and asserting on the totals right after the first would race the second.
    const match = await waitFor(async () => {
      const data = (await db.doc(`matches/${f.matchId}`).get()).data();
      return data?.status === 'confirmed' && data?.homeGamesWon != null ? data : null;
    });
    expect(match.homeGamesWon).toBe(7);
    expect(match.awayGamesWon).toBe(0);
    expect(match.homeLegsWon).toBe(21);
    expect(match.awayLegsWon).toBe(0);

    const homeTable = await waitFor(() => getDivisionTable(f, f.homeTeamId));
    expect(homeTable).toMatchObject({ played: 1, won: 1, lost: 0, points: 2, legsFor: 21, legsAgainst: 0, legDiff: 21, position: 1 });
    const awayTable = await waitFor(() => getDivisionTable(f, f.awayTeamId));
    expect(awayTable).toMatchObject({ played: 1, won: 0, lost: 1, points: 0, legsFor: 0, legsAgainst: 21, legDiff: -21, position: 2 });

    const h1Stats = await waitFor(() => getPlayerStats(f, `${f.p}-h1`));
    expect(h1Stats).toMatchObject({ teamId: f.homeTeamId, played: 2, won: 2, lost: 0 }); // h1 plays 1 singles + 1 pairs
    const a1Stats = await waitFor(() => getPlayerStats(f, `${f.p}-a1`));
    expect(a1Stats).toMatchObject({ teamId: f.awayTeamId, played: 2, won: 0, lost: 2 });
  });

  it('marks disputed (not confirmed) when submissions disagree, and leaves stats untouched', async () => {
    const f = makeFixture();
    await createScheduledMatch(f);

    await db.doc(`matches/${f.matchId}/submissions/home`).set({
      submittedByTeamId: f.homeTeamId, submittedByUserId: 'home-captain', games: sweepGames('home', f.p),
    });
    await db.doc(`matches/${f.matchId}/submissions/away`).set({
      submittedByTeamId: f.awayTeamId, submittedByUserId: 'away-captain', games: sweepGames('away', f.p), // disagrees on every leg
    });

    await waitFor(async () => (await db.doc(`matches/${f.matchId}`).get()).data()?.status === 'disputed');

    // Give onMatchConfirmed a moment it should never need — status never became
    // 'confirmed', so it never ran, so no divisionTables doc should exist at all
    // (unique fixture ids per test mean this can only be from THIS test, if anything).
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await getDivisionTable(f, f.homeTeamId)).toBeNull();
    expect(await getDivisionTable(f, f.awayTeamId)).toBeNull();
  });
});

describe('onMatchConfirmed — admin correction of an already-confirmed match', () => {
  it('recomputes the delta only, without double-counting the original result', async () => {
    const f = makeFixture();
    await createScheduledMatch(f);
    await db.doc(`matches/${f.matchId}/submissions/home`).set({
      submittedByTeamId: f.homeTeamId, submittedByUserId: 'home-captain', games: sweepGames('home', f.p),
    });
    await db.doc(`matches/${f.matchId}/submissions/away`).set({
      submittedByTeamId: f.awayTeamId, submittedByUserId: 'away-captain', games: sweepGames('home', f.p),
    });
    await waitFor(async () => {
      const data = (await db.doc(`matches/${f.matchId}`).get()).data();
      return data?.status === 'confirmed' && data?.homeGamesWon != null ? data : null;
    });
    await waitFor(() => getDivisionTable(f, f.homeTeamId)); // wait for first confirmation's stats to land

    // Admin corrects the result: away actually won it (e.g. a scoring mistake found later).
    await db.doc(`matches/${f.matchId}`).update({ games: sweepGames('away', f.p), status: 'confirmed' });

    // played must NOT increment a second time (playedDelta: 0 for a correction) —
    // this is the exact bug class this test guards against. Wait specifically for
    // the corrected value (won: 0) rather than the stale first-confirmation one.
    const homeTable = await waitFor(async () => {
      const t = await getDivisionTable(f, f.homeTeamId);
      return t && t.won === 0 ? t : null;
    });
    expect(homeTable).toMatchObject({ played: 1, won: 0, lost: 1, points: 0, legsFor: 0, legsAgainst: 21 });
    const awayTable = await waitFor(async () => {
      const t = await getDivisionTable(f, f.awayTeamId);
      return t && t.won === 1 ? t : null;
    });
    expect(awayTable).toMatchObject({ played: 1, won: 1, lost: 0, points: 2, legsFor: 21, legsAgainst: 0 });
  });
});

describe('onMatchDeleted', () => {
  it('fully reverses a confirmed match\'s contribution to divisionTables and playerSeasonStats', async () => {
    const f = makeFixture();
    await createScheduledMatch(f);
    await db.doc(`matches/${f.matchId}/submissions/home`).set({
      submittedByTeamId: f.homeTeamId, submittedByUserId: 'home-captain', games: sweepGames('home', f.p),
    });
    await db.doc(`matches/${f.matchId}/submissions/away`).set({
      submittedByTeamId: f.awayTeamId, submittedByUserId: 'away-captain', games: sweepGames('home', f.p),
    });
    await waitFor(async () => {
      const data = (await db.doc(`matches/${f.matchId}`).get()).data();
      return data?.status === 'confirmed' && data?.homeGamesWon != null ? data : null;
    });
    await waitFor(() => getDivisionTable(f, f.homeTeamId));

    await db.doc(`matches/${f.matchId}`).delete();

    const homeTable = await waitFor(async () => {
      const t = await getDivisionTable(f, f.homeTeamId);
      return t && t.played === 0 ? t : null;
    });
    expect(homeTable).toMatchObject({ played: 0, won: 0, lost: 0, points: 0, legsFor: 0, legsAgainst: 0, legDiff: 0 });

    const h1Stats = await waitFor(async () => {
      const s = await getPlayerStats(f, `${f.p}-h1`);
      return s && s.played === 0 ? s : null;
    });
    expect(h1Stats).toMatchObject({ played: 0, won: 0, lost: 0 });
  });
});
