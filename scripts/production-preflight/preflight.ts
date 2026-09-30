#!/usr/bin/env node
// Read-only inspection of production Firestore (chalkie-app) for the exact
// deterministic documents scripts/real-season-import's importer would
// create. This file is the ENTIRE script — deliberately one file, not a
// multi-module package like real-season-import, so its read-only property
// is trivially checkable by eye and by `grep` (see README.md's "Why this
// is safe" section for the exact commands). It does not import
// firebaseAdmin.ts or importer.ts from real-season-import — nothing here
// shares any code path with that package's write capability. The ONLY
// things imported from real-season-import are constants.ts and
// dataset.ts, which are pure data/derivation with zero Firestore calls of
// their own (confirmed by the same grep).
//
// This script takes no arguments and reads no target from argv/env beyond
// GOOGLE_APPLICATION_CREDENTIALS — same convention as showcase-seed and
// real-season-import's own CLIs.
import * as fs from 'node:fs';
import * as admin from 'firebase-admin';
import {
  EXPECTED_PROJECT_ID, LEAGUE_ID, SEASON_ID,
} from '../real-season-import/src/constants';
import { buildCanonicalDataset, CanonicalDataset } from '../real-season-import/src/dataset';

// ── Firebase Admin SDK init — read intent only. ─────────────────────────────
// Nothing below this function, or anywhere else in this file, ever calls
// .set(), .update(), .delete(), .batch(), or .commit() on anything this
// returns — see README.md for the grep that proves it. The Admin SDK
// credential itself is capable of writing (there is no "read-only" flag on
// a service-account key); the safety property this script provides is that
// its OWN code never exercises that capability, which is why README.md's
// verification is a structural code check, not a claim about the key.
function initReadOnlyAdminApp(): admin.firestore.Firestore {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) {
    throw new Error(
      'GOOGLE_APPLICATION_CREDENTIALS is not set. This script refuses to guess at credentials — '
      + 'point it at a service-account JSON key for the chalkie-app project.',
    );
  }
  if (!fs.existsSync(credPath)) {
    throw new Error(`GOOGLE_APPLICATION_CREDENTIALS points at "${credPath}", which does not exist.`);
  }

  let serviceAccount: { project_id?: string };
  try {
    serviceAccount = JSON.parse(fs.readFileSync(credPath, 'utf8'));
  } catch (e) {
    throw new Error(`Could not parse the service-account file at "${credPath}" as JSON: ${(e as Error).message}`);
  }

  if (serviceAccount.project_id !== EXPECTED_PROJECT_ID) {
    throw new Error(
      `REFUSING TO RUN: the service-account credential at "${credPath}" belongs to project `
      + `"${serviceAccount.project_id ?? '(missing project_id)'}", not the required "${EXPECTED_PROJECT_ID}". `
      + 'This script only ever reads chalkie-app — point GOOGLE_APPLICATION_CREDENTIALS at the correct key.',
    );
  }

  const app = admin.initializeApp({
    credential: admin.credential.cert(credPath),
    projectId: EXPECTED_PROJECT_ID,
  }, `production-preflight-${Date.now()}`);

  const resolvedProjectId = app.options.projectId;
  if (resolvedProjectId !== EXPECTED_PROJECT_ID) {
    throw new Error(
      `REFUSING TO RUN: initialized Firebase app resolved to project "${resolvedProjectId}", `
      + `expected "${EXPECTED_PROJECT_ID}". Aborting before any read.`,
    );
  }

  console.log(`Firebase Admin SDK initialized against project "${resolvedProjectId}" — verified. Read-only checks follow.`);
  return admin.firestore(app);
}

