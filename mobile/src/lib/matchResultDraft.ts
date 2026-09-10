// Pure, framework-free transformation between the result-entry form's
// per-game draft shape and the real per-leg MatchGame the rest of the app
// (Match Centre, playerSeasonStats, standings) reads. Extracted from
// results-entry.tsx so it can be unit-tested without any React/Firebase
// dependency — see matchResultDraft.test.ts.
import type { GameType, HighCheckout, MatchGame, MatchSide } from '@/types';

export const LEGS_PER_GAME = 3;

// A 180 or high checkout as entered in the draft form — each carries the
// leg it actually happened in (0-2), matching the same leg ordering
// toMatchGame derives from score (home's legs first, then away's — see
// toMatchGame below), which is also the ordering Match Centre's "Show legs"
// numbers as "Leg 1/2/3". Previously these were tracked with no leg
// association at all and toMatchGame fabricated the placement (BUG-007).
export interface DraftOneEighty {
  playerId: string;
  legIndex: number;
}
export interface DraftHighCheckout {
  playerId: string;
  value: string;
  legIndex: number;
}

export interface DraftGame {
  order: number;
  type: GameType;
  homePlayerIds: string[];
  awayPlayerIds: string[];
  // Legs won, home–away. Always sums to 3 (all 3 legs are always played).
  score: { home: number; away: number } | null;
  oneEighties: DraftOneEighty[];
  highCheckouts: DraftHighCheckout[]; // at most one per legIndex, so max 3
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
    oneEighties: g.legs.flatMap((l, legIndex) => l.oneEighties.map((playerId) => ({ playerId, legIndex }))),
    highCheckouts: g.legs
      .map((l, legIndex) => (l.highCheckout ? { ...l.highCheckout, legIndex } : null))
      .filter((hc): hc is DraftHighCheckout => hc !== null),
  }));
}

// The BUG-007 fix: oneEighties/highCheckouts are placed on the leg the user
// actually assigned them to (draft.legIndex), not fabricated onto leg 0 /
// mapped by array position. Leg order still comes from score the same way
// it always has (home's legs first, then away's) — that ordering is an
// existing, pre-existing product choice (legs aren't tracked in real
// chronological order anywhere in this app), unrelated to and unchanged by
// this fix; what's fixed is that 180s/checkouts now land on the SAME leg
// index the entry form assigned them to, consistently with that ordering.
export function toMatchGame(g: DraftGame): MatchGame {
  const score = g.score as { home: number; away: number };
  const winners: MatchSide[] = [
    ...Array(score.home).fill('home' as MatchSide),
    ...Array(score.away).fill('away' as MatchSide),
  ];
  return {
    order: g.order,
    type: g.type,
    homePlayerIds: g.homePlayerIds,
    awayPlayerIds: g.awayPlayerIds,
    legs: winners.map((winner, legIndex) => {
      const checkout = g.highCheckouts.find((hc) => hc.legIndex === legIndex);
      return {
        winner,
        oneEighties: g.oneEighties.filter((o) => o.legIndex === legIndex).map((o) => o.playerId),
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
    oneEighties: g.oneEighties.map((o) => `${o.legIndex}:${o.playerId}`).sort(),
    highCheckouts: g.highCheckouts.map((hc) => `${hc.legIndex}:${hc.playerId}:${hc.value}`).sort(),
  });
}

// Re-exported only so the test file doesn't need its own separate import of
// the shared type from '@/types' (kept private to app code otherwise).
export type { HighCheckout };
