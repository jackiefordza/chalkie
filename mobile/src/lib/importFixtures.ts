import { collection, doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';
import type { ValidatedFixtureRow } from './fixtureImport';

// Comfortably under Firestore's 500-writes-per-batch limit, leaving
// headroom. A single batch keeps the import truly atomic (all rows commit
// together or none do) — a realistic Division 3 season's fixture count is
// well under this, so splitting into multiple non-atomic batches was
// deliberately not built; a larger file is rejected rather than partially
// committed across batches.
const MAX_BATCH = 450;

// Writes each validated row with the exact same shape admin-fixtures.tsx's
// own generateFixtures() already writes — same fields, same defaults, same
// 'scheduled' status — so an imported fixture is indistinguishable from a
// manually generated one anywhere else in the app (results entry, dispute
// resolution, standings/stats).
export async function importFixtures(
  rows: ValidatedFixtureRow[],
  context: { leagueId: string; seasonId: string; divisionId: string },
): Promise<void> {
  if (rows.length === 0) return;
  if (rows.length > MAX_BATCH) {
    throw new Error(`Can't import more than ${MAX_BATCH} fixtures at once — split the file and import in batches.`);
  }
  const batch = writeBatch(db);
  rows.forEach((row) => {
    const matchRef = doc(collection(db, 'matches'));
    batch.set(matchRef, {
      leagueId: context.leagueId,
      seasonId: context.seasonId,
      divisionId: context.divisionId,
      round: row.round,
      homeTeamId: row.homeTeamId,
      awayTeamId: row.awayTeamId,
      scheduledDate: row.scheduledDate,
      venue: row.venue,
      status: 'scheduled',
      homeGamesWon: null,
      awayGamesWon: null,
      homeLegsWon: null,
      awayLegsWon: null,
      createdAt: serverTimestamp(),
    });
  });
  await batch.commit();
}
