// Pure, framework-free transformation between the result-entry form's
// per-game draft shape and the real per-leg MatchGame the rest of the app
// (Match Centre, playerSeasonStats, standings) reads. Extracted from
// results-entry.tsx so it can be unit-tested without any React/Firebase
// dependency — see matchResultDraft.test.ts.
import type { GameType, HighCheckout, MatchGame, MatchSide } from '@/types';

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

// Client-side mirror of functions/src/index.ts's computeTotals — used ONLY
// for display (the reconciled-but-not-yet-confirmed match sheet shown at
// pending_confirmation, before onMatchConfirmed has computed and written the
// official Match.homeGamesWon/awayGamesWon/homeLegsWon/awayLegsWon fields).
// Never used to write anything — the server's own computeTotals remains the
// sole source of truth for the confirmed record.
export interface GamesTotals {
  homeGamesWon: number;
  awayGamesWon: number;
  homeLegsWon: number;
  awayLegsWon: number;
}

export function computeGamesTotals(games: MatchGame[]): GamesTotals {
  let homeGamesWon = 0, awayGamesWon = 0, homeLegsWon = 0, awayLegsWon = 0;
  for (const game of games) {
    const gameHomeLegs = game.legs.filter((l) => l.winner === 'home').length;
    const gameAwayLegs = game.legs.filter((l) => l.winner === 'away').length;
    homeLegsWon += gameHomeLegs;
    awayLegsWon += gameAwayLegs;
    if (gameHomeLegs > gameAwayLegs) homeGamesWon++; else awayGamesWon++;
  }
  return { homeGamesWon, awayGamesWon, homeLegsWon, awayLegsWon };
}

export function slotsFor(type: GameType): number {
  return type === 'singles' ? 1 : 2;
}

// `ownSide`, when passed, means this is a captain's own-team-only submission
// draft: only THAT side needs its player slots filled (the opponent's side
// is never touched, by construction — see results-entry.tsx). Omitted (the
// default) requires both sides filled, for admin correction of the final
// merged record, where both sides are genuinely being edited.
export function isGameComplete(game: DraftGame, ownSide?: MatchSide): boolean {
  const need = slotsFor(game.type);
  if (ownSide) {
    return (ownSide === 'home' ? game.homePlayerIds : game.awayPlayerIds).length === need && game.score !== null;
  }
  return (
    game.homePlayerIds.length === need
    && game.awayPlayerIds.length === need
    && game.score !== null
  );
}

// ── Merging two reconciled submissions' own-team stats ──────────────────
// Mirrors functions/src/index.ts's buildMergedGame/mergeSubmissionGames
// exactly (independently implemented, not imported — functions and mobile
// don't share code, see that file's own header) so admin-dispute.tsx can
// correctly combine both sides' own-team stats for a game whose pairing/
// score already agree, instead of discarding one side's stats by naively
// picking the other side's whole submission. Leg index carries no meaning
// to any consumer of this data (see toMatchGame above) — which specific
// slot a stat lands in is cosmetic.
function distributeOneEightiesByLeg(oneEighties: string[]): string[][] {
  const byLeg: string[][] = Array.from({ length: LEGS_PER_GAME }, () => []);
  [...oneEighties].sort().forEach((playerId, i) => {
    byLeg[i % LEGS_PER_GAME].push(playerId);
  });
  return byLeg;
}

function distributeHighCheckouts(highCheckouts: HighCheckout[]): (HighCheckout | null)[] {
  const sorted = [...highCheckouts].sort((a, b) => (
    a.playerId === b.playerId ? a.value.localeCompare(b.value) : a.playerId.localeCompare(b.playerId)
  ));
  return Array.from({ length: LEGS_PER_GAME }, (_, i) => sorted[i] ?? null);
}

// Combines one already-score-agreed game from each side — each side's own
// PAIRING comes from its own submission (homeGame.homePlayerIds,
// awayGame.awayPlayerIds: the real own-team-only merge, since neither
// submission ever contains the opponent's pairing at all); each side's
// own-team 180s/checkouts are likewise pulled from its own submission only,
// filtered to that side's own players as a defense-in-depth re-check.
// `legWinnerSource` picks whose leg-winner SEQUENCE (i.e. whose reported
// score) is authoritative — defaults to homeGame, but admin-dispute.tsx
// passes awayGame explicitly when the admin is resolving a score
// disagreement in away's favor; mirrors functions/src/index.ts's
// buildMergedGame, which has no such choice to make since it only ever runs
// once pairingsAndScoreAgree has already confirmed both sides match.
export function mergeGame(homeGame: MatchGame, awayGame: MatchGame, legWinnerSource: MatchGame = homeGame): MatchGame {
  const homeOwn = new Set(homeGame.homePlayerIds);
  const awayOwn = new Set(awayGame.awayPlayerIds);

  const homeOneEighties = homeGame.legs.flatMap((l) => l.oneEighties).filter((id) => homeOwn.has(id));
  const awayOneEighties = awayGame.legs.flatMap((l) => l.oneEighties).filter((id) => awayOwn.has(id));
  const mergedOneEightiesByLeg = distributeOneEightiesByLeg([...homeOneEighties, ...awayOneEighties]);

  const homeCheckouts = homeGame.legs
    .map((l) => l.highCheckout)
    .filter((hc): hc is HighCheckout => hc !== null && homeOwn.has(hc.playerId));
  const awayCheckouts = awayGame.legs
    .map((l) => l.highCheckout)
    .filter((hc): hc is HighCheckout => hc !== null && awayOwn.has(hc.playerId));
  const mergedCheckouts = distributeHighCheckouts([...homeCheckouts, ...awayCheckouts]);

  return {
    order: homeGame.order,
    type: homeGame.type,
    homePlayerIds: homeGame.homePlayerIds,
    awayPlayerIds: awayGame.awayPlayerIds,
    legs: legWinnerSource.legs.map((leg, i) => ({
      winner: leg.winner,
      oneEighties: mergedOneEightiesByLeg[i],
      highCheckout: mergedCheckouts[i] ? { playerId: mergedCheckouts[i]!.playerId, value: mergedCheckouts[i]!.value } : null,
    })),
  };
}