// ── Comparison helpers (pure — no Firestore calls) ──────────────────────────
function toComparableDate(value: unknown): string | unknown {
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === 'object' && 'toDate' in value
    && typeof (value as { toDate: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return value;
}

interface FieldDiff { field: string; existing: unknown; canonical: unknown }

function diffFields(
  existing: Record<string, unknown>,
  canonical: Record<string, unknown>,
  fields: string[],
): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  for (const field of fields) {
    const e = field === 'scheduledDate' ? toComparableDate(existing[field]) : existing[field];
    const c = field === 'scheduledDate' ? toComparableDate(canonical[field]) : canonical[field];
    if (JSON.stringify(e) !== JSON.stringify(c)) diffs.push({ field, existing: e, canonical: c });
  }
  return diffs;
}

// ── Report data structures ───────────────────────────────────────────────
interface DocReport {
  id: string;
  exists: boolean;
  fields?: Record<string, unknown>;
  diffs?: FieldDiff[];
}

interface Report {
  league: DocReport;
  season: DocReport;
  divisions: DocReport[];
  teams: DocReport[];
  matches: DocReport[];
  unexpectedSeasons: string[];
  unexpectedDivisions: string[];
  unexpectedTeams: string[];
  unexpectedMatches: string[];
}

async function runPreflight(db: admin.firestore.Firestore, ds: CanonicalDataset): Promise<Report> {
  // ── League: single direct read, no query. ──
  const leagueSnap = await db.doc(`leagues/${LEAGUE_ID}`).get();
  const league: DocReport = {
    id: LEAGUE_ID,
    exists: leagueSnap.exists,
    fields: leagueSnap.exists ? { name: leagueSnap.data()!.name } : undefined,
  };
  if (leagueSnap.exists) {
    league.diffs = diffFields(leagueSnap.data()!, { name: ds.league.name }, ['name']);
  }

  // ── Season: query by leagueId so we also catch any UNEXPECTED season
  // under this league, not just our own canonical ID. ──
  const seasonsSnap = await db.collection('seasons').where('leagueId', '==', LEAGUE_ID).get();
  const seasonDoc = seasonsSnap.docs.find((d) => d.id === SEASON_ID);
  const season: DocReport = {
    id: SEASON_ID,
    exists: !!seasonDoc,
    fields: seasonDoc ? { leagueId: seasonDoc.data().leagueId, name: seasonDoc.data().name } : undefined,
  };
  if (seasonDoc) {
    season.diffs = diffFields(seasonDoc.data(), { leagueId: LEAGUE_ID, name: ds.season.name }, ['leagueId', 'name']);
  }
  const unexpectedSeasons = seasonsSnap.docs.filter((d) => d.id !== SEASON_ID).map((d) => d.id);

  // ── Divisions: same leagueId-scoped query, cross-referenced against our
  // 2 canonical division IDs. ──
  const divisionsSnap = await db.collection('divisions').where('leagueId', '==', LEAGUE_ID).get();
  const canonicalDivisionIds = new Set(ds.divisions.map((d) => d.id));
  const divisions: DocReport[] = ds.divisions.map((cd) => {
    const existingDoc = divisionsSnap.docs.find((d) => d.id === cd.id);
    const report: DocReport = {
      id: cd.id,
      exists: !!existingDoc,
      fields: existingDoc
        ? { leagueId: existingDoc.data().leagueId, seasonId: existingDoc.data().seasonId, name: existingDoc.data().name }
        : undefined,
    };
    if (existingDoc) {
      report.diffs = diffFields(
        existingDoc.data(),
        { leagueId: LEAGUE_ID, seasonId: SEASON_ID, name: cd.name },
        ['leagueId', 'seasonId', 'name'],
      );
    }
    return report;
  });
  const unexpectedDivisions = divisionsSnap.docs.filter((d) => !canonicalDivisionIds.has(d.id)).map((d) => d.id);

  // ── Teams: leagueId-scoped query (also gives the X/16 count and catches
  // any team under this league that isn't one of our 16 canonical IDs). ──
  const teamsSnap = await db.collection('teams').where('leagueId', '==', LEAGUE_ID).get();
  const canonicalTeamIds = new Set(ds.teams.map((t) => t.id));
  const teams: DocReport[] = ds.teams.map((ct) => {
    const existingDoc = teamsSnap.docs.find((d) => d.id === ct.id);
    const divisionId = ds.divisions.find((d) => d.key === ct.division)!.id;
    const report: DocReport = {
      id: ct.id,
      exists: !!existingDoc,
      fields: existingDoc
        ? {
          name: existingDoc.data().name, leagueId: existingDoc.data().leagueId,
          seasonId: existingDoc.data().seasonId, divisionId: existingDoc.data().divisionId,
        }
        : undefined,
    };
    if (existingDoc) {
      report.diffs = diffFields(
        existingDoc.data(),
        {
          name: ct.name, leagueId: LEAGUE_ID, seasonId: SEASON_ID, divisionId,
        },
        ['name', 'leagueId', 'seasonId', 'divisionId'],
      );
    }
    return report;
  });
  const unexpectedTeams = teamsSnap.docs.filter((d) => !canonicalTeamIds.has(d.id)).map((d) => d.id);

  // ── Matches: leagueId-scoped query (also gives the X/112 count and
  // catches any match under this league not among our 112 canonical IDs —
  // including one with a canonical-LOOKING ID but different teams/date/
  // week, which the per-field diff below would surface). ──
  const matchesSnap = await db.collection('matches').where('leagueId', '==', LEAGUE_ID).get();
  const canonicalMatchIds = new Set(ds.fixtures.map((f) => f.id));
  const matches: DocReport[] = ds.fixtures.map((cf) => {
    const existingDoc = matchesSnap.docs.find((d) => d.id === cf.id);
    const divisionId = ds.divisions.find((d) => d.key === cf.division)!.id;
    const report: DocReport = {
      id: cf.id,
      exists: !!existingDoc,
      fields: existingDoc
        ? {
          leagueId: existingDoc.data().leagueId, seasonId: existingDoc.data().seasonId,
          divisionId: existingDoc.data().divisionId, round: existingDoc.data().round,
          scheduledDate: toComparableDate(existingDoc.data().scheduledDate),
          homeTeamId: existingDoc.data().homeTeamId, awayTeamId: existingDoc.data().awayTeamId,
          status: existingDoc.data().status,
        }
        : undefined,
    };
    if (existingDoc) {
      report.diffs = diffFields(
        existingDoc.data(),
        {
          leagueId: LEAGUE_ID, seasonId: SEASON_ID, divisionId, round: cf.week,
          scheduledDate: new Date(`${cf.date}T00:00:00.000Z`), homeTeamId: cf.homeTeamId, awayTeamId: cf.awayTeamId,
        },
        ['leagueId', 'seasonId', 'divisionId', 'round', 'scheduledDate', 'homeTeamId', 'awayTeamId'],
      );
    }
    return report;
  });
  const unexpectedMatches = matchesSnap.docs.filter((d) => !canonicalMatchIds.has(d.id)).map((d) => d.id);

  return {
    league, season, divisions, teams, matches, unexpectedSeasons, unexpectedDivisions, unexpectedTeams, unexpectedMatches,
  };
}

// ── Reporting ────────────────────────────────────────────────────────────
function printDocReport(label: string, r: DocReport): void {
  console.log(`\n${label}: ${r.exists ? 'EXISTS' : 'MISSING'}`);
  console.log(`  ID: ${r.id}`);
  if (r.exists && r.fields) {
    for (const [k, v] of Object.entries(r.fields)) console.log(`  ${k}: ${JSON.stringify(v)}`);
  }
  if (r.diffs && r.diffs.length > 0) {
    console.log('  DIFFERS FROM CANONICAL:');
    for (const d of r.diffs) console.log(`    ${d.field}: existing=${JSON.stringify(d.existing)} canonical=${JSON.stringify(d.canonical)}`);
  }
}

function printReport(report: Report): void {
  console.log('');
  console.log('='.repeat(70));
  console.log('PRODUCTION PREFLIGHT — PER-DOCUMENT DETAIL');
  console.log('='.repeat(70));

  printDocReport('League', report.league);
  printDocReport('Season', report.season);
  for (const d of report.divisions) printDocReport('Division', d);
  for (const t of report.teams) printDocReport('Team', t);
  for (const m of report.matches) printDocReport('Match', m);

  const conflicts = [
    report.league, report.season, ...report.divisions, ...report.teams, ...report.matches,
  ].filter((r) => r.exists && r.diffs && r.diffs.length > 0);

  const unexpectedTotal = report.unexpectedSeasons.length + report.unexpectedDivisions.length
    + report.unexpectedTeams.length + report.unexpectedMatches.length;

  if (unexpectedTotal > 0) {
    console.log('\nUNEXPECTED DOCUMENTS UNDER THIS LEAGUE (not part of the canonical 132):');
    for (const id of report.unexpectedSeasons) console.log(`  seasons/${id}`);
    for (const id of report.unexpectedDivisions) console.log(`  divisions/${id}`);
    for (const id of report.unexpectedTeams) console.log(`  teams/${id}`);
    for (const id of report.unexpectedMatches) console.log(`  matches/${id}`);
  }

  const teamsExisting = report.teams.filter((t) => t.exists).length;
  const matchesExisting = report.matches.filter((m) => m.exists).length;
  const safeToImport = conflicts.length === 0 && unexpectedTotal === 0;

  console.log('');
  console.log('PRODUCTION PREFLIGHT');
  console.log('='.repeat(20));
  console.log(`League: ${report.league.exists ? 'EXISTS' : 'MISSING'}`);
  console.log(`Season: ${report.season.exists ? 'EXISTS' : 'MISSING'}`);
  console.log(`Division 2: ${report.divisions[0]?.exists ? 'EXISTS' : 'MISSING'}`);
  console.log(`Division 3: ${report.divisions[1]?.exists ? 'EXISTS' : 'MISSING'}`);
  console.log('');
  console.log('Teams:');
  console.log(`${teamsExisting}/16 exist`);
  console.log('');
  console.log('Fixtures:');
  console.log(`${matchesExisting}/112 exist`);
  console.log('');
  console.log('Conflicts:');
  console.log(`${conflicts.length}`);
  console.log('');
  console.log('Unexpected data:');
  console.log(`${unexpectedTotal}`);
  console.log('');
  console.log(`SAFE TO IMPORT: ${safeToImport ? 'YES' : 'NO'}`);
  if (!safeToImport) {
    console.log('');
    console.log('Why:');
    if (conflicts.length > 0) {
      console.log(`  - ${conflicts.length} existing document(s) differ structurally from the canonical dataset (see DIFFERS FROM CANONICAL above).`);
    }
    if (unexpectedTotal > 0) {
      console.log(`  - ${unexpectedTotal} document(s) exist under this league that are not part of the canonical 132 (see UNEXPECTED DOCUMENTS above).`);
    }
    console.log('  Resolve these manually and re-run this preflight before importing — this script changed nothing.');
  } else {
    console.log('');
    console.log('No production data was modified by this preflight.');
  }
}

async function main(): Promise<void> {
  const db = initReadOnlyAdminApp();
  const ds = buildCanonicalDataset();
  const report = await runPreflight(db, ds);
  printReport(report);
}

main().catch((e: unknown) => {
  console.error('\nFAILED:', (e as Error).message ?? e);
  process.exitCode = 1;
});
