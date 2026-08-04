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

// ── Team Knockout Cup ────────────────────────────────────────────────────
// Single-elimination, cross-division draw. A cup tie is deliberately its own
// collection (cupTies), not folded into matches — same MatchGame/leg shape
// and the exact same submission-comparison/confirm pattern (see
// onCupTieSubmissionWrite/onCupTieConfirmed below, mirroring onSubmissionWrite/
// onMatchConfirmed), but a tie's confirmation only ever advances the bracket,
// never touches divisionTables/playerSeasonStats — a cup draw spans multiple
// divisions, so crediting it toward any one division's table would be wrong.

export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

export function cupRoundName(teamsInRound: number): string {
  if (teamsInRound === 2) return 'Final';
  if (teamsInRound === 4) return 'Semi-Final';
  if (teamsInRound === 8) return 'Quarter-Final';
  return `Round of ${teamsInRound}`;
}

export interface BracketTie {
  homeTeamId: string | null;
  awayTeamId: string | null;
  winnerTeamId: string | null; // set only for a bye — resolved with no games played
  isBye: boolean;
  nextTieIndex: number | null; // index into the following round's ties array
  nextTieSlot: MatchSide | null;
}
export interface BracketRound {
  round: number;
  name: string;
  ties: BracketTie[];
}

