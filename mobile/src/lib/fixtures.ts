// Round-robin fixture generation (circle method). Every team plays every
// other team twice — once home, once away — with home/away perfectly
// balanced across the season. Odd team counts get a bye each round.

export interface FixtureTeam {
  id: string;
  venueId?: string | null;
}

export interface GeneratedFixture {
  round: number;
  homeTeamId: string;
  awayTeamId: string;
}

export interface SeasonBreakRange {
  start: Date;
  end: Date;
}

export interface GenerateFixturesOptions {
  startDate: Date;
  intervalDays: number;
  // Date ranges fixtures must never land in (Christmas, a venue closure,
  // etc.) — the date cursor skips forward past `end` whenever a round would
  // otherwise fall inside one, pushing every later round back by the same
  // amount rather than compressing the rest of the season.
  breaks?: SeasonBreakRange[];
  // venueId -> board count. A round where more teams sharing a venue are
  // drawn home than that venue has boards gets the excess matches shifted to
  // consecutive following days so nobody's turning up to a full venue.
  // Venues missing from this map (or a team with no venueId) are treated as
  // unconstrained — no map entry means no conflict data to enforce.
  venueBoardCounts?: Record<string, number>;
}

export interface GeneratedFixtureWithDate extends GeneratedFixture {
  scheduledDate: Date;
  // True if this fixture's date was pushed off its round's normal date to
  // resolve a venue/board clash — surfaced so the caller can tell the admin
  // what moved instead of silently rewriting dates.
  venueConflictShifted: boolean;
}

const BYE = Symbol('bye');
type Slot = string | typeof BYE;

function singleLegRounds(teamIds: string[]): Slot[][][] {
  const slots: Slot[] = [...teamIds];
  if (slots.length % 2 !== 0) slots.push(BYE);

  const n = slots.length;
  const rounds: Slot[][][] = [];
  let arr = slots.slice();

  for (let round = 0; round < n - 1; round++) {
    const roundPairs: Slot[][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      // Alternate which side is "home" each round — without this the team
      // fixed at index 0 would always be home whenever it lands at i === 0.
      roundPairs.push(round % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(roundPairs);

    const fixed = arr[0];
    const rest = arr.slice(1);
    const last = rest.pop() as Slot;
    arr = [fixed, last, ...rest];
  }

  return rounds;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// Pushes `date` forward past any break range it falls inside, re-checking
// after each jump in case that lands it inside a different (e.g.
// overlapping or adjacent) break.
function skipBreaks(date: Date, breaks: SeasonBreakRange[]): Date {
  let d = date;
  let movedAgain = true;
  while (movedAgain) {
    movedAgain = false;
    for (const b of breaks) {
      if (d >= b.start && d <= b.end) {
        d = addDays(b.end, 1);
        movedAgain = true;
      }
    }
  }
  return d;
}

// Within one round's fixtures (all sharing the round's base date), shifts
// the excess home fixtures at any over-subscribed venue onto consecutive
// following days. Deterministic (sorted by home team id) so re-generating
// with the same inputs always produces the same result.
function resolveVenueConflicts(
  roundFixtures: (GeneratedFixture & { scheduledDate: Date })[],
  teamVenueId: Map<string, string | null | undefined>,
  venueBoardCounts: Record<string, number>,
): (GeneratedFixtureWithDate)[] {
  const byVenue = new Map<string, (GeneratedFixture & { scheduledDate: Date })[]>();
  roundFixtures.forEach((fixture) => {
    const venueId = teamVenueId.get(fixture.homeTeamId);
    if (!venueId || venueBoardCounts[venueId] == null) return;
    if (!byVenue.has(venueId)) byVenue.set(venueId, []);
    byVenue.get(venueId)!.push(fixture);
  });

  const shifted = new Map<GeneratedFixture, Date>();
  byVenue.forEach((fixtures, venueId) => {
    const boardCount = venueBoardCounts[venueId];
    if (fixtures.length <= boardCount) return;
    const sorted = [...fixtures].sort((a, b) => a.homeTeamId.localeCompare(b.homeTeamId));
    sorted.slice(boardCount).forEach((fixture, i) => {
      shifted.set(fixture, addDays(fixture.scheduledDate, i + 1));
    });
  });

  return roundFixtures.map((fixture) => {
    const newDate = shifted.get(fixture);
    return {
      ...fixture,
      scheduledDate: newDate ?? fixture.scheduledDate,
      venueConflictShifted: newDate != null,
    };
  });
}

export function generateRoundRobinFixtures(
  teams: FixtureTeam[],
  opts: GenerateFixturesOptions,
): GeneratedFixtureWithDate[] {
  if (teams.length < 2) return [];

  const teamIds = teams.map((t) => t.id);
  const teamVenueId = new Map(teams.map((t) => [t.id, t.venueId]));
  const breaks = opts.breaks ?? [];
  const venueBoardCounts = opts.venueBoardCounts ?? {};

  const firstLeg = singleLegRounds(teamIds);
  const secondLeg = firstLeg.map((round) => round.map(([home, away]) => [away, home]));
  const allRounds = [...firstLeg, ...secondLeg];

  const fixtures: GeneratedFixtureWithDate[] = [];
  let cursor = skipBreaks(new Date(opts.startDate), breaks);

  allRounds.forEach((roundPairs, roundIndex) => {
    if (roundIndex > 0) {
      cursor = skipBreaks(addDays(cursor, opts.intervalDays), breaks);
    }
    const scheduledDate = new Date(cursor);

    const roundFixtures: (GeneratedFixture & { scheduledDate: Date })[] = [];
    roundPairs.forEach(([home, away]) => {
      if (typeof home !== 'string' || typeof away !== 'string') return;
      roundFixtures.push({ round: roundIndex + 1, homeTeamId: home, awayTeamId: away, scheduledDate });
    });

    fixtures.push(...resolveVenueConflicts(roundFixtures, teamVenueId, venueBoardCounts));
  });

  return fixtures;
}
