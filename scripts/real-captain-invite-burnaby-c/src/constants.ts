// Every fixed identifier this script uses. Nothing here is derived from
// argv, an env var, or a live query. Scope is exactly ONE real Captain
// invite for ONE real team — teams/bk-d2-team-1 (Burnaby Arms C, Division
// 2) — in the Bedford & Kempston District league already imported by
// scripts/real-season-import-staging. This script never creates that
// team (it must already exist) and never writes to it at all — it only
// reads it to verify identity/empty-slot, then writes exactly one new
// invites/{auto-id} document.

// ── Firebase project — the one and only project this script may ever touch ──
export const EXPECTED_PROJECT_ID = 'chalkie-app-staging';

// ── Existing staging admin account, looked up by email only, NEVER created
// or modified by this script. Used both to attribute the invite's
// createdByUserId (an audit trail, like every other invite) and because it
// is a real league admin scoped to LEAGUE_ID, matching the real
// createTeamInvite flow's own assertLeagueAdmin requirement. ──────────────
export const ADMIN_EMAIL = 'pilot.admin@chalkie.test';

// ── Real league/season/division/team identity — must already exist
// (scripts/real-season-import-staging), never created or modified here. ──
export const LEAGUE_ID = 'bedford-kempston-district';
export const SEASON_ID = 'bedford-kempston-winter-2026-27';
export const DIVISION_2_ID = 'bedford-kempston-winter-2026-27-division-2';
export const TEAM_ID = 'bk-d2-team-1';
export const TEAM_NAME = 'Burnaby Arms C';

export const INVITE_ROLE: 'captain' = 'captain';

// Matches functions/src/index.ts's own INVITE_EXPIRY_MS exactly — not
// re-derived, just mirrored, so this invite behaves identically to one
// created through the app's own admin-team.tsx UI.
export const INVITE_EXPIRY_MS = 14 * 24 * 60 * 60 * 1000;

// The existing staging Hosting Preview channel URL serving the deployed
// invite-flow fix (commit 0c0d8ba). Only used to build this run's printed
// invite link; never deployed to by this script.
export const STAGING_PREVIEW_BASE_URL = 'https://chalkie-app-staging--pr39-matchday-model-alkh20oi.web.app';
