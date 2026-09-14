import type * as admin from 'firebase-admin';
import { computeLegsWonFromMatches } from './compute';
import type { MatchDoc } from './types';

// Strictly read-only. This module never imports guardedUpdateLegsWon or
// anything else capable of writing — it is structurally incapable of
// mutating Firestore, not merely instructed not to. See investigate.ts
// (the entry point) and README.md's "Investigating, not backfilling"
// section.

interface PlayerSeasonStatsDocData {
  leagueId?: string;
  seasonId?: string;
  divisionId?: string;
  teamId?: string;
  playerId?: string;
  played?: number;
  won?: number;
  lost?: number;
  legsWon?: number;
  oneEighties?: number;
}

export interface InvestigateRow {
  docId: string;
  leagueId: string | null;
  seasonId: string | null;
  divisionId: string | null;
  played: number | null;
  won: number | null;
  existingLegsWon: number | null;
  computedLegsWon: number;
  exactMatch: boolean;
  delta: number | null; // null when existingLegsWon is null (nothing to diff)
  createTime: string | null;
  updateTime: string | null;
  suspicious: string[]; // human-readable flags, e.g. "legsWon > played*3"
}

const LEGS_PER_GAME = 3;

function flagSuspicious(row: Omit<InvestigateRow, 'suspicious'>): string[] {
  const flags: string[] = [];
  if (row.existingLegsWon !== null) {
    if (row.existingLegsWon < 0) flags.push('existing legsWon is negative');
    if (!Number.isInteger(row.existingLegsWon)) flags.push('existing legsWon is not an integer');
    if (row.played !== null && row.existingLegsWon > row.played * LEGS_PER_GAME) {
      flags.push(`existing legsWon (${row.existingLegsWon}) exceeds played*3 (${row.played * LEGS_PER_GAME}) — impossible`);
    }
  }
  if (row.computedLegsWon > 0 && row.played !== null && row.computedLegsWon > row.played * LEGS_PER_GAME) {
    flags.push(`computed legsWon (${row.computedLegsWon}) exceeds played*3 (${row.played * LEGS_PER_GAME}) — likely a bug in this investigation, not the data`);
  }
  return flags;
}

// Read-only: computes legsWon from confirmed matches exactly like the
// backfill's dry run, but additionally reads each playerSeasonStats
// document's FULL data (leagueId/seasonId/divisionId/played/won) and its
// Firestore-native createTime/updateTime metadata, for a much deeper
// per-document comparison than the plain backfill dry run prints.
export async function investigate(db: admin.firestore.Firestore): Promise<{
  rows: InvestigateRow[];
  missingDocs: { docId: string; computedLegsWon: number }[];
}> {
  const matchesSnap = await db.collection('matches').where('status', '==', 'confirmed').get();
  const matches: MatchDoc[] = matchesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MatchDoc, 'id'>) }));
  const computed = computeLegsWonFromMatches(matches);

  const rows: InvestigateRow[] = [];
  const missingDocs: { docId: string; computedLegsWon: number }[] = [];

  for (const [docId, result] of computed) {
    // eslint-disable-next-line no-await-in-loop -- deliberately sequential; read-only, small known scale
    const snap = await db.collection('playerSeasonStats').doc(docId).get();
    if (!snap.exists) {
      missingDocs.push({ docId, computedLegsWon: result.legsWon });
      continue;
    }
    const data = snap.data() as PlayerSeasonStatsDocData;
    const existingLegsWon = typeof data.legsWon === 'number' ? data.legsWon : null;
    const base = {
      docId,
      leagueId: data.leagueId ?? null,
      seasonId: data.seasonId ?? result.seasonId,
      divisionId: data.divisionId ?? null,
      played: typeof data.played === 'number' ? data.played : null,
      won: typeof data.won === 'number' ? data.won : null,
      existingLegsWon,
      computedLegsWon: result.legsWon,
      exactMatch: existingLegsWon === result.legsWon,
      delta: existingLegsWon === null ? null : result.legsWon - existingLegsWon,
      createTime: snap.createTime ? snap.createTime.toDate().toISOString() : null,
      updateTime: snap.updateTime ? snap.updateTime.toDate().toISOString() : null,
    };
    rows.push({ ...base, suspicious: flagSuspicious(base) });
  }
  return { rows, missingDocs };
}

