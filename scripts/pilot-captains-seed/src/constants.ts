// Every fixed identifier, name, and credential this script uses. Nothing
// here is derived from argv, an env var, or a live query — scope is two
// real Division 2 teams only, chosen to match the first fixture in the
// real Bedford & Kempston Winter 2026/27 schedule (see
// scripts/real-season-import-staging, which must be run first — this
// script never creates a league/season/division/team/match itself, only
// players + captain accounts on top of teams that already exist).
//
// Player and captain names are DELIBERATE PLACEHOLDERS, not real people —
// per explicit instruction, this pilot round tests the captain UI/
// permissions model itself, not real-world sign-up. Every name below is
// clearly labelled as a pilot placeholder so it can never be mistaken for
// real roster data later.

// ── Firebase project — the one and only project this script may ever touch ──
export const EXPECTED_PROJECT_ID = 'chalkie-app-staging';

// ── Real league/season/division identity — must already exist (created by
// scripts/real-season-import-staging), never created by this script. ──────
export const LEAGUE_ID = 'bedford-kempston-district';
export const SEASON_ID = 'bedford-kempston-winter-2026-27';
export const DIVISION_2_ID = 'bedford-kempston-winter-2026-27-division-2';

// ── The one pilot fixture this round is scoped to (Division 2, Week 1,
// 2026-10-14 — the first fixture in the real schedule). This script never
// writes to the match document itself; this is here only for the printed
// banner/verification report, so the operator can see at a glance which
// fixture this seed is for. ─────────────────────────────────────────────
export const PILOT_MATCH_ID = 'bk-d2-w01-2v1';

export type PilotTeamKey = 'oakley' | 'burnabyc';

export interface PilotTeam {
  key: PilotTeamKey;
  teamId: string;
  teamName: string;
  captainEmail: string;
  captainDisplayName: string;
  playerNamePrefix: string;
}

// Team 2 (home) and Team 1 (away) in scripts/real-season-import-staging's
// own numbering — see that package's src/constants.ts (teamId()) for how
// these exact IDs are derived from the poster's official team numbers.
export const PILOT_TEAMS: readonly PilotTeam[] = [
  {
    key: 'oakley',
    teamId: 'bk-d2-team-2',
    teamName: 'Oakley Sports Club',
    captainEmail: 'pilot.captain.oakley@chalkie.test',
    captainDisplayName: 'Oakley Pilot Captain',
    playerNamePrefix: 'Oakley Pilot Player',
  },
  {
    key: 'burnabyc',
    teamId: 'bk-d2-team-1',
    teamName: 'Burnaby Arms C',
    captainEmail: 'pilot.captain.burnabyc@chalkie.test',
    captainDisplayName: 'Burnaby C Pilot Captain',
    playerNamePrefix: 'Burnaby C Pilot Player',
  },
];

// 5 players per team: enough to fill all 7 games of a real match sheet
// (games 1-5 singles — 1 player each; games 6-7 pairs — 2 players each,
// reusing players from the 5-person squad) — see functions/src/index.ts's
// GAMES_PER_MATCH/SINGLES_GAMES for the exact shape this is sized against.
// Player index 1 on each team is also that team's captain (same "captain
// is always also a player" convention scripts/showcase-seed already uses).
export const PLAYERS_PER_TEAM = 5;
export const CAPTAIN_ROSTER_INDEX = 1;

// Clearly test-only, distinct from scripts/showcase-seed's own
// ChalkieShowcase2026! — never mistake one dataset's credentials for the
// other's.
export const PILOT_PASSWORD = 'ChalkiePilotTest2026!';

export function playerId(team: PilotTeam, rosterIndex: number): string {
  return `pilot-player-${team.teamId}-${rosterIndex}`;
}

export function playerName(team: PilotTeam, rosterIndex: number): string {
  return `${team.playerNamePrefix} ${rosterIndex}`;
}

export function allPilotEmails(): string[] {
  return PILOT_TEAMS.map((t) => t.captainEmail);
}
