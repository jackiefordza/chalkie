// Pure CSV parsing + validation for bulk fixture import (Phase 11) — no
// Firestore/React dependency, so it's fully unit-testable. The actual write
// (a single Firestore batch, shaped identically to admin-fixtures.tsx's own
// generateFixtures()) lives in importFixtures.ts.
export interface FixtureImportRow {
  rowNumber: number; // 1-indexed including the header row (row 1)
  raw: { date: string; homeTeam: string; awayTeam: string; venue: string };
}

export interface ValidatedFixtureRow {
  rowNumber: number;
  homeTeamId: string;
  homeTeamName: string;
  awayTeamId: string;
  awayTeamName: string;
  scheduledDate: Date;
  venue: string | null;
  round: number;
}

export interface FixtureImportError {
  rowNumber: number;
  message: string;
}

export interface FixtureImportResult {
  ready: ValidatedFixtureRow[];
  errors: FixtureImportError[];
}

export interface ExistingFixtureRef {
  homeTeamId: string;
  awayTeamId: string;
  scheduledDate: Date;
}

export interface TeamRef {
  id: string;
  name: string;
}

// A minimal RFC4180-ish line splitter — handles quoted fields (so a venue
// like `"The Red Lion, 12 High St"` survives) but not embedded newlines
// inside a quoted field, which this domain's data (team/venue names) never
// needs.
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      fields.push(field);
      field = '';
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

export function parseFixtureCSV(text: string): { rows: FixtureImportRow[]; headerError: string | null } {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { rows: [], headerError: 'The file is empty.' };

  const header = parseCSVLine(lines[0]).map((h) => h.trim().toLowerCase());
  const dateIdx = header.indexOf('date');
  const homeIdx = header.indexOf('home team');
  const awayIdx = header.indexOf('away team');
  const venueIdx = header.indexOf('venue');

  if (dateIdx === -1 || homeIdx === -1 || awayIdx === -1) {
    return { rows: [], headerError: 'Expected columns: Date, Home Team, Away Team, and optionally Venue.' };
  }

  const rows: FixtureImportRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    rows.push({
      rowNumber: i + 1,
      raw: {
        date: (cols[dateIdx] ?? '').trim(),
        homeTeam: (cols[homeIdx] ?? '').trim(),
        awayTeam: (cols[awayIdx] ?? '').trim(),
        venue: venueIdx !== -1 ? (cols[venueIdx] ?? '').trim() : '',
      },
    });
  }
  return { rows, headerError: null };
}

// Same YYYY-MM-DD convention as admin-fixtures.tsx's own parseDateInput
// (kept as a small local duplicate rather than exported/shared — it's five
// lines, and this module is meant to have zero dependency on that screen).
function parseFixtureDate(text: string): Date | null {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Rounds are a display-grouping convenience only (matches admin-fixtures.tsx
// / generateRoundRobinFixtures' own semantics — every fixture on the same
// date shares a round), not read anywhere in the result/stats pipeline.
// Assigned purely from THIS import's own dates — if the division already
// has fixtures, newly-imported round numbers aren't reconciled against
// them (a rare re-import scenario; cosmetic only, since round has no
// bearing on correctness anywhere else).
function assignRounds(rows: ValidatedFixtureRow[]): void {
  const uniqueDates = [...new Set(rows.map((r) => dateKey(r.scheduledDate)))].sort();
  const roundByDate = new Map(uniqueDates.map((d, i) => [d, i + 1]));
  rows.forEach((r) => { r.round = roundByDate.get(dateKey(r.scheduledDate))!; });
}

export function validateFixtureRows(
  rows: FixtureImportRow[],
  teams: TeamRef[],
  existingMatches: ExistingFixtureRef[],
): FixtureImportResult {
  const byNameLower = new Map(teams.map((t) => [t.name.trim().toLowerCase(), t]));
  const seenInFile = new Set<string>();
  const seenExisting = new Set(existingMatches.map((m) => `${m.homeTeamId}|${m.awayTeamId}|${dateKey(m.scheduledDate)}`));

  const ready: ValidatedFixtureRow[] = [];
  const errors: FixtureImportError[] = [];

  for (const row of rows) {
    const { date, homeTeam, awayTeam, venue } = row.raw;

    if (!homeTeam) { errors.push({ rowNumber: row.rowNumber, message: 'Home Team is missing.' }); continue; }
    if (!awayTeam) { errors.push({ rowNumber: row.rowNumber, message: 'Away Team is missing.' }); continue; }

    const home = byNameLower.get(homeTeam.toLowerCase());
    if (!home) { errors.push({ rowNumber: row.rowNumber, message: `"${homeTeam}" is not in this division.` }); continue; }
    const away = byNameLower.get(awayTeam.toLowerCase());
    if (!away) { errors.push({ rowNumber: row.rowNumber, message: `"${awayTeam}" is not in this division.` }); continue; }
    if (home.id === away.id) { errors.push({ rowNumber: row.rowNumber, message: `${home.name} cannot play itself.` }); continue; }

    const scheduledDate = parseFixtureDate(date);
    if (!scheduledDate) { errors.push({ rowNumber: row.rowNumber, message: `"${date}" is not a valid date (use YYYY-MM-DD).` }); continue; }

    const key = `${home.id}|${away.id}|${dateKey(scheduledDate)}`;
    if (seenExisting.has(key)) { errors.push({ rowNumber: row.rowNumber, message: 'This fixture already exists.' }); continue; }
    if (seenInFile.has(key)) { errors.push({ rowNumber: row.rowNumber, message: 'Duplicate of another row in this file.' }); continue; }
    seenInFile.add(key);

    ready.push({
      rowNumber: row.rowNumber,
      homeTeamId: home.id,
      homeTeamName: home.name,
      awayTeamId: away.id,
      awayTeamName: away.name,
      scheduledDate,
      venue: venue || null,
      round: 0,
    });
  }

  assignRounds(ready);
  return { ready, errors };
}
