// Every fixed identifier, name, and source fact this importer uses. Nothing
// here is derived from a live query, a CLI argument, or the fixture-generator
// project — every value is a compile-time constant transcribed directly from
// the official Bedford & Kempston District Darts League Winter 2026/27
// fixture poster (the single authoritative source, per the investigation
// that preceded this script — see the project's own audit reports for how
// that was established and why the fixture-generator's own seed/output is
// NOT used here).
//
// This file intentionally encodes the poster's own COMPACT representation
// (16 team names, one shared 7-week team-number matrix, one 14-week date
// calendar) rather than a hand-typed list of 112 expanded fixtures. Fewer,
// smaller, independently-checkable facts here means less surface for a
// transcription error — the full fixture list is *derived* mechanically by
// dataset.ts, not retyped.
//
// STAGING-ONLY VARIANT: this directory is a copy of PR #36's
// scripts/real-season-import, with exactly one change from the original —
// the project ID immediately below. Everything else (dataset, validation,
// importer logic, write-guard allowlist) is byte-for-byte identical to the
// reviewed original. This copy exists to populate chalkie-app-staging for
// the pilot; it is never run against chalkie-app.

// ── Firebase project — the one and only project this script may ever touch ──
export const EXPECTED_PROJECT_ID = 'chalkie-app-staging';

// ── Real league identity (hard-coded — never read from argv or env) ────────
// Deliberately distinct-looking from showcase-seed's `showcase-*` IDs and
// from any Division 1/4 identifier, so a typo can't accidentally collide.
export const LEAGUE_ID = 'bedford-kempston-district';
export const SEASON_ID = 'bedford-kempston-winter-2026-27';
export const DIVISION_2_ID = 'bedford-kempston-winter-2026-27-division-2';
export const DIVISION_3_ID = 'bedford-kempston-winter-2026-27-division-3';

export const LEAGUE_NAME = 'Bedford and Kempston District Darts League';
export const SEASON_NAME = 'Winter 2026-27';
export const DIVISION_2_NAME = 'Division 2';
export const DIVISION_3_NAME = 'Division 3';

export type DivisionKey = 'division2' | 'division3';

export const DIVISION_IDS: Record<DivisionKey, string> = {
  division2: DIVISION_2_ID,
  division3: DIVISION_3_ID,
};

export const DIVISION_NAMES: Record<DivisionKey, string> = {
  division2: DIVISION_2_NAME,
  division3: DIVISION_3_NAME,
};

export function teamId(division: DivisionKey, teamNumber: number): string {
  const d = division === 'division2' ? 'd2' : 'd3';
  return `bk-${d}-team-${teamNumber}`;
}

export function matchId(division: DivisionKey, week: number, homeNumber: number, awayNumber: number): string {
  const d = division === 'division2' ? 'd2' : 'd3';
  return `bk-${d}-w${String(week).padStart(2, '0')}-${homeNumber}v${awayNumber}`;
}

// ── Official team numbering (poster order, top-to-bottom / left-to-right) ──
// Division 2, sponsored by Bedford Bifolds.
export const DIVISION_2_TEAMS: readonly string[] = [
  'Burnaby Arms C',        // 1
  'Oakley Sports Club',    // 2
  'North End Club A',      // 3
  'Constitutional Club B', // 4
  'The Swan',              // 5
  'The Kings Arms Sandy',  // 6
  'The Mulberry Bush Anchor', // 7
  'Fox & Hounds',          // 8
];

// Division 3, sponsored by Inked by Adua.
export const DIVISION_3_TEAMS: readonly string[] = [
  'The Grafton',             // 1
  'Burnaby Arms B',          // 2
  'Cople Sports & Social',   // 3
  'Three Cups',              // 4
  'Marston Club B',          // 5
  'Five Bells "Bees"',       // 6
  'North End Club B',        // 7
  'The Kings Arms Bedford',  // 8
];

export const DIVISION_TEAMS: Record<DivisionKey, readonly string[]> = {
  division2: DIVISION_2_TEAMS,
  division3: DIVISION_3_TEAMS,
};

// ── The poster's shared fixture matrix (weeks 1-7; identical team-number ───
// pattern reused, unchanged, across every division on the poster — this is
// the tool's own "LEAGUE FIXTURE CALENDAR" grid, confirmed against the
// poster image directly, corrections applied where an earlier transcription
// pass had flagged uncertainty). Each entry is [homeTeamNumber, awayTeamNumber].
// Weeks 8-14 are NOT separately transcribed — the poster states explicitly
// "Weeks 8-14 replay the same fixture numbers shown above, in reverse (home
// venue swapped)", so dataset.ts derives them by reversing each pair.
export const WEEK_1_TO_7_MATRIX: readonly (readonly [number, number])[][] = [
  [[2, 1], [3, 8], [4, 7], [5, 6]], // week 1
  [[3, 4], [1, 7], [8, 6], [2, 5]], // week 2
  [[6, 2], [7, 8], [4, 1], [5, 3]], // week 3
  [[7, 5], [8, 4], [2, 3], [1, 6]], // week 4
  [[3, 1], [4, 2], [5, 8], [6, 7]], // week 5
  [[5, 4], [8, 1], [2, 7], [3, 6]], // week 6
  [[7, 3], [8, 2], [1, 5], [6, 4]], // week 7
];

// ── The poster's "LEAGUE FIXTURE CALENDAR" week -> date mapping. ───────────
// Format: ISO 8601 (yyyy-mm-dd), converted from the poster's dd.mm.yy.
export const WEEK_DATES: readonly string[] = [
  '2026-10-14', // week 1
  '2026-10-21', // week 2
  '2026-10-28', // week 3
  '2026-11-04', // week 4
  '2026-11-18', // week 5
  '2026-12-02', // week 6
  '2026-12-09', // week 7
  '2027-01-06', // week 8
  '2027-01-13', // week 9
  '2027-01-27', // week 10
  '2027-02-10', // week 11
  '2027-02-17', // week 12
  '2027-03-10', // week 13
  '2027-03-17', // week 14
];

export const TEAM_COUNT_PER_DIVISION = 8;
export const WEEKS_PER_SEASON = 14;
export const FIXTURES_PER_DIVISION_PER_WEEK = 4;
export const FIXTURES_PER_DIVISION = TEAM_COUNT_PER_DIVISION * (TEAM_COUNT_PER_DIVISION - 1); // 56
export const TOTAL_TEAMS = TEAM_COUNT_PER_DIVISION * 2; // 16
export const TOTAL_FIXTURES = FIXTURES_PER_DIVISION * 2; // 112

// Venue: the poster provides no separate venue field. For this pub-league,
// team name conventionally IS the home venue (confirmed structurally by the
// "Burnaby Arms A/B/C" pattern spanning three divisions at one shared pub —
// matching the documented 2-board/3-team capacity constraint). This is an
// INFERENCE, not printed data — flagged in the audit report, applied here
// only to populate Team.address/Match.venue with *something* recognisable
// rather than leaving them blank; never presented as poster-confirmed.
export function inferredVenueName(teamName: string): string {
  return teamName;
}
