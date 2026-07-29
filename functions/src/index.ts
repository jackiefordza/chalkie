import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onDocumentWritten, onDocumentUpdated, onDocumentDeleted, onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

initializeApp();
const db = getFirestore();

// ── Push notifications (Expo push service — no extra SDK needed, just its
// plain HTTP API). Every lookup here tolerates users with no expoPushToken
// yet (pre-EAS-setup, or simply never granted permission) by filtering them
// out rather than erroring — sending pushes is always best-effort, never
// something a core flow (confirm, submit, join-request) should fail over. ──

async function sendExpoPush(tokens: string[], title: string, body: string, data?: Record<string, unknown>): Promise<void> {
  const uniqueTokens = [...new Set(tokens)].filter((t) => typeof t === 'string' && t.startsWith('ExponentPushToken'));
  if (uniqueTokens.length === 0) return;
  const messages = uniqueTokens.map((to) => ({ to, title, body, data, sound: 'default' }));
  for (let i = 0; i < messages.length; i += 100) {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages.slice(i, i + 100)),
    });
  }
}

function tokensFromDocs(docs: FirebaseFirestore.QueryDocumentSnapshot[]): string[] {
  return docs.map((d) => d.data().expoPushToken as string | undefined).filter((t): t is string => !!t);
}

async function tokensForTeamRoles(teamId: string, roles: string[]): Promise<string[]> {
  const snap = await db.collection('users').where('teamId', '==', teamId).where('role', 'in', roles).get();
  return tokensFromDocs(snap.docs);
}

async function tokensForTeams(teamIds: string[]): Promise<string[]> {
  const snap = await db.collection('users').where('teamId', 'in', teamIds).get();
  return tokensFromDocs(snap.docs);
}

async function tokensForLeagueAdmins(leagueId: string): Promise<string[]> {
  const snap = await db.collection('users').where('leagueId', '==', leagueId).where('isLeagueAdmin', '==', true).get();
  return tokensFromDocs(snap.docs);
}

async function tokensForUser(uid: string): Promise<string[]> {
  const snap = await db.doc(`users/${uid}`).get();
  const token = snap.data()?.expoPushToken as string | undefined;
  return token ? [token] : [];
}

async function teamName(teamId: string): Promise<string> {
  const snap = await db.doc(`teams/${teamId}`).get();
  return (snap.data()?.name as string | undefined) ?? 'Their team';
}

export type MatchSide = 'home' | 'away';
export type GameType = 'singles' | 'pairs';

