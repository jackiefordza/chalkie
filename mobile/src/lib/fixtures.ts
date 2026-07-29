// Round-robin fixture generation (circle method), across every division in a
// season at once. Every team plays every other team in its own division
// twice (home and away). The whole season shares one weekly match night —
// every division's Nth round lands on the same calendar date — and where
// venues are shared by teams with fewer boards than teams drawn home there in
// some week, the fix is choosing which pairing happens on which date (and
// which side is home for it), never moving a fixture off its designated
// match night. Two distinct kinds of clash need two distinct fixes:
//  - Two teams sharing a venue end up *within the same division's own round*
//    (e.g. both independently home against other opponents that week): this
//    can only be fixed by choosing which side is home for each pairing —
//    two pairings stuck in the same round can never be separated just by
//    picking which calendar date that round lands on.
//  - Two teams sharing a venue are in *different* divisions, each drawn home
//    in whatever round their own division happens to be playing that week:
//    this is fixed by reordering which of a division's rounds lands on which
//    calendar week (round-robin's round order can be freely permuted without
//    breaking the schedule — every team still plays every other exactly once
//    per leg, regardless of which date that meeting happens to fall on).
// A round only ever moves off its own natural week (i.e. leg 2 repeating leg
// 1's pairings, home/away reversed, in the same week order — the shape
// leagues already run by hand) when a real clash actually forces it; nothing
// gets reshuffled just because reshuffling was an option.

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
  // venueId -> board count. Venues missing from this map (or a team with no
  // venueId) are treated as unconstrained — no map entry means no conflict
  // data to enforce.
  venueBoardCounts?: Record<string, number>;
}

export interface GeneratedFixtureWithDate extends GeneratedFixture {
  scheduledDate: Date;
}

export interface DivisionFixtureInput {
  divisionId: string;
  teams: FixtureTeam[];
}

// A venue/week combination that still had more teams drawn home than it has
// boards even after trying every reordering and every home/away choice —
// realistically only possible with a genuinely oversubscribed venue (more
// sharing teams than the season has rounds/boards to spread them across).
// Surfaced so an admin can fix it by hand (the per-fixture edit sheet) rather
// than it being silently ignored.
export interface VenueClash {
  week: number;
  venueId: string;
  teamIds: string[];
}

export interface SeasonFixtureResult {
  fixturesByDivision: Record<string, GeneratedFixtureWithDate[]>;
  unresolvedClashes: VenueClash[];
}

const BYE = Symbol('bye');
type Slot = string | typeof BYE;
interface Pairing { homeTeamId: string; awayTeamId: string }
interface RawPair { a: string; b: string }

// One leg's worth of rounds as *unordered* pairs — who plays whom each round
// is fixed by the standard circle-method rotation, but which side is "home"
// isn't decided here (see resolveRoundHomeChoices).
function buildLegPairs(teamIds: string[]): RawPair[][] {
  const slots: Slot[] = [...teamIds];
  if (slots.length % 2 !== 0) slots.push(BYE);

  const n = slots.length;
  const rounds: RawPair[][] = [];
  let arr = slots.slice();

  for (let round = 0; round < n - 1; round++) {
    const roundPairs: RawPair[] = [];
    for (let i = 0; i < n / 2; i++) {
      const x = arr[i];
      const y = arr[n - 1 - i];
      if (typeof x === 'string' && typeof y === 'string') roundPairs.push({ a: x, b: y });
    }
    rounds.push(roundPairs);

    const fixed = arr[0];
    const rest = arr.slice(1);
    const last = rest.pop() as Slot;
    arr = [fixed, last, ...rest];
  }

  return rounds;
}

// Cheap, deterministic pseudo-random bit — used only to vary the "no
// conflict to resolve at all" default home/away pattern across
// generateSeasonFixtures' inner seed attempts, not for anything
// security-sensitive.
function pseudoRandomBool(...parts: number[]): boolean {
  let h = 2166136261;
  parts.forEach((p) => { h = Math.imul(h ^ p, 16777619); });
  return (h >>> 0) % 2 === 0;
}

