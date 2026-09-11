// Coverage for the CSV parse/validate pipeline (Phase 11). The Firestore-
// touching batch write in importFixtures.ts needs a real backend and isn't
// unit-tested here — same pure/impure split as the rest of this engagement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFixtureCSV, validateFixtureRows, type TeamRef, type ExistingFixtureRef } from './fixtureImport';

const TEAMS: TeamRef[] = [
  { id: 't1', name: 'The Red Lion' },
  { id: 't2', name: 'White Swan' },
  { id: 't3', name: 'The Crown' },
];

test('parseFixtureCSV: parses a well-formed file into rows, header is row 1', () => {
  const csv = 'Date,Home Team,Away Team,Venue\n2026-10-14,The Red Lion,White Swan,The Red Lion Pub\n2026-10-21,The Crown,The Red Lion,';
  const { rows, headerError } = parseFixtureCSV(csv);
  assert.equal(headerError, null);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].rowNumber, 2);
  assert.deepEqual(rows[0].raw, { date: '2026-10-14', homeTeam: 'The Red Lion', awayTeam: 'White Swan', venue: 'The Red Lion Pub' });
  assert.equal(rows[1].raw.venue, '');
});

test('parseFixtureCSV: handles a quoted field with an embedded comma', () => {
  const csv = 'Date,Home Team,Away Team,Venue\n2026-10-14,The Red Lion,White Swan,"The Red Lion, 12 High St"';
  const { rows } = parseFixtureCSV(csv);
  assert.equal(rows[0].raw.venue, 'The Red Lion, 12 High St');
});

test('parseFixtureCSV: missing required columns is a header error, not a crash', () => {
  const { rows, headerError } = parseFixtureCSV('Date,Home,Away\n2026-10-14,A,B');
  assert.equal(rows.length, 0);
  assert.ok(headerError);
});

test('parseFixtureCSV: an empty file is a header error', () => {
  const { headerError } = parseFixtureCSV('');
  assert.ok(headerError);
});

test('validateFixtureRows: a clean file is entirely ready, rounds assigned by distinct date', () => {
  const { rows } = parseFixtureCSV(
    'Date,Home Team,Away Team,Venue\n'
    + '2026-10-14,The Red Lion,White Swan,\n'
    + '2026-10-14,The Crown,White Swan,\n'
    + '2026-10-21,White Swan,The Crown,',
  );
  const { ready, errors } = validateFixtureRows(rows, TEAMS, []);
  assert.equal(errors.length, 0);
  assert.equal(ready.length, 3);
  assert.equal(ready[0].round, 1);
  assert.equal(ready[1].round, 1);
  assert.equal(ready[2].round, 2);
});

test('validateFixtureRows: unknown team name is reported with the row number', () => {
  const { rows } = parseFixtureCSV('Date,Home Team,Away Team,Venue\n2026-10-14,Not A Real Team,White Swan,');
  const { ready, errors } = validateFixtureRows(rows, TEAMS, []);
  assert.equal(ready.length, 0);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].rowNumber, 2);
  assert.match(errors[0].message, /Not A Real Team.*not in this division/);
});

test('validateFixtureRows: a team playing itself is rejected', () => {
  const { rows } = parseFixtureCSV('Date,Home Team,Away Team,Venue\n2026-10-14,The Red Lion,The Red Lion,');
  const { ready, errors } = validateFixtureRows(rows, TEAMS, []);
  assert.equal(ready.length, 0);
  assert.match(errors[0].message, /cannot play itself/);
});

test('validateFixtureRows: an invalid date is rejected without crashing', () => {
  const { rows } = parseFixtureCSV('Date,Home Team,Away Team,Venue\n14/10/2026,The Red Lion,White Swan,');
  const { ready, errors } = validateFixtureRows(rows, TEAMS, []);
  assert.equal(ready.length, 0);
  assert.match(errors[0].message, /not a valid date/);
});

test('validateFixtureRows: a fixture already in Firestore is flagged, not silently re-imported', () => {
  const { rows } = parseFixtureCSV('Date,Home Team,Away Team,Venue\n2026-10-14,The Red Lion,White Swan,');
  const existing: ExistingFixtureRef[] = [{ homeTeamId: 't1', awayTeamId: 't2', scheduledDate: new Date(2026, 9, 14) }];
  const { ready, errors } = validateFixtureRows(rows, TEAMS, existing);
  assert.equal(ready.length, 0);
  assert.match(errors[0].message, /already exists/);
});

test('validateFixtureRows: two identical rows within the same file are a duplicate, not two imports', () => {
  const { rows } = parseFixtureCSV(
    'Date,Home Team,Away Team,Venue\n2026-10-14,The Red Lion,White Swan,\n2026-10-14,The Red Lion,White Swan,',
  );
  const { ready, errors } = validateFixtureRows(rows, TEAMS, []);
  assert.equal(ready.length, 1);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /Duplicate/);
});

test('validateFixtureRows: the reverse fixture (home/away swapped) on the same date is NOT a duplicate', () => {
  const { rows } = parseFixtureCSV(
    'Date,Home Team,Away Team,Venue\n2026-10-14,The Red Lion,White Swan,\n2026-10-14,White Swan,The Red Lion,',
  );
  const { ready, errors } = validateFixtureRows(rows, TEAMS, []);
  assert.equal(errors.length, 0);
  assert.equal(ready.length, 2);
});

test('validateFixtureRows: valid and invalid rows are partitioned independently (partial import)', () => {
  const { rows } = parseFixtureCSV(
    'Date,Home Team,Away Team,Venue\n'
    + '2026-10-14,The Red Lion,White Swan,\n'
    + '2026-10-21,Not A Team,White Swan,\n'
    + '2026-10-28,The Crown,White Swan,',
  );
  const { ready, errors } = validateFixtureRows(rows, TEAMS, []);
  assert.equal(ready.length, 2);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].rowNumber, 3);
});
