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

export function isGameComplete(game: DraftGame): boolean {
  const need = slotsFor(game.type);
  return (
    game.homePlayerIds.length === need
    && game.awayPlayerIds.length === need
    && game.score !== null
  );
}

// Pairings + score ONLY — the only fields reconciliation compares between
// two independently-submitted sides (mirrors functions/src/index.ts's
// pairingsAndScoreAgree, which is what actually decides pending_confirmation
// vs disputed server-side — this client copy is for the entry screen's own
// reconcile-mode diff highlighting, not the source of truth). Stats
// (oneEighties/highCheckouts) are deliberately excluded: each side only
// ever reports its own team's stats (enforced server-side, not just this
// screen), so they always differ between two submissions by construction —
// never a real disagreement, just complementary data the server merges
// (see mergeGame below).
export function normalizeGameForCompare(g: DraftGame): string {
  return JSON.stringify({
    homePlayerIds: [...g.homePlayerIds].sort(),
    awayPlayerIds: [...g.awayPlayerIds].sort(),
    score: g.score,
  });
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

// Combines one already-pairings-and-score-agreed game from each side —
// pairings/leg-winner sequence come from homeGame (equivalent to awayGame's
// by construction once scores agree — see pairingsAndScoreAgree server-side);
// each side's own-team 180s/checkouts are pulled from its own submission
// only, filtered to that side's own players as a defense-in-depth re-check.
export function mergeGame(homeGame: MatchGame, awayGame: MatchGame): MatchGame {
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
    awayPlayerIds: homeGame.awayPlayerIds,
    legs: homeGame.legs.map((leg, i) => ({
      winner: leg.winner,
      oneEighties: mergedOneEightiesByLeg[i],
      highCheckout: mergedCheckouts[i] ? { playerId: mergedCheckouts[i]!.playerId, value: mergedCheckouts[i]!.value } : null,
    })),
  };
}

// Keeps a game's pairings/score/winners exactly as-is but strips any 180/
// checkout entry that doesn't belong to `ownTeamId` — used when a captain
// adopts the OTHER team's version of a disputed game (results-entry.tsx):
// the pairing/score is exactly what needs adopting, but the opponent's own
// stat entries must never end up inside THIS captain's own submission — the
// server would reject the whole submission (see isValidGamesShape in
// functions/src/index.ts, which only trusts a submission's own team's
// players for stats).
export function keepOnlyOwnTeamStats(game: MatchGame, ownTeamId: string, homeTeamId: string): MatchGame {
  const ownIds = new Set(ownTeamId === homeTeamId ? game.homePlayerIds : game.awayPlayerIds);
  return {
    ...game,
    legs: game.legs.map((leg) => ({
      winner: leg.winner,
      oneEighties: leg.oneEighties.filter((id) => ownIds.has(id)),
      highCheckout: leg.highCheckout && ownIds.has(leg.highCheckout.playerId) ? leg.highCheckout : null,
    })),
  };
}
