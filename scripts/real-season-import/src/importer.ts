// The actual create/update/skip logic against Chalkie's real Firestore
// schema (mobile/src/types/index.ts, re-verified against current main
// before this was written). Operates purely against the FirestoreLike
// interface — the caller decides whether that's real Firestore (wrapped in
// guardedFirestore) or the in-memory fake used for offline testing.
//
// Safety principle applied throughout: fields that ONLY this importer ever
// owns (structural identity: name/leagueId/seasonId/divisionId/relationships)
// are reconciled on every run. Fields the APP itself or a human admin might
// reasonably change afterward (captainUserId, viceCaptainUserId, address,
// venuePhone, a match's status/games once play has started, createdAt) are
// written ONLY at creation and never touched again by a later run — so
// re-running this importer can never silently undo a real captain
// assignment, a manually-corrected venue address, or an in-progress/played
// match's result.
import { CanonicalDataset } from './dataset';
import { FirestoreLike } from './firestoreLike';

export interface DocOutcome { id: string; collectionPath: string }
export interface ApplyResult {
  created: DocOutcome[];
  updated: DocOutcome[];
  skipped: DocOutcome[];
  skippedPlayed: DocOutcome[]; // matches skipped specifically because real play has already started
}

function emptyResult(): ApplyResult {
  return { created: [], updated: [], skipped: [], skippedPlayed: [] };
}

function merge(a: ApplyResult, b: ApplyResult): ApplyResult {
  return {
    created: [...a.created, ...b.created],
    updated: [...a.updated, ...b.updated],
    skipped: [...a.skipped, ...b.skipped],
    skippedPlayed: [...a.skippedPlayed, ...b.skippedPlayed],
  };
}

// League.adminUserId has no meaningful value at this stage (no real admin
// Auth account has been created/onboarded yet — see the accompanying audit
// report). This placeholder is written ONLY on first creation and is never
// touched by a later run; it must be corrected once a real admin account
// exists (a one-field update via the app's own admin UI, or the Firebase
// Console — not this script's job).
export const PENDING_ADMIN_PLACEHOLDER = 'PENDING_REAL_ADMIN_ACCOUNT';

// Deliberately a SUBSET comparison, not a full key-count match: `existing`
// (a real document) legitimately carries extra fields this importer never
// reconciles on update (createdAt, captainUserId, viceCaptainUserId,
// address, venuePhone, status, games, ...). Only the fields present in `a`
// (the reconciled set for this doc kind) are compared — an extra field on
// `b` is never grounds to report "changed".
function reconciledFieldsMatch(a: Record<string, unknown>, b: Record<string, unknown> | undefined): boolean {
  if (!b) return false;
  return Object.keys(a).every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
}

