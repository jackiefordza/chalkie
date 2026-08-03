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

    // recomputeDivisionPositions is a separate write *after* applyMatchResultDelta's
    // own divisionTables batch — wait for position specifically, not just any
    // truthy doc, or this races the earlier (points/won/etc-only) write.
    const homeTable = await waitFor(async () => {
      const t = await getDivisionTable(f, f.homeTeamId);
      return t?.position != null ? t : null;
    });
    expect(homeTable).toMatchObject({ played: 1, won: 1, lost: 0, points: 2, legsFor: 21, legsAgainst: 0, legDiff: 21, position: 1 });
    const awayTable = await waitFor(async () => {
      const t = await getDivisionTable(f, f.awayTeamId);
      return t?.position != null ? t : null;
    });
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

// ── Team Knockout Cup: onCupTieSubmissionWrite + onCupTieConfirmed ─────────
// Seeds a small 4-team bracket by hand (Semi-Final x2 -> Final) — the exact
// shape adminCreateCup itself would write, minus actually calling the onCall
// wrapper (this only needs to exercise the Firestore triggers, same as the
// league match tests above).
interface CupFixture {
  leagueId: string; cupId: string;
  semiRoundId: string; finalRoundId: string;
  tie1Id: string; tie2Id: string; finalTieId: string;
  teamA: string; teamB: string; teamC: string; teamD: string;
  p: string;
}

function makeCupFixture(): CupFixture {
  const n = nonce();
  return {
    leagueId: `league-${n}`, cupId: `cup-${n}`,
    semiRoundId: `semi-${n}`, finalRoundId: `final-${n}`,
    tie1Id: `tie1-${n}`, tie2Id: `tie2-${n}`, finalTieId: `final-tie-${n}`,
    teamA: `team-a-${n}`, teamB: `team-b-${n}`, teamC: `team-c-${n}`, teamD: `team-d-${n}`,
    p: n,
  };
}

