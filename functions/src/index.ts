import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onDocumentWritten, onDocumentUpdated, onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

initializeApp();
const db = getFirestore();

type MatchSide = 'home' | 'away';
type GameType = 'singles' | 'pairs';

interface HighCheckout {
  playerId: string;
  value: string;
}
interface MatchLeg {
  winner: MatchSide;
  oneEighties: string[];
  highCheckout: HighCheckout | null;
}
interface MatchGame {
  order: number;
  type: GameType;
  homePlayerIds: string[];
  awayPlayerIds: string[];
  legs: MatchLeg[];
}
interface MatchSubmissionData {
  submittedByTeamId: string;
  submittedByUserId: string;
  games: MatchGame[];
}

function normalizeGames(games: MatchGame[]) {
  return [...games]
    .sort((a, b) => a.order - b.order)
    .map((g) => ({
      order: g.order,
      type: g.type,
      homePlayerIds: [...g.homePlayerIds].sort(),
      awayPlayerIds: [...g.awayPlayerIds].sort(),
      legs: g.legs.map((l) => ({
        winner: l.winner,
        oneEighties: [...l.oneEighties].sort(),
        highCheckout: l.highCheckout ? { playerId: l.highCheckout.playerId, value: l.highCheckout.value.trim() } : null,
      })),
    }));
}

function gamesEqual(a: MatchGame[], b: MatchGame[]): boolean {
  if (a.length !== b.length) return false;
  return JSON.stringify(normalizeGames(a)) === JSON.stringify(normalizeGames(b));
}

// ── Server-side result validation ───────────────────────────────────────────
// Authoritative validator for submitted match data. firestore.rules can only
// cheaply check that `games` is a 7-element array (see the comment there);
// full per-game/per-leg structure and — especially — cross-referencing every
// player ID against the `players` collection to confirm they're really on
// the right team needs real backend logic, not rules-language tricks. This
// is the single source of truth for "is this games array legitimate",
// reused by onSubmissionWrite (to quarantine bad submissions before they can
// ever be compared/confirmed) and defensively by onMatchConfirmed /
// onMatchDeleted (so no path — including a future one — can hand
// applyMatchResultDelta data that was never actually checked).
const GAMES_PER_MATCH = 7;
const SINGLES_GAMES = 5; // games 1-5 singles, 6-7 pairs — see Match type comment
const LEGS_PER_GAME = 3;

function isValidLeg(leg: unknown, eligiblePlayerIds: Set<string>): leg is MatchLeg {
  if (!leg || typeof leg !== 'object') return false;
  const l = leg as Record<string, unknown>;
  // An unrecognized winner must be rejected outright here — never allowed to
  // reach computeTotals, where falling through to "not home" would silently
  // become a phantom away-leg win.
  if (l.winner !== 'home' && l.winner !== 'away') return false;
  if (!Array.isArray(l.oneEighties) || !l.oneEighties.every((id) => typeof id === 'string' && eligiblePlayerIds.has(id))) {
    return false;
  }
  if (l.highCheckout !== null) {
    if (!l.highCheckout || typeof l.highCheckout !== 'object') return false;
    const hc = l.highCheckout as Record<string, unknown>;
    if (typeof hc.playerId !== 'string' || !eligiblePlayerIds.has(hc.playerId)) return false;
    if (typeof hc.value !== 'string') return false; // free text by design — no numeric validation
  }
  return true;
}