export interface HighCheckout {
  playerId: string;
  value: string;
}
export interface MatchLeg {
  winner: MatchSide;
  oneEighties: string[];
  highCheckout: HighCheckout | null;
}
export interface MatchGame {
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

export function normalizeGames(games: MatchGame[]) {
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

export function gamesEqual(a: MatchGame[], b: MatchGame[]): boolean {
  if (a.length !== b.length) return false;
  return JSON.stringify(normalizeGames(a)) === JSON.stringify(normalizeGames(b));
}

// ── Submission comparison: auto-confirm when both teams agree, else dispute ─
export const onSubmissionWrite = onDocumentWritten(
  'matches/{matchId}/submissions/{submissionId}',
  async (event) => {
    const matchId = event.params.matchId;
    const matchRef = db.doc(`matches/${matchId}`);
    const matchSnap = await matchRef.get();
    if (!matchSnap.exists) return;
    const match = matchSnap.data()!;
    if (match.status === 'confirmed') return; // locked once confirmed — resubmission can't reopen it

    const subsSnap = await matchRef.collection('submissions').get();
    if (subsSnap.empty) return;

    if (subsSnap.size === 1) {
      if (match.status === 'scheduled') {
        await matchRef.update({ status: 'awaiting_confirmation' });
        const submittedByTeamId = subsSnap.docs[0].data().submittedByTeamId as string;
        const otherTeamId = submittedByTeamId === match.homeTeamId ? match.awayTeamId : match.homeTeamId;
        const [submittedName, tokens] = await Promise.all([
          teamName(submittedByTeamId),
          tokensForTeamRoles(otherTeamId, ['captain', 'viceCaptain']),
        ]);
        await sendExpoPush(
          tokens,
          'Result needs confirmation',
          `${submittedName} submitted their result — check it matches yours.`,
          { type: 'awaiting_confirmation', matchId },
        );
      }
      return;
    }

    const [subA, subB] = subsSnap.docs.map((d) => d.data() as MatchSubmissionData);
    if (!gamesEqual(subA.games, subB.games)) {
      await matchRef.update({ status: 'disputed' });
      return;
    }

    // Both submissions agree — confirm using the canonical (normalized) games.
    // onMatchConfirmed picks up from here to compute totals + standings/stats.
    await matchRef.update({ status: 'confirmed', games: normalizeGames(subA.games) });
  },
);

export function computeTotals(games: MatchGame[]) {
  let homeGamesWon = 0, awayGamesWon = 0, homeLegsWon = 0, awayLegsWon = 0;
  for (const game of games) {
    let gameHomeLegs = 0, gameAwayLegs = 0;
    for (const leg of game.legs) {
      if (leg.winner === 'home') { gameHomeLegs++; homeLegsWon++; } else { gameAwayLegs++; awayLegsWon++; }
    }
    if (gameHomeLegs > gameAwayLegs) homeGamesWon++; else awayGamesWon++;
  }
  return { homeGamesWon, awayGamesWon, homeLegsWon, awayLegsWon };
}

export interface HighCheckoutEntry { value: string; matchId: string; date: Date }
export interface PlayerAccum {
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
export function computePlayerAccum(
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

// Standings alphabetical tiebreak (e.g. two teams both on 0 played) ignores a
// leading "The" per common league convention — "The Anchor" sorts under A,
// not T.
export function sortableTeamName(name: string): string {
  return name.replace(/^the\s+/i, '').trim();
}

async function recomputeDivisionPositions(seasonId: string, divisionId: string): Promise<void> {
  const divisionRows = await db.collection('divisionTables')
    .where('seasonId', '==', seasonId)
    .where('divisionId', '==', divisionId)
    .get();
  const rows = await Promise.all(divisionRows.docs.map(async (d) => {
    const data = d.data();
    const teamSnap = await db.collection('teams').doc(data.teamId as string).get();
    return {
      ref: d.ref,
      points: data.points ?? 0,
      legDiff: data.legDiff ?? 0,
      teamName: (teamSnap.data()?.name ?? '') as string,
    };
  }));
  const sorted = rows.sort((a, b) => (
    (b.points - a.points)
    || (b.legDiff - a.legDiff)
    || sortableTeamName(a.teamName).localeCompare(sortableTeamName(b.teamName))
  ));
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
// 2 points for a win, 0 for a loss (see PLAN.md "Match format") — null (not
// false) when there are no games at all, since a false here would wrongly
// credit the away side with a "win" contribution against zero games played.
export function computeMatchContribution(homeWon: boolean | null) {
  return homeWon === null
    ? { homePoints: 0, homeWon: 0, homeLost: 0, awayPoints: 0, awayWon: 0, awayLost: 0 }
    : {
      homePoints: homeWon ? 2 : 0, homeWon: homeWon ? 1 : 0, homeLost: homeWon ? 0 : 1,
      awayPoints: homeWon ? 0 : 2, awayWon: homeWon ? 0 : 1, awayLost: homeWon ? 1 : 0,
    };
}

async function applyMatchResultDelta(p: ResultDeltaParams): Promise<void> {
  const oldTotals = computeTotals(p.oldGames);
  const newTotals = computeTotals(p.newGames);
  const oldHomeWon = p.oldGames.length ? oldTotals.homeGamesWon > oldTotals.awayGamesWon : null;
  const newHomeWon = p.newGames.length ? newTotals.homeGamesWon > newTotals.awayGamesWon : null;

  const oldContrib = computeMatchContribution(oldHomeWon);
  const newContrib = computeMatchContribution(newHomeWon);

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

  // Only treat before.games as a real prior result if the match was already
  // confirmed — otherwise (first confirmation) there's nothing to reverse.
  const beforeGames = (before.status === 'confirmed' ? (before.games ?? []) : []) as MatchGame[];
  const afterGames = (after.games ?? []) as MatchGame[];
  if (JSON.stringify(beforeGames) === JSON.stringify(afterGames)) return; // no actual result change (e.g. venue/date edit)

  const matchId = event.params.matchId;
  const { leagueId, seasonId, divisionId, homeTeamId, awayTeamId, scheduledDate } = after as {
    leagueId: string; seasonId: string; divisionId: string;
    homeTeamId: string; awayTeamId: string; scheduledDate: FirebaseFirestore.Timestamp;
  };

  await db.doc(`matches/${matchId}`).update(computeTotals(afterGames));

  const isFirstConfirmation = before.status !== 'confirmed';

  await applyMatchResultDelta({
    matchId, leagueId, seasonId, divisionId, homeTeamId, awayTeamId,
    scheduledDate: scheduledDate.toDate(),
    oldGames: beforeGames,
    newGames: afterGames,
    playedDelta: isFirstConfirmation ? 1 : 0,
  });

  if (isFirstConfirmation) {
    const [homeName, awayName, tokens] = await Promise.all([
      teamName(homeTeamId),
      teamName(awayTeamId),
      tokensForTeams([homeTeamId, awayTeamId]),
    ]);
    await sendExpoPush(
      tokens,
      'Result confirmed',
      `${homeName} vs ${awayName} is confirmed — check the standings.`,
      { type: 'match_confirmed', matchId },
    );
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

  await applyMatchResultDelta({
    matchId, leagueId, seasonId, divisionId, homeTeamId, awayTeamId,
    scheduledDate: scheduledDate.toDate(),
    oldGames: games,
    newGames: [],
    playedDelta: -1,
  });
});

// ── Fixture reminder: every day, push anyone on a team playing a scheduled
// match tomorrow. Runs once daily rather than per-match so it's one simple
// query instead of N per-match scheduled triggers. ─────────────────────────
export const sendFixtureReminders = onSchedule(
  { schedule: 'every day 09:00', timeZone: 'Europe/London' },
  async () => {
    const tomorrowStart = new Date();
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    tomorrowStart.setHours(0, 0, 0, 0);
    const tomorrowEnd = new Date(tomorrowStart);
    tomorrowEnd.setHours(23, 59, 59, 999);

    const matchesSnap = await db.collection('matches')
      .where('status', '==', 'scheduled')
      .where('scheduledDate', '>=', Timestamp.fromDate(tomorrowStart))
      .where('scheduledDate', '<=', Timestamp.fromDate(tomorrowEnd))
      .get();

    for (const matchDoc of matchesSnap.docs) {
      const match = matchDoc.data();
      const [homeName, awayName, tokens] = await Promise.all([
        teamName(match.homeTeamId),
        teamName(match.awayTeamId),
        tokensForTeams([match.homeTeamId, match.awayTeamId]),
      ]);
      await sendExpoPush(
        tokens,
        'Fixture tomorrow',
        `${homeName} vs ${awayName} is tomorrow${match.venue ? ` at ${match.venue}` : ''}.`,
        { type: 'fixture_reminder', matchId: matchDoc.id },
      );
    }
  },
);

// ── Approval alerts: notify whoever needs to act on a new join/claim/
// captain-role request — reuses the existing approval flows, just adds a
// push on top of the in-app inbox that already exists. ─────────────────────
export const onJoinRequestCreated = onDocumentCreated('joinRequests/{requestId}', async (event) => {
  const request = event.data?.data();
  if (!request) return;

  let tokens: string[];
  let title: string;
  let body: string;

  if (request.requestType === 'captainRole') {
    if (request.requestedRole === 'captain') {
      tokens = await tokensForLeagueAdmins(request.leagueId);
    } else {
      const teamSnap = await db.doc(`teams/${request.teamId}`).get();
      const captainUserId = teamSnap.data()?.captainUserId as string | undefined;
      tokens = captainUserId ? await tokensForUser(captainUserId) : await tokensForLeagueAdmins(request.leagueId);
    }
    title = request.requestedRole === 'captain' ? 'Captain request' : 'Vice Captain request';
    body = `${request.displayName} wants to be ${request.requestedRole === 'captain' ? 'captain' : 'vice captain'} of ${request.teamName}.`;
  } else {
    tokens = await tokensForTeamRoles(request.teamId, ['captain', 'viceCaptain']);
    title = request.requestType === 'claim' ? 'Claim request' : 'Join request';
    body = request.requestType === 'claim'
      ? `${request.displayName} says they're already on your roster for ${request.teamName}.`
      : `${request.displayName} wants to join ${request.teamName}.`;
  }

  await sendExpoPush(tokens, title, body, { type: 'join_request', requestId: event.params.requestId });
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

async function hasAnyMatch(teamId: string): Promise<boolean> {
  const [homeSnap, awaySnap] = await Promise.all([
    db.collection('matches').where('homeTeamId', '==', teamId).limit(1).get(),
    db.collection('matches').where('awayTeamId', '==', teamId).limit(1).get(),
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

// Moves a team to a different division within the *same season* (rejects
// cross-season moves — a team's seasonId and its division's seasonId must
// stay in sync). Blocked while the team has any match at all, not just
// confirmed ones — even an unplayed 'scheduled' fixture was generated as
// part of the old division's round-robin against the old division's teams,
// so it'd be nonsensical once the team belongs to a different division.
// Denormalizes the same divisionId onto every player on the team, since
// players.divisionId is what several list queries filter on.
export const adminMoveTeamDivision = onCall(async (request) => {
  const { teamId, divisionId } = (request.data ?? {}) as { teamId?: string; divisionId?: string };
  if (!teamId || !divisionId) throw new HttpsError('invalid-argument', 'teamId and divisionId are required.');

  const teamSnap = await db.doc(`teams/${teamId}`).get();
  if (!teamSnap.exists) throw new HttpsError('not-found', 'Team not found.');
  const team = teamSnap.data()!;
  await assertLeagueAdmin(request.auth?.uid, team.leagueId);

  if (divisionId === team.divisionId) return;

  const divisionSnap = await db.doc(`divisions/${divisionId}`).get();
  if (!divisionSnap.exists) throw new HttpsError('not-found', 'Division not found.');
  const division = divisionSnap.data()!;
  if (division.leagueId !== team.leagueId || division.seasonId !== team.seasonId) {
    throw new HttpsError('failed-precondition', "That division isn't in this team's season.");
  }

  if (await hasAnyMatch(teamId)) {
    throw new HttpsError(
      'failed-precondition',
      'This team already has fixtures in its current division — delete those fixtures first, then move it.',
    );
  }

  const playersSnap = await db.collection('players').where('teamId', '==', teamId).get();
  const batch = db.batch();
  batch.update(teamSnap.ref, { divisionId });
  playersSnap.docs.forEach((d) => batch.update(d.ref, { divisionId }));
  await batch.commit();
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

// One-time migration for leagues created before the Venue entity existed:
// their teams still carry the old free-text `address`/`venuePhone` fields
// directly in Firestore (the field itself was never deleted, just dropped
// from the app's Team type/writes going forward — see PLAN.md). Groups teams
// by exact address string, creates one Venue per distinct address
// (boardCount defaults to 1 — admin corrects this afterward via the Venues
// screen, since board counts can't be inferred from an address), and
// re-points each team's venueId. Idempotent: skips any team that already has
// a venueId (already migrated, or created after Venue existed).
export const adminMigrateVenues = onCall(async (request) => {
  const { leagueId } = (request.data ?? {}) as { leagueId?: string };
  if (!leagueId) throw new HttpsError('invalid-argument', 'leagueId is required.');
  await assertLeagueAdmin(request.auth?.uid, leagueId);

  const teamsSnap = await db.collection('teams').where('leagueId', '==', leagueId).get();
  const venueIdByAddress = new Map<string, string>();
  let migratedTeams = 0;
  let createdVenues = 0;

  const batch = db.batch();
  for (const teamDoc of teamsSnap.docs) {
    const data = teamDoc.data() as { venueId?: string | null; address?: string | null; venuePhone?: string | null };
    if (data.venueId) continue;
    const address = (data.address ?? '').trim();
    if (!address) continue;

    let venueId = venueIdByAddress.get(address);
    if (!venueId) {
      const venueRef = db.collection('venues').doc();
      batch.set(venueRef, {
        leagueId,
        name: address,
        address,
        venuePhone: data.venuePhone ?? null,
        boardCount: 1,
        createdAt: FieldValue.serverTimestamp(),
      });
      venueId = venueRef.id;
      venueIdByAddress.set(address, venueId);
      createdVenues += 1;
    }
    batch.update(teamDoc.ref, { venueId });
    migratedTeams += 1;
  }
  await batch.commit();

  return { createdVenues, migratedTeams };
});

// Unlike team/division/season, a venue is referenced by many teams rather
// than owned by one — deleting it out from under them would silently drop
// their home-venue assignment, so this blocks instead of cascading. Admin
// must re-point every referencing team at a different venue first.
export const adminDeleteVenue = onCall(async (request) => {
  const { venueId } = (request.data ?? {}) as { venueId?: string };
  if (!venueId) throw new HttpsError('invalid-argument', 'venueId is required.');
  const venueSnap = await db.doc(`venues/${venueId}`).get();
  if (!venueSnap.exists) throw new HttpsError('not-found', 'Venue not found.');
  await assertLeagueAdmin(request.auth?.uid, venueSnap.data()!.leagueId);

  const referencingTeams = await db.collection('teams').where('venueId', '==', venueId).limit(1).get();
  if (!referencingTeams.empty) {
    throw new HttpsError(
      'failed-precondition',
      'One or more teams still play out of this venue — re-assign them to a different venue first.',
    );
  }
  await db.doc(`venues/${venueId}`).delete();
});
