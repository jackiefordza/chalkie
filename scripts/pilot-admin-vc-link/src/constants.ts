// Every fixed identifier this script uses. Nothing here is derived from
// argv, an env var, or a live query — scope is exactly one link: the
// EXISTING pilot.admin@chalkie.test staging admin account (created by
// scripts/pilot-admin-seed, which must already have run) to ONE new claimed
// player record on Burnaby Arms B, Division 3, as vice-captain. This script
// never creates an Auth account and never creates a league/season/division/
// team — all of those must already exist (scripts/real-season-import-staging).

// ── Firebase project — the one and only project this script may ever touch ──
export const EXPECTED_PROJECT_ID = 'chalkie-app-staging';

// ── Real league/season/division/team identity — must already exist, never
// created by this script. Same IDs scripts/real-season-import-staging uses
// (division3, team #2 — see that script's src/constants.ts). ──────────────
export const LEAGUE_ID = 'bedford-kempston-district';
export const SEASON_ID = 'bedford-kempston-winter-2026-27';
export const DIVISION_3_ID = 'bedford-kempston-winter-2026-27-division-3';
export const TEAM_ID = 'bk-d3-team-2';
export const TEAM_NAME = 'Burnaby Arms B';

// The existing admin account this script links — created by
// scripts/pilot-admin-seed. This script looks it up by email and NEVER
// calls auth.createUser; if the account doesn't exist, it refuses to run.
export const ADMIN_EMAIL = 'pilot.admin@chalkie.test';

// One deterministic player doc — this script's only players/ write.
export const PLAYER_ID = `pilot-admin-vc-${TEAM_ID}`;
