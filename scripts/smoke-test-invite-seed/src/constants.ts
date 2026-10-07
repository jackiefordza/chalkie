// Every fixed identifier this script uses. Nothing here is derived from
// argv, an env var, or a live query. Scope is exactly: one brand-new,
// wholly-isolated throwaway team (and its invented league/season/division
// IDs, which exist nowhere else in chalkie-app-staging and never collide
// with any real Bedford & Kempston District data), plus one pending
// Captain Invite on it. This script never touches any real league,
// season, division, team, captain, vice-captain, or contact data, and
// never creates or modifies any Firebase Auth account.

// ── Firebase project — the one and only project this script may ever touch ──
export const EXPECTED_PROJECT_ID = 'chalkie-app-staging';

// ── Existing staging admin account, looked up by email only, NEVER created
// or modified by this script. Used solely so the invite's createdByUserId
// field (an audit trail, like every other invite in this app) points at a
// real admin account instead of a fabricated uid. See
// scripts/pilot-admin-seed — this account already exists in staging. ──────
export const ADMIN_EMAIL = 'pilot.admin@chalkie.test';

// ── Brand-new, clearly-fake, wholly isolated team/league/season/division
// IDs. Deliberately NOT under bedford-kempston-district (the real league)
// and NOT under showcase-league (which belongs to chalkie-app PRODUCTION,
// not staging, anyway) — this exists in its own namespace so there is
// structurally zero chance of this script ever reading, writing, or
// colliding with any real team's captainUserId/viceCaptainUserId or any
// real contact data. ────────────────────────────────────────────────────
export const LEAGUE_ID = 'smoke-test-league';
export const SEASON_ID = 'smoke-test-season';
export const DIVISION_ID = 'smoke-test-division';
export const TEAM_ID = 'smoke-test-team';
export const TEAM_NAME = 'SMOKE TEST TEAM (temporary — safe to delete)';

// Either role exercises the identical code path in performCreateTeamInvite/
// performAcceptTeamInvite (both are role-agnostic) — 'captain' chosen
// arbitrarily; it does not need to match any real invite's role.
export const INVITE_ROLE: 'captain' | 'viceCaptain' = 'captain';

// Matches functions/src/index.ts's own INVITE_EXPIRY_MS exactly — not
// re-derived, just mirrored, so this throwaway invite behaves identically
// to a real one for the duration of the smoke test.
export const INVITE_EXPIRY_MS = 14 * 24 * 60 * 60 * 1000;

// The existing staging Hosting Preview channel URL serving commit
// 0c0d8ba (the deployed invite-flow fix) — same URL
// deploy-hosting-preview-staging.yml's last run printed. Only used to
// build this run's printed invite link; never deployed to by this script.
export const STAGING_PREVIEW_BASE_URL = 'https://chalkie-app-staging--pr39-matchday-model-alkh20oi.web.app';