function isValidGame(game: unknown): game is MatchGame {
  if (!game || typeof game !== 'object') return false;
  const g = game as Record<string, unknown>;
  if (typeof g.order !== 'number' || !Number.isInteger(g.order) || g.order < 1 || g.order > GAMES_PER_MATCH) return false;
  const expectedType: GameType = g.order > SINGLES_GAMES ? 'pairs' : 'singles';
  const expectedPlayerCount = expectedType === 'pairs' ? 2 : 1;
  if (g.type !== expectedType) return false;
  if (!Array.isArray(g.homePlayerIds) || g.homePlayerIds.length !== expectedPlayerCount) return false;
  if (!Array.isArray(g.awayPlayerIds) || g.awayPlayerIds.length !== expectedPlayerCount) return false;
  if (!g.homePlayerIds.every((id) => typeof id === 'string') || !g.awayPlayerIds.every((id) => typeof id === 'string')) {
    return false;
  }
  const homeIds = g.homePlayerIds as string[];
  const awayIds = g.awayPlayerIds as string[];
  if (homeIds.some((id) => awayIds.includes(id))) return false; // can't play both sides
  if (!Array.isArray(g.legs) || g.legs.length !== LEGS_PER_GAME) return false;
  const eligible = new Set<string>([...homeIds, ...awayIds]);
  return g.legs.every((leg) => isValidLeg(leg, eligible));
}

// Structural validation only: exactly 7 well-formed games with unique order
// values covering 1..7, and every 180/checkout attributed to a player who is
// actually listed on that specific game. Does NOT confirm the player IDs are
// real roster members of the right team — see allPlayersLegitimate.
function isValidGamesShape(games: unknown): games is MatchGame[] {
  if (!Array.isArray(games) || games.length !== GAMES_PER_MATCH) return false;
  const seenOrders = new Set<number>();
  for (const g of games) {
    if (!isValidGame(g)) return false;
    if (seenOrders.has(g.order)) return false;
    seenOrders.add(g.order);
  }
  return seenOrders.size === GAMES_PER_MATCH;
}

// Cross-references every player ID used in `games` against the `players`
// collection: each must exist and belong to whichever side (home/away team)
// they're listed on. Rejects nonexistent player IDs and players who belong
// to a different team (whether in this league or another league/season
// entirely) than the side they're claimed to be playing for.
async function allPlayersLegitimate(games: MatchGame[], homeTeamId: string, awayTeamId: string): Promise<boolean> {
  const homeIds = new Set<string>();
  const awayIds = new Set<string>();
  for (const g of games) {
    g.homePlayerIds.forEach((id) => homeIds.add(id));
    g.awayPlayerIds.forEach((id) => awayIds.add(id));
  }
  const allIds = [...new Set([...homeIds, ...awayIds])];
  const snaps = await db.getAll(...allIds.map((id) => db.doc(`players/${id}`)));
  const teamIdById = new Map(snaps.map((s) => [s.id, s.exists ? (s.data() as { teamId?: string }).teamId : undefined]));
  for (const id of homeIds) if (teamIdById.get(id) !== homeTeamId) return false;
  for (const id of awayIds) if (teamIdById.get(id) !== awayTeamId) return false;
  return true;
}

async function isValidSubmission(data: unknown, homeTeamId: string, awayTeamId: string): Promise<boolean> {
  if (!data || typeof data !== 'object') return false;
  const { games } = data as { games?: unknown };
  if (!isValidGamesShape(games)) return false;
  return allPlayersLegitimate(games, homeTeamId, awayTeamId);
}

