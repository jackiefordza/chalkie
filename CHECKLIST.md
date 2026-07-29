# Chalkie — Checklist

Quick-reference companion to `PLAN.md` (full narrative/context lives there — this is
just flat, tickable bullets). Check items off as they're shipped **and verified**, not
just started.

## Phase 0 — Cleanup
- [x] Delete dead `admin-setup.tsx`
- [x] Sync `types/index.ts` with real Firestore schema; fix `authStore.ts` dropping `seasonId`/`pendingRequestId`

## Phase 1 — Core league loop
- [x] Blaze plan + Cloud Functions project scaffolded
- [x] Round-robin fixture generator (`admin-fixtures.tsx`)
- [x] Fixtures list screens (captain/player + admin)
- [x] Results entry screen (lineup, legs, 180s, high checkout)
- [x] Submission comparison + auto-confirm Cloud Function (`onSubmissionWrite`)
- [x] Admin dispute view (`admin-dispute.tsx`)
- [x] Standings + stats recompute on confirm (`onMatchConfirmed`)
- [x] Standings screen
- [x] Stats screens (My Stats / Leaderboard)
- [x] Home "next fixture" tile
- [x] Home simplified + "Captains" tab (My Team / Inbox)
- [x] Push notifications — code complete (4 notification points + Cloud Function helper)
- [x] Admin role management screen (per-team)
- [x] Venue contact field (`Team.venuePhone`) — superseded 2026-07-22, see Venue entity below
- [x] Desktop admin console (`AdminShell`, edit/delete confirmed matches, cascading deletes)
- [x] Onboarding rewrite — request & approve, no invite/claim codes
- [x] Admin dashboard revamp (real Teams data table, season→division picker, sidebar tree)
- [ ] **Jake: real logged-in walkthrough** — the one thing blocking calling Phase 1 done. Confirm a push notification actually arrives, generate-fixtures round-trip, full results→confirm→standings loop, all against your real account/league.
- [x] Team/roster carry-over between seasons (2026-07-28, see below)

## Venue entity + fixture scheduling (2026-07-22, code complete — not deployed/migrated/live-verified)
- [x] `Venue` collection (name, address, phone, board count) — `Team.address`/`venuePhone` replaced with `Team.venueId`
- [x] `firestore.rules`/`firestore.indexes.json` updated for `venues` (league-scoped, admin write)
- [x] `adminDeleteVenue` + `adminMigrateVenues` Cloud Functions
- [x] Fixture generator: season start date + break-date ranges (Christmas etc.) skip-and-shift
- [x] Fixture generator: venue board-count clash auto-resolution (shifts excess same-day home fixtures to following days), summary banner in Fixtures tab
- [x] `admin-venues.tsx` screen + shared `VenuePickerSheet` (used by `admin-team.tsx`, `captains.tsx`, `admin-season.tsx` team creation)
- [x] `admin-season.tsx` Schedule panel (start date + breaks editor)
- [x] "Blank Test Season" dev tool (`admin-tools.tsx`) — 8 teams, 2 venues incl. a deliberate 3-teams-1-board conflict, no fixtures, for exercising Generate Fixtures live
- [x] `npx tsc --noEmit` clean (mobile + functions), `expo export -p web` clean
- [x] **Deployed 2026-07-28**: `firestore.rules`, `firestore.indexes.json`, and all Cloud Functions (incl. `adminDeleteVenue`, `adminMigrateVenues`) confirmed live on `chalkie-app` via `firebase deploy` (CI token) — verified with `firebase functions:list`
- [x] **Jake: run "Migrate Teams to Venues"** — confirmed done: all 29 real teams have `venueId` set, none still carry the old plain-text address field (checked directly against production 2026-07-29)
- [x] Fold into the real walkthrough above: generate fixtures against a division with a shared venue and confirm the clash-resolution banner/dates look right — verified 2026-07-29 against the real Summer 2026 season (182 matches/29 teams/22 venues across 4 divisions): zero venue clashes anywhere, every round on its correct single date, full round-robin math correct
- [x] Add Team gets a Division dropdown (works from any entry point, incl. a new season-level "+ Add Team") instead of being locked to whichever division you clicked from
- [x] `adminMoveTeamDivision` Cloud Function — move an existing team to a different division in the same season, blocked while it has any fixtures (not just confirmed ones)
- [x] Rename season, rename division, rename team — all editable after creation, not just at setup time (`admin-season.tsx`, `admin-team.tsx`)

