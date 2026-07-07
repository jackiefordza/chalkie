import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, type DocumentReference, type DocumentData } from 'firebase-admin/firestore';
import { onDocumentWritten, onDocumentUpdated } from 'firebase-functions/v2/firestore';

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

function computeTotals(games: MatchGame[]) {
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

interface PlayerAccum {
  teamId: string;
  played: number;
  won: number;
  lost: number;
  oneEighties: number;
  highCheckouts: { value: string; matchId: string; date: Date }[];
}

// ── On confirm (whether via auto-confirm above or admin dispute resolution):
// recompute homeGamesWon/etc, each team's divisionTables row + division
// positions, and every involved player's playerSeasonStats. ─────────────────
export const onMatchConfirmed = onDocumentUpdated('matches/{matchId}', async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after) return;
  if (before.status === 'confirmed' || after.status !== 'confirmed') return;

  const matchId = event.params.matchId;
  const games = (after.games ?? []) as MatchGame[];
  const { leagueId, seasonId, divisionId, homeTeamId, awayTeamId, scheduledDate } = after as {
    leagueId: string; seasonId: string; divisionId: string;
    homeTeamId: string; awayTeamId: string; scheduledDate: FirebaseFirestore.Timestamp;
  };
  const totals = computeTotals(games);

  await db.doc(`matches/${matchId}`).update(totals);

  // ── divisionTables ──
  const homeWon = totals.homeGamesWon > totals.awayGamesWon;
  const tableUpdates: { ref: DocumentReference; data: DocumentData }[] = [
    {
      ref: db.doc(`divisionTables/${seasonId}_${divisionId}_${homeTeamId}`),
      data: {
        leagueId, seasonId, divisionId, teamId: homeTeamId,
        played: FieldValue.increment(1),
        won: FieldValue.increment(homeWon ? 1 : 0),
        lost: FieldValue.increment(homeWon ? 0 : 1),
        points: FieldValue.increment(homeWon ? 2 : 0),
        legsFor: FieldValue.increment(totals.homeLegsWon),
        legsAgainst: FieldValue.increment(totals.awayLegsWon),
        legDiff: FieldValue.increment(totals.homeLegsWon - totals.awayLegsWon),
      },
    },
    {
      ref: db.doc(`divisionTables/${seasonId}_${divisionId}_${awayTeamId}`),
      data: {
        leagueId, seasonId, divisionId, teamId: awayTeamId,
        played: FieldValue.increment(1),
        won: FieldValue.increment(homeWon ? 0 : 1),
        lost: FieldValue.increment(homeWon ? 1 : 0),
        points: FieldValue.increment(homeWon ? 0 : 2),
        legsFor: FieldValue.increment(totals.awayLegsWon),
        legsAgainst: FieldValue.increment(totals.homeLegsWon),
        legDiff: FieldValue.increment(totals.awayLegsWon - totals.homeLegsWon),
      },
    },
  ];

  const tableBatch = db.batch();
  tableUpdates.forEach(({ ref, data }) => tableBatch.set(ref, data, { merge: true }));
  await tableBatch.commit();

  // Recompute standings position for the whole division (points desc, legDiff tiebreak)
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

  // ── playerSeasonStats — played/won/lost count individual games, not matches ──
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
          date: scheduledDate.toDate(),
        });
      }
    }
  }

  const statsBatch = db.batch();
  for (const [playerId, a] of accum) {
    const ref = db.doc(`playerSeasonStats/${seasonId}_${playerId}`);
    statsBatch.set(ref, {
      leagueId, seasonId, divisionId, teamId: a.teamId, playerId,
      played: FieldValue.increment(a.played),
      won: FieldValue.increment(a.won),
      lost: FieldValue.increment(a.lost),
      oneEighties: FieldValue.increment(a.oneEighties),
      ...(a.highCheckouts.length ? { highCheckouts: FieldValue.arrayUnion(...a.highCheckouts) } : {}),
    }, { merge: true });
  }
  await statsBatch.commit();
});
