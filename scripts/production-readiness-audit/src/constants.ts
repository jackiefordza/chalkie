// Every fixed identifier this script uses. Nothing here is derived from
// argv, an env var, or a live query.
//
// ── THIS IS THE ONE SCRIPT IN THIS REPO DELIBERATELY POINTED AT chalkie-app
// (production) — every other script's EXPECTED_PROJECT_ID is
// 'chalkie-app-staging' and refuses to run against production. This
// script inverts that: it refuses to run against anything OTHER than
// 'chalkie-app'. It is safe to point at production ONLY because it
// contains zero write-capable code anywhere in its source — verified by
// prove-read-only.sh (a static grep check) as a required step before this
// script is ever invoked. See README.md.

export const EXPECTED_PROJECT_ID = 'chalkie-app';

// ── Real league/season/division identity — same canonical IDs used by
// scripts/real-season-import-staging (which is itself a staging-retargeted
// copy of the not-yet-run production importer, PR #36). Reading these IDs
// here does not require that importer's dataset/validation code — this
// script only checks EXISTENCE and COUNTS, never full documents. ────────
export const LEAGUE_ID = 'bedford-kempston-district';
export const SEASON_ID = 'bedford-kempston-winter-2026-27';
export const DIVISION_2_ID = 'bedford-kempston-winter-2026-27-division-2';
export const DIVISION_3_ID = 'bedford-kempston-winter-2026-27-division-3';
export const EXPECTED_TEAM_COUNT = 16; // 8 per division
export const EXPECTED_FIXTURE_COUNT = 112; // 14 weeks x 8 fixtures (2 divisions x 4 matches/week)

// ── Known non-production test/pilot email addresses whose existence in
// PRODUCTION Auth would be a contamination signal worth flagging. Checked
// by exact lookup (auth.getUserByEmail) — never by listing/dumping all
// users. Only existence (true/false) is ever reported for these, never
// any other field. ─────────────────────────────────────────────────────
export const KNOWN_TEST_EMAILS: readonly string[] = [
  'pilot.admin@chalkie.test',
  'pilot.captain.oakley@chalkie.test',
  'pilot.captain.burnabyc@chalkie.test',
  'showcase.captain@chalkie.test',
  'showcase.vc@chalkie.test',
  'showcase.player@chalkie.test',
  'showcase.leagueadmin@chalkie.test',
  'showcase.globaladmin@chalkie.test',
  'jake.test@test.com',
];

// The user's own real staging VC account email — checked for existence in
// PRODUCTION only (does a real account already exist there, unrelated to
// staging?). Never modified. The user already knows this address; it is
// not exposed to anyone else by this report.
export const REAL_USER_EMAIL_TO_CHECK = 'jfordham95@gmail.com';