// ── Submission comparison: auto-confirm when both teams agree, else dispute ─
//
// Security invariants (complementing firestore.rules, which enforces the doc
// ID == submittedByTeamId convention that makes this lookup-by-identity
// possible in the first place — see the comment there):
//  - Submissions are read by TEAM IDENTITY (doc IDs homeTeamId/awayTeamId),
//    never by array position or count — two submissions from the same team
//    can no longer be mistaken for "both sides agreed".
//  - Each submission is re-validated (structure + real player/team
//    membership) before it's allowed to count towards confirmation. An
//    invalid submission is deleted (quarantined) rather than silently
//    skipped, so it can never combine with a later resubmission and slip
//    through, and so the submitting captain sees it actually disappeared
//    rather than being invisibly ignored.
export const onSubmissionWrite = onDocumentWritten(
  'matches/{matchId}/submissions/{submissionId}',
  async (event) => {
    const matchId = event.params.matchId;
    const matchRef = db.doc(`matches/${matchId}`);
    const matchSnap = await matchRef.get();
    if (!matchSnap.exists) return;
    const match = matchSnap.data()!;
    if (match.status === 'confirmed') return; // locked once confirmed — resubmission can't reopen it

    const homeTeamId = match.homeTeamId as string;
    const awayTeamId = match.awayTeamId as string;

    const [homeSnap, awaySnap] = await Promise.all([
      matchRef.collection('submissions').doc(homeTeamId).get(),
      matchRef.collection('submissions').doc(awayTeamId).get(),
    ]);

    const [homeValid, awayValid] = await Promise.all([
      homeSnap.exists && homeSnap.data()!.submittedByTeamId === homeTeamId
        ? isValidSubmission(homeSnap.data(), homeTeamId, awayTeamId)
        : Promise.resolve(false),
      awaySnap.exists && awaySnap.data()!.submittedByTeamId === awayTeamId
        ? isValidSubmission(awaySnap.data(), homeTeamId, awayTeamId)
        : Promise.resolve(false),
    ]);

    const toQuarantine = [
      ...(homeSnap.exists && !homeValid ? [homeSnap.ref] : []),
      ...(awaySnap.exists && !awayValid ? [awaySnap.ref] : []),
    ];
    if (toQuarantine.length) {
      console.warn(`onSubmissionWrite: deleting ${toQuarantine.length} invalid submission(s) for match ${matchId}`);
      await Promise.all(toQuarantine.map((ref) => ref.delete()));
    }

    const validCount = (homeValid ? 1 : 0) + (awayValid ? 1 : 0);
    if (validCount === 0) return;
    if (validCount === 1) {
      if (match.status === 'scheduled') {
        await matchRef.update({ status: 'awaiting_confirmation' });
      }
      return;
    }

    // Both sides have a genuinely valid, correctly-attributed submission.
    const homeData = homeSnap.data() as MatchSubmissionData;
    const awayData = awaySnap.data() as MatchSubmissionData;
    if (!gamesEqual(homeData.games, awayData.games)) {
      await matchRef.update({ status: 'disputed' });
      return;
    }

    // Both submissions agree — confirm using the canonical (normalized) games.
    // onMatchConfirmed picks up from here to compute totals + standings/stats.
    await matchRef.update({ status: 'confirmed', games: normalizeGames(homeData.games) });
  },
);

function computeTotals(games: MatchGame[]) {
  let homeGamesWon = 0, awayGamesWon = 0, homeLegsWon = 0, awayLegsWon = 0;
  for (const game of games) {
    let gameHomeLegs = 0, gameAwayLegs = 0;
    for (const leg of game.legs) {
      // Every caller of computeTotals is expected to have already run its
      // games through isValidGamesShape, so this should never trigger — but
      // an unrecognized winner must never silently fall into the "away"
      // bucket, so we fail loudly instead of guessing (see isValidLeg, which
      // is what actually keeps bad data out in the first place).
      if (leg.winner === 'home') { gameHomeLegs++; homeLegsWon++; }
      else if (leg.winner === 'away') { gameAwayLegs++; awayLegsWon++; }
      else throw new Error(`computeTotals: invalid leg winner ${JSON.stringify((leg as { winner: unknown }).winner)}`);
    }
    if (gameHomeLegs > gameAwayLegs) homeGamesWon++; else awayGamesWon++;
  }
  return { homeGamesWon, awayGamesWon, homeLegsWon, awayLegsWon };
}

interface HighCheckoutEntry { value: string; matchId: string; date: Date }
interface PlayerAccum {
  teamId: string;
  played: number;
  won: number;
  lost: number;
  oneEighties: number;
  highCheckouts: HighCheckoutEntry[];
}