async function seedCupBracket(f: CupFixture) {
  const date = admin.firestore.Timestamp.fromDate(new Date('2026-06-01'));
  await Promise.all([
    db.doc(`teams/${f.teamA}`).set({ leagueId: f.leagueId, name: 'Team A' }),
    db.doc(`teams/${f.teamB}`).set({ leagueId: f.leagueId, name: 'Team B' }),
    db.doc(`teams/${f.teamC}`).set({ leagueId: f.leagueId, name: 'Team C' }),
    db.doc(`teams/${f.teamD}`).set({ leagueId: f.leagueId, name: 'Team D' }),
  ]);
  await db.doc(`cups/${f.cupId}`).set({
    leagueId: f.leagueId, seasonId: `season-${f.p}`, name: 'Test Cup', teamIds: [f.teamA, f.teamB, f.teamC, f.teamD],
    status: 'active', winnerTeamId: null, createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await db.doc(`cupRounds/${f.semiRoundId}`).set({
    leagueId: f.leagueId, cupId: f.cupId, name: 'Semi-Final', order: 1, scheduledDate: date,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await db.doc(`cupRounds/${f.finalRoundId}`).set({
    leagueId: f.leagueId, cupId: f.cupId, name: 'Final', order: 2, scheduledDate: date,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  const tieBase = {
    leagueId: f.leagueId, cupId: f.cupId,
    homeGamesWon: null, awayGamesWon: null, homeLegsWon: null, awayLegsWon: null, games: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  await db.doc(`cupTies/${f.tie1Id}`).set({
    ...tieBase, cupRoundId: f.semiRoundId, round: 1,
    homeTeamId: f.teamA, awayTeamId: f.teamB, winnerTeamId: null,
    scheduledDate: date, venue: 'Team A', status: 'scheduled',
    nextTieId: f.finalTieId, nextTieSlot: 'home',
  });
  await db.doc(`cupTies/${f.tie2Id}`).set({
    ...tieBase, cupRoundId: f.semiRoundId, round: 1,
    homeTeamId: f.teamC, awayTeamId: f.teamD, winnerTeamId: null,
    scheduledDate: date, venue: 'Team C', status: 'scheduled',
    nextTieId: f.finalTieId, nextTieSlot: 'away',
  });
  await db.doc(`cupTies/${f.finalTieId}`).set({
    ...tieBase, cupRoundId: f.finalRoundId, round: 2,
    homeTeamId: null, awayTeamId: null, winnerTeamId: null,
    scheduledDate: date, venue: null, status: 'pending',
    nextTieId: null, nextTieSlot: null,
  });
}

async function submitCupTie(tieId: string, homeTeamId: string, awayTeamId: string, p: string, homeWins: boolean) {
  const games = sweepGames(homeWins ? 'home' : 'away', p);
  await db.doc(`cupTies/${tieId}/submissions/home`).set({ submittedByTeamId: homeTeamId, submittedByUserId: 'home-captain', games });
  await db.doc(`cupTies/${tieId}/submissions/away`).set({ submittedByTeamId: awayTeamId, submittedByUserId: 'away-captain', games });
}

async function getCupTie(tieId: string) {
  const snap = await db.doc(`cupTies/${tieId}`).get();
  return snap.exists ? snap.data() : null;
}
async function getCup(cupId: string) {
  const snap = await db.doc(`cups/${cupId}`).get();
  return snap.exists ? snap.data() : null;
}

describe('Team Knockout Cup — onCupTieSubmissionWrite + onCupTieConfirmed', () => {
  it('confirms a tie, advances its winner into the Final, and completes the cup once the Final confirms', async () => {
    const f = makeCupFixture();
    await seedCupBracket(f);

    // Semi-Final 1: A beats B.
    await submitCupTie(f.tie1Id, f.teamA, f.teamB, `${f.p}-1`, true);
    const tie1 = await waitFor(async () => {
      const t = await getCupTie(f.tie1Id);
      return t?.status === 'confirmed' && t?.winnerTeamId ? t : null;
    });
    expect(tie1.winnerTeamId).toBe(f.teamA);

    // Its win should already have landed in the Final's home slot.
    const finalAfterTie1 = await waitFor(async () => {
      const t = await getCupTie(f.finalTieId);
      return t?.homeTeamId ? t : null;
    });
    expect(finalAfterTie1.homeTeamId).toBe(f.teamA);
    expect(finalAfterTie1.status).toBe('pending'); // away slot still empty

    // Semi-Final 2: C beats D.
    await submitCupTie(f.tie2Id, f.teamC, f.teamD, `${f.p}-2`, true);
    await waitFor(async () => {
      const t = await getCupTie(f.tie2Id);
      return t?.status === 'confirmed' ? t : null;
    });

    // Both Final slots now filled — should flip to 'scheduled'.
    const finalReady = await waitFor(async () => {
      const t = await getCupTie(f.finalTieId);
      return t?.awayTeamId && t?.status === 'scheduled' ? t : null;
    });
    expect(finalReady.homeTeamId).toBe(f.teamA);
    expect(finalReady.awayTeamId).toBe(f.teamC);
    expect(finalReady.venue).toBe('Team A'); // home team's own name, same convention as league fixtures

    // Play the Final: A beats C.
    await submitCupTie(f.finalTieId, f.teamA, f.teamC, `${f.p}-3`, true);
    await waitFor(async () => {
      const t = await getCupTie(f.finalTieId);
      return t?.status === 'confirmed' ? t : null;
    });

    // No next tie for the Final — the cup itself should complete.
    const cup = await waitFor(async () => {
      const c = await getCup(f.cupId);
      return c?.status === 'completed' ? c : null;
    });
    expect(cup.winnerTeamId).toBe(f.teamA);
  });

  it('marks a tie disputed (not confirmed) when submissions disagree, and does not advance the bracket', async () => {
    const f = makeCupFixture();
    await seedCupBracket(f);

    await db.doc(`cupTies/${f.tie1Id}/submissions/home`).set({
      submittedByTeamId: f.teamA, submittedByUserId: 'home-captain', games: sweepGames('home', `${f.p}-1`),
    });
    await db.doc(`cupTies/${f.tie1Id}/submissions/away`).set({
      submittedByTeamId: f.teamB, submittedByUserId: 'away-captain', games: sweepGames('away', `${f.p}-1`),
    });
    await waitFor(async () => (await getCupTie(f.tie1Id))?.status === 'disputed');

    await new Promise((resolve) => setTimeout(resolve, 1500));
    const finalTie = await getCupTie(f.finalTieId);
    expect(finalTie?.homeTeamId).toBeNull();
    expect(finalTie?.status).toBe('pending');
  });
});

// ── Singles Knockout: onSinglesTieConfirmed ─────────────────────────────
// Same 4-player Semi-Final x2 -> Final shape as the cup fixture above, but
// admin writes the confirmed result directly (no submissions subcollection
// to write through — see the "no captain on each side" reasoning in
// functions/src/index.ts).
interface SinglesFixture {
  leagueId: string; competitionId: string;
  tie1Id: string; tie2Id: string; finalTieId: string;
  playerA: string; playerB: string; playerC: string; playerD: string;
}

function makeSinglesFixture(): SinglesFixture {
  const n = nonce();
  return {
    leagueId: `league-${n}`, competitionId: `singles-${n}`,
    tie1Id: `stie1-${n}`, tie2Id: `stie2-${n}`, finalTieId: `sfinal-${n}`,
    playerA: `player-a-${n}`, playerB: `player-b-${n}`, playerC: `player-c-${n}`, playerD: `player-d-${n}`,
  };
}

async function seedSinglesBracket(f: SinglesFixture) {
  const date = admin.firestore.Timestamp.fromDate(new Date('2026-07-01'));
  await db.doc(`singlesCompetitions/${f.competitionId}`).set({
    leagueId: f.leagueId, seasonId: `season-${f.competitionId}`, name: 'Test Singles', eventDate: date,
    playerIds: [f.playerA, f.playerB, f.playerC, f.playerD], status: 'active', winnerPlayerId: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  const tieBase = {
    leagueId: f.leagueId, competitionId: f.competitionId,
    homeLegsWon: null, awayLegsWon: null, legs: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  await db.doc(`singlesTies/${f.tie1Id}`).set({
    ...tieBase, round: 1, homePlayerId: f.playerA, awayPlayerId: f.playerB, winnerPlayerId: null,
    status: 'ready', nextTieId: f.finalTieId, nextTieSlot: 'home',
  });
  await db.doc(`singlesTies/${f.tie2Id}`).set({
    ...tieBase, round: 1, homePlayerId: f.playerC, awayPlayerId: f.playerD, winnerPlayerId: null,
    status: 'ready', nextTieId: f.finalTieId, nextTieSlot: 'away',
  });
  await db.doc(`singlesTies/${f.finalTieId}`).set({
    ...tieBase, round: 2, homePlayerId: null, awayPlayerId: null, winnerPlayerId: null,
    status: 'pending', nextTieId: null, nextTieSlot: null,
  });
}

// A straight 2-0 sweep, best of 3 legs.
function sweepLegs(): { winner: 'home'; oneEighties: string[]; highCheckout: null }[] {
  return [
    { winner: 'home', oneEighties: [], highCheckout: null },
    { winner: 'home', oneEighties: [], highCheckout: null },
  ];
}

async function getSinglesTie(tieId: string) {
  const snap = await db.doc(`singlesTies/${tieId}`).get();
  return snap.exists ? snap.data() : null;
}
async function getSinglesCompetition(competitionId: string) {
  const snap = await db.doc(`singlesCompetitions/${competitionId}`).get();
  return snap.exists ? snap.data() : null;
}

describe('Singles Knockout — onSinglesTieConfirmed', () => {
  it('confirms a tie from raw legs, advances the winner, and completes the competition once the Final confirms', async () => {
    const f = makeSinglesFixture();
    await seedSinglesBracket(f);

    // Tie 1: A beats B 2-0.
    await db.doc(`singlesTies/${f.tie1Id}`).update({ status: 'confirmed', legs: sweepLegs() });
    const tie1 = await waitFor(async () => {
      const t = await getSinglesTie(f.tie1Id);
      return t?.winnerPlayerId ? t : null;
    });
    expect(tie1.winnerPlayerId).toBe(f.playerA);
    expect(tie1.homeLegsWon).toBe(2);
    expect(tie1.awayLegsWon).toBe(0);

    const finalAfterTie1 = await waitFor(async () => {
      const t = await getSinglesTie(f.finalTieId);
      return t?.homePlayerId ? t : null;
    });
    expect(finalAfterTie1.homePlayerId).toBe(f.playerA);
    expect(finalAfterTie1.status).toBe('pending');

    // Tie 2: C beats D 2-1 (a real decider, not a straight sweep).
    await db.doc(`singlesTies/${f.tie2Id}`).update({
      status: 'confirmed',
      legs: [
        { winner: 'home', oneEighties: [], highCheckout: null },
        { winner: 'away', oneEighties: [], highCheckout: null },
        { winner: 'home', oneEighties: [], highCheckout: null },
      ],
    });
    await waitFor(async () => (await getSinglesTie(f.tie2Id))?.winnerPlayerId ? true : null);

    const finalReady = await waitFor(async () => {
      const t = await getSinglesTie(f.finalTieId);
      return t?.awayPlayerId && t?.status === 'ready' ? t : null;
    });
    expect(finalReady.homePlayerId).toBe(f.playerA);
    expect(finalReady.awayPlayerId).toBe(f.playerC);

    // Final: A beats C 2-0 — no next tie, so the competition itself completes.
    await db.doc(`singlesTies/${f.finalTieId}`).update({ status: 'confirmed', legs: sweepLegs() });
    const competition = await waitFor(async () => {
      const c = await getSinglesCompetition(f.competitionId);
      return c?.status === 'completed' ? c : null;
    });
    expect(competition.winnerPlayerId).toBe(f.playerA);
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