// Every board-count-tracked venue shared by 2+ teams, regardless of which
// division each is in — the only venues where a half-preference bias could
// possibly matter.
function sharedTrackedVenues(divisions: DivisionFixtureInput[], venueBoardCounts: Record<string, number>): string[] {
  const counts = new Map<string, number>();
  divisions.forEach((d) => d.teams.forEach((t) => {
    if (!t.venueId || venueBoardCounts[t.venueId] == null) return;
    counts.set(t.venueId, (counts.get(t.venueId) ?? 0) + 1);
  }));
  return [...counts.entries()].filter(([, count]) => count >= 2).map(([id]) => id).sort();
}

// For each shared venue, splits its teams into "prefers its home games in
// the first half of the season" vs "...second half" — deliberately pushing
// sharing teams toward *opposite* halves by default. This matters most for
// the tightest case: two teams sharing a single board, each needing to be
// home in roughly half the season, leaves barely any slack — a per-round
// coin flip for each team independently only finds a fully clash-free split
// by luck, while a deliberate opposite-halves split is the actual shape of
// *a* correct solution whenever one exists, giving the week-assignment
// search a much better starting point to refine from.
//
// *Which* of the two sides gets "first" vs "second" (`flipByVenue`) has to
// be searched over, not fixed — team ids are opaque (real Firestore doc ids
// in production, not meaningful names), so sorting them for a stable
// tie-break carries no signal about which assignment actually resolves a
// given season's real constraints, and a division with *multiple* solo
// cross-division-shared teams needs all of them to land on a *mutually
// compatible* combination — see generateSeasonFixtures, which enumerates
// every combination of flips across all shared venues.
function computeHalfPreferences(
  divisions: DivisionFixtureInput[],
  venueBoardCounts: Record<string, number>,
  flipByVenue: Map<string, boolean>,
): Map<string, 'first' | 'second'> {
  const teamsByVenue = new Map<string, string[]>();
  divisions.forEach((d) => d.teams.forEach((t) => {
    if (!t.venueId || venueBoardCounts[t.venueId] == null) return;
    if (!teamsByVenue.has(t.venueId)) teamsByVenue.set(t.venueId, []);
    teamsByVenue.get(t.venueId)!.push(t.id);
  }));

  const prefs = new Map<string, 'first' | 'second'>();
  teamsByVenue.forEach((teamIds, venueId) => {
    if (teamIds.length < 2) return;
    const flip = flipByVenue.get(venueId) ?? false;
    [...teamIds].sort().forEach((id, i) => {
      const firstHalf = (i % 2 === 0) !== flip;
      prefs.set(id, firstHalf ? 'first' : 'second');
    });
  });
  return prefs;
}

// Leg 1 *is* the first half of the season and leg 2 *is* the second, now that
// week assignment prefers every round's own natural week (see
// candidateWeeksFor) — so a team wanting its home games "front-loaded"
// just needs to be the home side in *every* leg-1 round it plays, full
// stop, not merely in whichever rounds happen to fall in some sub-slice of
// leg 1's own round indices. (An earlier version only forced this for
// `legRoundIndex < totalLegRounds / 2`, leaving the rest of that team's leg-1
// rounds to a coin flip — which could still land it home the same week as
// the very team it was supposed to avoid clashing with.) If exactly one side
// of this pair has a half preference, that's a real signal for which side
// should be home in leg 1 — otherwise (both, neither, or a tie) there's no
// preference-based reason to prefer one side, so the caller falls back to
// the seeded pseudo-random default.
function preferredHomeIsA(pair: RawPair, halfPrefs: Map<string, 'first' | 'second'>): boolean | null {
  const aPref = halfPrefs.get(pair.a);
  const bPref = halfPrefs.get(pair.b);
  const aWantsHomeInLeg1 = aPref === 'first' || bPref === 'second';
  const aWantsAwayInLeg1 = aPref === 'second' || bPref === 'first';
  if (aWantsHomeInLeg1 && !aWantsAwayInLeg1) return true;
  if (aWantsAwayInLeg1 && !aWantsHomeInLeg1) return false;
  return null;
}