// Pure — no Firestore calls. Reused for a match's first confirmation, a later
// admin correction of an already-confirmed match, and a full reversal on
// delete (by passing an empty games array as the "other side" of the diff).
function computePlayerAccum(
  games: MatchGame[], homeTeamId: string, awayTeamId: string, matchId: string, scheduledDate: Date,
): Map<string, PlayerAccum> {
  const accum = new Map<string, PlayerAccum>();
  const getAccum = (playerId: string, teamId: string): PlayerAccum => {
    if (!accum.has(playerId)) accum.set(playerId, { teamId, played: 0, won: 0, lost: 0, oneEighties: 0, highCheckouts: [] });
    return accum.get(playerId)!;
  };

  for (const game of games) {
    const gameHomeWon = game.legs.filter((l) => l.winner === 'home').length > game.legs.filter((l) => l.winner === 'away').length;
    for (const playerId of game.homePlayerIds) {
      const a = getAccum(playerId, homeTeamId);
      a.played += 1;
      if (gameHomeWon) a.won += 1; else a.lost += 1;
    }
    for (const playerId of game.awayPlayerIds) {
      const a = getAccum(playerId, awayTeamId);
      a.played += 1;
      if (gameHomeWon) a.lost += 1; else a.won += 1;
    }
    for (const leg of game.legs) {
      for (const playerId of leg.oneEighties) {
        const teamId = game.homePlayerIds.includes(playerId) ? homeTeamId : awayTeamId;
        getAccum(playerId, teamId).oneEighties += 1;
      }
      if (leg.highCheckout) {
        const teamId = game.homePlayerIds.includes(leg.highCheckout.playerId) ? homeTeamId : awayTeamId;
        getAccum(leg.highCheckout.playerId, teamId).highCheckouts.push({
          value: leg.highCheckout.value,
          matchId,
          date: scheduledDate,
        });
      }
    }
  }
  return accum;
}

async function recomputeDivisionPositions(seasonId: string, divisionId: string): Promise<void> {
  const divisionRows = await db.collection('divisionTables')
    .where('seasonId', '==', seasonId)
    .where('divisionId', '==', divisionId)
    .get();
  const sorted = divisionRows.docs
    .map((d) => ({ ref: d.ref, points: d.data().points ?? 0, legDiff: d.data().legDiff ?? 0 }))
    .sort((a, b) => (b.points - a.points) || (b.legDiff - a.legDiff));
  const positionBatch = db.batch();
  sorted.forEach((row, i) => positionBatch.update(row.ref, { position: i + 1 }));
  await positionBatch.commit();
}

interface ResultDeltaParams {
  matchId: string;
  leagueId: string;
  seasonId: string;
  divisionId: string;
  homeTeamId: string;
  awayTeamId: string;
  scheduledDate: Date;
  oldGames: MatchGame[]; // [] for a first confirmation (no prior result to reverse)
  newGames: MatchGame[]; // [] for a full reversal (match deleted)
  playedDelta: number; // +1 first confirmation, 0 correction of an existing result, -1 delete
}