// A JS `Date` we write is read back as a plain Date from the in-memory fake,
// but as a Firestore `Timestamp` (which is NOT `instanceof Date`, and
// serializes completely differently) from real/emulator Firestore. Both
// expose a `.toDate()`-compatible shape; normalize either to the same ISO
// string before comparing, or every match would always look "changed".
function toComparableDateString(value: unknown): string | unknown {
  if (value instanceof Date) return value.toISOString();
  if (
    value !== null && typeof value === 'object' && 'toDate' in value
    && typeof (value as { toDate: unknown }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return value;
}

async function applyOne(
  db: FirestoreLike,
  collectionPath: string,
  id: string,
  reconciledFields: Record<string, unknown>,
  createOnlyFields: Record<string, unknown>,
  dryRun: boolean,
): Promise<{ outcome: 'created' | 'updated' | 'skipped'; }> {
  const ref = db.collection(collectionPath).doc(id);
  const snap = await ref.get();

  if (!snap.exists) {
    if (!dryRun) {
      await ref.set({ ...reconciledFields, ...createOnlyFields, createdAt: new Date() }, { merge: true });
    }
    return { outcome: 'created' };
  }

  const existing = snap.data();
  if (reconciledFieldsMatch(reconciledFields, existing)) {
    return { outcome: 'skipped' };
  }
  if (!dryRun) {
    await ref.set(reconciledFields, { merge: true });
  }
  return { outcome: 'updated' };
}

async function importLeague(db: FirestoreLike, ds: CanonicalDataset, dryRun: boolean): Promise<ApplyResult> {
  const result = emptyResult();
  const { outcome } = await applyOne(
    db, 'leagues', ds.league.id,
    { id: ds.league.id, name: ds.league.name },
    { adminUserId: PENDING_ADMIN_PLACEHOLDER },
    dryRun,
  );
  result[outcome].push({ id: ds.league.id, collectionPath: 'leagues' });
  return result;
}

async function importSeason(db: FirestoreLike, ds: CanonicalDataset, dryRun: boolean): Promise<ApplyResult> {
  const result = emptyResult();
  const { outcome } = await applyOne(
    db, 'seasons', ds.season.id,
    { id: ds.season.id, leagueId: ds.season.leagueId, name: ds.season.name },
    { status: 'upcoming' },
    dryRun,
  );
  result[outcome].push({ id: ds.season.id, collectionPath: 'seasons' });
  return result;
}

async function importDivisions(db: FirestoreLike, ds: CanonicalDataset, dryRun: boolean): Promise<ApplyResult> {
  let result = emptyResult();
  for (const div of ds.divisions) {
    const { outcome } = await applyOne(
      db, 'divisions', div.id,
      {
        id: div.id, leagueId: ds.league.id, seasonId: ds.season.id, name: div.name, order: div.order,
      },
      {},
      dryRun,
    );
    result = merge(result, { ...emptyResult(), [outcome]: [{ id: div.id, collectionPath: 'divisions' }] });
  }
  return result;
}

async function importTeams(db: FirestoreLike, ds: CanonicalDataset, dryRun: boolean): Promise<ApplyResult> {
  let result = emptyResult();
  for (const team of ds.teams) {
    const divisionId = ds.divisions.find((d) => d.key === team.division)!.id;
    const { outcome } = await applyOne(
      db, 'teams', team.id,
      {
        id: team.id, leagueId: ds.league.id, seasonId: ds.season.id, divisionId, name: team.name,
      },
      {
        captainUserId: null, viceCaptainUserId: null, address: team.venue, venuePhone: null,
      },
      dryRun,
    );
    result = merge(result, { ...emptyResult(), [outcome]: [{ id: team.id, collectionPath: 'teams' }] });
  }
  return result;
}

async function importMatches(db: FirestoreLike, ds: CanonicalDataset, dryRun: boolean): Promise<ApplyResult> {
  let result = emptyResult();
  for (const fx of ds.fixtures) {
    const divisionId = ds.divisions.find((d) => d.key === fx.division)!.id;
    const ref = db.collection('matches').doc(fx.id);
    // eslint-disable-next-line no-await-in-loop
    const snap = await ref.get();

    if (snap.exists) {
      const existing = snap.data();
      // Safety-critical: once a fixture has moved past 'scheduled' (a
      // result has been submitted/confirmed/disputed against it), this
      // importer NEVER touches it again — not even to "fix" a structural
      // field — regardless of how many times it's re-run.
      if (existing && existing.status !== 'scheduled') {
        result.skippedPlayed.push({ id: fx.id, collectionPath: 'matches' });
        // eslint-disable-next-line no-continue
        continue;
      }
    }

    const reconciled = {
      id: fx.id,
      leagueId: ds.league.id,
      seasonId: ds.season.id,
      divisionId,
      round: fx.week,
      homeTeamId: fx.homeTeamId,
      awayTeamId: fx.awayTeamId,
      scheduledDate: new Date(`${fx.date}T00:00:00.000Z`),
      venue: fx.venue,
    };

    if (!snap.exists) {
      if (!dryRun) {
        await ref.set({
          ...reconciled, status: 'scheduled', competitionType: 'league', createdAt: new Date(),
        }, { merge: true });
      }
      result.created.push({ id: fx.id, collectionPath: 'matches' });
      // eslint-disable-next-line no-continue
      continue;
    }

    const existing = snap.data();
    const comparable = { ...reconciled, scheduledDate: reconciled.scheduledDate.toISOString() };
    const existingComparable = existing
      ? { ...existing, scheduledDate: toComparableDateString(existing.scheduledDate) }
      : undefined;
    if (reconciledFieldsMatch(comparable, existingComparable as Record<string, unknown> | undefined)) {
      result.skipped.push({ id: fx.id, collectionPath: 'matches' });
      // eslint-disable-next-line no-continue
      continue;
    }
    if (!dryRun) {
      await ref.set(reconciled, { merge: true });
    }
    result.updated.push({ id: fx.id, collectionPath: 'matches' });
  }
  return result;
}

export async function runImport(
  db: FirestoreLike,
  ds: CanonicalDataset,
  options: { dryRun: boolean },
): Promise<ApplyResult> {
  const league = await importLeague(db, ds, options.dryRun);
  const season = await importSeason(db, ds, options.dryRun);
  const divisions = await importDivisions(db, ds, options.dryRun);
  const teams = await importTeams(db, ds, options.dryRun);
  const matches = await importMatches(db, ds, options.dryRun);
  return [league, season, divisions, teams, matches].reduce(merge, emptyResult());
}

export function printApplyResult(result: ApplyResult, dryRun: boolean): void {
  console.log('');
  console.log(dryRun ? 'DRY RUN — no writes performed' : 'LIVE RUN — writes performed');
  console.log('='.repeat(60));
  console.log(`Created: ${result.created.length}`);
  console.log(`Updated: ${result.updated.length}`);
  console.log(`Skipped (already up to date): ${result.skipped.length}`);
  console.log(`Skipped (real play already started — never touched): ${result.skippedPlayed.length}`);
  const total = result.created.length + result.updated.length + result.skipped.length + result.skippedPlayed.length;
  console.log(`Total documents considered: ${total}`);
}
