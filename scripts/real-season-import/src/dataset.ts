// Pure, Firebase-free construction of the canonical Division 2 + Division 3
// dataset from the compact poster source in constants.ts. No network, no
// file I/O, no randomness — calling buildCanonicalDataset() twice always
// produces byte-for-byte identical output. This is deliberately the ONLY
// place the 7-week matrix is expanded into full fixtures; nothing else in
// this script (or the importer) re-derives fixtures independently.
import {
  DIVISION_2_ID, DIVISION_2_NAME, DIVISION_2_TEAMS,
  DIVISION_3_ID, DIVISION_3_NAME, DIVISION_3_TEAMS,
  DivisionKey, LEAGUE_ID, LEAGUE_NAME, SEASON_ID, SEASON_NAME,
  WEEK_1_TO_7_MATRIX, WEEK_DATES, WEEKS_PER_SEASON,
  inferredVenueName, matchId, teamId,
} from './constants';

export interface CanonicalTeam {
  id: string;
  division: DivisionKey;
  teamNumber: number; // 1-8, official poster numbering
  name: string;
  venue: string; // inferred (team name) — see constants.ts's inferredVenueName doc comment
}

export interface CanonicalFixture {
  id: string;
  division: DivisionKey;
  week: number; // 1-14
  date: string; // ISO 8601, from the poster's own calendar
  homeTeamNumber: number;
  awayTeamNumber: number;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  venue: string; // the home team's inferred venue
}

export interface CanonicalDivision {
  id: string;
  key: DivisionKey;
  name: string;
  order: number;
}

export interface CanonicalDataset {
  league: { id: string; name: string };
  season: { id: string; leagueId: string; name: string };
  divisions: CanonicalDivision[];
  teams: CanonicalTeam[];
  fixtures: CanonicalFixture[];
}

const DIVISION_KEYS: readonly DivisionKey[] = ['division2', 'division3'];

function teamsForDivision(division: DivisionKey): readonly string[] {
  return division === 'division2' ? DIVISION_2_TEAMS : DIVISION_3_TEAMS;
}

/**
 * Returns the 4 [home, away] team-number pairs for a given week (1-14) of
 * an 8-team division. Weeks 1-7 come directly from the poster's matrix;
 * weeks 8-14 are the SAME pairing as week (n-7), with home/away reversed —
 * mechanically applying the poster's own stated rule ("Weeks 8-14 replay
 * the same fixture numbers shown above, in reverse (home venue swapped)"),
 * never a second independently-transcribed set of numbers.
 */
export function pairsForWeek(week: number): readonly (readonly [number, number])[] {
  if (week < 1 || week > WEEKS_PER_SEASON) {
    throw new Error(`week must be between 1 and ${WEEKS_PER_SEASON}, got ${week}`);
  }
  if (week <= 7) return WEEK_1_TO_7_MATRIX[week - 1];
  const firstHalf = WEEK_1_TO_7_MATRIX[week - 8];
  return firstHalf.map(([home, away]) => [away, home] as const);
}

function buildTeams(division: DivisionKey): CanonicalTeam[] {
  return teamsForDivision(division).map((name, idx) => {
    const teamNumber = idx + 1;
    return {
      id: teamId(division, teamNumber),
      division,
      teamNumber,
      name,
      venue: inferredVenueName(name),
    };
  });
}

function buildFixtures(division: DivisionKey): CanonicalFixture[] {
  const names = teamsForDivision(division);
  const fixtures: CanonicalFixture[] = [];
  for (let week = 1; week <= WEEKS_PER_SEASON; week++) {
    const date = WEEK_DATES[week - 1];
    for (const [homeNumber, awayNumber] of pairsForWeek(week)) {
      const homeTeamName = names[homeNumber - 1];
      const awayTeamName = names[awayNumber - 1];
      fixtures.push({
        id: matchId(division, week, homeNumber, awayNumber),
        division,
        week,
        date,
        homeTeamNumber: homeNumber,
        awayTeamNumber: awayNumber,
        homeTeamId: teamId(division, homeNumber),
        awayTeamId: teamId(division, awayNumber),
        homeTeamName,
        awayTeamName,
        venue: inferredVenueName(homeTeamName),
      });
    }
  }
  return fixtures;
}

export function buildCanonicalDataset(): CanonicalDataset {
  const teams = DIVISION_KEYS.flatMap(buildTeams);
  const fixtures = DIVISION_KEYS.flatMap(buildFixtures);
  return {
    league: { id: LEAGUE_ID, name: LEAGUE_NAME },
    season: { id: SEASON_ID, leagueId: LEAGUE_ID, name: SEASON_NAME },
    divisions: [
      { id: DIVISION_2_ID, key: 'division2', name: DIVISION_2_NAME, order: 2 },
      { id: DIVISION_3_ID, key: 'division3', name: DIVISION_3_NAME, order: 3 },
    ],
    teams,
    fixtures,
  };
}