// Chooses which side of each pair in one leg-1 round is "home" (leg 2's
// mirrored round automatically gets the opposite side home for the same
// pair, so overall home/away stays exactly balanced — one home, one away per
// opponent — no matter how this choice is made). Only pairs touching a
// board-count-tracked venue can possibly need a non-default choice, so the
// search space for the *actual* solve is tiny in practice (realistically 0-4
// relevant pairs per round, out of a whole division's teams) — but the
// *default* used for everything else still matters a lot (see
// computeHalfPreferences above), since a team with no same-round conflict of
// its own (the common case) still competes for the same venue against a
// *different* division's team, and which of its rounds end up "home" only
// changes via this default.
function resolveRoundHomeChoices(
  roundPairs: RawPair[],
  teamVenueId: Map<string, string | null | undefined>,
  venueBoardCounts: Record<string, number>,
  halfPrefs: Map<string, 'first' | 'second'>,
  seed: number,
  roundSalt: number,
): boolean[] {
  const defaultChoice = roundPairs.map((pair, i) => (
    preferredHomeIsA(pair, halfPrefs) ?? pseudoRandomBool(seed, roundSalt, i)
  ));

  const relevant: number[] = [];
  roundPairs.forEach((pair, i) => {
    const va = teamVenueId.get(pair.a);
    const vb = teamVenueId.get(pair.b);
    if ((va && venueBoardCounts[va] != null) || (vb && venueBoardCounts[vb] != null)) relevant.push(i);
  });
  if (relevant.length === 0) return defaultChoice;

  function usage(chosen: boolean[], leg: 1 | 2): Map<string, number> {
    const map = new Map<string, number>();
    relevant.forEach((i) => {
      const pair = roundPairs[i];
      const homeIsAThisLeg = leg === 1 ? chosen[i] : !chosen[i];
      const homeTeam = homeIsAThisLeg ? pair.a : pair.b;
      const venueId = teamVenueId.get(homeTeam);
      if (!venueId || venueBoardCounts[venueId] == null) return;
      map.set(venueId, (map.get(venueId) ?? 0) + 1);
    });
    return map;
  }

  function fits(chosen: boolean[]): boolean {
    const u1 = usage(chosen, 1);
    const u2 = usage(chosen, 2);
    return relevant.every((i) => {
      const venueId = teamVenueId.get(roundPairs[i].a) ?? teamVenueId.get(roundPairs[i].b);
      if (!venueId) return true;
      const cap = venueBoardCounts[venueId];
      return (u1.get(venueId) ?? 0) <= cap && (u2.get(venueId) ?? 0) <= cap;
    });
  }

  // Brute-force over just the relevant pairs — realistically a handful of
  // teams share any one venue, so 2^relevant.length is trivial.
  const chosen = [...defaultChoice];
  function dfs(idx: number): boolean {
    if (idx === relevant.length) return fits(chosen);
    const i = relevant[idx];
    for (const choice of [chosen[i], !chosen[i]]) {
      chosen[i] = choice;
      if (dfs(idx + 1)) return true;
    }
    chosen[i] = defaultChoice[i];
    return false;
  }
  return dfs(0) ? chosen : defaultChoice;
}

// One division's full double round-robin as an *unordered* list of rounds
// (each a same-week set of pairings, home/away already settled to avoid any
// same-round venue clash) — which calendar week each round lands on is
// decided separately by assignDivisionWeeks below.
function buildDivisionRounds(
  teamIds: string[],
  teamVenueId: Map<string, string | null | undefined>,
  venueBoardCounts: Record<string, number>,
  halfPrefs: Map<string, 'first' | 'second'>,
  seed: number,
): Pairing[][] {
  if (teamIds.length < 2) return [];
  const legRounds = buildLegPairs(teamIds);

  const leg1: Pairing[][] = [];
  const leg2: Pairing[][] = [];
  legRounds.forEach((roundPairs, legRoundIndex) => {
    const homeIsA = resolveRoundHomeChoices(
      roundPairs, teamVenueId, venueBoardCounts, halfPrefs, seed, legRoundIndex,
    );
    leg1.push(roundPairs.map((pair, i) => (homeIsA[i]
      ? { homeTeamId: pair.a, awayTeamId: pair.b }
      : { homeTeamId: pair.b, awayTeamId: pair.a })));
    leg2.push(roundPairs.map((pair, i) => (homeIsA[i]
      ? { homeTeamId: pair.b, awayTeamId: pair.a }
      : { homeTeamId: pair.a, awayTeamId: pair.b })));
  });

  return [...leg1, ...leg2];
}

