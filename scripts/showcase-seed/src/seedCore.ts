import * as admin from 'firebase-admin';
import {
  CAPTAIN_INDEX, VICE_CAPTAIN_INDEX, CONFIRMED_MATCH_COUNT, DISPUTED_PAIRING,
  AWAITING_CONFIRMATION_PAIRING, SCHEDULED_EXAMPLE_PAIRINGS, DIVISION_ID, DIVISION_NAME,
  GLOBAL_ADMIN_EMAIL, LEAGUE_ADMIN_EMAIL, LEAGUE_ID, LEAGUE_NAME, NORMAL_PLAYER_EMAIL,
  NORMAL_PLAYER_ROSTER_INDEX, NORMAL_PLAYER_TEAM_INDEX, PLAYERS_PER_TEAM, PLAYER_NAMES,
  RNG_SEED, SCHEDULE_INTERVAL_DAYS, SCHEDULE_LEAD_WEEKS, SEASON_ID, SEASON_NAME,
  SHOWCASE_PASSWORD, TEAM_COUNT, TEAM_NAMES, captainEmail, matchId, playerId, teamId,
  viceCaptainEmail,
} from './constants';
import { safeSet, registerShowcaseUserId } from './firebaseAdmin';
import { generateRoundRobinFixtures } from './fixtures';
import { pollUntil } from './poll';
import { createRng, shuffle, type Rng } from './random';
import { generateMatchResult, withDisputedGame } from './results';
import type { GeneratedFixture, MatchGame } from './types';

const FieldValue = admin.firestore.FieldValue;

// ── Small helpers ────────────────────────────────────────────────────────

async function ensureAuthUser(auth: admin.auth.Auth, email: string, displayName: string): Promise<string> {
  let uid: string;
  try {
    const existing = await auth.getUserByEmail(email);
    uid = existing.uid;
  } catch (e: unknown) {
    if ((e as { code?: string }).code !== 'auth/user-not-found') throw e;
    const created = await auth.createUser({ email, password: SHOWCASE_PASSWORD, displayName });
    uid = created.uid;
  }
  registerShowcaseUserId(uid);
  return uid;
}

// Mirrors testData.ts's/mockSeason.ts's own two-step user-doc pattern
// exactly: a minimal "just signed up" doc on first creation only (so
// `createdAt` is never bumped on a re-run), then a separate role-specific
// update layered on top every time (fully idempotent — always asserts the
// same end state).
async function ensureBaseUserDoc(db: admin.firestore.Firestore, uid: string, email: string, displayName: string): Promise<void> {
  const existing = await db.collection('users').doc(uid).get();
  if (existing.exists) return;
  await safeSet(db, 'users', uid, {
    email, displayName, role: 'pending',
    leagueId: null, teamId: null, divisionId: null, playerId: null,
    // Matches the real signup flow (authStore.ts's register()) exactly —
    // every genuine account always has these two explicitly false at
    // creation. Only seedAdminPersonas's later, deliberate update ever
    // flips either to true — never leave them unset.
    isLeagueAdmin: false, isGlobalAdmin: false,
    pendingRequestType: null, createdAt: FieldValue.serverTimestamp(),
  });
}

// Idempotent "create if missing, otherwise leave completely untouched" —
// used for every document phases 1/2/3/6 create. This is what makes
// re-running the seed on top of an already-seeded (or partially-seeded)
// dataset safe: an existing document — in particular an already-confirmed
// match — is never rewritten, never has its status reset, and never bumps
// createdAt. See writeAllFixturesAsScheduled for the phase this matters
// most for.
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

// ── Phase 1: league / season / division ─────────────────────────────────

