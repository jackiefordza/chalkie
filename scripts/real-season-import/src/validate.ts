// Pure, Firebase-free validation of a CanonicalDataset. No network, no
// writes — every check here operates only on the in-memory structure
// dataset.ts produces. This is deliberately run BEFORE the importer is ever
// allowed to write anything (see import.ts).
import {
  FIXTURES_PER_DIVISION, FIXTURES_PER_DIVISION_PER_WEEK, TEAM_COUNT_PER_DIVISION,
  TOTAL_FIXTURES, TOTAL_TEAMS, WEEKS_PER_SEASON, WEEK_DATES,
} from './constants';
import { CanonicalDataset, CanonicalFixture } from './dataset';

export interface ValidationCheck {
  name: string;
  pass: boolean;
  detail: string;
}

export interface ValidationReport {
  checks: ValidationCheck[];
  overallPass: boolean;
}

function check(name: string, pass: boolean, detail: string): ValidationCheck {
  return { name, pass, detail };
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

export function validateDataset(ds: CanonicalDataset): ValidationReport {
  const checks: ValidationCheck[] = [];
  const divisionKeys = ds.divisions.map((d) => d.key);

  // 1. Total team count.
  checks.push(check(
    'total teams === 16',
    ds.teams.length === TOTAL_TEAMS,
    `found ${ds.teams.length}`,
  ));

  // 2. Division count.
  checks.push(check(
    'divisions === 2 (Division 2, Division 3)',
    ds.divisions.length === 2,
    `found ${ds.divisions.length}: ${ds.divisions.map((d) => d.name).join(', ')}`,
  ));

  // 3. Total fixture count.
  checks.push(check(
    'total fixtures === 112',
    ds.fixtures.length === TOTAL_FIXTURES,
    `found ${ds.fixtures.length}`,
  ));

  // 4 & 5. Per-division team/fixture counts.
  for (const divKey of divisionKeys) {
    const teams = ds.teams.filter((t) => t.division === divKey);
    const fixtures = ds.fixtures.filter((f) => f.division === divKey);
    checks.push(check(
      `${divKey}: 8 teams`,
      teams.length === TEAM_COUNT_PER_DIVISION,
      `found ${teams.length}`,
    ));
    checks.push(check(
      `${divKey}: 56 fixtures`,
      fixtures.length === FIXTURES_PER_DIVISION,
      `found ${fixtures.length}`,
    ));

    // Team numbers 1-8 present exactly once each.
    const numbers = teams.map((t) => t.teamNumber).sort((a, b) => a - b);
    const expectedNumbers = Array.from({ length: TEAM_COUNT_PER_DIVISION }, (_, i) => i + 1);
    checks.push(check(
      `${divKey}: team numbers are exactly 1-8, no duplicates`,
      JSON.stringify(numbers) === JSON.stringify(expectedNumbers),
      `found [${numbers.join(',')}]`,
    ));
  }

  // 6 & 7. Per division, per week: exactly 4 fixtures, and each of the 8
  // teams appears in exactly one of them (home or away) — i.e. every team
  // plays exactly once that week, no team idle, no team double-booked.
  let weekShapeFailures = 0;
  let onceAWeekFailures = 0;
  for (const divKey of divisionKeys) {
    const teams = ds.teams.filter((t) => t.division === divKey);
    const teamIds = new Set(teams.map((t) => t.id));
    for (let week = 1; week <= WEEKS_PER_SEASON; week++) {
      const weekFixtures = ds.fixtures.filter((f) => f.division === divKey && f.week === week);
      if (weekFixtures.length !== FIXTURES_PER_DIVISION_PER_WEEK) weekShapeFailures++;
      const appearances = weekFixtures.flatMap((f) => [f.homeTeamId, f.awayTeamId]);
      const distinct = new Set(appearances);
      const everyTeamOnce = appearances.length === TEAM_COUNT_PER_DIVISION
        && distinct.size === TEAM_COUNT_PER_DIVISION
        && [...teamIds].every((id) => distinct.has(id));
      if (!everyTeamOnce) onceAWeekFailures++;
    }
  }
  checks.push(check(
    'every division-week has exactly 4 fixtures',
    weekShapeFailures === 0,
    weekShapeFailures === 0 ? 'all 28 division-weeks correct' : `${weekShapeFailures} division-week(s) wrong`,
  ));
  checks.push(check(
    'each team plays exactly once per week (no idle team, no double-booking)',
    onceAWeekFailures === 0,
    onceAWeekFailures === 0 ? 'all 28 division-weeks correct' : `${onceAWeekFailures} division-week(s) wrong`,
  ));

  // 8 & 9. Every pair meets exactly twice, and the second meeting reverses
  // home/away relative to the first (i.e. weeks 8-14 mirror weeks 1-7).
  let pairCountFailures: string[] = [];
  let mirrorFailures: string[] = [];
  for (const divKey of divisionKeys) {
    const fixtures = ds.fixtures.filter((f) => f.division === divKey);
    const byPair = new Map<string, CanonicalFixture[]>();
    for (const f of fixtures) {
      const key = pairKey(f.homeTeamId, f.awayTeamId);
      const list = byPair.get(key) ?? [];
      list.push(f);
      byPair.set(key, list);
    }
    for (const [key, list] of byPair) {
      if (list.length !== 2) pairCountFailures.push(`${divKey}:${key} met ${list.length}x`);
      else {
        const [a, b] = list;
        const reversed = a.homeTeamId === b.awayTeamId && a.awayTeamId === b.homeTeamId;
        if (!reversed) mirrorFailures.push(`${divKey}:${key} did not reverse home/away`);
      }
    }
    const expectedPairs = (TEAM_COUNT_PER_DIVISION * (TEAM_COUNT_PER_DIVISION - 1)) / 2; // 28
    if (byPair.size !== expectedPairs) {
      pairCountFailures.push(`${divKey}: only ${byPair.size} distinct pairs, expected ${expectedPairs}`);
    }
  }
  checks.push(check(
    'every pair meets exactly twice (full double round-robin, both divisions)',
    pairCountFailures.length === 0,
    pairCountFailures.length === 0 ? '28 pairs x 2 meetings, both divisions' : pairCountFailures.join('; '),
  ));
  checks.push(check(
    'home/away is reversed between a pair\'s two meetings (weeks 8-14 mirror weeks 1-7)',
    mirrorFailures.length === 0,
    mirrorFailures.length === 0 ? 'confirmed for every pair, both divisions' : mirrorFailures.join('; '),
  ));

  // 10. No duplicate fixture IDs, and no duplicate (division,week,home,away).
  const idCounts = new Map<string, number>();
  const tupleCounts = new Map<string, number>();
  for (const f of ds.fixtures) {
    idCounts.set(f.id, (idCounts.get(f.id) ?? 0) + 1);
    const tuple = `${f.division}|${f.week}|${f.homeTeamId}|${f.awayTeamId}`;
    tupleCounts.set(tuple, (tupleCounts.get(tuple) ?? 0) + 1);
  }
  const dupIds = [...idCounts.entries()].filter(([, n]) => n > 1);
  const dupTuples = [...tupleCounts.entries()].filter(([, n]) => n > 1);
  checks.push(check(
    'no duplicate fixture IDs',
    dupIds.length === 0,
    dupIds.length === 0 ? 'all 112 IDs unique' : `${dupIds.length} duplicate ID(s): ${dupIds.map(([k]) => k).join(', ')}`,
  ));
  checks.push(check(
    'no duplicate (division, week, home, away) fixture',
    dupTuples.length === 0,
    dupTuples.length === 0 ? 'all 112 fixtures unique' : `${dupTuples.length} duplicate(s)`,
  ));

  // 11. No cross-division fixtures: both teams in a fixture must belong to
  // that same fixture's own division.
  const teamDivisionById = new Map(ds.teams.map((t) => [t.id, t.division] as const));
  const crossDivision = ds.fixtures.filter((f) => (
    teamDivisionById.get(f.homeTeamId) !== f.division
    || teamDivisionById.get(f.awayTeamId) !== f.division
  ));
  checks.push(check(
    'no cross-division fixtures (both teams always belong to the fixture\'s own division)',
    crossDivision.length === 0,
    crossDivision.length === 0 ? 'confirmed for all 112 fixtures' : `${crossDivision.length} fixture(s): ${crossDivision.map((f) => f.id).join(', ')}`,
  ));

  // 12. Dates match the official league calendar exactly, consistently
  // across both divisions (same week => same date, every division).
  const dateMismatches = ds.fixtures.filter((f) => f.date !== WEEK_DATES[f.week - 1]);
  checks.push(check(
    'every fixture\'s date matches the official week->date calendar',
    dateMismatches.length === 0,
    dateMismatches.length === 0 ? 'confirmed for all 112 fixtures' : `${dateMismatches.length} mismatch(es): ${dateMismatches.map((f) => f.id).join(', ')}`,
  ));
  checks.push(check(
    'calendar has exactly 14 distinct dates, one per week',
    WEEK_DATES.length === WEEKS_PER_SEASON && new Set(WEEK_DATES).size === WEEKS_PER_SEASON,
    `found ${WEEK_DATES.length} entries, ${new Set(WEEK_DATES).size} distinct`,
  ));

  const overallPass = checks.every((c) => c.pass);
  return { checks, overallPass };
}

export function printValidationReport(report: ValidationReport): void {
  console.log('');
  console.log('DATASET VALIDATION');
  console.log('==================');
  for (const c of report.checks) {
    console.log(`[${c.pass ? 'PASS' : 'FAIL'}] ${c.name} — ${c.detail}`);
  }
  console.log('');
  console.log(`OVERALL: ${report.overallPass ? 'PASS' : 'FAIL'}`);
}
