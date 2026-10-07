// Every fixed identifier this script uses. Nothing here is derived from
// argv, an env var, or a live query. Scope is exactly: delete the two
// documents and one Auth account created by scripts/smoke-test-invite-seed
// for the now-completed Captain Invite smoke test, after verifying the
// Auth account belongs ONLY to the throwaway team. Never touches any real
// league/season/division/team/captain/VC account or data.

// ── Firebase project — the one and only project this script may ever touch ──
export const EXPECTED_PROJECT_ID = 'chalkie-app-staging';

// ── The exact throwaway documents created by scripts/smoke-test-invite-seed.
export const SMOKE_TEST_TEAM_ID = 'smoke-test-team';
export const SMOKE_TEST_LEAGUE_ID = 'smoke-test-league';
export const SMOKE_TEST_SEASON_ID = 'smoke-test-season';
export const SMOKE_TEST_DIVISION_ID = 'smoke-test-division';
export const SMOKE_TEST_INVITE_ID = 'MPMApUNQ7WZgzY6BQQ5Q';

// The one throwaway Auth account the manual smoke test registered and used
// to accept the invite above — looked up by email, deleted only after this
// script independently confirms (by re-reading Firestore) that it is
// linked to smoke-test-team and nothing else.
export const SMOKE_TEST_ACCOUNT_EMAIL = 'jake.test@test.com';

// ── Read-only verification anchors — NEVER written to by this script, only
// read back afterward to prove they were left untouched. ──────────────────
export const REAL_PILOT_ADMIN_EMAIL = 'pilot.admin@chalkie.test';
export const REAL_LEAGUE_ID = 'bedford-kempston-district';
export const REAL_VC_EMAIL = 'jfordham95@gmail.com';
export const REAL_TEAM_ID = 'bk-d3-team-2'; // Burnaby Arms B