export async function seedCoreStructure(db: admin.firestore.Firestore, log: (msg: string) => void): Promise<void> {
  log('Phase 1/9: league, season, division…');
  // adminUserId is deliberately not set here: the real schema
  // (mobile/src/types/index.ts's League.adminUserId) requires a real,
  // non-null string, and the only correct value for it is the showcase
  // league-admin persona's own uid — which doesn't exist yet at this point
  // in the run. seedAdminPersonas (phase 5) fills it in once that account
  // is resolved, before this script finishes. createOnce (not a plain
  // safeSet) means this never re-runs — and so never clobbers that later
  // value — on a second seed.
  await createOnce(db, 'leagues', LEAGUE_ID, {
    name: LEAGUE_NAME, createdAt: FieldValue.serverTimestamp(),
  });
  await createOnce(db, 'seasons', SEASON_ID, {
    leagueId: LEAGUE_ID, name: SEASON_NAME, status: 'active', createdAt: FieldValue.serverTimestamp(),
  });
  await createOnce(db, 'divisions', DIVISION_ID, {
    leagueId: LEAGUE_ID, seasonId: SEASON_ID, name: DIVISION_NAME, order: 1, createdAt: FieldValue.serverTimestamp(),
  });
}

// ── Phase 2: teams ────────────────────────────────────────────────────────

