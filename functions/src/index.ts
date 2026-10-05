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

// ── Reconciliation: compare SCORE ONLY, never pairings or stats ────────────
// Own-team-only submission model: each side submits only its own players for
// its own side of every game (the opponent's side is always empty in a raw
// submission — see isValidGame's statScope handling below), so there is
// nothing to compare on pairings at all — only whether the two independently-
// reported scores for a given game agree. Score is compared by the leg WIN
// COUNT per side, not the exact leg-by-leg sequence: the app's own entry UI
// (toMatchGame in mobile/src/lib/matchResultDraft.ts) always derives that
// sequence deterministically from the score alone, so two submissions with
// the same score already have byte-identical sequences — comparing counts
// is equivalent and simpler. Stats (180s/checkouts) are never compared here
// either — each team only ever reports its own players' stats
// (isValidGamesShape enforces this server-side), so they're expected to
// differ between submissions by construction, never a real disagreement.
export function pairingsAndScoreAgree(a: MatchGame[], b: MatchGame[]): boolean {
  if (a.length !== b.length) return false;
  const bByOrder = new Map(b.map((g) => [g.order, g]));
  return a.every((ag) => {
    const bg = bByOrder.get(ag.order);
    if (!bg) return false;
    const aHomeLegs = ag.legs.filter((l) => l.winner === 'home').length;
    const bHomeLegs = bg.legs.filter((l) => l.winner === 'home').length;
    return aHomeLegs === bHomeLegs;
  });
}

// Deterministic placement into LEGS_PER_GAME slots by SORTED CONTENT, never
// by which submission it came from or what order it was entered in — the
// same principle mobile/src/lib/matchResultDraft.ts's toMatchGame already
// uses for a single submission, extended here to a MERGE of two. Leg index
// carries no meaning to any consumer of this data (see that file's own
// comment) — computePlayerAccum below only ever sums across ALL of a game's
// legs, never per-leg — so which specific slot a stat lands in is cosmetic.
function distributeOneEightiesByLeg(oneEighties: string[]): string[][] {
  const byLeg: string[][] = Array.from({ length: LEGS_PER_GAME }, () => []);
  [...oneEighties].sort().forEach((playerId, i) => {
    byLeg[i % LEGS_PER_GAME].push(playerId);
  });
  return byLeg;
}

// A leg holds at most one highCheckout, so at most LEGS_PER_GAME (3) can
// exist across a game. Two teams' own submissions are validated
// independently and can't coordinate on this, so their combined total could
// exceed 3 in a genuinely implausible case (more checkouts claimed, across
// both sides, than legs exist to have won them in) — rather than reject the
// whole reconciliation over that, the excess is dropped deterministically
// (by the same sort used for placement) so the result is still well-formed.
function distributeHighCheckouts(highCheckouts: HighCheckout[]): (HighCheckout | null)[] {
  const sorted = [...highCheckouts].sort((a, b) => (
    a.playerId === b.playerId ? a.value.localeCompare(b.value) : a.playerId.localeCompare(b.playerId)
  ));
  return Array.from({ length: LEGS_PER_GAME }, (_, i) => sorted[i] ?? null);
}