// Single source of truth for "how a match's result affects divisionTables +
// playerSeasonStats" — applied as a (new − old) delta so it works identically
// whether this is the very first confirmation (old = zero contribution),
// an admin correcting an already-confirmed result (old = the previous
// games), or a full delete (new = zero contribution).
async function applyMatchResultDelta(p: ResultDeltaParams): Promise<void> {
  const oldTotals = computeTotals(p.oldGames);
  const newTotals = computeTotals(p.newGames);
  // null (not false) when there are no games at all — a false here would
  // wrongly credit the away side with a "win" contribution against zero games.
  const oldHomeWon = p.oldGames.length ? oldTotals.homeGamesWon > oldTotals.awayGamesWon : null;
  const newHomeWon = p.newGames.length ? newTotals.homeGamesWon > newTotals.awayGamesWon : null;

  const contrib = (homeWon: boolean | null) => (homeWon === null
    ? { homePoints: 0, homeWon: 0, homeLost: 0, awayPoints: 0, awayWon: 0, awayLost: 0 }
    : {
      homePoints: homeWon ? 2 : 0, homeWon: homeWon ? 1 : 0, homeLost: homeWon ? 0 : 1,
      awayPoints: homeWon ? 0 : 2, awayWon: homeWon ? 0 : 1, awayLost: homeWon ? 1 : 0,
    });
  const oldContrib = contrib(oldHomeWon);
  const newContrib = contrib(newHomeWon);

  const tableBatch = db.batch();
  tableBatch.set(db.doc(`divisionTables/${p.seasonId}_${p.divisionId}_${p.homeTeamId}`), {
    leagueId: p.leagueId, seasonId: p.seasonId, divisionId: p.divisionId, teamId: p.homeTeamId,
    played: FieldValue.increment(p.playedDelta),
    won: FieldValue.increment(newContrib.homeWon - oldContrib.homeWon),
    lost: FieldValue.increment(newContrib.homeLost - oldContrib.homeLost),
    points: FieldValue.increment(newContrib.homePoints - oldContrib.homePoints),
    legsFor: FieldValue.increment(newTotals.homeLegsWon - oldTotals.homeLegsWon),
    legsAgainst: FieldValue.increment(newTotals.awayLegsWon - oldTotals.awayLegsWon),
    legDiff: FieldValue.increment(
      (newTotals.homeLegsWon - newTotals.awayLegsWon) - (oldTotals.homeLegsWon - oldTotals.awayLegsWon),
    ),
  }, { merge: true });
  tableBatch.set(db.doc(`divisionTables/${p.seasonId}_${p.divisionId}_${p.awayTeamId}`), {
    leagueId: p.leagueId, seasonId: p.seasonId, divisionId: p.divisionId, teamId: p.awayTeamId,
    played: FieldValue.increment(p.playedDelta),
    won: FieldValue.increment(newContrib.awayWon - oldContrib.awayWon),
    lost: FieldValue.increment(newContrib.awayLost - oldContrib.awayLost),
    points: FieldValue.increment(newContrib.awayPoints - oldContrib.awayPoints),
    legsFor: FieldValue.increment(newTotals.awayLegsWon - oldTotals.awayLegsWon),
    legsAgainst: FieldValue.increment(newTotals.homeLegsWon - oldTotals.homeLegsWon),
    legDiff: FieldValue.increment(
      (newTotals.awayLegsWon - newTotals.homeLegsWon) - (oldTotals.awayLegsWon - oldTotals.homeLegsWon),
    ),
  }, { merge: true });
  await tableBatch.commit();

  await recomputeDivisionPositions(p.seasonId, p.divisionId);

  // ── playerSeasonStats — diff old vs new per player ──
  const oldAccum = computePlayerAccum(p.oldGames, p.homeTeamId, p.awayTeamId, p.matchId, p.scheduledDate);
  const newAccum = computePlayerAccum(p.newGames, p.homeTeamId, p.awayTeamId, p.matchId, p.scheduledDate);
  const playerIds = new Set([...oldAccum.keys(), ...newAccum.keys()]);

  const statsBatch = db.batch();
  const checkoutPlayerIds: string[] = [];

  for (const playerId of playerIds) {
    const o = oldAccum.get(playerId);
    const n = newAccum.get(playerId);
    const deltaPlayed = (n?.played ?? 0) - (o?.played ?? 0);
    const deltaWon = (n?.won ?? 0) - (o?.won ?? 0);
    const deltaLost = (n?.lost ?? 0) - (o?.lost ?? 0);
    const delta180 = (n?.oneEighties ?? 0) - (o?.oneEighties ?? 0);
    const checkoutsChanged = JSON.stringify(o?.highCheckouts ?? []) !== JSON.stringify(n?.highCheckouts ?? []);

    if (checkoutsChanged) {
      checkoutPlayerIds.push(playerId);
      continue;
    }
    if (deltaPlayed === 0 && deltaWon === 0 && deltaLost === 0 && delta180 === 0) continue;

    const teamId = (n ?? o)!.teamId;
    statsBatch.set(db.doc(`playerSeasonStats/${p.seasonId}_${playerId}`), {
      leagueId: p.leagueId, seasonId: p.seasonId, divisionId: p.divisionId, teamId, playerId,
      played: FieldValue.increment(deltaPlayed),
      won: FieldValue.increment(deltaWon),
      lost: FieldValue.increment(deltaLost),
      oneEighties: FieldValue.increment(delta180),
    }, { merge: true });
  }
  await statsBatch.commit();

  // highCheckouts can't be delta-incremented (no arrayRemove-by-predicate) —
  // read, drop this match's old entries, append the new ones, write in full.
  for (const playerId of checkoutPlayerIds) {
    const o = oldAccum.get(playerId);
    const n = newAccum.get(playerId);
    const deltaPlayed = (n?.played ?? 0) - (o?.played ?? 0);
    const deltaWon = (n?.won ?? 0) - (o?.won ?? 0);
    const deltaLost = (n?.lost ?? 0) - (o?.lost ?? 0);
    const delta180 = (n?.oneEighties ?? 0) - (o?.oneEighties ?? 0);
    const teamId = (n ?? o)!.teamId;

    const ref = db.doc(`playerSeasonStats/${p.seasonId}_${playerId}`);
    const snap = await ref.get();
    const existing = (snap.exists ? (snap.data()!.highCheckouts as HighCheckoutEntry[] | undefined) ?? [] : []);
    const filtered = existing.filter((hc) => hc.matchId !== p.matchId);
    const rebuilt = [...filtered, ...(n?.highCheckouts ?? [])];

    await ref.set({
      leagueId: p.leagueId, seasonId: p.seasonId, divisionId: p.divisionId, teamId, playerId,
      played: FieldValue.increment(deltaPlayed),
      won: FieldValue.increment(deltaWon),
      lost: FieldValue.increment(deltaLost),
      oneEighties: FieldValue.increment(delta180),
      highCheckouts: rebuilt,
    }, { merge: true });
  }
}

