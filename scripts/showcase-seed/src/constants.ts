// Every fixed identifier, name, and email the showcase dataset uses. Nothing
// in this file is derived from a live user, a live league, or a CLI
// argument — every value here is a compile-time constant, which is exactly
// what makes the safety rails in firebaseAdmin.ts able to check writes
// against a fixed allowlist rather than trusting runtime input.

// ── Firebase project — the one and only project this script may ever touch ──
export const EXPECTED_PROJECT_ID = 'chalkie-app';

// ── Showcase league identity (hard-coded — never read from argv or env) ─────
export const LEAGUE_ID = 'showcase-league';
export const SEASON_ID = 'showcase-season';
export const DIVISION_ID = 'showcase-division';

export const LEAGUE_NAME = 'Alderbrook & District Darts League';
export const SEASON_NAME = '2026/27 Winter Season';
export const DIVISION_NAME = 'Division One';

// ── Determinism ──────────────────────────────────────────────────────────
// Seeds every generated match result (lineups, leg splits, 180s, high
// checkouts, and which non-special fixtures get confirmed). Calendar dates
// are deliberately NOT part of this determinism — see fixtures.ts — they're
// always relative to when the script is actually run, so the data looks
// "current" whenever that is, right up to the 16 September showcase.
export const RNG_SEED = 20260916;

// ── Shared showcase credentials ──────────────────────────────────────────
export const SHOWCASE_PASSWORD = 'ChalkieShowcase2026!';

// ── Teams ─────────────────────────────────────────────────────────────────
export const TEAM_NAMES = [
  'The Red Lion',
  'The Railway Tavern',
  'Kings Arms',
  'The White Swan',
  'The Miners Arms',
  'The Ferry Boat Inn',
  'The Coach & Horses',
  'The Plough',
] as const;

export const TEAM_COUNT = TEAM_NAMES.length; // 8

export function teamId(teamIndex: number): string {
  return `showcase-team-${teamIndex + 1}`;
}

// ── Players — index 0 = Captain, index 1 = Vice-Captain, 2-5 = squad ───────
// 6 players per team x 8 teams = 48.
export const PLAYER_NAMES: readonly (readonly string[])[] = [
  ['Martin Hayes', 'Karen Whitfield', 'Chris Reid', 'Paul Grainger', 'Steve Kirby', 'Neil Ashworth'],
  ['Tony Blackwell', 'Michelle Carver', 'Simon Yates', 'Gary Pemberton', 'Alan Fitch', 'Derek Whitmore'],
  ['Jason Wren', 'Sandra Openshaw', 'Ian Bostock', 'Keith Sharman', 'Mark Hollis', 'Andy Newby'],
  ['Craig Prentice', 'Denise Faulkner', 'Darren Dunmore', 'Lee Cusack', 'Kevin Rowbotham', 'Nigel Tunnicliffe'],
  ['Barry Sedgwick', 'Tracy Bracewell', 'Colin Whitlow', 'Trevor Garratt', 'Graham Speight', 'Julie Iliffe'],
  ['Phil Rushton', 'Linda Kellow', 'Rob Bramley', 'Adrian Studley', 'Stuart Nesbitt', 'Terry Yardley'],
  ['Brian Colley', 'Nicola Fenwick', 'Roy Hargreaves', 'Malcolm Winstanley', 'Peter Broadbent', 'Frank Lathwell'],
  ['Susan Marchant', 'Rachel Pickersgill', 'Emma Norcott', 'Claire Tovey', 'Louise Fairweather', 'Amanda Studd'],
];

export const PLAYERS_PER_TEAM = 6;
export const CAPTAIN_INDEX = 0;
export const VICE_CAPTAIN_INDEX = 1;

export function playerId(teamIndex: number, playerIndex: number): string {
  return `showcase-player-${teamIndex + 1}-${playerIndex + 1}`;
}

// ── Personas / accounts ──────────────────────────────────────────────────
// Team 0 (The Red Lion) is the "primary demo" team — its captain/VC get
// short, memorable emails; the other 7 teams get numbered ones (see the
// design doc for why).
export function captainEmail(teamIndex: number): string {
  return teamIndex === 0 ? 'showcase.captain@chalkie.test' : `showcase.captain.${teamIndex + 1}@chalkie.test`;
}
export function viceCaptainEmail(teamIndex: number): string {
  return teamIndex === 0 ? 'showcase.vc@chalkie.test' : `showcase.vc.${teamIndex + 1}@chalkie.test`;
}

export const NORMAL_PLAYER_EMAIL = 'showcase.player@chalkie.test';
// The normal-player persona claims the "Chris Reid" slot — team 0 (Red Lion), roster index 2 (0-based: 0=captain, 1=VC, 2=Chris Reid).
export const NORMAL_PLAYER_TEAM_INDEX = 0;
export const NORMAL_PLAYER_ROSTER_INDEX = 2;

export const LEAGUE_ADMIN_EMAIL = 'showcase.leagueadmin@chalkie.test';
export const GLOBAL_ADMIN_EMAIL = 'showcase.globaladmin@chalkie.test';

// Every Auth account this script (or its reset path) may ever touch — used
// both by reset (to look accounts up by email, never by query) and by the
// write-guard in firebaseAdmin.ts (to refuse a `users/{uid}` write for any
// uid that didn't resolve from one of these emails).
export function allShowcaseEmails(): string[] {
  const emails: string[] = [NORMAL_PLAYER_EMAIL, LEAGUE_ADMIN_EMAIL, GLOBAL_ADMIN_EMAIL];
  for (let i = 0; i < TEAM_COUNT; i++) {
    emails.push(captainEmail(i), viceCaptainEmail(i));
  }
  return emails; // 3 + 8 + 8 = 19
}

// ── Match generation ──────────────────────────────────────────────────────
export const TOTAL_FIXTURE_COUNT = TEAM_COUNT * (TEAM_COUNT - 1); // 56 (double round-robin, 8 teams)
export const CONFIRMED_MATCH_COUNT = 20;
export const SCHEDULE_INTERVAL_DAYS = 7; // one round per week, same convention as mockSeason.ts
export const SCHEDULE_LEAD_WEEKS = 5; // rounds 1-ish land this many weeks in the past, relative to run time

export const HIGH_CHECKOUT_VALUES = ['170', '164', '161', '158', '146', '140', '121', '116', '100', '96'];

export function matchId(homeTeamIdx: number, awayTeamIdx: number, round: number): string {
  return `showcase-match-r${round}-${homeTeamIdx + 1}v${awayTeamIdx + 1}`;
}

// ── Special-state pairings (by team index into TEAM_NAMES/PLAYER_NAMES) ────
// Selected by team pair, not by a literal "round 6" — see fixtures.ts's
// comment for why: which literal round number a given pairing lands in is
// an artifact of the round-robin circle-method rotation, and hard-coding
// around that is more fragile than just searching for the pairing.
export const DISPUTED_PAIRING: readonly [number, number] = [0, 3]; // The Red Lion vs The White Swan
export const AWAITING_CONFIRMATION_PAIRING: readonly [number, number] = [1, 2]; // The Railway Tavern vs Kings Arms
export const SCHEDULED_EXAMPLE_PAIRINGS: readonly (readonly [number, number])[] = [
  [4, 5], // The Miners Arms vs The Ferry Boat Inn
  [6, 7], // The Coach & Horses vs The Plough
];

export function specialPairings(): (readonly [number, number])[] {
  return [DISPUTED_PAIRING, AWAITING_CONFIRMATION_PAIRING, ...SCHEDULED_EXAMPLE_PAIRINGS];
}