// For each of a division's rounds, how many home draws it puts on each
// board-count-tracked venue — the only thing that matters for deciding which
// week a round can safely land in (cross-division clashes only, by this
// point — same-round/same-division clashes are already resolved above).
function venueUsagePerRound(
  rounds: Pairing[][],
  teamVenueId: Map<string, string | null | undefined>,
  venueBoardCounts: Record<string, number>,
): Map<string, number>[] {
  return rounds.map((pairings) => {
    const usage = new Map<string, number>();
    pairings.forEach((p) => {
      const venueId = teamVenueId.get(p.homeTeamId);
      if (!venueId || venueBoardCounts[venueId] == null) return;
      usage.set(venueId, (usage.get(venueId) ?? 0) + 1);
    });
    return usage;
  });
}

function overflowAt(
  week: number, usage: Map<string, number>, globalUsage: Map<number, Map<string, number>>,
  venueBoardCounts: Record<string, number>,
): number {
  const existing = globalUsage.get(week);
  let total = 0;
  usage.forEach((count, venueId) => {
    const already = existing?.get(venueId) ?? 0;
    total += Math.max(0, already + count - venueBoardCounts[venueId]);
  });
  return total;
}

// Tries a round's own natural week (its roundIndex) first, before any other
// week — so a round only ever moves off its natural calendar slot when a
// real cross-division venue clash actually forces it to. Without this, the
// search would happily reshuffle rounds that never needed to move at all
// (see assignAllWeeks), scrambling the traditional "second half is the same
// pairings as the first half, home/away reversed, same week-of-season" shape
// leagues are used to for no reason — round-robin correctness never
// depended on preserving that shape, but there's no reason to break it
// either when nothing requires it.
function candidateWeeksFor(naturalWeek: number, weekCount: number): number[] {
  const order = [naturalWeek];
  for (let w = 0; w < weekCount; w++) if (w !== naturalWeek) order.push(w);
  return order;
}

function commitUsage(week: number, usage: Map<string, number>, globalUsage: Map<number, Map<string, number>>): void {
  if (!globalUsage.has(week)) globalUsage.set(week, new Map());
  const existing = globalUsage.get(week)!;
  usage.forEach((count, venueId) => existing.set(venueId, (existing.get(venueId) ?? 0) + count));
}

function uncommitUsage(week: number, usage: Map<string, number>, globalUsage: Map<number, Map<string, number>>): void {
  const existing = globalUsage.get(week);
  if (!existing) return;
  usage.forEach((count, venueId) => existing.set(venueId, (existing.get(venueId) ?? 0) - count));
}

// Bails a strict backtracking search out to a "best available" greedy
// fallback rather than risk pathological search time — real leagues are
// nowhere near this scale (a handful of teams sharing a venue, a season of
// a few dozen weeks), so this only ever engages on a genuinely-oversized or
// adversarial input.
const MAX_DFS_STEPS = 50_000;

interface WeekTask {
  divisionId: string;
  roundIndex: number;
  usage: Map<string, number>;
}

interface CombinedWeekAssignment {
  weekByDivisionRound: Map<string, number[]>;
  ok: boolean;
}