// Combines one already-score-agreed game from each side: each side's own
// PAIRING is taken from its own submission (homeGame.homePlayerIds,
// awayGame.awayPlayerIds — this is the actual own-team-only merge, since
// neither submission ever contains the opponent's pairing at all); each
// side's own-team 180s/checkouts are likewise pulled from ITS OWN submission
// only, filtered to that side's own players as a defense-in-depth re-check
// (isValidGamesShape should already have refused a submission naming the
// opponent's player, but this never trusts that alone). The leg-winner
// sequence comes from homeGame (guaranteed equivalent to awayGame's once
// scores agree — see pairingsAndScoreAgree).
function buildMergedGame(homeGame: MatchGame, awayGame: MatchGame): MatchGame {
  const homeOwn = new Set(homeGame.homePlayerIds);
  const awayOwn = new Set(awayGame.awayPlayerIds);

  const homeOneEighties = homeGame.legs.flatMap((l) => l.oneEighties).filter((id) => homeOwn.has(id));
  const awayOneEighties = awayGame.legs.flatMap((l) => l.oneEighties).filter((id) => awayOwn.has(id));
  const mergedOneEightiesByLeg = distributeOneEightiesByLeg([...homeOneEighties, ...awayOneEighties]);

  const homeCheckouts = homeGame.legs
    .map((l) => l.highCheckout)
    .filter((hc): hc is HighCheckout => hc !== null && homeOwn.has(hc.playerId));
  const awayCheckouts = awayGame.legs
    .map((l) => l.highCheckout)
    .filter((hc): hc is HighCheckout => hc !== null && awayOwn.has(hc.playerId));
  const mergedCheckouts = distributeHighCheckouts([...homeCheckouts, ...awayCheckouts]);

  return {
    order: homeGame.order,
    type: homeGame.type,
    homePlayerIds: homeGame.homePlayerIds,
    awayPlayerIds: awayGame.awayPlayerIds,
    legs: homeGame.legs.map((leg, i) => ({
      winner: leg.winner,
      oneEighties: mergedOneEightiesByLeg[i],
      highCheckout: mergedCheckouts[i] ? { playerId: mergedCheckouts[i]!.playerId, value: mergedCheckouts[i]!.value } : null,
    })),
  };
}

