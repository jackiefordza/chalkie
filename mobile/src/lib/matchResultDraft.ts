// Pure, framework-free transformation between the result-entry form's
// per-game draft shape and the real per-leg MatchGame the rest of the app
// (Match Centre, playerSeasonStats, standings) reads. Extracted from
// results-entry.tsx so it can be unit-tested without any React/Firebase
// dependency — see matchResultDraft.test.ts.
import type { GameType, MatchGame, MatchSide } from '@/types';

export const LEGS_PER_GAME = 3;

// A high checkout as entered in the draft form — just who and how much.
// Unlike the old (BUG-007-era) shape, this deliberately carries no leg
// association: which specific leg a 180 or checkout happened in was never
// something computePlayerAccum (functions/src/index.ts) or any other
// consumer actually needed — it only ever sums per player, across every
// leg. Forcing captains to pick a leg bought nothing and was confusing
// (see the Issue 6 UX rework). At most one checkout per game-leg, so still
// capped at LEGS_PER_GAME entries.
export interface DraftHighCheckoutEntry {
  playerId: string;
  value: string;
}

export interface DraftGame {
  order: number;
  type: GameType;
  homePlayerIds: string[];
  awayPlayerIds: string[];
  // Legs won, home–away. Always sums to 3 (all 3 legs are always played).
  score: { home: number; away: number } | null;
  // One entry per 180, by playerId — a player with two 180s in this game
  // appears twice. No leg association (see above).
  oneEighties: string[];
  highCheckouts: DraftHighCheckoutEntry[];
}

export function blankGames(): DraftGame[] {
  return Array.from({ length: 7 }, (_, i) => ({
    order: i + 1,
    type: (i < 5 ? 'singles' : 'pairs') as GameType,
    homePlayerIds: [],
    awayPlayerIds: [],
    score: null,
    oneEighties: [],
    highCheckouts: [],
  }));
}

export function toDraft(games: MatchGame[]): DraftGame[] {
  return games.map((g) => ({
    order: g.order,
    type: g.type,
    homePlayerIds: [...g.homePlayerIds],
    awayPlayerIds: [...g.awayPlayerIds],
    score: {
      home: g.legs.filter((l) => l.winner === 'home').length,
      away: g.legs.filter((l) => l.winner === 'away').length,
    },
    oneEighties: g.legs.flatMap((l) => l.oneEighties),
    highCheckouts: g.legs
      .map((l) => l.highCheckout)
      .filter((hc): hc is DraftHighCheckoutEntry => hc !== null),
  }));
}

// oneEighties/highCheckouts no longer carry a leg — the entry form doesn't
// ask for one (see Issue 6) — but the persisted MatchGame shape still needs
// each one to live on *some* leg, so they're deterministically distributed
// across the game's LEGS_PER_GAME leg slots here.
//
// Critically, this distribution is by SORTED content, never by entry order:
// two captains independently submitting the same real result (same players,
// same 180 counts, same checkout values) must always produce byte-identical
// MatchGame objects regardless of the order they tapped things in, or
// onSubmissionWrite's gamesEqual() would wrongly flag a genuine agreement as
// a dispute. Sorting first guarantees that.
//
// Leg *winner* order still comes from score exactly as before (home's legs
// first, then away's) — unrelated to and unchanged by this fix.
export function toMatchGame(g: DraftGame): MatchGame {
  const score = g.score as { home: number; away: number };
  const winners: MatchSide[] = [
    ...Array(score.home).fill('home' as MatchSide),
    ...Array(score.away).fill('away' as MatchSide),
  ];

  const oneEightiesByLeg: string[][] = Array.from({ length: LEGS_PER_GAME }, () => []);
  [...g.oneEighties].sort().forEach((playerId, i) => {
    oneEightiesByLeg[i % LEGS_PER_GAME].push(playerId);
  });

  const sortedCheckouts = [...g.highCheckouts].sort((a, b) => (
    a.playerId === b.playerId ? a.value.localeCompare(b.value) : a.playerId.localeCompare(b.playerId)
  ));

  return {
    order: g.order,
    type: g.type,
    homePlayerIds: g.homePlayerIds,
    awayPlayerIds: g.awayPlayerIds,
    legs: winners.map((winner, legIndex) => {
      const checkout = sortedCheckouts[legIndex];
      return {
        winner,
        oneEighties: oneEightiesByLeg[legIndex],
        highCheckout: checkout ? { playerId: checkout.playerId, value: checkout.value } : null,
      };
    }),
  };
}

export function slotsFor(type: GameType): number {
  return type === 'singles' ? 1 : 2;
}

export function isGameComplete(game: DraftGame): boolean {
  const need = slotsFor(game.type);
  return (
    game.homePlayerIds.length === need
    && game.awayPlayerIds.length === need
    && game.score !== null
  );
}

export function normalizeGameForCompare(g: DraftGame): string {
  return JSON.stringify({
    homePlayerIds: [...g.homePlayerIds].sort(),
    awayPlayerIds: [...g.awayPlayerIds].sort(),
    score: g.score,
    oneEighties: [...g.oneEighties].sort(),
    highCheckouts: g.highCheckouts.map((hc) => `${hc.playerId}:${hc.value}`).sort(),
  });
}