// Pure — no Firestore calls, so it's independently testable. `shuffled` is
// the already-randomized draw order (the caller shuffles; this function just
// arranges byes/pairings/advancement from whatever order it's given, so a
// test can pass a fixed order for a deterministic result). Byes go to the
// first `byeCount` teams in the shuffled order and are resolved immediately,
// with their "win" propagated straight into the following round's slot —
// including cascading into a round where *both* slots of a tie are filled
// purely by two byes (a real, fair scenario once byeCount exceeds a quarter
// of the bracket: those two teams simply play each other one round later
// than everyone else, not a "double bye").
export function buildCupBracket(shuffled: string[]): BracketRound[] {
  const n = shuffled.length;
  const bracketSize = nextPowerOfTwo(n);
  const byeCount = bracketSize - n;
  const totalRounds = Math.log2(bracketSize);

  const round1Ties: BracketTie[] = [];
  let cursor = 0;
  for (let i = 0; i < byeCount; i++) {
    const teamId = shuffled[cursor];
    cursor += 1;
    round1Ties.push({
      homeTeamId: teamId, awayTeamId: null, winnerTeamId: teamId, isBye: true, nextTieIndex: null, nextTieSlot: null,
    });
  }
  while (cursor < n) {
    const a = shuffled[cursor];
    const b = shuffled[cursor + 1];
    cursor += 2;
    round1Ties.push({
      homeTeamId: a, awayTeamId: b, winnerTeamId: null, isBye: false, nextTieIndex: null, nextTieSlot: null,
    });
  }

  const rounds: BracketRound[] = [
    { round: 1, name: cupRoundName(round1Ties.length * 2), ties: round1Ties },
  ];

  let prevTies = round1Ties;
  for (let r = 2; r <= totalRounds; r++) {
    const ties: BracketTie[] = Array.from({ length: prevTies.length / 2 }, () => ({
      homeTeamId: null, awayTeamId: null, winnerTeamId: null, isBye: false, nextTieIndex: null, nextTieSlot: null,
    }));
    prevTies.forEach((tie, i) => {
      tie.nextTieIndex = Math.floor(i / 2);
      tie.nextTieSlot = i % 2 === 0 ? 'home' : 'away';
      if (tie.winnerTeamId) {
        const target = ties[tie.nextTieIndex];
        if (tie.nextTieSlot === 'home') target.homeTeamId = tie.winnerTeamId; else target.awayTeamId = tie.winnerTeamId;
      }
    });
    rounds.push({ round: r, name: cupRoundName(ties.length * 2), ties });
    prevTies = ties;
  }

  return rounds;
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function addDaysUtc(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// Draws and creates the entire bracket in one go, including placeholder
// ties for every future round (wired via nextTieId/nextTieSlot) — later
// rounds' dates are already fully determined by team count + interval, only
// which *teams* land in them is unknown until earlier rounds are played.
export const adminCreateCup = onCall(async (request) => {
  const { leagueId, seasonId, name, teamIds, startDate, intervalDays } = (request.data ?? {}) as {
    leagueId?: string; seasonId?: string; name?: string; teamIds?: string[]; startDate?: string; intervalDays?: number;
  };
  if (!leagueId || !seasonId || !name || !teamIds || teamIds.length < 2 || !startDate || !intervalDays) {
    throw new HttpsError('invalid-argument', 'leagueId, seasonId, name, at least 2 teamIds, startDate, and intervalDays are required.');
  }
  await assertLeagueAdmin(request.auth?.uid, leagueId);

  const plan = buildCupBracket(shuffleArray(teamIds));

  const teamDocs = await db.getAll(...teamIds.map((id) => db.doc(`teams/${id}`)));
  const teamNameById = new Map(teamDocs.map((d) => [d.id, (d.data()?.name as string | undefined) ?? 'Unknown']));

  const cupRef = db.collection('cups').doc();
  const start = new Date(startDate);
  const roundRefs = plan.map(() => db.collection('cupRounds').doc());
  const tieRefsByRound = plan.map((round) => round.ties.map(() => db.collection('cupTies').doc()));

  const batch = db.batch();
  batch.set(cupRef, {
    leagueId, seasonId, name, teamIds, status: 'active', winnerTeamId: null, createdAt: FieldValue.serverTimestamp(),
  });

  plan.forEach((round, roundIdx) => {
    const roundDate = Timestamp.fromDate(addDaysUtc(start, intervalDays * roundIdx));
    batch.set(roundRefs[roundIdx], {
      leagueId, cupId: cupRef.id, name: round.name, order: round.round,
      scheduledDate: roundDate, createdAt: FieldValue.serverTimestamp(),
    });

    round.ties.forEach((tie, tieIdx) => {
      const nextTieRef = tie.nextTieIndex != null ? tieRefsByRound[roundIdx + 1][tie.nextTieIndex] : null;
      const status: string = tie.isBye ? 'bye' : (tie.homeTeamId && tie.awayTeamId) ? 'scheduled' : 'pending';
      batch.set(tieRefsByRound[roundIdx][tieIdx], {
        leagueId, cupId: cupRef.id, cupRoundId: roundRefs[roundIdx].id, round: round.round,
        homeTeamId: tie.homeTeamId, awayTeamId: tie.awayTeamId, winnerTeamId: tie.winnerTeamId,
        scheduledDate: roundDate,
        venue: tie.homeTeamId ? teamNameById.get(tie.homeTeamId) ?? null : null,
        status,
        homeGamesWon: null, awayGamesWon: null, homeLegsWon: null, awayLegsWon: null, games: null,
        nextTieId: nextTieRef ? nextTieRef.id : null,
        nextTieSlot: tie.nextTieSlot,
        createdAt: FieldValue.serverTimestamp(),
      });
    });
  });

  await batch.commit();
  return { cupId: cupRef.id };
});

// ── Cup submission comparison — identical logic to onSubmissionWrite above,
// scoped to cupTies/{tieId}/submissions instead of matches/{id}/submissions.
export const onCupTieSubmissionWrite = onDocumentWritten(
  'cupTies/{tieId}/submissions/{submissionId}',
  async (event) => {
    const tieId = event.params.tieId;
    const tieRef = db.doc(`cupTies/${tieId}`);
    const tieSnap = await tieRef.get();
    if (!tieSnap.exists) return;
    const tie = tieSnap.data()!;
    if (tie.status === 'confirmed') return;

    const subsSnap = await tieRef.collection('submissions').get();
    if (subsSnap.empty) return;

    if (subsSnap.size === 1) {
      if (tie.status === 'scheduled') {
        await tieRef.update({ status: 'awaiting_confirmation' });
        const submittedByTeamId = subsSnap.docs[0].data().submittedByTeamId as string;
        const otherTeamId = submittedByTeamId === tie.homeTeamId ? tie.awayTeamId : tie.homeTeamId;
        const [submittedName, tokens] = await Promise.all([
          teamName(submittedByTeamId),
          tokensForTeamRoles(otherTeamId, ['captain', 'viceCaptain']),
        ]);
        await sendExpoPush(
          tokens,
          'Cup result needs confirmation',
          `${submittedName} submitted their cup result — check it matches yours.`,
          { type: 'cup_awaiting_confirmation', cupTieId: tieId },
        );
      }
      return;
    }

    const [subA, subB] = subsSnap.docs.map((d) => d.data() as MatchSubmissionData);
    if (!gamesEqual(subA.games, subB.games)) {
      await tieRef.update({ status: 'disputed' });
      return;
    }

    await tieRef.update({ status: 'confirmed', games: normalizeGames(subA.games) });
  },
);

// Fills the next round's slot with this tie's winner (in a transaction, since
// two ties can confirm around the same time and both feed the same next
// tie) — or, if there's no next tie at all, this was the Final: marks the
// cup itself completed.
async function advanceCupTieWinner(
  cupId: string, nextTieId: string | null, nextTieSlot: MatchSide | null, winnerTeamId: string,
): Promise<void> {
  if (!nextTieId || !nextTieSlot) {
    await db.doc(`cups/${cupId}`).update({ status: 'completed', winnerTeamId });
    return;
  }
  const winnerName = await teamName(winnerTeamId);
  const nextTieRef = db.doc(`cupTies/${nextTieId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(nextTieRef);
    if (!snap.exists) return;
    const data = snap.data()!;
    const field = nextTieSlot === 'home' ? 'homeTeamId' : 'awayTeamId';
    const otherField = nextTieSlot === 'home' ? 'awayTeamId' : 'homeTeamId';
    const update: Record<string, unknown> = { [field]: winnerTeamId };
    if (data[otherField]) update.status = 'scheduled';
    if (nextTieSlot === 'home') update.venue = winnerName;
    tx.update(nextTieRef, update);
  });
}

// ── On a cup tie confirming (or an admin correcting an already-confirmed
// one's games — same trigger condition onMatchConfirmed uses, not gated to
// a first-confirmation-only transition): compute the winner and advance the
// bracket. No divisionTables/playerSeasonStats write at all — see the
// section header above for why.
// **Known limitation, deliberately out of scope for this pass**: if the
// *next* round's tie has itself already been played by the time a
// correction changes who won here, this only overwrites that tie's
// home/awayTeamId slot — it doesn't cascade-reverse anything further down
// the bracket. Reversing an entire sub-bracket is a meaningfully harder
// problem than the delta-based divisionTables correction above (a
// knockout tree has no equivalent simple delta), and correcting a result
// after the round it feeds has already been played is expected to be rare
// enough in practice not to need that machinery yet.
export const onCupTieConfirmed = onDocumentUpdated('cupTies/{tieId}', async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after) return;
  if (after.status !== 'confirmed') return;

  const beforeGames = (before.status === 'confirmed' ? (before.games ?? []) : []) as MatchGame[];
  const afterGames = (after.games ?? []) as MatchGame[];
  if (JSON.stringify(beforeGames) === JSON.stringify(afterGames)) return; // no actual result change

  const tieId = event.params.tieId;
  const totals = computeTotals(afterGames);
  const winnerTeamId = (totals.homeGamesWon > totals.awayGamesWon ? after.homeTeamId : after.awayTeamId) as string;

  await db.doc(`cupTies/${tieId}`).update({ ...totals, winnerTeamId });

  const isFirstConfirmation = before.status !== 'confirmed';
  if (isFirstConfirmation) {
    const [homeName, awayName, tokens] = await Promise.all([
      teamName(after.homeTeamId), teamName(after.awayTeamId), tokensForTeams([after.homeTeamId, after.awayTeamId]),
    ]);
    await sendExpoPush(
      tokens, 'Cup result confirmed', `${homeName} vs ${awayName} is confirmed.`,
      { type: 'cup_match_confirmed', cupTieId: tieId },
    );
  }

  await advanceCupTieWinner(
    after.cupId as string, (after.nextTieId ?? null) as string | null, (after.nextTieSlot ?? null) as MatchSide | null, winnerTeamId,
  );
});

// Blocked while any tie has a confirmed result — same conservative
// reasoning as deleteTeamCascade above (no bulk-reversal support here).
export const adminDeleteCup = onCall(async (request) => {
  const { cupId } = (request.data ?? {}) as { cupId?: string };
  if (!cupId) throw new HttpsError('invalid-argument', 'cupId is required.');
  const cupSnap = await db.doc(`cups/${cupId}`).get();
  if (!cupSnap.exists) throw new HttpsError('not-found', 'Cup not found.');
  await assertLeagueAdmin(request.auth?.uid, cupSnap.data()!.leagueId);

  const tiesSnap = await db.collection('cupTies').where('cupId', '==', cupId).get();
  if (tiesSnap.docs.some((d) => d.data().status === 'confirmed')) {
    throw new HttpsError(
      'failed-precondition',
      "This cup has confirmed results — delete isn't supported while that history exists.",
    );
  }

  const roundsSnap = await db.collection('cupRounds').where('cupId', '==', cupId).get();

  const batch = db.batch();
  for (const tieDoc of tiesSnap.docs) {
    const subsSnap = await tieDoc.ref.collection('submissions').get();
    subsSnap.docs.forEach((s) => batch.delete(s.ref));
    batch.delete(tieDoc.ref);
  }
  roundsSnap.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(db.doc(`cups/${cupId}`));
  await batch.commit();
});

// ── Singles Knockout ─────────────────────────────────────────────────────
// Individual-player single-elimination bracket, played through in one
// sitting on one night (the real league's own printed schedule lists a
// single date for this, unlike the Team K.O.'s separate date per round) —
// so unlike cupTies there's no per-round scheduledDate and no submissions
// subcollection at all. The admin/organiser running the night writes each
// tie's raw leg-by-leg result directly (see onSinglesTieConfirmed below,
// which — same principle as computeTotals elsewhere in this file — never
// trusts a client-supplied winner/legsWon, always recomputes it from the
// raw legs). Reuses buildCupBracket unchanged: it only ever operated on a
// generic string[] of entrant ids, so a player id works exactly like a team
// id did for the Team Cup — same bye/pairing/advancement logic, no
// duplication needed.
//
// Registration is a separate phase from the draw: a competition is created
// in 'registration' status with no players yet, players self-register (or
// an admin adds them) into singlesRegistrations, then the admin builds the
// draw from whoever's registered, which is when playerIds/ties/boards all
// get created. This mirrors how the club's own tournament-tracker tool
// (a lighter, single-room-PIN app used to run the board rotation and
// projector display at real events) already works, minus the payment step
// — paymentStatus/paymentMethod are tracked on each registration but
// nothing charges them yet, so a real payment provider can slot in later
// without a schema change.

async function tokensForPlayerIds(playerIds: string[]): Promise<string[]> {
  const snaps = await Promise.all(playerIds.map((id) => db.doc(`players/${id}`).get()));
  const uids = snaps.map((s) => s.data()?.claimedByUserId as string | undefined).filter((u): u is string => !!u);
  const tokenLists = await Promise.all(uids.map((uid) => tokensForUser(uid)));
  return tokenLists.flat();
}

export interface AssignableSinglesTie {
  id: string;
  drawOrder: number;
}
export interface SinglesBoardAssignment {
  tieId: string;
  boardId: number;
}
// Greedy FIFO queue: the earliest-drawn ready tie (by drawOrder) takes the
// lowest-index free board, repeated until either the ready-ties list or the
// free-boards list runs out. Pure and independently testable, same
// board-rotation behaviour as the reference tournament tracker this was
// modelled on.
export function assignFreeBoards(
  boards: (string | null)[], readyTies: AssignableSinglesTie[],
): { boards: (string | null)[]; assignments: SinglesBoardAssignment[] } {
  const newBoards = [...boards];
  const sorted = [...readyTies].sort((a, b) => a.drawOrder - b.drawOrder);
  const assignments: SinglesBoardAssignment[] = [];
  for (const tie of sorted) {
    const freeIndex = newBoards.indexOf(null);
    if (freeIndex === -1) break;
    newBoards[freeIndex] = tie.id;
    assignments.push({ tieId: tie.id, boardId: freeIndex });
  }
  return { boards: newBoards, assignments };
}

async function notifySinglesBoardAssignments(
  assignments: SinglesBoardAssignment[],
  tiesById: Map<string, { homePlayerId: string; awayPlayerId: string }>,
  boardNames: (string | null)[],
): Promise<void> {
  await Promise.all(assignments.map(async ({ tieId, boardId }) => {
    const tie = tiesById.get(tieId);
    if (!tie) return;
    const tokens = await tokensForPlayerIds([tie.homePlayerId, tie.awayPlayerId]);
    const boardLabel = boardNames[boardId] || `Board ${boardId + 1}`;
    await sendExpoPush(tokens, "You're up!", `Head to ${boardLabel} — your match is starting.`, { type: 'singles_board_assigned', tieId });
  }));
}

export const adminCreateSinglesCompetition = onCall(async (request) => {
  const { leagueId, seasonId, name, eventDate, entryFeeCents } = (request.data ?? {}) as {
    leagueId?: string; seasonId?: string; name?: string; eventDate?: string; entryFeeCents?: number | null;
  };
  if (!leagueId || !seasonId || !name || !eventDate) {
    throw new HttpsError('invalid-argument', 'leagueId, seasonId, name, and eventDate are required.');
  }
  await assertLeagueAdmin(request.auth?.uid, leagueId);

  const compRef = db.collection('singlesCompetitions').doc();
  await compRef.set({
    leagueId, seasonId, name, eventDate: Timestamp.fromDate(new Date(eventDate)),
    playerIds: [], status: 'registration', winnerPlayerId: null,
    entryFeeCents: entryFeeCents ?? null, boardCount: 0, boardNames: [], boards: [],
    createdAt: FieldValue.serverTimestamp(),
  });
  return { competitionId: compRef.id };
});

async function assertSinglesRegistrationOpen(competitionId: string): Promise<FirebaseFirestore.DocumentData> {
  const compSnap = await db.doc(`singlesCompetitions/${competitionId}`).get();
  if (!compSnap.exists) throw new HttpsError('not-found', 'Competition not found.');
  const comp = compSnap.data()!;
  if (comp.status !== 'registration') {
    throw new HttpsError('failed-precondition', 'Registration is closed for this competition.');
  }
  return comp;
}

// Self-service — the caller registers themselves, not an arbitrary player,
// so this resolves their own claimed Player from their uid rather than
// trusting a client-supplied playerId. Eligibility mirrors the admin's own
// manual-add list: must have actually played a league game this season
// (playerSeasonStats.played > 0), not just be on a roster.
export const registerForSinglesCompetition = onCall(async (request) => {
  const { competitionId } = (request.data ?? {}) as { competitionId?: string };
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  if (!competitionId) throw new HttpsError('invalid-argument', 'competitionId is required.');

  const comp = await assertSinglesRegistrationOpen(competitionId);

  const userSnap = await db.doc(`users/${uid}`).get();
  const user = userSnap.data();
  if (!user || user.leagueId !== comp.leagueId) {
    throw new HttpsError('permission-denied', "You're not a member of this league.");
  }

  const playerSnap = await db.collection('players')
    .where('leagueId', '==', comp.leagueId).where('claimedByUserId', '==', uid).limit(1).get();
  if (playerSnap.empty) {
    throw new HttpsError('failed-precondition', 'No player profile found for your account in this league.');
  }
  const playerDoc = playerSnap.docs[0];
  const playerId = playerDoc.id;

  const statsSnap = await db.collection('playerSeasonStats')
    .where('seasonId', '==', comp.seasonId).where('playerId', '==', playerId).limit(1).get();
  const played = statsSnap.empty ? 0 : (statsSnap.docs[0].data().played ?? 0);
  if (played <= 0) {
    throw new HttpsError('failed-precondition', 'You need to have played a league game this season to enter.');
  }

  const existingSnap = await db.collection('singlesRegistrations')
    .where('competitionId', '==', competitionId).where('playerId', '==', playerId).limit(1).get();
  if (!existingSnap.empty) {
    throw new HttpsError('already-exists', "You're already registered for this competition.");
  }

  const regRef = db.collection('singlesRegistrations').doc();
  await regRef.set({
    leagueId: comp.leagueId, competitionId, playerId, playerName: playerDoc.data().name,
    addedBy: 'self', registeredByUserId: uid,
    paymentStatus: 'unpaid', paymentMethod: null,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { registrationId: regRef.id };
});

export const adminAddSinglesRegistration = onCall(async (request) => {
  const { competitionId, playerId } = (request.data ?? {}) as { competitionId?: string; playerId?: string };
  if (!competitionId || !playerId) throw new HttpsError('invalid-argument', 'competitionId and playerId are required.');

  const compSnap = await db.doc(`singlesCompetitions/${competitionId}`).get();
  if (!compSnap.exists) throw new HttpsError('not-found', 'Competition not found.');
  const comp = compSnap.data()!;
  await assertLeagueAdmin(request.auth?.uid, comp.leagueId);
  if (comp.status !== 'registration') {
    throw new HttpsError('failed-precondition', 'Registration is closed for this competition.');
  }

  const playerSnap = await db.doc(`players/${playerId}`).get();
  if (!playerSnap.exists || playerSnap.data()!.leagueId !== comp.leagueId) {
    throw new HttpsError('not-found', 'Player not found in this league.');
  }

  const existingSnap = await db.collection('singlesRegistrations')
    .where('competitionId', '==', competitionId).where('playerId', '==', playerId).limit(1).get();
  if (!existingSnap.empty) {
    throw new HttpsError('already-exists', 'That player is already registered.');
  }

  const regRef = db.collection('singlesRegistrations').doc();
  await regRef.set({
    leagueId: comp.leagueId, competitionId, playerId, playerName: playerSnap.data()!.name,
    addedBy: 'admin', registeredByUserId: null,
    paymentStatus: 'unpaid', paymentMethod: null,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { registrationId: regRef.id };
});

export const adminRemoveSinglesRegistration = onCall(async (request) => {
  const { registrationId } = (request.data ?? {}) as { registrationId?: string };
  if (!registrationId) throw new HttpsError('invalid-argument', 'registrationId is required.');
  const regSnap = await db.doc(`singlesRegistrations/${registrationId}`).get();
  if (!regSnap.exists) throw new HttpsError('not-found', 'Registration not found.');
  const reg = regSnap.data()!;
  await assertLeagueAdmin(request.auth?.uid, reg.leagueId);

  const compSnap = await db.doc(`singlesCompetitions/${reg.competitionId}`).get();
  if (compSnap.exists && compSnap.data()!.status !== 'registration') {
    throw new HttpsError('failed-precondition', "Can't remove a registration once the draw has been built.");
  }
  await regSnap.ref.delete();
});

// The only mutation here is the payment status/method itself — deliberately
// its own callable (rather than a generic client updateDoc) so a future
// Stripe webhook handler has one obvious place to call into instead of a
// second, parallel write path.
export const adminSetSinglesRegistrationPayment = onCall(async (request) => {
  const { registrationId, paymentStatus, paymentMethod } = (request.data ?? {}) as {
    registrationId?: string; paymentStatus?: string; paymentMethod?: string | null;
  };
  if (!registrationId || !paymentStatus) {
    throw new HttpsError('invalid-argument', 'registrationId and paymentStatus are required.');
  }
  if (!['unpaid', 'paid', 'waived'].includes(paymentStatus)) {
    throw new HttpsError('invalid-argument', 'paymentStatus must be unpaid, paid, or waived.');
  }
  if (paymentMethod != null && !['cash', 'stripe'].includes(paymentMethod)) {
    throw new HttpsError('invalid-argument', 'paymentMethod must be cash, stripe, or null.');
  }
  const regSnap = await db.doc(`singlesRegistrations/${registrationId}`).get();
  if (!regSnap.exists) throw new HttpsError('not-found', 'Registration not found.');
  await assertLeagueAdmin(request.auth?.uid, regSnap.data()!.leagueId);

  await regSnap.ref.update({ paymentStatus, paymentMethod: paymentMethod ?? null });
});

// Closes registration and builds the bracket from whoever's registered by
// this point — same buildCupBracket call the old one-step
// adminCreateSinglesCompetition used to make directly. Also seeds the live
// board queue: any Round 1 tie that's immediately playable (no bye owed to
// either side) gets assigned a board right away, same as a tie becoming
// newly ready mid-event does in onSinglesTieConfirmed below.
export const adminBuildSinglesDraw = onCall(async (request) => {
  const { competitionId, boardCount, boardNames } = (request.data ?? {}) as {
    competitionId?: string; boardCount?: number; boardNames?: (string | null)[];
  };
  if (!competitionId || !boardCount || boardCount < 1) {
    throw new HttpsError('invalid-argument', 'competitionId and a boardCount of at least 1 are required.');
  }
  const compSnap = await db.doc(`singlesCompetitions/${competitionId}`).get();
  if (!compSnap.exists) throw new HttpsError('not-found', 'Competition not found.');
  const comp = compSnap.data()!;
  await assertLeagueAdmin(request.auth?.uid, comp.leagueId);
  if (comp.status !== 'registration') {
    throw new HttpsError('failed-precondition', 'The draw has already been built for this competition.');
  }

  const regsSnap = await db.collection('singlesRegistrations').where('competitionId', '==', competitionId).get();
  const playerIds = regsSnap.docs.map((d) => d.data().playerId as string);
  if (playerIds.length < 2) {
    throw new HttpsError('failed-precondition', 'Need at least 2 registered players to build a draw.');
  }

  const plan = buildCupBracket(shuffleArray(playerIds));
  const tieRefsByRound = plan.map((round) => round.ties.map(() => db.collection('singlesTies').doc()));
  const refsById = new Map<string, FirebaseFirestore.DocumentReference>();
  const readyTies: AssignableSinglesTie[] = [];
  const readyTieInfo = new Map<string, { homePlayerId: string; awayPlayerId: string }>();

  const batch = db.batch();
  let drawOrder = 0;
  plan.forEach((round, roundIdx) => {
    round.ties.forEach((tie, tieIdx) => {
      const nextTieRef = tie.nextTieIndex != null ? tieRefsByRound[roundIdx + 1][tie.nextTieIndex] : null;
      const status: string = tie.isBye ? 'bye' : (tie.homeTeamId && tie.awayTeamId) ? 'ready' : 'pending';
      const tieRef = tieRefsByRound[roundIdx][tieIdx];
      const order = drawOrder++;
      refsById.set(tieRef.id, tieRef);
      batch.set(tieRef, {
        leagueId: comp.leagueId, competitionId, round: round.round, drawOrder: order,
        homePlayerId: tie.homeTeamId, awayPlayerId: tie.awayTeamId, winnerPlayerId: tie.winnerTeamId,
        status, boardId: null, homeLegsWon: null, awayLegsWon: null, legs: null,
        nextTieId: nextTieRef ? nextTieRef.id : null, nextTieSlot: tie.nextTieSlot,
        createdAt: FieldValue.serverTimestamp(),
      });
      if (status === 'ready') {
        readyTies.push({ id: tieRef.id, drawOrder: order });
        readyTieInfo.set(tieRef.id, { homePlayerId: tie.homeTeamId!, awayPlayerId: tie.awayTeamId! });
      }
    });
  });

  const names: (string | null)[] = [...(boardNames ?? [])].slice(0, boardCount);
  while (names.length < boardCount) names.push(null);
  const { boards, assignments } = assignFreeBoards(new Array(boardCount).fill(null), readyTies);
  assignments.forEach(({ tieId, boardId }) => {
    batch.update(refsById.get(tieId)!, { status: 'active', boardId });
  });

  batch.update(compSnap.ref, { playerIds, status: 'active', boardCount, boardNames: names, boards });
  await batch.commit();

  await notifySinglesBoardAssignments(assignments, readyTieInfo, names);
  return { competitionId };
});

async function advanceSinglesTieWinner(
  competitionId: string, nextTieId: string | null, nextTieSlot: MatchSide | null, winnerPlayerId: string,
): Promise<void> {
  if (!nextTieId || !nextTieSlot) {
    await db.doc(`singlesCompetitions/${competitionId}`).update({ status: 'completed', winnerPlayerId });
    return;
  }
  const nextTieRef = db.doc(`singlesTies/${nextTieId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(nextTieRef);
    if (!snap.exists) return;
    const data = snap.data()!;
    const field = nextTieSlot === 'home' ? 'homePlayerId' : 'awayPlayerId';
    const otherField = nextTieSlot === 'home' ? 'awayPlayerId' : 'homePlayerId';
    const update: Record<string, unknown> = { [field]: winnerPlayerId };
    if (data[otherField]) update.status = 'ready';
    tx.update(nextTieRef, update);
  });
}

// Frees the board the just-confirmed tie was occupying, then runs the same
// FIFO queue assignFreeBoards uses at draw-build time over whichever ties
// are now 'ready' — this both fills the board that just freed up and picks
// up any tie that only just became 'ready' via advanceSinglesTieWinner
// above (both its slots filled for the first time).
async function reassignSinglesBoards(competitionId: string, freedBoardId: number | null): Promise<void> {
  const compRef = db.doc(`singlesCompetitions/${competitionId}`);
  const compSnap = await compRef.get();
  if (!compSnap.exists) return;
  const comp = compSnap.data()!;
  const boards = [...((comp.boards ?? []) as (string | null)[])];
  if (freedBoardId != null && freedBoardId >= 0 && freedBoardId < boards.length) boards[freedBoardId] = null;

  const readySnap = await db.collection('singlesTies')
    .where('competitionId', '==', competitionId).where('status', '==', 'ready').get();
  const readyTies: AssignableSinglesTie[] = [];
  const readyTieInfo = new Map<string, { homePlayerId: string; awayPlayerId: string }>();
  readySnap.docs.forEach((d) => {
    const data = d.data();
    readyTies.push({ id: d.id, drawOrder: data.drawOrder as number });
    readyTieInfo.set(d.id, { homePlayerId: data.homePlayerId as string, awayPlayerId: data.awayPlayerId as string });
  });

  const { boards: newBoards, assignments } = assignFreeBoards(boards, readyTies);
  if (assignments.length === 0 && JSON.stringify(newBoards) === JSON.stringify(comp.boards ?? [])) return;

  const batch = db.batch();
  batch.update(compRef, { boards: newBoards });
  assignments.forEach(({ tieId, boardId }) => {
    batch.update(db.doc(`singlesTies/${tieId}`), { status: 'active', boardId });
  });
  await batch.commit();

  await notifySinglesBoardAssignments(assignments, readyTieInfo, (comp.boardNames ?? []) as (string | null)[]);
}

export const onSinglesTieConfirmed = onDocumentUpdated('singlesTies/{tieId}', async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after) return;
  if (after.status !== 'confirmed') return;

  const beforeLegs = (before.status === 'confirmed' ? (before.legs ?? []) : []) as MatchLeg[];
  const afterLegs = (after.legs ?? []) as MatchLeg[];
  if (JSON.stringify(beforeLegs) === JSON.stringify(afterLegs)) return; // no actual result change

  const tieId = event.params.tieId;
  const homeLegsWon = afterLegs.filter((l) => l.winner === 'home').length;
  const awayLegsWon = afterLegs.filter((l) => l.winner === 'away').length;
  const winnerPlayerId = (homeLegsWon > awayLegsWon ? after.homePlayerId : after.awayPlayerId) as string;

  await db.doc(`singlesTies/${tieId}`).update({ homeLegsWon, awayLegsWon, winnerPlayerId, boardId: null });

  await advanceSinglesTieWinner(
    after.competitionId as string, (after.nextTieId ?? null) as string | null, (after.nextTieSlot ?? null) as MatchSide | null,
    winnerPlayerId,
  );

  await reassignSinglesBoards(after.competitionId as string, (after.boardId ?? null) as number | null);
});

// Blocked while any tie has a confirmed result — same conservative
// reasoning as adminDeleteCup above.
export const adminDeleteSinglesCompetition = onCall(async (request) => {
  const { competitionId } = (request.data ?? {}) as { competitionId?: string };
  if (!competitionId) throw new HttpsError('invalid-argument', 'competitionId is required.');
  const compSnap = await db.doc(`singlesCompetitions/${competitionId}`).get();
  if (!compSnap.exists) throw new HttpsError('not-found', 'Competition not found.');
  await assertLeagueAdmin(request.auth?.uid, compSnap.data()!.leagueId);

  const tiesSnap = await db.collection('singlesTies').where('competitionId', '==', competitionId).get();
  if (tiesSnap.docs.some((d) => d.data().status === 'confirmed')) {
    throw new HttpsError(
      'failed-precondition',
      "This competition has confirmed results — delete isn't supported while that history exists.",
    );
  }

  const regsSnap = await db.collection('singlesRegistrations').where('competitionId', '==', competitionId).get();

  const batch = db.batch();
  tiesSnap.docs.forEach((d) => batch.delete(d.ref));
  regsSnap.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(db.doc(`singlesCompetitions/${competitionId}`));
  await batch.commit();
});
