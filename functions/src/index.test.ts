import {
  computeTotals,
  computeMatchContribution,
  computePlayerAccum,
  normalizeGames,
  gamesEqual,
  sortableTeamName,
  MatchGame,
  MatchLeg,
} from './index';

// ── Fixture helpers ─────────────────────────────────────────────────────────

function leg(winner: 'home' | 'away', opts: Partial<Omit<MatchLeg, 'winner'>> = {}): MatchLeg {
  return { winner, oneEighties: [], highCheckout: null, ...opts };
}

function singles(
  order: number, homePlayerId: string, awayPlayerId: string, legs: MatchLeg[],
): MatchGame {
  return { order, type: 'singles', homePlayerIds: [homePlayerId], awayPlayerIds: [awayPlayerId], legs };
}

function pairs(
  order: number, homePlayerIds: [string, string], awayPlayerIds: [string, string], legs: MatchLeg[],
): MatchGame {
  return { order, type: 'pairs', homePlayerIds, awayPlayerIds, legs };
}

// A full 7-game match (5 singles + 2 pairs) where home sweeps every game 3-0.
// Individual tests override specific games/legs to exercise other cases.
function homeSweepMatch(): MatchGame[] {
  const sweep = [leg('home'), leg('home'), leg('home')];
  return [
    singles(1, 'h1', 'a1', sweep),
    singles(2, 'h2', 'a2', sweep),
    singles(3, 'h3', 'a3', sweep),
    singles(4, 'h4', 'a4', sweep),
    singles(5, 'h5', 'a5', sweep),
    pairs(6, ['h1', 'h2'], ['a1', 'a2'], sweep),
    pairs(7, ['h3', 'h4'], ['a3', 'a4'], sweep),
  ];
}

// ── computeTotals ────────────────────────────────────────────────────────────

describe('computeTotals', () => {
  it('returns all zeros for no games', () => {
    expect(computeTotals([])).toEqual({ homeGamesWon: 0, awayGamesWon: 0, homeLegsWon: 0, awayLegsWon: 0 });
  });

  it('credits a game to whichever side wins 2 of the 3 legs, never a draw', () => {
    const game = singles(1, 'h1', 'a1', [leg('home'), leg('away'), leg('home')]);
    const totals = computeTotals([game]);
    expect(totals).toEqual({ homeGamesWon: 1, awayGamesWon: 0, homeLegsWon: 2, awayLegsWon: 1 });
  });

  it('sums totals across all 7 games of a real match', () => {
    // Home wins games 1-4 (3-0 each), away wins games 5-7 (2-1 each).
    const games: MatchGame[] = [
      singles(1, 'h1', 'a1', [leg('home'), leg('home'), leg('home')]),
      singles(2, 'h2', 'a2', [leg('home'), leg('home'), leg('home')]),
      singles(3, 'h3', 'a3', [leg('home'), leg('home'), leg('home')]),
      singles(4, 'h4', 'a4', [leg('home'), leg('home'), leg('home')]),
      singles(5, 'h5', 'a5', [leg('away'), leg('away'), leg('home')]),
      pairs(6, ['h1', 'h2'], ['a1', 'a2'], [leg('away'), leg('home'), leg('away')]),
      pairs(7, ['h3', 'h4'], ['a3', 'a4'], [leg('away'), leg('away'), leg('home')]),
    ];
    expect(computeTotals(games)).toEqual({
      homeGamesWon: 4,
      awayGamesWon: 3,
      homeLegsWon: 12 + 1 + 1 + 1, // 4 sweeps (3 each) + 1 leg won in each of the 3 away-won games
      awayLegsWon: 2 + 2 + 2, // 2 legs won in each of the 3 away-won games
    });
  });
});

// ── computeMatchContribution ─────────────────────────────────────────────────

describe('computeMatchContribution', () => {
  it('awards the winner 2 points and the loser 0 — never a draw (odd game count)', () => {
    expect(computeMatchContribution(true)).toEqual({
      homePoints: 2, homeWon: 1, homeLost: 0,
      awayPoints: 0, awayWon: 0, awayLost: 1,
    });
    expect(computeMatchContribution(false)).toEqual({
      homePoints: 0, homeWon: 0, homeLost: 1,
      awayPoints: 2, awayWon: 1, awayLost: 0,
    });
  });

  it('contributes nothing when there is no result yet (null, not false)', () => {
    // Regression guard: a naive `false` here would wrongly credit the away
    // side with a win against a match that was never actually played.
    expect(computeMatchContribution(null)).toEqual({
      homePoints: 0, homeWon: 0, homeLost: 0,
      awayPoints: 0, awayWon: 0, awayLost: 0,
    });
  });
});

