// Round-robin fixture generation (circle method) — ported, not imported,
// from mobile/src/lib/fixtures.ts's generateRoundRobinFixtures(). That
// function is pure and has zero framework dependency, so it would have been
// possible to extract it into a shared package both the mobile app and this
// script import from — but doing that would mean introducing a new shared
// workspace/package boundary into the repo purely to share two small pure
// functions (this one and results.ts's generateLegs-equivalent), which is a
// structural change disproportionate to what it buys here. Copying ~40
// lines of logic that essentially never changes (it's just the standard
// round-robin scheduling algorithm) is the smaller, safer diff. See the
// implementation report for the full reasoning.
//
// The one deliberate difference from the original: this version operates on
// team *indices* (0..7) rather than string team IDs, since the rest of this
// script (constants.ts's teamId(), the special-pairing lookups) is already
// index-based — trivial to convert to real Firestore IDs at write time.
import type { GeneratedFixture } from './types';

const BYE = Symbol('bye');
type Slot = number | typeof BYE;

function singleLegRounds(teamCount: number): Slot[][][] {
  const slots: Slot[] = Array.from({ length: teamCount }, (_, i) => i);
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

// Deliberately relative to `startDate` as passed in, not a fixed calendar
// date — the caller (seedCore.ts) always computes startDate relative to
// `new Date()` at the moment the script actually runs, exactly like
// mockSeason.ts's own seedMockSeason() does. That's what keeps "confirmed
// matches sit in the past, upcoming ones sit in the future" true no matter
// which day between now and 16 September this script is eventually run —
// calendar dates are the one part of this dataset that is NOT part of the
// seeded-RNG determinism by design (see constants.ts's RNG_SEED comment).
export function generateRoundRobinFixtures(
  teamCount: number,
  opts: { startDate: Date; intervalDays: number },
): GeneratedFixture[] {
  if (teamCount < 2) return [];

  const firstLeg = singleLegRounds(teamCount);
  const secondLeg = firstLeg.map((round) => round.map(([home, away]) => [away, home]));
  const allRounds = [...firstLeg, ...secondLeg];

  const fixtures: GeneratedFixture[] = [];
  allRounds.forEach((roundPairs, roundIndex) => {
    const scheduledDate = new Date(opts.startDate);
    scheduledDate.setDate(scheduledDate.getDate() + roundIndex * opts.intervalDays);

    roundPairs.forEach(([home, away]) => {
      if (typeof home !== 'number' || typeof away !== 'number') return;
      fixtures.push({
        round: roundIndex + 1,
        homeTeamIndex: home,
        awayTeamIndex: away,
        scheduledDate,
      });
    });
  });

  return fixtures;
}