export function mergeSubmissionGames(homeGames: MatchGame[], awayGames: MatchGame[]): MatchGame[] {
  const awayByOrder = new Map(awayGames.map((g) => [g.order, g]));
  return [...homeGames]
    .sort((a, b) => a.order - b.order)
    .map((hg) => buildMergedGame(hg, awayByOrder.get(hg.order)!));
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

// `statScope`, when passed, means this is validating a RAW SUBMISSION from
// one team under the own-team-only model: the submitting team's own side of
// every game must carry its real pairing, and the OPPONENT's side must be
// EMPTY — a captain's submission never contains the opponent's players at
// all, by construction (the client UI never offers them; this is the
// server-side enforcement of that, not just a UX nicety). oneEighties/
// highCheckout are likewise restricted to the submitting team's own players
// only (the pre-existing "own-team stat security"). Omitted (the default)
// when validating a FINAL/MERGED games array (onMatchConfirmed/
// onMatchDeleted/adminResetMatchResult), where both sides are legitimately
// populated and either side's player is eligible for stats — that's the
// whole point of the merge.
function isValidGame(game: unknown, statScope?: { submittedByTeamId: string; matchHomeTeamId: string }): game is MatchGame {
  if (!game || typeof game !== 'object') return false;
  const g = game as Record<string, unknown>;
  if (typeof g.order !== 'number' || !Number.isInteger(g.order) || g.order < 1 || g.order > GAMES_PER_MATCH) return false;
  const expectedType: GameType = g.order > SINGLES_GAMES ? 'pairs' : 'singles';
  const expectedPlayerCount = expectedType === 'pairs' ? 2 : 1;
  if (g.type !== expectedType) return false;
  if (!Array.isArray(g.homePlayerIds) || !Array.isArray(g.awayPlayerIds)) return false;
  if (!g.homePlayerIds.every((id) => typeof id === 'string') || !g.awayPlayerIds.every((id) => typeof id === 'string')) {
    return false;
  }
  const isHomeSubmission = statScope ? statScope.submittedByTeamId === statScope.matchHomeTeamId : undefined;
  const expectedHomeCount = !statScope || isHomeSubmission ? expectedPlayerCount : 0;
  const expectedAwayCount = !statScope || !isHomeSubmission ? expectedPlayerCount : 0;
  if (g.homePlayerIds.length !== expectedHomeCount) return false;
  if (g.awayPlayerIds.length !== expectedAwayCount) return false;
  const homeIds = g.homePlayerIds as string[];
  const awayIds = g.awayPlayerIds as string[];
  if (homeIds.some((id) => awayIds.includes(id))) return false; // can't play both sides
  if (!Array.isArray(g.legs) || g.legs.length !== LEGS_PER_GAME) return false;
  const eligible = statScope
    ? new Set<string>(isHomeSubmission ? homeIds : awayIds)
    : new Set<string>([...homeIds, ...awayIds]);
  return g.legs.every((leg) => isValidLeg(leg, eligible));
}

// Structural validation only: exactly 7 well-formed games with unique order
// values covering 1..7, and every 180/checkout attributed to a player who is
// actually listed on that specific game (and, when statScope is passed, on
// the submitting team specifically). Does NOT confirm the player IDs are
// real roster members of the right team — see allPlayersLegitimate.
export function isValidGamesShape(
  games: unknown,
  statScope?: { submittedByTeamId: string; matchHomeTeamId: string },
): games is MatchGame[] {
  if (!Array.isArray(games) || games.length !== GAMES_PER_MATCH) return false;
  const seenOrders = new Set<number>();
  for (const g of games) {
    if (!isValidGame(g, statScope)) return false;
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

// `submittedByTeamId`, when passed, is a raw single-team submission being
// validated pre-reconciliation — 180s/checkouts are restricted to that
// team's own players (see isValidGamesShape). Omitted when re-validating a
// FINAL/MERGED games array, where either side's players are legitimately
// eligible for stats.
export async function isValidSubmission(
  data: unknown,
  homeTeamId: string,
  awayTeamId: string,
  submittedByTeamId?: string,
): Promise<boolean> {
  if (!data || typeof data !== 'object') return false;
  const { games } = data as { games?: unknown };
  const statScope = submittedByTeamId ? { submittedByTeamId, matchHomeTeamId: homeTeamId } : undefined;
  if (!isValidGamesShape(games, statScope)) return false;
  return allPlayersLegitimate(games, homeTeamId, awayTeamId);
}

// ── Submission comparison: reconcile when both teams' pairings AND scores
// agree, else dispute. Player statistics are never compared between
// submissions — each team is authoritative for its own players' stats — and
// are MERGED into the reconciled record instead (see mergeSubmissionGames
// above). Reaching agreement does NOT confirm the match: it moves to
// 'pending_confirmation', and onConfirmationWrite (below) is the only path
// from there to 'confirmed'.
//
// Security invariants (complementing firestore.rules, which enforces the doc
// ID == submittedByTeamId convention that makes this lookup-by-identity
// possible in the first place — see the comment there):
//  - Submissions are read by TEAM IDENTITY (doc IDs homeTeamId/awayTeamId),
//    never by array position or count — two submissions from the same team
//    can no longer be mistaken for "both sides agreed".
//  - Each submission is re-validated (structure + real player/team
//    membership + own-team-only stats) before it's allowed to count towards
//    reconciliation. An invalid submission is deleted (quarantined) rather
//    than silently skipped, so it can never combine with a later
//    resubmission and slip through, and so the submitting captain sees it
//    actually disappeared rather than being invisibly ignored.
// Exported (not just the onDocumentWritten wrapper below) so it can be
// exercised directly against a real Firestore (emulator) in tests without
// needing the Functions emulator or synthetic trigger-event construction —
// see reconciliation.test.ts. Contains the entire behavior; the wrapper adds
// nothing but the trigger binding.
export async function handleSubmissionWrite(matchId: string): Promise<void> {
  const matchRef = db.doc(`matches/${matchId}`);
  const matchSnap = await matchRef.get();
  if (!matchSnap.exists) return;
  const match = matchSnap.data()!;
  // Locked once reconciled or confirmed — firestore.rules already blocks a
  // client write to submissions in either state; this is defense in depth.
  if (match.status === 'confirmed' || match.status === 'pending_confirmation') return;

  const homeTeamId = match.homeTeamId as string;
  const awayTeamId = match.awayTeamId as string;

  const [homeSnap, awaySnap] = await Promise.all([
    matchRef.collection('submissions').doc(homeTeamId).get(),
    matchRef.collection('submissions').doc(awayTeamId).get(),
  ]);

  const [homeValid, awayValid] = await Promise.all([
    homeSnap.exists && homeSnap.data()!.submittedByTeamId === homeTeamId
      ? isValidSubmission(homeSnap.data(), homeTeamId, awayTeamId, homeTeamId)
      : Promise.resolve(false),
    awaySnap.exists && awaySnap.data()!.submittedByTeamId === awayTeamId
      ? isValidSubmission(awaySnap.data(), homeTeamId, awayTeamId, awayTeamId)
      : Promise.resolve(false),
  ]);

  const toQuarantine = [
    ...(homeSnap.exists && !homeValid ? [homeSnap.ref] : []),
    ...(awaySnap.exists && !awayValid ? [awaySnap.ref] : []),
  ];
  if (toQuarantine.length) {
    console.warn(`handleSubmissionWrite: deleting ${toQuarantine.length} invalid submission(s) for match ${matchId}`);
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
  if (!pairingsAndScoreAgree(homeData.games, awayData.games)) {
    await matchRef.update({ status: 'disputed' });
    return;
  }

  // Pairings and scores agree — merge each side's own-reported stats into
  // the reconciled record and move to pending_confirmation, NOT confirmed.
  const merged = mergeSubmissionGames(homeData.games, awayData.games);
  await matchRef.update({ status: 'pending_confirmation', games: normalizeGames(merged) });
}

// ── Submission comparison: reconcile when both teams' pairings AND scores
// agree, else dispute. Player statistics are never compared between
// submissions — each team is authoritative for its own players' stats — and
// are MERGED into the reconciled record instead (see mergeSubmissionGames
// above). Reaching agreement does NOT confirm the match: it moves to
// 'pending_confirmation', and onConfirmationWrite (below) is the only path
// from there to 'confirmed'.
//
// Security invariants (complementing firestore.rules, which enforces the doc
// ID == submittedByTeamId convention that makes this lookup-by-identity
// possible in the first place — see the comment there):
//  - Submissions are read by TEAM IDENTITY (doc IDs homeTeamId/awayTeamId),
//    never by array position or count — two submissions from the same team
//    can no longer be mistaken for "both sides agreed".
//  - Each submission is re-validated (structure + real player/team
//    membership + own-team-only stats) before it's allowed to count towards
//    reconciliation. An invalid submission is deleted (quarantined) rather
//    than silently skipped, so it can never combine with a later
//    resubmission and slip through, and so the submitting captain sees it
//    actually disappeared rather than being invisibly ignored.
export const onSubmissionWrite = onDocumentWritten(
  'matches/{matchId}/submissions/{submissionId}',
  (event) => handleSubmissionWrite(event.params.matchId),
);

// Exported for the same reason as handleSubmissionWrite above — see
// reconciliation.test.ts.
export async function handleConfirmationWrite(matchId: string): Promise<void> {
  const matchRef = db.doc(`matches/${matchId}`);
  const matchSnap = await matchRef.get();
  if (!matchSnap.exists) return;
  const match = matchSnap.data()!;
  // Only act while genuinely awaiting confirmation — a confirmation doc
  // that arrives after a dispute or a reset (or, defensively, any other
  // status) must never itself move the match forward.
  if (match.status !== 'pending_confirmation') return;

  const homeTeamId = match.homeTeamId as string;
  const awayTeamId = match.awayTeamId as string;

  const [homeSnap, awaySnap] = await Promise.all([
    matchRef.collection('confirmations').doc(homeTeamId).get(),
    matchRef.collection('confirmations').doc(awayTeamId).get(),
  ]);
  const homeConfirmed = homeSnap.exists && homeSnap.data()!.confirmedByTeamId === homeTeamId;
  const awayConfirmed = awaySnap.exists && awaySnap.data()!.confirmedByTeamId === awayTeamId;
  if (!homeConfirmed || !awayConfirmed) return;

  await matchRef.update({ status: 'confirmed', confirmedVia: 'captains' });
}

// ── Explicit two-team confirmation: a match only becomes 'confirmed' once
// BOTH teams have created their own matches/{matchId}/confirmations/{teamId}
// doc. This is the ONLY path from 'pending_confirmation' to 'confirmed' — no
// client write can set status:'confirmed' directly (matches/{matchId}'s
// update rule stays admin-only — see firestore.rules). Match.games is
// already the reconciled record (set by onSubmissionWrite above) and is left
// untouched here; this trigger only ever flips status.
export const onConfirmationWrite = onDocumentWritten(
  'matches/{matchId}/confirmations/{teamId}',
  (event) => handleConfirmationWrite(event.params.matchId),
);

// Exported for the same reason as handleSubmissionWrite above — see
// reconciliation.test.ts. Throws exactly what the onCall wrapper throws
// (HttpsError), so a test can assert on the same error codes/messages a
// real client would see.
export async function performDisputeMatch(matchId: string, uid: string | undefined): Promise<void> {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const matchRef = db.doc(`matches/${matchId}`);
  const matchSnap = await matchRef.get();
  if (!matchSnap.exists) throw new HttpsError('not-found', 'Match not found.');
  const match = matchSnap.data()!;

  const userSnap = await db.doc(`users/${uid}`).get();
  const user = userSnap.data();
  const isCaptainOrVCOfMatch = !!user
    && (user.role === 'captain' || user.role === 'viceCaptain')
    && (user.teamId === match.homeTeamId || user.teamId === match.awayTeamId);
  if (!isCaptainOrVCOfMatch) {
    throw new HttpsError('permission-denied', 'Only a captain or vice-captain of one of this match\'s two teams may dispute it.');
  }
  if (match.status !== 'pending_confirmation') {
    throw new HttpsError('failed-precondition', 'This match isn\'t awaiting confirmation.');
  }

  await matchRef.update({ status: 'disputed' });
}

// ── A captain/VC of either team disputing a reconciled-but-unconfirmed
// result (e.g. they don't recognize a merged stat, even though pairings and
// scores agreed) — the explicit alternative to Confirm the model calls for.
// A callable, not a client write, so the permission check (genuinely a
// captain/VC of ONE of this match's two teams) and the state check (only
// while pending_confirmation) are both enforced authoritatively in one
// place, without widening matches/{matchId}'s otherwise admin-only update
// rule. Any confirmation doc(s) already created are left in place — inert,
// since onConfirmationWrite only ever acts while status is still
// 'pending_confirmation', and this call has already moved it to 'disputed'.
export const disputeMatch = onCall(async (request) => {
  const { matchId } = (request.data ?? {}) as { matchId?: string };
  if (!matchId) throw new HttpsError('invalid-argument', 'matchId is required.');
  await performDisputeMatch(matchId, request.auth?.uid);
});

export function computeTotals(games: MatchGame[]) {
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

// Exported for the same reason as handleSubmissionWrite/
// handleConfirmationWrite above — direct testability against a real
// Firestore emulator without the (unavailable in this sandbox) Functions
// emulator or synthetic v2 CloudEvent construction. Pure mechanical
// extraction — zero logic change — added specifically to let the PR #39
// manual UI walkthrough verify, with the genuinely unmodified pipeline,
// that a confirmed match's games correctly reach computeTotals/
// applyMatchResultDelta (standings/playerSeasonStats). See
// reconciliation.test.ts for the automated coverage this also enables.
export async function handleMatchConfirmed(
  matchId: string,
  before: FirebaseFirestore.DocumentData,
  after: FirebaseFirestore.DocumentData,
): Promise<void> {
  if (after.status !== 'confirmed') return;

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
}

// ── On confirm (auto-confirm above, or an admin correcting an already-
// confirmed result): recompute totals, divisionTables, standings positions,
// and playerSeasonStats. ────────────────────────────────────────────────────
export const onMatchConfirmed = onDocumentUpdated('matches/{matchId}', async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after) return;
  await handleMatchConfirmed(event.params.matchId, before, after);
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
  const isGlobalAdmin = user?.isGlobalAdmin === true;
  const isScopedLeagueAdmin = user?.isLeagueAdmin === true && user?.leagueId === leagueId;
  if (!user || (!isGlobalAdmin && !isScopedLeagueAdmin)) {
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

// ── Reset a prematurely/incorrectly entered result back to scheduled ───────
// Distinct from deleting a fixture: the match document itself, its ID, its
// teams, date/venue and league/season/division references all stay exactly
// as they were — only the result/submission state is cleared, returning the
// fixture to the same shape a freshly generated one has (see
// admin-fixtures.tsx's fixture-creation code for that shape). Deliberately a
// callable (not a plain client updateDoc admin-fixtures.tsx/results-entry.tsx
// could make under firestore.rules' existing unrestricted admin update
// rule) so the derived-stats reversal below can never be skipped: a raw
// client-side status flip to 'scheduled' would leave divisionTables/
// playerSeasonStats permanently stale, since onMatchConfirmed only ever
// fires forward INTO 'confirmed', never back out of it.
// Exported for the same reason as performDisputeMatch above — direct
// testability against a real Firestore emulator without the (sandbox-
// unavailable) Functions emulator, and throws exactly what the onCall
// wrapper throws (HttpsError) so a test can assert on the same error
// codes/messages a real client would see.
export async function performAdminResetMatchResult(matchId: string, uid: string | undefined): Promise<void> {
  const matchRef = db.doc(`matches/${matchId}`);
  const matchSnap = await matchRef.get();
  if (!matchSnap.exists) throw new HttpsError('not-found', 'Match not found.');
  const match = matchSnap.data()!;
  await assertLeagueAdmin(uid, match.leagueId);

  if (match.status === 'scheduled') {
    throw new HttpsError('failed-precondition', 'This fixture has no result to reset.');
  }

  const { leagueId, seasonId, divisionId, homeTeamId, awayTeamId, scheduledDate } = match as {
    leagueId: string; seasonId: string; divisionId: string;
    homeTeamId: string; awayTeamId: string; scheduledDate: FirebaseFirestore.Timestamp;
  };

  // Reverse the confirmed result's contribution to standings/player stats
  // FIRST, using the same reversal onMatchDeleted makes — just without
  // deleting the fixture itself. A disputed or awaiting_confirmation match
  // never had games confirmed (Match.games is only ever set once confirmed),
  // so there's nothing to reverse in that case.
  if (match.status === 'confirmed') {
    const games = (match.games ?? []) as MatchGame[];
    if (games.length > 0 && (!isValidGamesShape(games) || !(await allPlayersLegitimate(games, homeTeamId, awayTeamId)))) {
      throw new HttpsError(
        'failed-precondition',
        'This match\'s confirmed result looks invalid — refusing to reset without a safe reversal.',
      );
    }
    await applyMatchResultDelta({
      matchId, leagueId, seasonId, divisionId, homeTeamId, awayTeamId,
      scheduledDate: scheduledDate.toDate(),
      oldGames: games,
      newGames: [],
      playedDelta: -1,
    });
  }

  // Clear any submitted result AND any confirmations. All deletes land in
  // one batch so onSubmissionWrite/onConfirmationWrite (which re-read both
  // docs of their respective subcollection on any write to either) always
  // observe them either both present or both already gone — never a stale
  // one paired with a since-cleared other, which could otherwise let a
  // leftover submission/confirmation wrongly combine with a later, unrelated
  // resubmission after the reset.
  const [homeSubSnap, awaySubSnap, homeConfSnap, awayConfSnap] = await Promise.all([
    matchRef.collection('submissions').doc(homeTeamId).get(),
    matchRef.collection('submissions').doc(awayTeamId).get(),
    matchRef.collection('confirmations').doc(homeTeamId).get(),
    matchRef.collection('confirmations').doc(awayTeamId).get(),
  ]);
  if (homeSubSnap.exists || awaySubSnap.exists || homeConfSnap.exists || awayConfSnap.exists) {
    const deleteBatch = db.batch();
    if (homeSubSnap.exists) deleteBatch.delete(homeSubSnap.ref);
    if (awaySubSnap.exists) deleteBatch.delete(awaySubSnap.ref);
    if (homeConfSnap.exists) deleteBatch.delete(homeConfSnap.ref);
    if (awayConfSnap.exists) deleteBatch.delete(awayConfSnap.ref);
    await deleteBatch.commit();
  }

  // Finally, return the fixture to its original unplayed shape — every
  // other field (teams, date, venue, league/season/division refs) untouched.
  await matchRef.update({
    status: 'scheduled',
    games: null,
    homeGamesWon: null,
    awayGamesWon: null,
    homeLegsWon: null,
    awayLegsWon: null,
    confirmedVia: FieldValue.delete(),
  });
}

export const adminResetMatchResult = onCall(async (request) => {
  const { matchId } = (request.data ?? {}) as { matchId?: string };
  if (!matchId) throw new HttpsError('invalid-argument', 'matchId is required.');
  await performAdminResetMatchResult(matchId, request.auth?.uid);
});
