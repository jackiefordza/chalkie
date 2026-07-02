// Round-robin fixture generation (circle method). Every team plays every
// other team twice — once home, once away — with home/away perfectly
// balanced across the season. Odd team counts get a bye each round.

export interface FixtureTeam {
  id: string;
}

export interface GeneratedFixture {
  round: number;
  homeTeamId: string;
  awayTeamId: string;
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

export function generateRoundRobinFixtures(
  teams: FixtureTeam[],
  opts: { startDate: Date; intervalDays: number },
): (GeneratedFixture & { scheduledDate: Date })[] {
  if (teams.length < 2) return [];

  const teamIds = teams.map((t) => t.id);
  const firstLeg = singleLegRounds(teamIds);
  const secondLeg = firstLeg.map((round) => round.map(([home, away]) => [away, home]));
  const allRounds = [...firstLeg, ...secondLeg];

  const fixtures: (GeneratedFixture & { scheduledDate: Date })[] = [];
  allRounds.forEach((roundPairs, roundIndex) => {
    const scheduledDate = new Date(opts.startDate);
    scheduledDate.setDate(scheduledDate.getDate() + roundIndex * opts.intervalDays);

    roundPairs.forEach(([home, away]) => {
      if (typeof home !== 'string' || typeof away !== 'string') return;
      fixtures.push({
        round: roundIndex + 1,
        homeTeamId: home,
        awayTeamId: away,
        scheduledDate,
      });
    });
  });

  return fixtures;
}
