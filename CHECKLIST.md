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
- [ ] Team/roster carry-over between seasons (raised, not built — also tracked under Suggested improvements)

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
- [ ] **Not deployed**: `firestore.rules`, `firestore.indexes.json`, and the 2 new Cloud Functions need `firebase deploy` before any of this works live
- [ ] **Jake: run "Migrate Teams to Venues"** (Tools screen, real one-off, not dev-gated) once deployed — your existing teams still have plain-text addresses, not venues, until this runs once
- [ ] Fold into the real walkthrough above: generate fixtures against a division with a shared venue and confirm the clash-resolution banner/dates look right
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
- [ ] Design Android notification icon asset (white/transparent, `expo-notifications` plugin)
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

## Suggested improvements (not bugs)
- [ ] Admin-side "enter/confirm a result" path for a stuck/offline captain
- [ ] Team/roster carry-over between seasons

## Open risks — revisit
- [ ] Phase 2 scope vs. timeline (sequenced after Phase 1 deliberately — don't compress Phase 1 to protect it)
- [ ] Results entry UX — validate with a real captain before trusting it
- [ ] No test coverage anywhere — Cloud Function aggregation logic (standings/stats) is the highest-priority gap given money/competitive stakes
- [ ] Audit real players in Jake's live league for missing `divisionId` from before the 2026-07-13 fix
