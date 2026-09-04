// A small, deterministic PRNG (mulberry32) — standard, well-known,
// dependency-free. Given the same seed, calling it produces exactly the
// same sequence of numbers every time, which is what makes "seed -> reset
// -> seed again" reproduce the same generated match results (lineups, leg
// splits, 180s, high checkouts). Not cryptographic — doesn't need to be,
// this is showcase data, not a security primitive.
//
// Deliberately NOT `Math.random()` anywhere in this codebase — every call
// that needs randomness takes an explicit `Rng` instance so the call order
// (and therefore the output sequence) is entirely determined by the order
// this script itself makes calls in, not by anything external.
export type Rng = () => number; // returns a float in [0, 1)

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(rng: Rng, maxExclusive: number): number {
  return Math.floor(rng() * maxExclusive);
}

export function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[randInt(rng, arr.length)];
}

// Fisher-Yates shuffle using the given rng, in place, returning the same
// array reference for convenience. Deterministic given the same rng state.
export function shuffle<T>(rng: Rng, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
