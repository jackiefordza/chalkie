import type { DivisionTable, Match } from '@/types';
import { recentForm } from './recentForm';

// The upcoming opponent's standings position and recent form for the Home
// Dashboard's Next Match card. Both are resolved from the OPPONENT's own
// data, scoped to the same league/season/division as the fixture itself —
// never from the viewer's own team or standings row. This is the fix for
// the bug where the card showed the viewer's own position twice (once here,
// once in the "Your Team" section) instead of the opponent's.
export interface OpponentInfo {
  opponentId: string;
  tableRow: DivisionTable | null;
  form: ('W' | 'L')[];
}

type ScopedMatch = Pick<Match, 'homeTeamId' | 'awayTeamId' | 'seasonId' | 'divisionId' | 'leagueId'>;

// `tableRows` and `leagueMatches` are expected to be scoped by the caller's
// own Firestore query (matching the existing divisionTables/matches query
// shapes already used elsewhere in this file's caller — see HomeDashboard's
// NextMatchHero), but this function re-filters both defensively by the
// fixture's own leagueId/seasonId/divisionId regardless of what's passed
// in, so a caller bug in query scoping can't leak another league's or
// division's data into the card — the same defense-in-depth this app
// already applies server-side (see isValidGamesShape/allPlayersLegitimate
// in functions/src/index.ts).
export function resolveOpponentInfo(
  match: ScopedMatch,
  viewerTeamId: string,
  tableRows: DivisionTable[],
  leagueMatches: Match[],
): OpponentInfo {
  const opponentId = match.homeTeamId === viewerTeamId ? match.awayTeamId : match.homeTeamId;

  const tableRow = tableRows.find((r) => (
    r.teamId === opponentId
    && r.seasonId === match.seasonId
    && r.divisionId === match.divisionId
    && r.leagueId === match.leagueId
  )) ?? null;

  const opponentMatches = leagueMatches.filter((m) => (
    m.leagueId === match.leagueId
    && (m.homeTeamId === opponentId || m.awayTeamId === opponentId)
  ));

  return { opponentId, tableRow, form: recentForm(opponentMatches, opponentId) };
}
