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
- [x] Venue contact field (`Team.venuePhone`)
- [x] Desktop admin console (`AdminShell`, edit/delete confirmed matches, cascading deletes)
- [x] Onboarding rewrite — request & approve, no invite/claim codes
- [x] Admin dashboard revamp (real Teams data table, season→division picker, sidebar tree)
- [ ] **Jake: real logged-in walkthrough** — the one thing blocking calling Phase 1 done. Confirm a push notification actually arrives, generate-fixtures round-trip, full results→confirm→standings loop, all against your real account/league.
- [ ] Team/roster carry-over between seasons (raised, not built — also tracked under Suggested improvements)

## Mobile testing & real device builds (2026-07-13 → ongoing)
- [x] EAS project created & linked (`@fordza95/chalkie`)
- [x] `mobile/eas.json` build profiles added (development/preview/production)
- [x] `expo-dev-client` installed
- [x] Expo Go testing working via Codespaces public-port workaround (Expo's bundled tunnel ngrok is broken/deprecated)
- [ ] Jake: test app in Expo Go on iPhone from work PC tomorrow
- [ ] Apple Developer Program enrollment (Jake, $99/yr) — needed for any real iOS build/TestFlight
- [ ] Google Play dev account — needed for any real Android build
- [ ] FCM V1 service account credential (`eas credentials`, via Firebase Console) — needed for Android push specifically
- [ ] Design Android notification icon asset (white/transparent, `expo-notifications` plugin)
- [ ] Run a real `eas build` once accounts exist

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