// Finds a week for every round of every division at once — critically, in a
// *single* backtracking search spanning all of them, not one division at a
// time. Two pairings sharing a venue can only ever be kept apart by which
// week each one lands on, and if an earlier division's search commits to a
// week arrangement before a later, venue-sharing division even gets a say,
// there's no way back from a bad early choice — a per-division search can
// declare success and move on while boxing in everyone after it, even when
// some other combined arrangement would have worked for the whole season.
// One combined search backtracks across that boundary freely, undoing an
// earlier division's choice when a later one needs the room.
//
// Each week must be used at most once *within* a division (so a division's
// own rounds still form a complete, non-overlapping schedule); the same week
// is of course shared across every division (that's the whole point — one
// weekly match night for the season). Tasks are tried most-constrained
// first (anything touching a tracked venue, before anything that doesn't) —
// otherwise unconstrained rounds grab whichever week they land on first and
// force far more backtracking once the search reaches the rounds that
// actually care.
function assignAllWeeks(
  roundsByDivision: Map<string, Pairing[][]>,
  usagePerRoundByDivision: Map<string, Map<string, number>[]>,
  weekCount: number,
  venueBoardCounts: Record<string, number>,
): CombinedWeekAssignment {
  const tasks: WeekTask[] = [];
  roundsByDivision.forEach((rounds, divisionId) => {
    const usagePerRound = usagePerRoundByDivision.get(divisionId)!;
    rounds.forEach((_, roundIndex) => tasks.push({ divisionId, roundIndex, usage: usagePerRound[roundIndex] }));
  });
  tasks.sort((a, b) => (b.usage.size > 0 ? 1 : 0) - (a.usage.size > 0 ? 1 : 0));

  const weekByDivisionRound = new Map<string, number[]>();
  const usedWeeksByDivision = new Map<string, Set<number>>();
  roundsByDivision.forEach((rounds, divisionId) => {
    weekByDivisionRound.set(divisionId, new Array(rounds.length).fill(-1));
    usedWeeksByDivision.set(divisionId, new Set());
  });
  const globalUsage = new Map<number, Map<string, number>>();
  let steps = 0;

  function dfs(taskIndex: number): boolean {
    if (taskIndex === tasks.length) return true;
    if (++steps > MAX_DFS_STEPS) return false;
    const task = tasks[taskIndex];
    const usedWeeks = usedWeeksByDivision.get(task.divisionId)!;
    for (const week of candidateWeeksFor(task.roundIndex, weekCount)) {
      if (usedWeeks.has(week)) continue;
      if (overflowAt(week, task.usage, globalUsage, venueBoardCounts) > 0) continue;
      usedWeeks.add(week);
      commitUsage(week, task.usage, globalUsage);
      weekByDivisionRound.get(task.divisionId)![task.roundIndex] = week;
      if (dfs(taskIndex + 1)) return true;
      uncommitUsage(week, task.usage, globalUsage);
      usedWeeks.delete(week);
      weekByDivisionRound.get(task.divisionId)![task.roundIndex] = -1;
    }
    return false;
  }

  if (dfs(0)) return { weekByDivisionRound, ok: true };

  // Strict search failed (or hit the step budget) — greedily place every
  // remaining task on whichever week creates the least overflow, so a
  // complete schedule always comes out the other end. Any remaining overflow
  // is real and gets reported to the caller, not hidden.
  roundsByDivision.forEach((rounds, divisionId) => {
    weekByDivisionRound.set(divisionId, new Array(rounds.length).fill(-1));
  });
  usedWeeksByDivision.forEach((set) => set.clear());
  globalUsage.clear();
  let anyOverflow = false;
  tasks.forEach((task) => {
    const usedWeeks = usedWeeksByDivision.get(task.divisionId)!;
    let bestWeek = -1;
    let bestOverflow = Infinity;
    for (const week of candidateWeeksFor(task.roundIndex, weekCount)) {
      if (usedWeeks.has(week)) continue;
      const overflow = overflowAt(week, task.usage, globalUsage, venueBoardCounts);
      if (overflow < bestOverflow) { bestOverflow = overflow; bestWeek = week; }
      if (overflow === 0) break;
    }
    if (bestOverflow > 0) anyOverflow = true;
    usedWeeks.add(bestWeek);
    commitUsage(bestWeek, task.usage, globalUsage);
    weekByDivisionRound.get(task.divisionId)![task.roundIndex] = bestWeek;
  });
  return { weekByDivisionRound, ok: !anyOverflow };
}

// Every round's natural week (its own roundIndex) laid end to end, with no
// reordering at all — the simplest possible calendar, and exactly the
// traditional "second half repeats the first, home/away reversed, same
// week-of-season" shape leagues already run by hand. Cheap to check (just a
// running per-week venue tally, no search), so it's always worth trying
// before paying for assignAllWeeks' backtracking search.
function identityFits(
  usagePerRoundByDivision: Map<string, Map<string, number>[]>,
  venueBoardCounts: Record<string, number>,
): boolean {
  const weekUsage = new Map<number, Map<string, number>>();
  for (const usagePerRound of usagePerRoundByDivision.values()) {
    for (let week = 0; week < usagePerRound.length; week++) {
      if (!weekUsage.has(week)) weekUsage.set(week, new Map());
      const wm = weekUsage.get(week)!;
      for (const [venueId, count] of usagePerRound[week]) {
        const total = (wm.get(venueId) ?? 0) + count;
        if (total > venueBoardCounts[venueId]) return false;
        wm.set(venueId, total);
      }
    }
  }
  return true;
}