## Mobile testing & real device builds (2026-07-13 → ongoing)
- [x] EAS project created & linked (`@fordza95/chalkie`)
- [x] `mobile/eas.json` build profiles added (development/preview/production)
- [x] `expo-dev-client` installed
- [x] Expo Go testing working via Codespaces public-port workaround (Expo's bundled tunnel ngrok is broken/deprecated)
- [ ] Jake: test app in Expo Go on iPhone from work PC tomorrow
- [ ] FCM V1 service account credential (`eas credentials`, via Firebase Console) — needed for Android push specifically
- [x] **2026-07-28 — Design Android notification icon asset.** `mobile/assets/notification-icon.png`:
      a white bullseye/target silhouette on transparent, generated to match Android's
      spec exactly (96x96 baseline, pure white, `resizeMode: cover` — verified against the
      actual installed `expo-notifications` plugin source, not just docs, since those
      were unreachable). Matches the "target" icon-font glyph already used as Chalkie's
      de facto in-app mark (login screen, header) — reads as darts regardless of the
      pending rename. Wired into `app.json`'s `expo-notifications` plugin config
      (`icon`/`color: "#7A4FD1"`, the app's brand purple). Verified: renders correctly
      transparent, reads clearly on a dark background, and stays legible even
      downscaled to actual notification-bar size (24px). `npx expo config` resolves
      clean, `npx tsc --noEmit` clean.
      **Bigger thing found while doing this, flagged not fixed:** `assets/icon.png` (the
      actual home-screen app icon) and `assets/android-icon-monochrome.png` are both
      still the unmodified Expo scaffold placeholders — a generic blue chevron with
      visible design-tool blueprint/guide lines still in the image, not a real Chalkie
      mark. There is no bespoke app logo anywhere in the codebase; the "logo" seen
      throughout the app's UI is just a generic `target` icon-font glyph tinted brand
      purple (`AppIcon name="target"`), not a designed asset. Deliberately not fixed in
      this pass — a real app icon is a bigger creative decision than a notification
      icon, and reasonably belongs after the pending rename is settled rather than
      designing a mark for a name that's about to change.
- [ ] Run a real Android `eas build` (dev/preview profile → sideloadable `.apk`, no store account needed) once the FCM cred + icon are in place

**Deferred to Phase 3 (2026-07-22 — Jake not paying for Apple Developer Program yet):**
- [ ] Apple Developer Program enrollment ($99/yr) — blocks any real iOS build, dev or prod (Apple requires a paid account to sign builds at all, unlike Android sideloading)
- [ ] Google Play dev account — only needed for Play Store distribution, not for Android sideload testing
- [ ] Real iOS `eas build` / TestFlight

## Phase 2 — Cup & individual competitions
- [ ] Team knockout cup (single-elimination, cross-division)
- [ ] Singles knockout
- [ ] Pairs knockout
- [ ] Captains Cup
- [ ] Player Championship (top 12/division, seeded from `playerSeasonStats`)
- [ ] 180 Cup
- [ ] Bracket UI (draw/seed, record rounds, advance winners)

## Phase 3 — Productization
- [ ] Memberships subcollection (multi-league support) — breaking schema change, not mid-trial
- [ ] Paid tiers (Stripe billing, gated fixture wizard)
- [ ] Real app store builds / TestFlight / Play internal testing (see Mobile testing section above — in progress)

## Bugs — fixed
- [x] Missing `matches` indexes → silent infinite spinner (2026-07-02)
- [x] `Alert.alert` a no-op on web — broke every delete/confirm dialog (2026-07-10)
- [x] Admin/captain "Add Player" missing `divisionId` (2026-07-13)
- [x] Blank Standings page with no empty state (2026-07-13)
- [x] Multiple seasons could be "active" at once; Dashboard Teams count summed across all seasons (2026-07-13)
- [x] VC "waiting for request" hint incorrectly gated on Captain's state (2026-07-13)
- [x] **Missing `onSnapshot` error handlers, app-wide — 2026-07-28.** The same silent-stuck-spinner
      failure mode as the 2026-07-02 indexes bug above, but audited across the *entire* app rather
      than just the two screens that bug happened to hit. All ~40 `onSnapshot` call sites across 18
      files now pass a 3rd error-callback argument (reusing whichever error-display pattern each
      screen already had — inline banner or `Alert.alert`). Full detail + list of every file/site
      touched in PLAN.md under "Bugs found & fixed". Verified via a paren-depth-aware script (not
      a regex) confirming zero remaining 2-arg `onSnapshot` calls, plus `npx tsc --noEmit` clean.
- [x] **"Delete all & regenerate" fixtures silently doing nothing — 2026-07-29.** Its
      Firestore query filtered by `divisionId` only; the security rule needs `leagueId`
      as an explicit query filter too (same rule as everywhere else in this codebase),
      so Firestore rejected the query outright — and with no error handling, that
      vanished silently. Fixed the query and added error handling there plus on the
      two neighboring actions (edit fixture, delete one fixture) that had the same
      gap. Verified against the emulator: seeded 6 fixtures, deleted them all through
      the real button, confirmed zero left in Firestore.

## CI / deploy automation
- [x] **2026-07-29 — automatic deploy on push to `JakeDevBranch`.** Retargeted the
      existing (already-working, already-secreted) `deploy-firebase.yml` from `main`
      (stale since 2026-07-09 — see PLAN.md) to `JakeDevBranch`, added `mobile/**` to
      its path filter, and added the missing `hosting` deploy target alongside
      `functions`/`firestore:rules`/`firestore:indexes`. Also added functions
      typecheck/tests and a mobile typecheck as pre-deploy gates. No more manual
      CI-token deploys needed for routine merges — see PLAN.md for the full writeup.

## Suggested improvements (not bugs)
- [x] **Team fixtures view on `admin-team.tsx` — 2026-07-29, live-verified.** Clicking a
      team now shows all of its fixtures (home & away), each tapping through to the
      result. Verified against the Firebase Emulator.
- [x] **Admin-side "enter/confirm a result" path — 2026-07-28, code complete AND
      live-verified.** `results-entry.tsx` now lets admin pick which team they're
      entering on behalf of (a "Enter for [Home]" / "Enter for [Away]" choice, shown
      whenever admin opens a not-yet-confirmed match) — everything after that point
      reuses the exact same submission flow a captain would go through, so it goes
      through the normal auto-confirm/dispute comparison rather than bypassing it.
      `firestore.rules` broadened to let admin create/update a submission for either
      of the match's two teams (previously captain/VC-of-that-team only) — still
      guarded so admin can't submit for a team that isn't actually one of the two
      sides. **Verified via the Firebase Emulator**: UI screenshots confirm the team
      picker and "Entering on behalf of X" banner render correctly, and — the one
      thing the earlier Cloud Function integration tests couldn't check, since Admin
      SDK writes bypass security rules entirely — a client-SDK write test confirmed
      the new rule actually allows admin's submission (match correctly moved to
      `awaiting_confirmation`) and correctly **denies** a submission for a
      non-participating team (`permission-denied`, guard is real not decorative).
      `npx tsc --noEmit` clean.
- [x] **Team/roster carry-over between seasons — 2026-07-28, code complete AND
      live-verified (against a local Firebase Emulator, not real production data).**
      New Season sheet (`admin.tsx`) now offers "Copy teams & players from" any existing
      season (defaults to "Start empty" — deliberately not pre-picking the most recent
      season, since this league has throwaway test/mock seasons that could get copied by
      mistake). `mobile/src/lib/seasonCarryOver.ts` copies divisions → teams → players in
      order, preserving each team's captain/VC assignment and each player's
      `claimedByUserId`/`designatedRole` — the point is saving returning players from
      having to re-find-and-claim themselves, not just saving admin's typing. Admin edits
      the copy afterward with the normal roster screens (remove players who left, add new
      signings) — no separate review step. `npx tsc --noEmit` and `expo export -p web`
      both clean.
      **Verified 2026-07-28** by standing up the Firebase Local Emulator Suite (new
      one-time infra: `firebase.json` `emulators` block, `mobile/src/config/firebase.ts`
      dev-only emulator connection gated behind `EXPO_PUBLIC_USE_FIREBASE_EMULATOR` — off
      by default, no effect on production), seeding a fake league/season/2 divisions/3
      teams/4 players, and driving the real app in a real browser (Playwright): logged in
      as a seeded admin, opened New Season, picked the seeded season to copy from, hit
      Create. Result matched exactly — "Copied 2 divisions, 3 teams, and 4 players"
      — and a direct Firestore read afterward confirmed every cross-check: correct
      division→team→player id remapping, the captain's `captainUserId` preserved, a
      claimed player's `claimedByUserId`/`designatedRole` preserved, an unclaimed
      player's `claimedByUserId` still null, and the source season completely untouched
      (still 3 teams). **Caught and fixed one real bug this way**: the seed script's
      first attempt used `role: 'admin'` on the test user, which silently hung on a
      spinner forever — `app/index.tsx`'s post-login routing switch has no `'admin'`
      case at all (a pure admin is modeled as `role: 'pending'` + `isLeagueAdmin: true`,
      not a distinct role value) and had no `default:` case to catch the mismatch. Not
      a real app bug (my seed data was wrong, not the app), but worth knowing: an
      account with an unrecognized `role` value hangs silently with no error, same
      class of gap as the historical "silent spinner" bugs elsewhere in this doc — if
      you ever see a real account stuck on the loading spinner, check its Firestore
      `role` field is exactly one of the four valid values.
      **Still not run against Jake's real production data/account** — this proves the
      logic is correct, not that it's been exercised on the real league. Low-risk either
      way since it only ever creates new docs.

## Open risks — revisit
- [ ] **⚠️ BLOCKER — rename the app before any public launch.** "Chalkie" conflicts with
      chalkie.ai, an established teacher lesson-planning app. Do not publish to any app
      store or make the app publicly visible under "Chalkie" until a new name is picked.
      Full writeup, ruled-out names, and surviving candidates are in PLAN.md's Open Risks
      section — pick up the conversation from there, don't restart the brainstorm.
- [ ] Phase 2 scope vs. timeline (sequenced after Phase 1 deliberately — don't compress Phase 1 to protect it)
- [ ] Results entry UX — validate with a real captain before trusting it
- [x] **2026-07-28 — Jest test coverage for the Cloud Function aggregation logic** (`functions/src/index.test.ts`, 23 tests): `computeTotals`, `computeMatchContribution` (2pts/0pts scoring, null-vs-false for "no result yet"), `computePlayerAccum` (singles/pairs attribution, 180s, high checkouts, multi-game accumulation), and `normalizeGames`/`gamesEqual` (the auto-confirm-vs-dispute comparison — order-independence across games/players/180s, and real-mismatch detection on leg winner/180s/checkout value). `npm test` in `functions/`; test files excluded from the `tsc` build/deploy output.
- [x] **2026-07-28 — Integration tests for the Firestore triggers themselves** (`functions/src/index.integration.test.ts`, 4 tests, `npm run test:integration`), closing the gap the unit tests above explicitly couldn't cover. Runs against the real Firebase Emulator Suite (via `firebase emulators:exec`) — actually confirms `onSubmissionWrite` auto-confirms on matching submissions and disputes on mismatched ones, `onMatchConfirmed` computes correct totals/`divisionTables`/`playerSeasonStats` on first confirmation AND correctly recomputes the delta-only (no double-counting) on an admin correction, and `onMatchDeleted` fully reverses a confirmed match's contribution. Each test uses fully unique league/season/division/team/player ids (not shared fixtures + a reset-between-tests approach) since Cloud Function triggers run asynchronously relative to the write that provoked them — shared ids plus timing could cross-contaminate between tests.
- [ ] Audit real players in Jake's live league for missing `divisionId` from before the 2026-07-13 fix