// ── On confirm (auto-confirm above, or an admin correcting an already-
// confirmed result): recompute totals, divisionTables, standings positions,
// and playerSeasonStats. ────────────────────────────────────────────────────
export const onMatchConfirmed = onDocumentUpdated('matches/{matchId}', async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after) return;
  if (after.status !== 'confirmed') return;

  const matchId = event.params.matchId;
  const { leagueId, seasonId, divisionId, homeTeamId, awayTeamId, scheduledDate } = after as {
    leagueId: string; seasonId: string; divisionId: string;
    homeTeamId: string; awayTeamId: string; scheduledDate: FirebaseFirestore.Timestamp;
  };

  // Defense in depth: onSubmissionWrite only ever confirms using games it has
  // already validated, and the admin dispute-resolution UI builds its
  // finalGames out of those same validated submissions — but this is the
  // last stop before games reaches applyMatchResultDelta/playerSeasonStats,
  // so it re-validates rather than trusting the caller. Anything that got
  // here some other way (a manual Console edit, a future code path) must not
  // be able to corrupt statistics.
  if (!isValidGamesShape(after.games) || !(await allPlayersLegitimate(after.games, homeTeamId, awayTeamId))) {
    console.error(`onMatchConfirmed: match ${matchId} is "confirmed" with invalid games — refusing to touch statistics.`);
    return;
  }

  // Only treat before.games as a real prior result if the match was already
  // confirmed — otherwise (first confirmation) there's nothing to reverse.
  const beforeGames = (before.status === 'confirmed' ? (before.games ?? []) : []) as MatchGame[];
  const afterGames = after.games as MatchGame[];
  if (JSON.stringify(beforeGames) === JSON.stringify(afterGames)) return; // no actual result change (e.g. venue/date edit)

  try {
    await db.doc(`matches/${matchId}`).update(computeTotals(afterGames));
    await applyMatchResultDelta({
      matchId, leagueId, seasonId, divisionId, homeTeamId, awayTeamId,
      scheduledDate: scheduledDate.toDate(),
      oldGames: beforeGames,
      newGames: afterGames,
      playedDelta: before.status !== 'confirmed' ? 1 : 0,
    });
  } catch (err) {
    console.error(`onMatchConfirmed: failed to apply result delta for match ${matchId}`, err);
  }
});