function groupBy<T, K extends string>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = keyFn(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(item);
  }
  return map;
}

export function printInvestigation(rows: InvestigateRow[], missingDocs: { docId: string; computedLegsWon: number }[]): void {
  const withExisting = rows.filter((r) => r.existingLegsWon !== null);
  const withoutExisting = rows.filter((r) => r.existingLegsWon === null);
  const exactMatches = withExisting.filter((r) => r.exactMatch);
  const mismatches = withExisting.filter((r) => !r.exactMatch);
  const suspicious = rows.filter((r) => r.suspicious.length > 0);

  console.log('\n============================================================');
  console.log('LEGSWON INVESTIGATION — READ ONLY, NO WRITES PERFORMED');
  console.log('============================================================\n');
  console.log(`Total player-season documents computed: ${rows.length}`);
  console.log(`  Already have a numeric legsWon:        ${withExisting.length}`);
  console.log(`    - exact match with fresh computation: ${exactMatches.length}`);
  console.log(`    - DIFFER from fresh computation:       ${mismatches.length}`);
  console.log(`  Field not set at all:                  ${withoutExisting.length}`);
  console.log(`  Suspicious values flagged:             ${suspicious.length}`);
  console.log(`  Computed players with NO existing doc:  ${missingDocs.length}`);

  if (mismatches.length > 0) {
    console.log('\n--- MISMATCHES (existing legsWon != fresh computation) ---');
    mismatches.forEach((r) => {
      console.log(`  ${r.docId}: existing=${r.existingLegsWon} computed=${r.computedLegsWon} delta=${r.delta} updateTime=${r.updateTime}`);
    });
  }

  if (suspicious.length > 0) {
    console.log('\n--- SUSPICIOUS VALUES ---');
    suspicious.forEach((r) => {
      console.log(`  ${r.docId}: ${r.suspicious.join('; ')}`);
    });
  }

  console.log('\n--- Grouped by league / season / division (docs WITH an existing legsWon only) ---');
  const grouped = groupBy(withExisting, (r) => `${r.leagueId ?? '(none)'} / ${r.seasonId ?? '(none)'} / ${r.divisionId ?? '(none)'}` as const);
  for (const [key, groupRows] of grouped) {
    const updateTimes = groupRows.map((r) => r.updateTime).filter((t): t is string => t !== null).sort();
    const createTimes = groupRows.map((r) => r.createTime).filter((t): t is string => t !== null).sort();
    console.log(`\n  ${key}  (${groupRows.length} docs)`);
    console.log(`    createTime range: ${createTimes[0] ?? '(none)'}  ->  ${createTimes[createTimes.length - 1] ?? '(none)'}`);
    console.log(`    updateTime range: ${updateTimes[0] ?? '(none)'}  ->  ${updateTimes[updateTimes.length - 1] ?? '(none)'}`);
  }

  console.log('\n--- Full per-document listing (docs WITH an existing legsWon) ---');
  withExisting
    .sort((a, b) => (a.updateTime ?? '').localeCompare(b.updateTime ?? ''))
    .forEach((r) => {
      console.log(
        `  ${r.docId}  league=${r.leagueId} season=${r.seasonId} division=${r.divisionId} `
        + `played=${r.played} won=${r.won} legsWon=${r.existingLegsWon} (computed=${r.computedLegsWon}, `
        + `${r.exactMatch ? 'MATCH' : 'MISMATCH'})  created=${r.createTime}  updated=${r.updateTime}`,
      );
    });

  console.log('\n--- Docs WITH NO existing legsWon (field not set) ---');
  withoutExisting.forEach((r) => {
    console.log(
      `  ${r.docId}  league=${r.leagueId} season=${r.seasonId} division=${r.divisionId} `
      + `played=${r.played} computed=${r.computedLegsWon}  created=${r.createTime}  updated=${r.updateTime}`,
    );
  });

  if (missingDocs.length > 0) {
    console.log('\n--- Computed players with NO existing playerSeasonStats doc at all ---');
    missingDocs.forEach((r) => console.log(`  ${r.docId}: computed legsWon would be ${r.computedLegsWon}`));
  }

  console.log('\nInvestigation complete. This was a read-only run — nothing was written.');
}
