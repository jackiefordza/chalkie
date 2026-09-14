import type * as admin from 'firebase-admin';
import { computeLegsWonFromMatches } from './compute';
import { guardedUpdateLegsWon } from './firebaseAdmin';
import type { MatchDoc } from './types';

export interface BackfillPlanRow {
  docId: string; // `${seasonId}_${playerId}`
  seasonId: string;
  playerId: string;
  teamId: string;
  existingLegsWon: number | null; // null = playerSeasonStats doc exists but has no legsWon field yet
  computedLegsWon: number;
}

export interface MissingDocRow {
  docId: string;
  seasonId: string;
  playerId: string;
  computedLegsWon: number;
}

// Read-only against `matches` — this is the only place this script ever
// reads from that collection, and it never writes to it. A single
// `where('status', '==', 'confirmed')` query with no further scoping, since
// the backfill is explicitly meant to cover every league/season currently
// in the project, including the showcase season — not just one league.
export async function buildBackfillPlan(
  db: admin.firestore.Firestore,
): Promise<{ plan: BackfillPlanRow[]; missingDocs: MissingDocRow[] }> {
  const matchesSnap = await db.collection('matches').where('status', '==', 'confirmed').get();
  const matches: MatchDoc[] = matchesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MatchDoc, 'id'>) }));

  const computed = computeLegsWonFromMatches(matches);

  const plan: BackfillPlanRow[] = [];
  const missingDocs: MissingDocRow[] = [];

  for (const [docId, result] of computed) {
    // eslint-disable-next-line no-await-in-loop -- deliberately sequential; see README (small, known scale)
    const snap = await db.collection('playerSeasonStats').doc(docId).get();
    if (!snap.exists) {
      // A computed player with no existing playerSeasonStats doc at all is
      // an anomaly this script refuses to silently paper over by creating
      // one — it's reported, never written. See README's "Anomalies" section.
      missingDocs.push({ docId, seasonId: result.seasonId, playerId: result.playerId, computedLegsWon: result.legsWon });
      continue;
    }
    const existing = (snap.data() as { legsWon?: number }).legsWon;
    plan.push({
      docId, seasonId: result.seasonId, playerId: result.playerId, teamId: result.teamId,
      existingLegsWon: typeof existing === 'number' ? existing : null,
      computedLegsWon: result.legsWon,
    });
  }
  return { plan, missingDocs };
}

export function rowsNeedingWrite(plan: BackfillPlanRow[]): BackfillPlanRow[] {
  return plan.filter((r) => r.existingLegsWon !== r.computedLegsWon);
}

export function printPlan(plan: BackfillPlanRow[], missingDocs: MissingDocRow[]): void {
  const needsWrite = rowsNeedingWrite(plan);
  console.log(`\nComputed legsWon for ${plan.length} player-season(s) from confirmed League/TKO matches.`);
  console.log(`  ${plan.length - needsWrite.length} already correct — no write needed.`);
  console.log(`  ${needsWrite.length} need a legsWon write:\n`);
  needsWrite.forEach((r) => {
    const delta = r.computedLegsWon - (r.existingLegsWon ?? 0);
    console.log(`  playerSeasonStats/${r.docId}`);
    console.log(`    existing legsWon: ${r.existingLegsWon === null ? '(field not set)' : r.existingLegsWon}`);
    console.log(`    computed legsWon: ${r.computedLegsWon}`);
    console.log(`    delta: ${delta >= 0 ? '+' : ''}${delta}`);
  });
  if (missingDocs.length > 0) {
    console.log(`\n  ${missingDocs.length} ANOMALY — computed legsWon but no playerSeasonStats document exists (SKIPPED, nothing written):`);
    missingDocs.forEach((r) => {
      console.log(`    playerSeasonStats/${r.docId} — would be legsWon: ${r.computedLegsWon} (season ${r.seasonId}, player ${r.playerId})`);
    });
    console.log('  This should not happen (a player with a confirmed game should already have a stats doc from the live');
    console.log('  aggregation) — investigate before assuming this backfill is complete.');
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
    await guardedUpdateLegsWon(db, row.docId, row.existingLegsWon, row.computedLegsWon);
  }
  return needsWrite.length;
}