function identityWeekAssignment(roundsByDivision: Map<string, Pairing[][]>): Map<string, number[]> {
  const map = new Map<string, number[]>();
  roundsByDivision.forEach((rounds, divisionId) => map.set(divisionId, rounds.map((_, i) => i)));
  return map;
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

// One shared calendar for the whole season — computed once, sequentially, so
// a break's push-forward compounds onto every later week rather than being
// recomputed from the original start date each time.
function buildWeekDates(weekCount: number, startDate: Date, intervalDays: number, breaks: SeasonBreakRange[]): Date[] {
  const dates: Date[] = [];
  let cursor = skipBreaks(new Date(startDate), breaks);
  for (let week = 0; week < weekCount; week++) {
    if (week > 0) cursor = skipBreaks(addDays(cursor, intervalDays), breaks);
    dates.push(new Date(cursor));
  }
  return dates;
}

// One full attempt: builds every division's rounds (home/away settled using
// `flipByVenue` for the cross-division half-split, falling back to `seed`'s
// pseudo-random default for whichever pairs have no conflict to resolve at
// all) and finds a combined week assignment for the result. Tries the plain
// identity week assignment first (see identityFits) and only calls into
// assignAllWeeks' backtracking search if this particular combo/seed actually
// needs a round moved off its natural week. `identityOnly` skips that search
// entirely and returns null instead — used by generateSeasonFixtures' first
// pass, which would rather try a different flip combination than pay for a
// reorder this combo doesn't strictly need.
function attemptSeasonFixtures(
  divisions: DivisionFixtureInput[],
  opts: GenerateFixturesOptions,
  teamVenueId: Map<string, string | null | undefined>,
  flipByVenue: Map<string, boolean>,
  seed: number,
  identityOnly: boolean,
): SeasonFixtureResult | null {
  const breaks = opts.breaks ?? [];
  const venueBoardCounts = opts.venueBoardCounts ?? {};
  const halfPrefs = computeHalfPreferences(divisions, venueBoardCounts, flipByVenue);

  const roundsByDivision = new Map<string, Pairing[][]>();
  divisions.forEach((d, divisionIndex) => roundsByDivision.set(
    d.divisionId,
    buildDivisionRounds(d.teams.map((t) => t.id), teamVenueId, venueBoardCounts, halfPrefs, seed * 1000 + divisionIndex),
  ));

  const weekCount = Math.max(0, ...[...roundsByDivision.values()].map((r) => r.length));
  const weekDates = buildWeekDates(weekCount, opts.startDate, opts.intervalDays, breaks);
  const usagePerRoundByDivision = new Map(
    [...roundsByDivision.entries()].map(([id, rounds]) => [id, venueUsagePerRound(rounds, teamVenueId, venueBoardCounts)]),
  );

  const usesIdentity = identityFits(usagePerRoundByDivision, venueBoardCounts);
  if (!usesIdentity && identityOnly) return null;

  const { weekByDivisionRound, ok } = usesIdentity
    ? { weekByDivisionRound: identityWeekAssignment(roundsByDivision), ok: true }
    : assignAllWeeks(roundsByDivision, usagePerRoundByDivision, weekCount, venueBoardCounts);

  const fixturesByDivision: Record<string, GeneratedFixtureWithDate[]> = {};
  const unresolvedClashes: VenueClash[] = [];

  roundsByDivision.forEach((rounds, divisionId) => {
    const usagePerRound = usagePerRoundByDivision.get(divisionId)!;
    const weekByRoundIndex = weekByDivisionRound.get(divisionId)!;

    fixturesByDivision[divisionId] = rounds.flatMap((pairings, roundIndex) => {
      const week = weekByRoundIndex[roundIndex];
      return pairings.map((p) => ({
        round: week + 1,
        homeTeamId: p.homeTeamId,
        awayTeamId: p.awayTeamId,
        scheduledDate: weekDates[week],
      }));
    });

    if (!ok) {
      rounds.forEach((pairings, roundIndex) => {
        const week = weekByRoundIndex[roundIndex];
        usagePerRound[roundIndex].forEach((_, venueId) => {
          // Overall usage at this venue/week, across every division, not
          // just this one — the check has to be global since a clash here
          // could equally be caused by a *different* division's fixture.
          let committed = 0;
          roundsByDivision.forEach((otherRounds, otherDivisionId) => {
            const otherWeeks = weekByDivisionRound.get(otherDivisionId)!;
            const otherUsage = usagePerRoundByDivision.get(otherDivisionId)!;
            otherRounds.forEach((_, otherRoundIndex) => {
              if (otherWeeks[otherRoundIndex] === week) committed += otherUsage[otherRoundIndex].get(venueId) ?? 0;
            });
          });
          if (committed > venueBoardCounts[venueId]) {
            const teamIds = pairings.filter((p) => teamVenueId.get(p.homeTeamId) === venueId).map((p) => p.homeTeamId);
            unresolvedClashes.push({ week: week + 1, venueId, teamIds });
          }
        });
      });
    }
  });

  return { fixturesByDivision, unresolvedClashes };
}

// Real leagues share only a handful of venues across divisions at most, so
// exhaustively trying every combination of "which side gets which half" is
// cheap (2^6 = 64 combinations for Jake's real league, each resolved in low
// single-digit milliseconds) — far more reliable than hoping a hash-based
// sample happens to land on a working combination. Capped defensively for
// a pathological input with an unrealistic number of shared venues.
const MAX_FLIP_COMBOS = 1024;
// A few inner seed variations per flip combination, for the (much smaller)
// remaining freedom in non-preference pairs' defaults — cheap insurance,
// not the main mechanism.
const INNER_SEEDS_PER_COMBO = 3;
// If a real solution exists for realistic inputs, it's found within the
// first handful of combinations — real leagues share few enough venues that
// this never comes close to firing. It exists purely so a genuinely
// oversubscribed venue (more sharing teams than any combination of
// halves/weeks could fit) fails fast instead of grinding through every
// combination × every inner seed at full search cost each time.
const STALL_LIMIT = 30;

export function generateSeasonFixtures(
  divisions: DivisionFixtureInput[],
  opts: GenerateFixturesOptions,
): SeasonFixtureResult {
  const teamVenueId = new Map<string, string | null | undefined>();
  divisions.forEach((d) => d.teams.forEach((t) => teamVenueId.set(t.id, t.venueId)));

  const venueBoardCounts = opts.venueBoardCounts ?? {};
  const sharedVenues = sharedTrackedVenues(divisions, venueBoardCounts);
  const comboCount = Math.min(2 ** sharedVenues.length, MAX_FLIP_COMBOS);

  // First pass: every flip combination gets one cheap, search-free try at
  // the plain identity week assignment (see identityFits) — whichever combo
  // hits a clean fit first wins outright, with every round left on its
  // natural week. Only if *no* combination avoids every clash without
  // reordering do we fall through to the second pass below, which brings in
  // assignAllWeeks' backtracking search (and accepts a schedule with some
  // rounds moved off their natural week, which the caller surfaces nothing
  // special about — it's still a fully valid, clash-free schedule, just not
  // the tidiest-looking one). Without this pass, the search below would
  // happily settle for the first combo that resolves cleanly *after*
  // reordering, even when a different combo needed no reordering at all.
  for (let combo = 0; combo < comboCount; combo++) {
    const flipByVenue = new Map(sharedVenues.map((venueId, i) => [venueId, ((combo >> i) & 1) === 1]));
    const result = attemptSeasonFixtures(divisions, opts, teamVenueId, flipByVenue, combo * INNER_SEEDS_PER_COMBO, true);
    if (result) return result;
  }

  let best: SeasonFixtureResult | null = null;
  let stalled = 0;
  for (let combo = 0; combo < comboCount && stalled < STALL_LIMIT; combo++) {
    const flipByVenue = new Map(sharedVenues.map((venueId, i) => [venueId, ((combo >> i) & 1) === 1]));
    for (let innerSeed = 0; innerSeed < INNER_SEEDS_PER_COMBO; innerSeed++) {
      const result = attemptSeasonFixtures(divisions, opts, teamVenueId, flipByVenue, combo * INNER_SEEDS_PER_COMBO + innerSeed, false)!;
      if (result.unresolvedClashes.length === 0) return result;
      if (!best || result.unresolvedClashes.length < best.unresolvedClashes.length) {
        best = result;
        stalled = 0;
      } else if (++stalled >= STALL_LIMIT) {
        break;
      }
    }
  }
  return best ?? { fixturesByDivision: {}, unresolvedClashes: [] };
}

// Convenience entry point for generating (or regenerating) just one
// division's fixtures on their own — same solver underneath, just with no
// other division's teams competing for shared venues.
export function generateRoundRobinFixtures(
  teams: FixtureTeam[],
  opts: GenerateFixturesOptions,
): GeneratedFixtureWithDate[] {
  return generateSeasonFixtures([{ divisionId: 'single', teams }], opts).fixturesByDivision.single ?? [];
}
