// Match-result generation — ported, not imported, from
// mobile/src/lib/mockSeason.ts's generateLegs()/generateMatchGames() (same
// reasoning as fixtures.ts for why this is a copy, not a shared import).
// The one real change: every call that used `Math.random()` there takes an
// explicit `Rng` here instead, so results are reproducible given the fixed
// RNG_SEED (see constants.ts) rather than genuinely random every run.
import { HIGH_CHECKOUT_VALUES } from './constants';
import { pick, randInt, shuffle, type Rng } from './random';
import type { GameType, MatchGame, MatchLeg, MatchSide } from './types';

// A single game's 3 legs: split weighted toward closer scores (2-1/1-2) over
// clean sweeps; each leg independently may carry a 180 (from either
// participant) and/or one high checkout for whoever won it. Verbatim logic
// from mockSeason.ts's generateLegs, just RNG-parameterized.
function generateLegs(rng: Rng, homePlayerIds: string[], awayPlayerIds: string[]): { legs: MatchLeg[]; homeLegs: number } {
  const splits: [number, number][] = [[3, 0], [0, 3], [2, 1], [1, 2]];
  const [homeLegs, awayLegs] = pick(rng, splits);
  const winners: MatchSide[] = [
    ...Array(homeLegs).fill('home' as MatchSide),
    ...Array(awayLegs).fill('away' as MatchSide),
  ];
  shuffle(rng, winners);

  const legs: MatchLeg[] = winners.map((winner) => {
    const oneEighties: string[] = [];
    if (randInt(rng, 6) === 0) {
      const thrower = pick(rng, winner === 'home' ? [...homePlayerIds, ...awayPlayerIds] : [...awayPlayerIds, ...homePlayerIds]);
      oneEighties.push(thrower);
    }
    const highCheckout = randInt(rng, 12) === 0
      ? { playerId: pick(rng, winner === 'home' ? homePlayerIds : awayPlayerIds), value: pick(rng, HIGH_CHECKOUT_VALUES) }
      : null;
    return { winner, oneEighties, highCheckout };
  });

  return { legs, homeLegs };
}

// 5 singles (straight 1-1 pairing) + 2 pairs (reusing the same 5 players in
// two different partnerships) — the exact structure real Chalkie matches use
// (see the Match type comment: 5 singles then 2 pairs, always). `homeFive`/
// `awayFive` are that week's chosen matchday lineup (5 of a team's 6-player
// squad — see seedCore.ts for how the 5-of-6 rotation is chosen).
export function generateMatchResult(rng: Rng, homeFive: string[], awayFive: string[]): MatchGame[] {
  const games: MatchGame[] = [];
  for (let i = 0; i < 5; i++) {
    const { legs } = generateLegs(rng, [homeFive[i]], [awayFive[i]]);
    games.push({ order: i + 1, type: 'singles' as GameType, homePlayerIds: [homeFive[i]], awayPlayerIds: [awayFive[i]], legs });
  }
  const pairsRosters: [number[], number[]][] = [[[0, 1], [2, 3]], [[3, 4], [0, 2]]];
  pairsRosters.forEach(([homeIdx, awayIdx], i) => {
    const home = homeIdx.map((idx) => homeFive[idx]);
    const away = awayIdx.map((idx) => awayFive[idx]);
    const { legs } = generateLegs(rng, home, away);
    games.push({ order: 6 + i, type: 'pairs' as GameType, homePlayerIds: home, awayPlayerIds: away, legs });
  });
  return games;
}

// For the deliberately-disputed showcase match: produces a second version of
// `baseGames` that is byte-identical on every game except `gameOrder` (1-7),
// which gets an independently regenerated (and legs-shuffled so the winner
// genuinely differs where possible) result for the SAME two players/pairs —
// a realistic "we disagree who actually won this specific game" scenario,
// not an arbitrary wholesale mismatch. Deep-clones `baseGames` first so the
// original array passed to the other team's submission is never mutated.
export function withDisputedGame(rng: Rng, baseGames: MatchGame[], gameOrder: number): MatchGame[] {
  const cloned: MatchGame[] = baseGames.map((g) => ({
    ...g,
    homePlayerIds: [...g.homePlayerIds],
    awayPlayerIds: [...g.awayPlayerIds],
    legs: g.legs.map((l) => ({ ...l, oneEighties: [...l.oneEighties], highCheckout: l.highCheckout ? { ...l.highCheckout } : null })),
  }));
  const target = cloned.find((g) => g.order === gameOrder);
  if (!target) throw new Error(`withDisputedGame: no game with order ${gameOrder} in the base result`);

  const baseHomeLegs = target.legs.filter((l) => l.winner === 'home').length;
  const baseAwayLegs = target.legs.filter((l) => l.winner === 'away').length;
  const baseWinnerWasHome = baseHomeLegs > baseAwayLegs;

  // Regenerate until the winner actually flips (a genuine disagreement, not
  // a coincidentally-identical re-roll) — bounded attempts so this can never
  // spin forever if the RNG sequence is unlucky.
  for (let attempt = 0; attempt < 20; attempt++) {
    const { legs } = generateLegs(rng, target.homePlayerIds, target.awayPlayerIds);
    const homeLegs = legs.filter((l) => l.winner === 'home').length;
    const awayLegs = legs.filter((l) => l.winner === 'away').length;
    const winnerIsHome = homeLegs > awayLegs;
    if (winnerIsHome !== baseWinnerWasHome) {
      target.legs = legs;
      return cloned;
    }
  }
  throw new Error('withDisputedGame: failed to generate a genuinely different winner after 20 attempts');
}
