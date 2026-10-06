// Every fixed identifier this script uses. Nothing here is derived from
// argv, an env var, or a live query — scope is exactly three pre-identified
// collisions between pilot/test accounts and the real teams they'd block a
// real captain/VC invite from working correctly on (see the architectural
// review that preceded this script): a real captain's teams.captainUserId
// write alone wouldn't be enough, because match-sheet submission is
// authorized by the SUBMITTING USER's OWN users/{uid}.teamId + role, not by
// teams.captainUserId — so the pilot accounts' own team/role fields must be
// cleared too, or they'd still be able to submit for a team they no longer
// nominally captain.

export const EXPECTED_PROJECT_ID = 'chalkie-app-staging';
export const LEAGUE_ID = 'bedford-kempston-district';

export const OAKLEY_TEAM_ID = 'bk-d2-team-2';
export const BURNABY_C_TEAM_ID = 'bk-d2-team-1';
export const BURNABY_B_TEAM_ID = 'bk-d3-team-2';

export const OAKLEY_CAPTAIN_EMAIL = 'pilot.captain.oakley@chalkie.test';
export const BURNABY_C_CAPTAIN_EMAIL = 'pilot.captain.burnabyc@chalkie.test';
export const ADMIN_EMAIL = 'pilot.admin@chalkie.test';

// The one bespoke player doc scripts/pilot-admin-vc-link created purely as
// an artifact of linking the admin account as Burnaby Arms B's VC — not
// part of the real roster, not part of the pilot-captains-seed placeholder
// convention, and not referenced by any match (Burnaby Arms B has no
// confirmed/submitted matches). Safe to delete outright, unlike the
// Oakley/Burnaby C pilot captains' own placeholder roster players, which
// this script deliberately leaves untouched.
export const BURNABY_B_ADMIN_PLAYER_ID = `pilot-admin-vc-${BURNABY_B_TEAM_ID}`;