export async function seedTeams(db: admin.firestore.Firestore, log: (msg: string) => void): Promise<void> {
  log('Phase 2/9: 8 teams…');
  for (let i = 0; i < TEAM_COUNT; i++) {
    await createOnce(db, 'teams', teamId(i), {
      leagueId: LEAGUE_ID, seasonId: SEASON_ID, divisionId: DIVISION_ID, name: TEAM_NAMES[i],
      captainUserId: null, viceCaptainUserId: null, address: null, venuePhone: null,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
}

// ── Phase 3: players (all unclaimed initially) ──────────────────────────

export async function seedPlayers(db: admin.firestore.Firestore, log: (msg: string) => void): Promise<void> {
  log('Phase 3/9: 48 players…');
  for (let t = 0; t < TEAM_COUNT; t++) {
    for (let p = 0; p < PLAYERS_PER_TEAM; p++) {
      await createOnce(db, 'players', playerId(t, p), {
        leagueId: LEAGUE_ID, seasonId: SEASON_ID, divisionId: DIVISION_ID, teamId: teamId(t),
        name: PLAYER_NAMES[t][p], claimedByUserId: null, claimedAt: null,
        createdByUserId: null, createdAt: FieldValue.serverTimestamp(),
      });
    }
  }
}

// ── Phase 4: team accounts (captains, vice-captains, the one normal player) ─

async function linkTeamMember(
  db: admin.firestore.Firestore, auth: admin.auth.Auth,
  teamIdx: number, rosterIdx: number, role: 'captain' | 'viceCaptain' | 'player', email: string,
): Promise<string> {
  const name = PLAYER_NAMES[teamIdx][rosterIdx];
  const uid = await ensureAuthUser(auth, email, name);
  await ensureBaseUserDoc(db, uid, email, name);

  await safeSet(db, 'users', uid, {
    role, leagueId: LEAGUE_ID, seasonId: SEASON_ID, teamId: teamId(teamIdx), divisionId: DIVISION_ID,
    playerId: playerId(teamIdx, rosterIdx), displayName: name,
    // Explicit, not just inherited from ensureBaseUserDoc's first write —
    // every captain/VC/normal-player persona's FINAL doc state should be
    // unambiguous on its own, matching the real signup shape exactly.
    isLeagueAdmin: false, isGlobalAdmin: false,
    pendingRequestType: null, pendingRequestId: null,
  });

  // Only write the claim if it isn't already exactly this — keeps a re-seed
  // from bumping claimedAt (or re-writing an identical claim) every time.
  const pid = playerId(teamIdx, rosterIdx);
  const playerSnap = await db.collection('players').doc(pid).get();
  if (playerSnap.data()?.claimedByUserId !== uid) {
    await safeSet(db, 'players', pid, { claimedByUserId: uid, claimedAt: FieldValue.serverTimestamp() });
  }
  return uid;
}

// Returns the captain UID for each team (indexed 0..7) — needed by the
// match-confirmation phases so submissions can be attributed to a real
// captain's uid in `submittedByUserId`.
export async function seedTeamAccounts(db: admin.firestore.Firestore, auth: admin.auth.Auth, log: (msg: string) => void): Promise<string[]> {
  log('Phase 4/9: 8 captains, 8 vice-captains, 1 normal player…');
  const captainUidByTeam: string[] = [];
  for (let t = 0; t < TEAM_COUNT; t++) {
    const captainUid = await linkTeamMember(db, auth, t, CAPTAIN_INDEX, 'captain', captainEmail(t));
    const vcUid = await linkTeamMember(db, auth, t, VICE_CAPTAIN_INDEX, 'viceCaptain', viceCaptainEmail(t));
    await safeSet(db, 'teams', teamId(t), { captainUserId: captainUid, viceCaptainUserId: vcUid });
    captainUidByTeam[t] = captainUid;
  }

  await linkTeamMember(db, auth, NORMAL_PLAYER_TEAM_INDEX, NORMAL_PLAYER_ROSTER_INDEX, 'player', NORMAL_PLAYER_EMAIL);
  return captainUidByTeam;
}

// ── Phase 5: admin personas — flags set directly via Admin SDK (see README) ─

export async function seedAdminPersonas(db: admin.firestore.Firestore, auth: admin.auth.Auth, log: (msg: string) => void): Promise<void> {
  log('Phase 5/9: league admin + global admin…');

  const leagueAdminUid = await ensureAuthUser(auth, LEAGUE_ADMIN_EMAIL, 'Showcase League Admin');
  await ensureBaseUserDoc(db, leagueAdminUid, LEAGUE_ADMIN_EMAIL, 'Showcase League Admin');
  await safeSet(db, 'users', leagueAdminUid, {
    // Scoped to the showcase league specifically, per the approved design.
    leagueId: LEAGUE_ID, isLeagueAdmin: true, isGlobalAdmin: false,
  });

  // League.adminUserId is a required, non-nullable string in the real
  // schema (mobile/src/types/index.ts) — the showcase league-admin persona
  // is the correct real-world value for it, exactly what a genuine admin
  // doing "Create League" in the app produces for themselves (admin.tsx's
  // handleCreateLeague sets adminUserId: appUser.uid). Written here, now
  // that the uid is actually resolved, rather than guessed at in
  // seedCoreStructure. Naturally idempotent — same uid every run.
  await safeSet(db, 'leagues', LEAGUE_ID, { adminUserId: leagueAdminUid });

  const globalAdminUid = await ensureAuthUser(auth, GLOBAL_ADMIN_EMAIL, 'Showcase Global Admin');
  await ensureBaseUserDoc(db, globalAdminUid, GLOBAL_ADMIN_EMAIL, 'Showcase Global Admin');
  await safeSet(db, 'users', globalAdminUid, {
    // Deliberately NOT scoped to any league — isGlobalAdmin() bypasses the
    // league check everywhere in firestore.rules regardless, so leaving
    // this null is the most honest representation of "genuinely global",
    // not a limitation. Never narrow this to make a demo simpler.
    leagueId: null, isLeagueAdmin: false, isGlobalAdmin: true,
  });
}

// ── Phase 6: fixtures ────────────────────────────────────────────────────

export interface BuiltSchedule {
  all: GeneratedFixture[];
  disputed: GeneratedFixture;
  awaitingConfirmation: GeneratedFixture;
  scheduledExamples: GeneratedFixture[];
  toConfirm: GeneratedFixture[]; // chronologically-first CONFIRMED_MATCH_COUNT non-special fixtures
}

function findFixture(fixtures: GeneratedFixture[], pairing: readonly [number, number]): GeneratedFixture {
  const found = fixtures.find(
    (f) => (f.homeTeamIndex === pairing[0] && f.awayTeamIndex === pairing[1])
      || (f.homeTeamIndex === pairing[1] && f.awayTeamIndex === pairing[0]),
  );
  if (!found) throw new Error(`No generated fixture found for pairing [${pairing[0]}, ${pairing[1]}]`);
  return found;
}

export function buildSchedule(): BuiltSchedule {
  // Relative to "now" (script run time), not a fixed calendar date — see
  // fixtures.ts's comment on generateRoundRobinFixtures for why.
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - SCHEDULE_LEAD_WEEKS * 7);

  const all = generateRoundRobinFixtures(TEAM_COUNT, { startDate, intervalDays: SCHEDULE_INTERVAL_DAYS });

  const disputed = findFixture(all, DISPUTED_PAIRING);
  const awaitingConfirmation = findFixture(all, AWAITING_CONFIRMATION_PAIRING);
  const scheduledExamples = SCHEDULED_EXAMPLE_PAIRINGS.map((p) => findFixture(all, p));
  const specialSet = new Set([disputed, awaitingConfirmation, ...scheduledExamples]);

  // Chronologically-first CONFIRMED_MATCH_COUNT fixtures, excluding the 4
  // special ones wherever they naturally fall — see constants.ts's
  // specialPairings() comment. This means teams end up with *approximately*
  // (not necessarily exactly) 5 confirmed matches each — documented as a
  // deliberate simplification in the implementation report.
  const nonSpecial = all.filter((f) => !specialSet.has(f)).sort((a, b) => a.scheduledDate.getTime() - b.scheduledDate.getTime());
  const toConfirm = nonSpecial.slice(0, CONFIRMED_MATCH_COUNT);

  return { all, disputed, awaitingConfirmation, scheduledExamples, toConfirm };
}

// Uses createOnce, not a plain safeSet — this is the fix for the double-
// counting bug a code review found: writing every fixture unconditionally
// on every seed run meant a match this script had already confirmed on a
// prior run got its status merge-written back to 'scheduled' here, which
// then made confirmMatchesSequentially's re-submission look like a genuine
// first confirmation to onMatchConfirmed (before.status !== 'confirmed'),
// double-incrementing divisionTables/playerSeasonStats. createOnce leaves
// any match that already exists — confirmed, disputed, awaiting
// confirmation, or still scheduled — completely untouched, so a re-seed can
// never regress or reprocess it. onSubmissionWrite's own
// `if (match.status === 'confirmed') return;` guard (functions/src/index.ts)
// is then what makes confirmMatchesSequentially/seedSpecialStates safe to
// call again on top of that: since status is never reset out from under
// them, re-submitting identical (deterministic) results to an
// already-confirmed match is always a no-op.
export async function writeAllFixturesAsScheduled(db: admin.firestore.Firestore, schedule: BuiltSchedule, log: (msg: string) => void): Promise<void> {
  log(`Phase 6/9: writing all ${schedule.all.length} fixtures as 'scheduled' (existing matches are left exactly as they are)…`);
  let created = 0;
  let alreadyExisted = 0;
  for (const fx of schedule.all) {
    const wasCreated = await createOnce(db, 'matches', matchId(fx.homeTeamIndex, fx.awayTeamIndex, fx.round), {
      leagueId: LEAGUE_ID, seasonId: SEASON_ID, divisionId: DIVISION_ID, round: fx.round,
      homeTeamId: teamId(fx.homeTeamIndex), awayTeamId: teamId(fx.awayTeamIndex),
      scheduledDate: fx.scheduledDate, venue: null, status: 'scheduled',
      homeGamesWon: null, awayGamesWon: null, homeLegsWon: null, awayLegsWon: null,
      games: null, createdAt: FieldValue.serverTimestamp(),
    });
    if (wasCreated) created += 1; else alreadyExisted += 1;
  }
  log(`  ${created} match(es) newly created, ${alreadyExisted} already existed (left untouched).`);
}

// ── Phase 7: confirm matches through the real pipeline, sequentially ───────
//
// Sequential is deliberate, not merely cautious: onMatchConfirmed's
// divisionTables position recompute reads every team's row in the division,
// then writes back a fresh `position` for all of them — a plain
// read-then-write, not a transaction. Confirming two matches concurrently
// risks both recomputes reading the same stale snapshot and the later
// writer's positions winning, leaving `position` inconsistent with the
// `points`/`legDiff` values that actually landed. Waiting for each match's
// confirmation to fully land (polled, not slept) before starting the next
// one removes that race entirely. See the implementation report.

// A team's 6-player squad, that week's 5 selected for the matchday lineup:
// captain + VC are always included (real captains rarely sit themselves
// out), and 3 of the remaining 4 squad players are chosen by the seeded
// RNG each time — so the 4th genuinely sits out that week, and which one
// varies match to match.
function pickMatchdayFive(rng: Rng, teamIdx: number): string[] {
  const captain = playerId(teamIdx, CAPTAIN_INDEX);
  const vc = playerId(teamIdx, VICE_CAPTAIN_INDEX);
  const restIndices = shuffle(rng, [2, 3, 4, 5]).slice(0, 3);
  const rest = restIndices.map((i) => playerId(teamIdx, i));
  return [captain, vc, ...rest];
}

function computeMatchTotals(games: MatchGame[]) {
  let homeGamesWon = 0; let awayGamesWon = 0; let homeLegsWon = 0; let awayLegsWon = 0;
  for (const g of games) {
    const h = g.legs.filter((l) => l.winner === 'home').length;
    const a = g.legs.filter((l) => l.winner === 'away').length;
    homeLegsWon += h; awayLegsWon += a;
    if (h > a) homeGamesWon += 1; else awayGamesWon += 1;
  }
  return { homeGamesWon, awayGamesWon, homeLegsWon, awayLegsWon };
}

export async function confirmMatchesSequentially(
  db: admin.firestore.Firestore, rng: Rng, captainUidByTeam: string[], schedule: BuiltSchedule,
  log: (msg: string) => void,
): Promise<{ confirmed: number; failed: GeneratedFixture[] }> {
  log(`Phase 7/9: confirming ${schedule.toConfirm.length} matches through the real submission pipeline (sequential, polled)…`);
  const sorted = [...schedule.toConfirm].sort((a, b) => (
    a.scheduledDate.getTime() - b.scheduledDate.getTime()
    || matchId(a.homeTeamIndex, a.awayTeamIndex, a.round).localeCompare(matchId(b.homeTeamIndex, b.awayTeamIndex, b.round))
  ));

  const failed: GeneratedFixture[] = [];
  let confirmed = 0;
  for (const fx of sorted) {
    const id = matchId(fx.homeTeamIndex, fx.awayTeamIndex, fx.round);
    const homeFive = pickMatchdayFive(rng, fx.homeTeamIndex);
    const awayFive = pickMatchdayFive(rng, fx.awayTeamIndex);
    const games = generateMatchResult(rng, homeFive, awayFive);

    await safeSet(db, `matches/${id}/submissions`, teamId(fx.homeTeamIndex), {
      submittedByTeamId: teamId(fx.homeTeamIndex), submittedByUserId: captainUidByTeam[fx.homeTeamIndex],
      games, createdAt: FieldValue.serverTimestamp(),
    });
    await safeSet(db, `matches/${id}/submissions`, teamId(fx.awayTeamIndex), {
      submittedByTeamId: teamId(fx.awayTeamIndex), submittedByUserId: captainUidByTeam[fx.awayTeamIndex],
      games, createdAt: FieldValue.serverTimestamp(),
    });

    const result = await pollUntil(
      `${id} -> confirmed`,
      async () => {
        const snap = await db.collection('matches').doc(id).get();
        return snap.exists && snap.data()?.status === 'confirmed' ? true : null;
      },
    );
    if (result.succeeded) {
      confirmed += 1;
      const totals = computeMatchTotals(games);
      log(`  confirmed ${id} (${totals.homeGamesWon}-${totals.awayGamesWon} games, ${result.elapsedMs}ms)`);
    } else {
      failed.push(fx);
      log(`  ✗ ${id} did NOT reach 'confirmed' within the timeout`);
    }
  }
  return { confirmed, failed };
}

// ── Phase 8: the three special Round-6-equivalent states ────────────────

export async function seedSpecialStates(
  db: admin.firestore.Firestore, rng: Rng, captainUidByTeam: string[], schedule: BuiltSchedule,
  log: (msg: string) => void,
): Promise<{ awaitingConfirmationOk: boolean; disputedOk: boolean }> {
  log('Phase 8/9: special match states (awaiting-confirmation, disputed — the two plain-scheduled examples need no further action)…');

  // C — Railway Tavern vs Kings Arms: exactly one valid submission. The
  // match is NEVER set to 'awaiting_confirmation' by this script directly —
  // onSubmissionWrite does that itself once it sees one valid submission.
  const ac = schedule.awaitingConfirmation;
  const acId = matchId(ac.homeTeamIndex, ac.awayTeamIndex, ac.round);
  const acHomeFive = pickMatchdayFive(rng, ac.homeTeamIndex);
  const acAwayFive = pickMatchdayFive(rng, ac.awayTeamIndex);
  const acGames = generateMatchResult(rng, acHomeFive, acAwayFive);
  await safeSet(db, `matches/${acId}/submissions`, teamId(ac.homeTeamIndex), {
    submittedByTeamId: teamId(ac.homeTeamIndex), submittedByUserId: captainUidByTeam[ac.homeTeamIndex],
    games: acGames, createdAt: FieldValue.serverTimestamp(),
  });
  const acResult = await pollUntil(`${acId} -> awaiting_confirmation`, async () => {
    const snap = await db.collection('matches').doc(acId).get();
    return snap.exists && snap.data()?.status === 'awaiting_confirmation' ? true : null;
  });
  log(`  ${acResult.succeeded ? '✓' : '✗'} ${acId} (${teamId(ac.homeTeamIndex)} submitted, ${teamId(ac.awayTeamIndex)} has not)`);

  // D — The Red Lion vs The White Swan: two valid submissions, agreeing on
  // 6 of 7 games, deliberately disagreeing on Game 3. The match is NEVER
  // set to 'disputed' by this script directly — onSubmissionWrite's
  // gamesEqual() check failing is what does that.
  const d = schedule.disputed;
  const dId = matchId(d.homeTeamIndex, d.awayTeamIndex, d.round);
  const dHomeFive = pickMatchdayFive(rng, d.homeTeamIndex);
  const dAwayFive = pickMatchdayFive(rng, d.awayTeamIndex);
  const baseGames = generateMatchResult(rng, dHomeFive, dAwayFive);
  const alteredGames = withDisputedGame(rng, baseGames, 3);
  await safeSet(db, `matches/${dId}/submissions`, teamId(d.homeTeamIndex), {
    submittedByTeamId: teamId(d.homeTeamIndex), submittedByUserId: captainUidByTeam[d.homeTeamIndex],
    games: baseGames, createdAt: FieldValue.serverTimestamp(),
  });
  await safeSet(db, `matches/${dId}/submissions`, teamId(d.awayTeamIndex), {
    submittedByTeamId: teamId(d.awayTeamIndex), submittedByUserId: captainUidByTeam[d.awayTeamIndex],
    games: alteredGames, createdAt: FieldValue.serverTimestamp(),
  });
  const dResult = await pollUntil(`${dId} -> disputed`, async () => {
    const snap = await db.collection('matches').doc(dId).get();
    return snap.exists && snap.data()?.status === 'disputed' ? true : null;
  });
  log(`  ${dResult.succeeded ? '✓' : '✗'} ${dId} (${teamId(d.homeTeamIndex)} vs ${teamId(d.awayTeamIndex)}, differ on Game 3)`);

  return { awaitingConfirmationOk: acResult.succeeded, disputedOk: dResult.succeeded };
}

export function createShowcaseRng(): Rng {
  return createRng(RNG_SEED);
}