// ── On delete of a confirmed match: fully reverse its contribution to
// divisionTables/playerSeasonStats/standings — otherwise deleting a
// confirmed match would silently leave stale stats behind. ─────────────────
export const onMatchDeleted = onDocumentDeleted('matches/{matchId}', async (event) => {
  const before = event.data?.data();
  if (!before || before.status !== 'confirmed') return;

  const matchId = event.params.matchId;
  const { leagueId, seasonId, divisionId, homeTeamId, awayTeamId, scheduledDate } = before as {
    leagueId: string; seasonId: string; divisionId: string;
    homeTeamId: string; awayTeamId: string; scheduledDate: FirebaseFirestore.Timestamp;
  };
  const games = (before.games ?? []) as MatchGame[];

  // Defense in depth — see onMatchConfirmed. A confirmed match's games should
  // already be valid (that's what got it confirmed), but this is the last
  // stop before the reversal delta touches statistics.
  if (games.length > 0 && (!isValidGamesShape(games) || !(await allPlayersLegitimate(games, homeTeamId, awayTeamId)))) {
    console.error(`onMatchDeleted: confirmed match ${matchId} had invalid games — refusing to reverse statistics.`);
    return;
  }

  try {
    await applyMatchResultDelta({
      matchId, leagueId, seasonId, divisionId, homeTeamId, awayTeamId,
      scheduledDate: scheduledDate.toDate(),
      oldGames: games,
      newGames: [],
      playedDelta: -1,
    });
  } catch (err) {
    console.error(`onMatchDeleted: failed to reverse result delta for match ${matchId}`, err);
  }
});

// ── Admin cascading deletes ─────────────────────────────────────────────────
// Callable functions bypass Firestore rules entirely, so each one re-checks
// the caller is really a league admin for the league that owns the target
// doc before doing anything. Deliberately conservative: anything with a
// confirmed match in its history is blocked rather than cascade-reversed —
// that would need the same bulk stats-reversal complexity as the single-
// match recompute engine above, and is out of scope for this pass.

async function assertLeagueAdmin(uid: string | undefined, leagueId: string): Promise<void> {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const userSnap = await db.doc(`users/${uid}`).get();
  const user = userSnap.data();
  if (!user || user.isLeagueAdmin !== true || user.leagueId !== leagueId) {
    throw new HttpsError('permission-denied', 'League admin access required.');
  }
}

async function hasConfirmedMatch(teamId: string): Promise<boolean> {
  const [homeSnap, awaySnap] = await Promise.all([
    db.collection('matches').where('homeTeamId', '==', teamId).where('status', '==', 'confirmed').limit(1).get(),
    db.collection('matches').where('awayTeamId', '==', teamId).where('status', '==', 'confirmed').limit(1).get(),
  ]);
  return !homeSnap.empty || !awaySnap.empty;
}

async function assertNoConfirmedMatches(teamIds: string[]): Promise<void> {
  for (const teamId of teamIds) {
    if (await hasConfirmedMatch(teamId)) {
      throw new HttpsError(
        'failed-precondition',
        'One or more teams here have confirmed match results — delete isn\'t supported while that history exists. Delete or correct those results first.',
      );
    }
  }
}

