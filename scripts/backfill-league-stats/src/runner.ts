import type * as admin from 'firebase-admin';
import { computeLeagueStatsFromMatches } from './compute';
import { guardedUpdateLeagueStats } from './firebaseAdmin';
import type { MatchDoc } from './types';

interface ExistingLeagueFields {
  leagueLegsWon: number | null;
  leagueLegsPlayed: number | null;
  leagueGamesWon: number | null;
  leagueGamesPlayed: number | null;
}
interface ComputedLeagueFields {
  leagueLegsWon: number;
  leagueLegsPlayed: number;
  leagueGamesWon: number;
  leagueGamesPlayed: number;
}

export interface BackfillPlanRow {
  docId: string; // `${seasonId}_${playerId}`
  seasonId: string;
  playerId: string;
  teamId: string;
  existing: ExistingLeagueFields; // null field = not set yet (every doc, pre-rollout)
  computed: ComputedLeagueFields;
}

export interface MissingDocRow {
  docId: string;
  seasonId: string;
  playerId: string;
  computed: ComputedLeagueFields;
}

// Read-only against `matches` — this is the only place this script ever
// reads from that collection, and it never writes to it. A single
// `where('status', '==', 'confirmed')` query with no further scoping (the
// League/TKO/Friendly filtering happens inside computeLeagueStatsFromMatches
// itself), since the backfill is explicitly meant to cover every
// league/season currently in the project, including the showcase season —
// not just one league.
export async function buildBackfillPlan(
  db: admin.firestore.Firestore,
): Promise<{ plan: BackfillPlanRow[]; missingDocs: MissingDocRow[] }> {
  const matchesSnap = await db.collection('matches').where('status', '==', 'confirmed').get();
  const matches: MatchDoc[] = matchesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MatchDoc, 'id'>) }));

  const computed = computeLeagueStatsFromMatches(matches);

  const plan: BackfillPlanRow[] = [];
  const missingDocs: MissingDocRow[] = [];

  for (const [docId, result] of computed) {
    // eslint-disable-next-line no-await-in-loop -- deliberately sequential; see README (small, known scale)
    const snap = await db.collection('playerSeasonStats').doc(docId).get();
    const computedFields: ComputedLeagueFields = {
      leagueLegsWon: result.leagueLegsWon,
      leagueLegsPlayed: result.leagueLegsPlayed,
      leagueGamesWon: result.leagueGamesWon,
      leagueGamesPlayed: result.leagueGamesPlayed,
    };
    if (!snap.exists) {
      // A computed player with no existing playerSeasonStats doc at all is
      // an anomaly this script refuses to silently paper over by creating
      // one — it's reported, never written. See README's "Anomalies" section.
      missingDocs.push({ docId, seasonId: result.seasonId, playerId: result.playerId, computed: computedFields });
      continue;
    }
    const data = snap.data() as Partial<ExistingLeagueFields>;
    plan.push({
      docId, seasonId: result.seasonId, playerId: result.playerId, teamId: result.teamId,
      existing: {
        leagueLegsWon: typeof data.leagueLegsWon === 'number' ? data.leagueLegsWon : null,
        leagueLegsPlayed: typeof data.leagueLegsPlayed === 'number' ? data.leagueLegsPlayed : null,
        leagueGamesWon: typeof data.leagueGamesWon === 'number' ? data.leagueGamesWon : null,
        leagueGamesPlayed: typeof data.leagueGamesPlayed === 'number' ? data.leagueGamesPlayed : null,
      },
      computed: computedFields,
    });
  }
  return { plan, missingDocs };
}

function rowNeedsWrite(r: BackfillPlanRow): boolean {
  return r.existing.leagueLegsWon !== r.computed.leagueLegsWon
    || r.existing.leagueLegsPlayed !== r.computed.leagueLegsPlayed
    || r.existing.leagueGamesWon !== r.computed.leagueGamesWon
    || r.existing.leagueGamesPlayed !== r.computed.leagueGamesPlayed;
}

export function rowsNeedingWrite(plan: BackfillPlanRow[]): BackfillPlanRow[] {
  return plan.filter(rowNeedsWrite);
}

export function printPlan(plan: BackfillPlanRow[], missingDocs: MissingDocRow[]): void {
  const needsWrite = rowsNeedingWrite(plan);
  console.log(`\nComputed League-only leaderboard stats for ${plan.length} player-season(s) from confirmed League matches.`);
  console.log(`  ${plan.length - needsWrite.length} already correct — no write needed.`);
  console.log(`  ${needsWrite.length} need a write:\n`);
  needsWrite.forEach((r) => {
    console.log(`  playerSeasonStats/${r.docId}`);
    console.log(`    existing: leagueLegsWon=${r.existing.leagueLegsWon ?? '(not set)'} leagueLegsPlayed=${r.existing.leagueLegsPlayed ?? '(not set)'} leagueGamesWon=${r.existing.leagueGamesWon ?? '(not set)'} leagueGamesPlayed=${r.existing.leagueGamesPlayed ?? '(not set)'}`);
    console.log(`    computed: leagueLegsWon=${r.computed.leagueLegsWon} leagueLegsPlayed=${r.computed.leagueLegsPlayed} leagueGamesWon=${r.computed.leagueGamesWon} leagueGamesPlayed=${r.computed.leagueGamesPlayed}`);
  });
  if (missingDocs.length > 0) {
    console.log(`\n  ${missingDocs.length} ANOMALY — computed League stats but no playerSeasonStats document exists (SKIPPED, nothing written):`);
    missingDocs.forEach((r) => {
      console.log(`    playerSeasonStats/${r.docId} — would be leagueLegsWon=${r.computed.leagueLegsWon} leagueGamesWon=${r.computed.leagueGamesWon} (season ${r.seasonId}, player ${r.playerId})`);
    });
    console.log('  This should not happen (a player with a confirmed League game should already have a stats doc from');
    console.log('  the live aggregation) — investigate before assuming this backfill is complete.');
  }
}

// The only place this script writes. Sequential, not batched/parallel — the
// realistic scale here (a Division 3 pilot league, plus the showcase
// season) is small, and sequential writes keep the printed audit trail
// strictly in the same order as the plan printed above.
export async function applyPlan(db: admin.firestore.Firestore, plan: BackfillPlanRow[]): Promise<number> {
  const needsWrite = rowsNeedingWrite(plan);
  for (const row of needsWrite) {
    // eslint-disable-next-line no-await-in-loop -- deliberately sequential; see comment above
    await guardedUpdateLeagueStats(db, row.docId, row.existing, row.computed);
  }
  return needsWrite.length;
}