// ── computePlayerAccum ───────────────────────────────────────────────────────

describe('computePlayerAccum', () => {
  const matchId = 'match-1';
  const date = new Date('2026-09-01');

  it('credits each singles player exactly one played game and the correct win/loss', () => {
    const games = [singles(1, 'h1', 'a1', [leg('home'), leg('home'), leg('away')])];
    const accum = computePlayerAccum(games, 'home-team', 'away-team', matchId, date);

    expect(accum.get('h1')).toMatchObject({ teamId: 'home-team', played: 1, won: 1, lost: 0 });
    expect(accum.get('a1')).toMatchObject({ teamId: 'away-team', played: 1, won: 0, lost: 1 });
  });

  it('credits both players on the winning side of a pairs game, not just one', () => {
    const games = [pairs(6, ['h1', 'h2'], ['a1', 'a2'], [leg('home'), leg('home'), leg('away')])];
    const accum = computePlayerAccum(games, 'home-team', 'away-team', matchId, date);

    expect(accum.get('h1')).toMatchObject({ played: 1, won: 1, lost: 0 });
    expect(accum.get('h2')).toMatchObject({ played: 1, won: 1, lost: 0 });
    expect(accum.get('a1')).toMatchObject({ played: 1, won: 0, lost: 1 });
    expect(accum.get('a2')).toMatchObject({ played: 1, won: 0, lost: 1 });
  });

  it('accumulates played/won/lost across multiple games for a player in more than one', () => {
    // h1 plays a singles game (wins) and a pairs game (loses).
    const games = [
      singles(1, 'h1', 'a1', [leg('home'), leg('home'), leg('away')]),
      pairs(6, ['h1', 'h2'], ['a1', 'a2'], [leg('away'), leg('away'), leg('home')]),
    ];
    const accum = computePlayerAccum(games, 'home-team', 'away-team', matchId, date);
    expect(accum.get('h1')).toMatchObject({ played: 2, won: 1, lost: 1 });
  });

  it('attributes a 180 to the correct player regardless of home/away side', () => {
    const games = [
      singles(1, 'h1', 'a1', [leg('home', { oneEighties: ['h1'] }), leg('away', { oneEighties: ['a1'] }), leg('home')]),
    ];
    const accum = computePlayerAccum(games, 'home-team', 'away-team', matchId, date);
    expect(accum.get('h1')?.oneEighties).toBe(1);
    expect(accum.get('a1')?.oneEighties).toBe(1);
  });

  it('attributes a high checkout to the correct player with match/date metadata', () => {
    const games = [
      singles(1, 'h1', 'a1', [
        leg('home', { highCheckout: { playerId: 'h1', value: '134' } }),
        leg('home'),
        leg('away'),
      ]),
    ];
    const accum = computePlayerAccum(games, 'home-team', 'away-team', matchId, date);
    expect(accum.get('h1')?.highCheckouts).toEqual([{ value: '134', matchId, date }]);
    expect(accum.get('a1')?.highCheckouts).toEqual([]);
  });

  it('never entries a player who did not appear in any game', () => {
    const games = [singles(1, 'h1', 'a1', [leg('home'), leg('home'), leg('away')])];
    const accum = computePlayerAccum(games, 'home-team', 'away-team', matchId, date);
    expect(accum.has('h2')).toBe(false);
  });

  it('computes correct totals across a full 7-game match', () => {
    const accum = computePlayerAccum(homeSweepMatch(), 'home-team', 'away-team', matchId, date);
    // 5 singles players each play once; h1/h2 and h3/h4 additionally play one pairs game each.
    expect(accum.get('h1')).toMatchObject({ played: 2, won: 2, lost: 0 });
    expect(accum.get('h5')).toMatchObject({ played: 1, won: 1, lost: 0 });
    expect(accum.get('a1')).toMatchObject({ played: 2, won: 0, lost: 2 });
    expect(accum.get('a5')).toMatchObject({ played: 1, won: 0, lost: 1 });
  });
});

// ── normalizeGames / gamesEqual — the auto-confirm vs. dispute decision ─────