// Deletes a team's players, its pending join requests, its own (non-
// confirmed — callers must have already checked) matches, then the team
// itself. Re-checks confirmed matches itself too, so it's safe to call
// directly (adminDeleteTeam) as well as from a division/season cascade that
// already did the check up front.
async function deleteTeamCascade(teamId: string): Promise<void> {
  if (await hasConfirmedMatch(teamId)) {
    throw new HttpsError(
      'failed-precondition',
      'This team has confirmed match results — delete isn\'t supported while that history exists. Delete or correct those results first.',
    );
  }

  const [playersSnap, joinReqSnap, homeMatchesSnap, awayMatchesSnap] = await Promise.all([
    db.collection('players').where('teamId', '==', teamId).get(),
    db.collection('joinRequests').where('teamId', '==', teamId).get(),
    db.collection('matches').where('homeTeamId', '==', teamId).get(),
    db.collection('matches').where('awayTeamId', '==', teamId).get(),
  ]);

  const batch = db.batch();
  playersSnap.docs.forEach((d) => batch.delete(d.ref));
  joinReqSnap.docs.forEach((d) => batch.delete(d.ref));
  homeMatchesSnap.docs.forEach((d) => batch.delete(d.ref));
  awayMatchesSnap.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(db.doc(`teams/${teamId}`));
  await batch.commit();
}

async function deleteDivisionCascade(divisionId: string): Promise<void> {
  const teamsSnap = await db.collection('teams').where('divisionId', '==', divisionId).get();
  const teamIds = teamsSnap.docs.map((d) => d.id);
  await assertNoConfirmedMatches(teamIds);

  for (const teamId of teamIds) {
    await deleteTeamCascade(teamId);
  }

  const [tablesSnap, statsSnap] = await Promise.all([
    db.collection('divisionTables').where('divisionId', '==', divisionId).get(),
    db.collection('playerSeasonStats').where('divisionId', '==', divisionId).get(),
  ]);
  const cleanupBatch = db.batch();
  tablesSnap.docs.forEach((d) => cleanupBatch.delete(d.ref));
  statsSnap.docs.forEach((d) => cleanupBatch.delete(d.ref));
  cleanupBatch.delete(db.doc(`divisions/${divisionId}`));
  await cleanupBatch.commit();
}

async function deleteSeasonCascade(seasonId: string): Promise<void> {
  const divisionsSnap = await db.collection('divisions').where('seasonId', '==', seasonId).get();
  const divisionIds = divisionsSnap.docs.map((d) => d.id);

  const teamIdsPerDivision = await Promise.all(
    divisionIds.map((divisionId) => db.collection('teams').where('divisionId', '==', divisionId).get()),
  );
  await assertNoConfirmedMatches(teamIdsPerDivision.flatMap((snap) => snap.docs.map((d) => d.id)));

  for (const divisionId of divisionIds) {
    await deleteDivisionCascade(divisionId);
  }
  await db.doc(`seasons/${seasonId}`).delete();
}

export const adminDeleteTeam = onCall(async (request) => {
  const { teamId } = (request.data ?? {}) as { teamId?: string };
  if (!teamId) throw new HttpsError('invalid-argument', 'teamId is required.');
  const teamSnap = await db.doc(`teams/${teamId}`).get();
  if (!teamSnap.exists) throw new HttpsError('not-found', 'Team not found.');
  await assertLeagueAdmin(request.auth?.uid, teamSnap.data()!.leagueId);
  await deleteTeamCascade(teamId);
});

export const adminDeleteDivision = onCall(async (request) => {
  const { divisionId } = (request.data ?? {}) as { divisionId?: string };
  if (!divisionId) throw new HttpsError('invalid-argument', 'divisionId is required.');
  const divisionSnap = await db.doc(`divisions/${divisionId}`).get();
  if (!divisionSnap.exists) throw new HttpsError('not-found', 'Division not found.');
  await assertLeagueAdmin(request.auth?.uid, divisionSnap.data()!.leagueId);
  await deleteDivisionCascade(divisionId);
});

export const adminDeleteSeason = onCall(async (request) => {
  const { seasonId } = (request.data ?? {}) as { seasonId?: string };
  if (!seasonId) throw new HttpsError('invalid-argument', 'seasonId is required.');
  const seasonSnap = await db.doc(`seasons/${seasonId}`).get();
  if (!seasonSnap.exists) throw new HttpsError('not-found', 'Season not found.');
  await assertLeagueAdmin(request.auth?.uid, seasonSnap.data()!.leagueId);
  await deleteSeasonCascade(seasonId);
});
