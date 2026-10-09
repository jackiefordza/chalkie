// Every fixed identifier, name, and credential this script uses. Nothing
// here is derived from argv, an env var, or a live query — scope is exactly
// one temporary, clearly staging-only league-admin account, for testing the
// admin dispute-resolution screen against the real Captain A / Captain B
// pilot data (scripts/real-season-import-staging + scripts/
// pilot-captains-seed, which must both already have run — this script never
// creates a league/season/division/team/match/player/captain itself).

// ── Firebase project — the one and only project this script may ever touch ──
export const EXPECTED_PROJECT_ID = 'chalkie-app-staging';

// ── Real league identity — must already exist (created by scripts/
// real-season-import-staging), never created by this script. ───────────────
export const LEAGUE_ID = 'bedford-kempston-district';

// scripts/real-season-import-staging's importer writes this exact
// placeholder into leagues/{LEAGUE_ID}.adminUserId on first creation,
// "pending real admin onboarding" (see that script's importer.ts /
// offlineChecks.ts). This script is that onboarding step — it corrects the
// placeholder to this account's real uid, the same one-time correction
// scripts/showcase-seed's seedAdminPersonas makes for its own showcase
// league admin.
export const PENDING_ADMIN_PLACEHOLDER = 'PENDING_REAL_ADMIN_ACCOUNT';

// Clearly a temporary pilot-test account, not a real person — same
// '@chalkie.test' convention scripts/pilot-captains-seed uses for its two
// captain accounts.
//
// Deliberately NO password constant here. A password is never committed to
// version control, even a throwaway test one — src/seedCore.ts generates
// one at runtime, only on first account creation, and it is printed once to
// this run's own output (see seed.ts) and never written to Firestore, a
// file, or this source tree. See README.md's "If you lose the password"
// section for recovery.
export const ADMIN_EMAIL = 'pilot.admin@chalkie.test';
export const ADMIN_DISPLAY_NAME = 'Pilot League Admin (staging only)';