describe('gamesEqual', () => {
  it('treats identical submissions as equal', () => {
    const games = homeSweepMatch();
    expect(gamesEqual(games, homeSweepMatch())).toBe(true);
  });

  it('ignores game submission order (captains may enter games in a different order)', () => {
    const games = homeSweepMatch();
    const reordered = [...games].reverse();
    expect(gamesEqual(games, reordered)).toBe(true);
  });

  it('ignores player-id order within a pairs game', () => {
    const a = [pairs(6, ['h1', 'h2'], ['a1', 'a2'], [leg('home'), leg('home'), leg('away')])];
    const b = [pairs(6, ['h2', 'h1'], ['a2', 'a1'], [leg('home'), leg('home'), leg('away')])];
    expect(gamesEqual(a, b)).toBe(true);
  });

  it('ignores 180-list order within a leg', () => {
    const a = [singles(1, 'h1', 'a1', [leg('home', { oneEighties: ['h1', 'a1'] }), leg('home'), leg('away')])];
    const b = [singles(1, 'h1', 'a1', [leg('home', { oneEighties: ['a1', 'h1'] }), leg('home'), leg('away')])];
    expect(gamesEqual(a, b)).toBe(true);
  });

  it('ignores incidental whitespace in a high-checkout value', () => {
    const a = [singles(1, 'h1', 'a1', [leg('home', { highCheckout: { playerId: 'h1', value: '134' } }), leg('home'), leg('away')])];
    const b = [singles(1, 'h1', 'a1', [leg('home', { highCheckout: { playerId: 'h1', value: ' 134 ' } }), leg('home'), leg('away')])];
    expect(gamesEqual(a, b)).toBe(true);
  });

  it('flags a real disagreement on which side won a leg — must go to dispute, not auto-confirm', () => {
    const a = [singles(1, 'h1', 'a1', [leg('home'), leg('home'), leg('away')])];
    const b = [singles(1, 'h1', 'a1', [leg('away'), leg('home'), leg('away')])];
    expect(gamesEqual(a, b)).toBe(false);
  });

  it('flags a disagreement over who threw a 180', () => {
    const a = [singles(1, 'h1', 'a1', [leg('home', { oneEighties: ['h1'] }), leg('home'), leg('away')])];
    const b = [singles(1, 'h1', 'a1', [leg('home', { oneEighties: [] }), leg('home'), leg('away')])];
    expect(gamesEqual(a, b)).toBe(false);
  });

  it('flags a disagreement over a high-checkout value', () => {
    const a = [singles(1, 'h1', 'a1', [leg('home', { highCheckout: { playerId: 'h1', value: '134' } }), leg('home'), leg('away')])];
    const b = [singles(1, 'h1', 'a1', [leg('home', { highCheckout: { playerId: 'h1', value: '121' } }), leg('home'), leg('away')])];
    expect(gamesEqual(a, b)).toBe(false);
  });

  it('flags a different number of games as unequal', () => {
    const a = homeSweepMatch();
    const b = a.slice(0, 6);
    expect(gamesEqual(a, b)).toBe(false);
  });
});

describe('normalizeGames', () => {
  it('sorts games by order and player ids consistently regardless of input order', () => {
    const games = [pairs(7, ['b', 'a'], ['d', 'c'], [leg('home'), leg('home'), leg('away')])];
    const [normalized] = normalizeGames(games);
    expect(normalized.homePlayerIds).toEqual(['a', 'b']);
    expect(normalized.awayPlayerIds).toEqual(['c', 'd']);
  });

  it('does not mutate the input array', () => {
    const games = homeSweepMatch();
    const copy = JSON.parse(JSON.stringify(games));
    normalizeGames(games);
    expect(games).toEqual(copy);
  });
});

describe('sortableTeamName', () => {
  it('strips a leading "The " so it sorts under its next word', () => {
    expect(sortableTeamName('The Anchor')).toBe('Anchor');
  });

  it('is case-insensitive on "the"', () => {
    expect(sortableTeamName('the Bluebell')).toBe('Bluebell');
  });

  it('leaves names with no leading "The" unchanged', () => {
    expect(sortableTeamName('Kings Arms')).toBe('Kings Arms');
  });

  it('does not strip "the" when it is not a standalone leading word', () => {
    expect(sortableTeamName('Theatre Royal')).toBe('Theatre Royal');
  });

  it('sorts a mixed list ignoring leading "The"', () => {
    const names = ['The Swan', 'Kings Arms', 'The Anchor', 'Bedford Ath'];
    const sorted = [...names].sort(
      (a, b) => sortableTeamName(a).localeCompare(sortableTeamName(b)),
    );
    expect(sorted).toEqual(['The Anchor', 'Bedford Ath', 'Kings Arms', 'The Swan']);
  });
});
