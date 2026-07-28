# Chalkie — Product Plan

Living roadmap doc. Update this file as work is completed or decisions change — this is
the source of truth to pick the project back up in a new session. Check items off as
they're actually shipped and tested, not just started.

## Status snapshot

- **Now:** every Phase 1 checklist item is code-complete as of 2026-07-10, including
  push notifications (just added) and the desktop admin console (2026-07-09) that goes
  beyond Phase 1's original scope with admin edit/delete of confirmed matches and
  cascading season/division/team deletes. **`firestore.rules`, `firestore.indexes.json`,
  and all 8 Cloud Functions were deployed live to `chalkie-app` on 2026-07-10** (CI
  token via Google Cloud Shell) — `onJoinRequestCreated` and `sendFixtureReminders`
  created new, the other 6 updated, indexes released, rules released.
  **EAS project also created and linked on 2026-07-10** (`eas init`, run from the
  sandbox using an Expo personal access token Jake generated via the expo.dev website —
  Jake's on a work PC with no terminal access, so this replaces the `eas login`/
  `eas init` steps described below): `@fordza95/chalkie`, project ID
  `26ba0098-1660-4083-87b0-1062e47ff405` written into `mobile/app.json`
  (`d7341de`). This is what `getExpoPushTokenAsync()` needs to mint a token at all, so
  registration should stop silently no-op'ing now. **Still not the same as a real
  build** — no `eas.json` build profile exists yet, and Expo Go on Android still can't
  receive pushes regardless (see the push notifications checklist item). The access
  token used for this was single-purpose and should be revoked from Jake's expo.dev
  account settings once confirmed no longer needed.
  **One thing still blocks calling Phase 1 done:** none of 2026-07-08 through
  2026-07-10's work has a real logged-in Firestore verification pass yet (no admin test
  credentials exist in the sandbox this was built in — see per-item notes below). Now
  that everything is actually deployed and linked, Jake: doing one real walkthrough as
  yourself — including checking a push notification actually arrives — is the actual
  next step before this phase can be called done, not more code.
- **Admin dashboard revamp — shipped and deployed 2026-07-10** (`c6ab104`): implements
  the dashboard mockup artifact. Teams tab is now a real data table (players/P/W/L,
  home venue, status badge) instead of a card list; the season/division picker splits
  into two steps (season, then that season's divisions) instead of one flat list; the
  sidebar grows a live division tree with team counts; the context switcher moved out
  of a permanent sidebar box into a per-page filter chip shown only on the tabs it
  governs. Also bundled in: admin inbox now catches claim/join requests for teams with
  no captain/VC yet (previously only `captainRole` requests surfaced there), a new
  `designatedRole` field on `Player` so admins can pre-assign a captain/VC to an
  unclaimed roster slot before that person registers, TabBar hides itself on desktop
  admin (AdminShell's sidebar replaces it), and auth screens get a max-width cap on
  desktop browsers. No `firestore.rules`/indexes/functions changes — frontend only.
  Typechecked clean, web bundle built and **deployed live to Firebase Hosting**
  (`https://chalkie-app.web.app`) via a fresh CI token from Google Cloud Shell, then
  pushed to `origin/JakeDevBranch`. **Walked through as a real logged-in admin
  2026-07-10** — created a genuine test admin account
  (`claude-test-admin@chalkie-test.dev`, `isLeagueAdmin`/`leagueId` set manually by
  Jake in the Console the same way his own account was originally bootstrapped, since
  `isLeagueAdmin` is deliberately never client-settable per `firestore.rules`) and
  drove it against Jake's real "Bedford & Kempston District" league data via
  Playwright. Caught and fixed two real issues this way: (1) `8868907` — the sidebar's
  "Divisions" item only ever showed the last-chosen season's divisions with no way to
  switch seasons except a top-right picker chip; replaced with a Season→Division
  accordion in the sidebar itself, one season expanded at a time, matching what a
  league admin actually expects. (2) `6f3dd34` — Teams table header rendered "L" and
  "STATUS" flush together with no gap (body rows didn't show it because the status
  `Badge` pill's own padding masked it). What first looked like a broken/blank
  season-picker dropdown turned out, on pixel-level inspection, to not be a bug at all
  — the dark overlay does cover the whole screen including the sidebar, just
  imperceptibly against its already-near-black background.
  **Not done:** team import/carry-over between seasons (raised by Jake, not built),
  and Phase 2 cup/knockout competitions (still just roadmap, see below) — Jake had
  assumed basic fixture generation was also unbuilt, but that's been live since
  2026-07-02 (`admin-fixtures.tsx`, round-robin generator).
- **Full admin QA pass, 2026-07-10.** Built a throwaway multi-division test season
  (2 divisions, 6 teams) since every real season only had 1 division, then walked
  every admin screen. Found and shipped a critical fix (`7afd935`): **every
  `Alert.alert` call in the app — every delete/confirm dialog and every error
  message — was a complete no-op on the web build.** `react-native-web`'s
  `Alert.alert` is a literal empty function; confirmed by reading the installed
  package source, not just guessing. This silently disabled Delete
  Team/Season/Division/Player, Reject Request, and every "Something went wrong"
  message across ~10 screens on desktop — clicking Delete Season produced nothing
  at all. Fixed with `mobile/src/lib/alert.ts`: native platforms keep the real
  Alert, web falls back to `window.confirm`/`window.alert` against the same
  signature every call site already used, so no call site's logic changed, only
  its import. Verified end-to-end with a real cascading Delete Season that removed
  the test season. Full report (including 4 other issues found — a Players-count
  bug from admin-added players missing `divisionId`, a blank unstyled Standings
  screen before any match is played, multiple seasons allowed "active"
  simultaneously with a Dashboard Teams count that sums across all of them, and a
  minor Captain/VC helper-text bug) is in the QA artifact linked from that
  session — not duplicated here in full since this file is for state, not the
  narrative.
- **Deadlines:** Showcase to league committee/captains in **August 2026**. Live trial
  with own league for the **2026/27 winter season (starts Sept/Oct 2026)**.
- **What already exists and works:** account onboarding (admin/captain/VC/player roles,
  invite/join/claim codes), league/season/division/team admin CRUD, roster management,
  approval flows. See `git log` / the app for detail — not repeated here.
- **What this plan covers:** everything needed to go from "admin scaffolding only" to
  "a league can actually play its season in the app."

## The vision (why, not just what)

- Trial is Jake's own league: 4 divisions, 8 teams per division, 5–9 players per team.
- Longer term this becomes a product other leagues pay to use. Implication: avoid
  building anything into the core data model that *only* works for a single league
  (e.g. don't hardcode "a user belongs to one league" any harder than it already is —
  see Phase 3) but don't block the Sept/Oct deadline trying to fully solve
  multi-league membership now.
- Paid tier concept: assisted/auto fixture generation was floated as a future paid
  feature. Decision: build a **basic** round-robin generator now anyway (see Phase 1) —
  224 fixtures across 4 divisions is not hand-enterable, so the free tier needs *some*
  generator. The "paid" version is a nicer wizard (custom rounds, byes, scheduling
  constraints) on top of the same underlying data model. Don't gate the basic one.

## Roles & permissions (clarified with Jake 2026-07-08)

Three tiers. Confirmed against the actual `firestore.rules` + app screens on
2026-07-08 — mostly already true today, not a redesign:

- **Admin** — full reign: create/edit teams, edit players, see all results, create
  fixtures, create/edit divisions, create competitions (Phase 2), edit anyone's role.
  Already true today via `isAdmin()` in `firestore.rules` for everything except
  **role editing, which has no UI yet** — see the new Phase 1 item below.
- **Captain / Vice-Captain** — run their own team only (`me().teamId == teamId`
  everywhere in the rules): accept new players (approve join requests), submit match
  results, create new players, edit their team's venue address. **A captain or VC is
  always automatically also a player** — a captain/VC is a `users` doc
  (`role: 'captain'`/`'viceCaptain'`) *plus* a linked `players` doc, not a separate
  flag; every other screen (rosters, stats) assumes this, so don't change the shape.
  (Historical note: this used to be implemented via `authStore.ts`'s
  `processJoinCode`/`processClaimCode` and the `joinCodes`/`claimCodes` collections —
  both removed 2026-07-08, see "Onboarding — request & approve, no codes" below. The
  auto-player-on-approval behavior itself is unchanged, just the trigger that leads to
  approval.)
- **Player** — join a team, edit only their own details (name/phone), view fixtures
  and division stats, no write access to anything else. Already enforced by the
  `users` update rule (a user can only touch their own safe fields unless they're
  admin/captain-of-their-team).

**Two gaps found while checking this against the code, both confirmed with Jake as
wanted, added to Phase 1 below:**
1. No admin screen exists to directly change an existing user's role (promote a
   player to VC, demote a captain, hand captaincy to someone else) — today roles only
   change via the team-approval flow or by someone redeeming an invite/join code
   themselves. The data-layer rule already permits admin to write any user doc, so
   this is a new screen, not a rules change.
2. "Contact details" a captain/VC can edit refers to the **venue's** contact info
   (e.g. a phone number for the pub), not the captain's own phone (which is already
   editable). `Team` currently only has an `address` field, no contact-number
   field — needs a new field + edit UI, same place as the existing venue-address
   editor on the Team tab.

## Onboarding — request & approve, no codes (2026-07-08)

**Status: code complete and typechecks clean; rules deployed; indexes NOT yet
confirmed deployed; live end-to-end verification incomplete — see "Resume here"
below before touching this again.**

Jake wants all invite/claim codes gone (captain codes, VC codes, player invite
codes, claim codes) in favor of search-and-request, mirroring how team-request
already worked. New model, confirmed with Jake:

- **Admin creates teams first** (already true — `admin-season.tsx`'s "+ Add Team",
  unaffected by this change). The old "captain requests a brand-new team"
  flow (`team-request.tsx`, league-level `captainInviteCode`) is **gone** — a
  captain/VC can now only request to join a team admin already created.
- **Player**: search league → pick team → see that team's *unclaimed* roster →
  either tap **"This is me"** (a `joinRequests` doc with `requestType: 'claim'`,
  `claimPlayerId` set) or **"I'm not here"** (`requestType: 'join'`, same as
  before). Both need the team's captain/VC to approve — claiming is no longer
  instant/unreviewed like the old claim-code flow was.
- **Captain/VC**: new screen `request-captain-role.tsx` (replaces
  `team-request.tsx`) — search for an existing team, pick Captain or Vice
  Captain, submit (`requestType: 'captainRole'`, `requestedRole` set).
  - Requesting **Captain** → always **admin** approves (`admin-inbox.tsx`, new
    "Captain / VC Requests" section, replacing the old "Pending Team Requests").
  - Requesting **Vice Captain** → the team's **current captain** approves, in
    their own Captains → Inbox tab — *not* just any VC, and not admin, unless
    the team has no captain yet (then it falls through to admin, since there's
    nobody else to ask).
- `JoinRequest` (new shared type in `src/types/index.ts`) unifies all three
  kinds in the existing `joinRequests` collection — no new collection needed.
  `claimCodes`, `joinCodes`, `teamRequests` collections/rules are all removed.

**Security note (important, don't reintroduce):** the old rules had two
self-service bypass clauses (anyone could self-assign an unclaimed
`teams.captainUserId`/`viceCaptainUserId`, or self-claim any unclaimed
`players` doc) that existed only to support the old code-redemption
transactions. Both were **removed** as part of this change — leaving them in
would let anyone skip approval entirely. If you ever see "self-assign" style
clauses reappear in `firestore.rules`, that's almost certainly wrong now.

**Resume here (2026-07-08 session ran out of time before finishing
verification):**
1. Confirm both `firestore.rules` and `firestore.indexes.json` are deployed to
   the live `chalkie-app` project (rules were deployed manually by Jake this
   session; indexes were not confirmed — check the Firestore → Indexes tab in
   the Firebase Console for two indexes: `players` (teamId, claimedByUserId)
   and `joinRequests` (leagueId, requestType, status), both should read
   "Enabled" not "Building").
2. Re-run the end-to-end claim flow that was in progress when this session
   ended: register a brand-new test account (name it after one of the seeded
   unclaimed test players, e.g. "Bev Carter" or "Colin Dean" from the
   `seedTestLeague` fixture), search the league ("Bedford & Kempston
   District" in this environment), choose "I'm a Player", search/select "Test
   Home Tigers", confirm the unclaimed roster loads without a permission
   error (this exact step was broken and fixed once already — the `players`
   read rule needed the same "pending user browsing" allowance `teams`
   already had; if it breaks again, check whether the rules deploy actually
   went out), tap "This is me" on the matching name.
3. Sign in as `test.home.captain@chalkie.test` (password `TestPass123!`),
   check Captains → Inbox — the claim request should show "Says this is: Bev
   Carter" (or whichever name), approve it, confirm the roster now shows them
   as "Registered".
4. Also still unverified: the "I'm not here" new-player path (should still
   work, minimal change from before), the full captain/VC role-request flow
   (`request-captain-role.tsx` → admin approves a Captain request in
   `admin-inbox.tsx`, or the team's captain approves a VC request in
   `captains.tsx` Inbox — **no admin test account exists in this sandbox**,
   same long-standing limitation noted elsewhere in this doc, so the admin
   side of this needs a real human pass).
5. Two orphaned test accounts were created while debugging this session
   (`bev.test.<timestamp>@chalkie.test`, password `TestPass123!`) — they got
   as far as "pending, no request submitted yet" before hitting the bug in
   step 2 above. Harmless, but fine to delete from Firebase Auth if they show
   up in a user list and look confusing.

## Match format (the core rules to encode)

- One match = **7 games**: 5 singles, then 2 pairs. All 501.
- Each game = **3 legs**, and **all 3 legs are always played** (no early stop at 2-0).
- Match winner = team that wins more of the 7 games. Since 7 is odd, **no draws are
  possible** at match level — good, standings never need draw handling.
- **Standings:** 2 points for a win, 0 for a loss. Tiebreak = leg difference
  (legs won − legs lost, across the season).
- **Stats wanted:** 180s (who threw one, per leg), and "high checkout" — captain just
  free-types a checkout value into a blank field if they feel it's worth recording (no
  fixed threshold, no validation). Keep this loose — don't over-engineer validation the
  league doesn't want.

## Results submission flow

- After a match, the **home or away captain (or VC in their absence)** submits full
  detail: lineup for each of the 7 games, leg-by-leg winner, any 180s, any high
  checkouts.
- **Both** captains submit independently (this already matches the existing
  `matches/{id}/submissions/{id}` subcollection in `firestore.rules` — that structure
  was already anticipated, just never built on).
- If both submissions agree → **auto-confirm**, trigger standings + stats update.
- If they disagree → mark **disputed**, surface both submissions side-by-side to the
  **admin**, who picks/edits the correct one to confirm.

## Data model additions (Firestore)

Builds on the existing `leagues / seasons / divisions / teams / players / users`
collections — don't restructure those, add to them.

```
matches/{matchId}
  leagueId, seasonId, divisionId (or competitionId — see Phase 2)
  homeTeamId, awayTeamId
  scheduledDate, venue (pulled from home team's address)
  status: 'scheduled' | 'awaiting_confirmation' | 'disputed' | 'confirmed'
  homeGamesWon, awayGamesWon, homeLegsWon, awayLegsWon   // set on confirm
  matches/{matchId}/submissions/{submissionId}   // already in rules
    submittedByTeamId, submittedByUserId
    games: [ { order, type: 'singles'|'pairs', homePlayerIds[], awayPlayerIds[],
               legs: [ { winner: 'home'|'away', oneEighties: [playerId],
                         highCheckout: { playerId, value } | null } ] } ]
  matches/{matchId}.games   // set on confirm — the agreed/resolved canonical copy,
                            // same shape as a submission's games[], so standings/stats
                            // functions don't need to re-read submissions

divisionTables/{tableId}     // already in rules, write:false — Cloud Function only
  leagueId, seasonId, divisionId, teamId
  played, won, lost, points, legsFor, legsAgainst, legDiff, position

playerSeasonStats/{statsId}  // already in rules, write:false — Cloud Function only
  leagueId, seasonId, playerId, teamId
  played, won, lost, oneEighties, highCheckouts: [ { value, matchId, date } ]

competitions/{competitionId}   // Phase 2, new
  leagueId, seasonId, type: 'cup' | 'singlesKO' | 'pairsKO' | 'playerChamp' | '180cup'
  name, status, rounds: [ { roundNumber, matchIds[] or ties[] } ]
```

**Note (found while scaffolding functions):** `firestore.rules` already has working
`matches` + `matches/{id}/submissions/{id}` rules that match this plan almost exactly
(admin creates/edits matches, captain/VC of the submitting team can create/update a
submission while the match isn't confirmed yet, disputes just need admin to be able to
read/act on both submissions — already covered by `isAdmin()`). Likely won't need rule
changes for the match/submission model itself, just new composite indexes once the
actual query patterns are written (fixtures-by-team, fixtures-by-division-and-date).

**Why `divisionTables`/`playerSeasonStats` need a Cloud Function:** they're already
`allow write: if false` in the current rules — someone (past Jake or past Claude)
already decided these must be server-computed, not client-written, so results can't be
gamed and stats always reconcile with confirmed matches. That means **Cloud Functions
are a hard prerequisite** for Phase 1, not optional polish. This needs the Firebase
project on the **Blaze (pay-as-you-go) plan** — Spark's free tier doesn't run Cloud
Functions. Flag this to Jake before starting Phase 1 build.

## Phasing

### Phase 0 — Cleanup (small, do first)
- [x] Delete dead `mobile/app/(protected)/admin-setup.tsx` (superseded by inline setup
      flow in `admin.tsx`, nothing routes to it anymore). Done 2026-07-02.
- [x] Sync `mobile/src/types/index.ts` with the real Firestore schema (`seasonId` on
      `Team`/`AppUser`, `playerInviteCode`, `captainInviteCode`, etc. — currently drifted).
      Also fixed `authStore.ts` to actually expose `seasonId`/`pendingRequestId` on
      `appUser` — they were being written to the user doc but silently dropped on read.
      Done 2026-07-02, typechecks clean.

### Phase 1 — Core league loop (target: working demo by August, solid by Sept/Oct trial)
- [x] Firebase project on Blaze plan (done by Jake 2026-07-02); Cloud Functions project
      scaffolded at `functions/` (TypeScript, firebase-functions v7 / firebase-admin
      v13, wired into `firebase.json` alongside firestore rules+indexes which weren't
      linked before). Builds clean, no functions written yet — that starts once the
      matches/games/submissions data model below is settled.
- [x] Fixtures: basic round-robin generator (every team plays every other team twice,
      home + away) that an admin runs per division, producing `matches` docs with
      placeholder dates; admin then edits dates/venues as needed. Not the fancy paid
      wizard — just enough to not hand-type 224 fixtures. Done 2026-07-02:
      `mobile/src/lib/fixtures.ts` (circle-method round robin, verified by script —
      balanced home/away, every pair plays exactly twice, byes handled for odd counts),
      `Match`/`MatchGame`/`MatchLeg`/`MatchSubmission` types added, new
      `admin-fixtures.tsx` screen (generate + view-by-round + edit date/venue + delete)
      wired in from `admin-season.tsx`, `matches` composite indexes added to
      `firestore.indexes.json`.
- [x] Fixtures list screens (captain/player: "my upcoming fixtures"; admin: full
      division schedule). Done 2026-07-02: new `fixtures.tsx` screen linked from both
      `captain.tsx` and `home.tsx`, queries `matches` by team via Firestore `or()`.
      **Caught by [[feedback_firestore_query_rules]] before it shipped broken:** the
      `matches` read rule only checks `resource.data.leagueId`, so every matches query
      (admin-fixtures and this one) had to add an explicit `leagueId` filter or Firestore
      would've silently rejected it.
      **Verified:** typechecks clean, app boots on web with no console errors (checked
      via Playwright), login screen renders correctly. **Not yet verified:** the actual
      logged-in generate-fixtures flow — no admin test credentials or service-account
      key are available in this environment, so the real Firestore round-trip (write
      224 matches, read them back grouped by round) still needs a human pass. Jake:
      worth running through this yourself before the August demo.
- [x] Results entry screen (captain/VC): full lineup + leg-by-leg + 180s + optional
      high-checkout per game, for a scheduled match. Done 2026-07-06:
      `results-entry.tsx` — single-game-at-a-time stepper (7 games: 5 singles, 2
      pairs), player picker modal per side, per-leg winner toggle + 180 chips + high
      checkout modal, pre-fills from an existing own submission for editing. Writes to
      `matches/{id}/submissions/{ownTeamId}`. Entry point wired from `fixtures.tsx`
      (captain/VC sees "Enter Result"/"View / Edit Result" on their own non-confirmed
      fixtures). Changed `MatchLeg.highCheckout` from a bare free-text string to
      `{ playerId, value }` — needed so `playerSeasonStats.highCheckouts` can attribute
      a checkout to a player; `value` itself stays unvalidated free text as originally
      intended.
- [x] Submission comparison + auto-confirm logic (Cloud Function, triggered on
      submission write). Done 2026-07-06: `functions/src/index.ts` `onSubmissionWrite`
      — re-reads both submissions on every write, normalizes (sorted arrays) and deep-
      compares; 1 submission → `awaiting_confirmation`, mismatch → `disputed`, match →
      `confirmed` + canonical `games` written onto the match doc.
- [x] Dispute view for admin (both submissions side by side, pick/edit, confirm). Done
      2026-07-06: `admin-dispute.tsx`, linked from a new "Disputed Results" banner on
      `admin.tsx`. Per game: auto-shows a single agreed summary if both teams already
      match on that game, otherwise shows both teams' versions side by side for the
      admin to pick, with a leg-winner override on top of whichever version is picked.
      Confirms by writing `games` + `status: 'confirmed'` directly to the match doc
      (admin already has write access) — same `onMatchConfirmed` function handles it
      either way, so this path doesn't need its own aggregation logic.
- [x] Cloud Function: on match confirm, recompute `divisionTables` row for both teams
      and `playerSeasonStats` for every player involved. Done 2026-07-06:
      `onMatchConfirmed` (triggers on any match update where status becomes
      `confirmed`, regardless of whether that came from auto-confirm or admin dispute
      resolution) — computes game/leg totals, upserts both teams' `divisionTables` rows
      via `FieldValue.increment`, recomputes `position` for the whole division, and
      upserts `playerSeasonStats` per player (played/won/lost count *individual games*,
      not matches — a player can play more than one game per match).
- [x] Standings screen (division table, all league members can view their division).
      Done 2026-07-06: `standings.tsx`, division switcher, own-team row highlighted.
      Linked from `home.tsx`, `captain.tsx`, `admin-season.tsx`.
- [x] Stats screens: player's own stats (personal), division leaderboard (most 180s,
      best win %, notable high checkouts). Done 2026-07-06: `stats.tsx`, two tabs ("My
      Stats" / "Leaderboard"). Linked from `home.tsx`, `captain.tsx`.
- [x] Home page "next fixture" tile: glanceable card for anyone tied to a team —
      opponent, Home/Away, venue, the *opposing* captain/VC's contact details (gated by
      their `phoneVisibility` choice same as everywhere else, not a new permission
      concept), the team's division position, and last-3-results form (W green / L
      red). Done 2026-07-08: `src/components/NextFixtureTile.tsx`, shared between
      `home.tsx` (player role) and `captain.tsx` (captain/VC role — these are two
      separate screens even though the tab bar labels both "Home", see `TabBar.tsx`
      `visibleRouteNames()`; the tile had to be added to both or captains/VCs
      wouldn't see it). Verified via Playwright against the seeded test league in both
      themes; the "no upcoming fixture" and "form" (W/L) states were exercised for
      real, but the seed data doesn't include a division-table row or an opposing
      captain phone number, so the position-badge and contact-row rendering paths are
      untested against live data — worth a manual check once real fixtures/results
      exist.
- [x] Home simplified + new "Captains" section (2026-07-08, supersedes part of the
      entry above). Jake wanted Home to be *just* the next 1-2 fixture cards for
      everyone tied to a team, nothing else — all of `captain.tsx`'s old team-management
      content (roster, venue editor, own contact details, join requests) needed a new
      home. Rather than keep it crammed into what the tab bar merely *labels* "Home"
      (the pre-existing `captain`/`home` route split from the entry above), added a
      genuine 5th bottom tab, **captain/VC only**: "Captains", with an internal
      "My Team" / "Inbox" switcher (same `Chip` sub-tab pattern already used in
      `stats.tsx`). Concretely:
      - `NextFixtureTile` reworked to render up to `count` (default 2) separate
        `Card`s instead of one combined tile — each fixture is now its own card per
        Jake's wording ("fixture card**s**"); table position and form only show on
        the nearest one, not repeated on both.
      - New `src/components/HomeFixturesScreen.tsx` — the actual minimal Home content
        (just `NextFixtureTile`). Both `home.tsx` and `captain.tsx` are now two-line
        re-exports of it, so player and captain/VC roles see byte-for-byte the same
        Home.
      - New `(tabs)/captains.tsx` — "My Team" tab is the old `captain.tsx` content
        verbatim (venue/contact editing, add-player, claim codes), plus player roster
        rows now show a role badge (Captain/Vice Captain), reusing the view-only
        display logic from the admin role-management work above. "Inbox" tab is new:
        pending join requests (moved from My Team) + a new "Needs Your Action" list —
        fixtures where nobody's submitted yet and the scheduled date has passed, or
        the opponent has submitted and this team hasn't (checked via a
        `matches/{id}/submissions/{teamId}` existence read). There was no
        notification concept in the app before this; confirmed with Jake to scope it
        to exactly these two states, not disputes (admin's problem, not the
        captain's).
      - `TabBar.tsx`: `visibleRouteNames()` now returns 5 names for captain/VC
        (`captain`, `captains`, `fixtures`, `standings`, `stats`) vs. 4 for player —
        admin's 3-tab set is unchanged.
      - Verified via Playwright in both themes, signed in as Test Home Captain: Home
        shows only the fixture card, the Captains tab's My Team/Inbox switcher both
        render (including the "Captain" role badge on the seeded captain's own roster
        row), and the address/phone saved earlier in this session persisted through
        the restructuring. **Not verified**: the "Needs Your Action" list with an
        actual actionable match in it, or the join-requests list with a real pending
        request — the seeded test league has neither state right now, and there's no
        admin account available in this sandbox to re-seed it (same limitation noted
        elsewhere in this doc).
- [x] Push notifications — code complete 2026-07-10, **not deployed, not pushed,
      genuinely can't be live-tested yet** (see blocker below). `AppUser.expoPushToken`
      (string | null) added; `mobile/src/lib/pushNotifications.ts` requests permission
      and registers an Expo push token on login (`(protected)/_layout.tsx`), saved via
      a new `savePushToken` authStore action — silently no-ops (never throws) if
      there's no physical device, permission is denied, or no EAS project exists yet.
      Server side, `functions/src/index.ts` gained a plain-HTTP Expo-push helper
      (`sendExpoPush`, no extra SDK needed) and four notification points, matching this
      item's original scope exactly: `onSubmissionWrite` → "result needs your
      confirmation" to the other team's captain/VC when the first submission comes in;
      `onMatchConfirmed` → "result confirmed" to both teams on first confirmation only
      (not on later admin corrections); new `sendFixtureReminders` (`onSchedule`, daily
      09:00 Europe/London) → "fixture tomorrow" to both teams for anything still
      `'scheduled'` the next day; new `onJoinRequestCreated` → routes to league admins
      (captain requests), the team's current captain (VC requests, falling back to
      admin if no captain yet), or the team's captain/VC (join/claim requests) — this is
      the "admin/captain approval alerts" reuse of the existing request/approve flows.
      Two new composite indexes added (`matches` status+scheduledDate,
      `users` teamId+role) — nothing else needed in `firestore.rules`, `expoPushToken`
      already falls under the existing "user updates own safe fields" branch since that
      rule denies specific sensitive fields rather than allow-listing safe ones.
      `mobile`/`functions` both typecheck and build clean; web bundle exports with no
      runtime error from the new imports.

      **Partial blocker, updated 2026-07-10:** no `eas.json` / dev-or-production build
      exists yet (still just `expo start`), and Expo SDK 53+'s **Expo Go on Android no
      longer supports receiving remote push notifications at all** regardless of EAS
      config — only a real build does. What *has* been resolved: `expo-notifications`'
      `getExpoPushTokenAsync()` needs an EAS project ID to mint a token at all, and that
      project now exists — `eas init` was run 2026-07-10 (`@fordza95/chalkie`, see
      status snapshot above), so token registration should stop silently no-op'ing on
      iOS Expo Go / web at least. Added the `expo-notifications` config plugin to
      `app.json` earlier so that's already handled too. Still needed before a real push
      arrives on an Android device specifically: `eas build` for a dev/production
      build, which needs Jake's Apple/Google dev accounts for signing (see Phase 3).

      **2026-07-13 — build groundwork laid, still not buildable.** Added
      `mobile/eas.json` (development/preview/production profiles, matching Expo's
      standard shape — development and preview both produce an installable `.apk`
      directly rather than an `.aab`, since those are for on-device testing, not Play
      Store) and installed `expo-dev-client` (required for
      `developmentClient: true` in the development profile to actually build).
      Verified `eas.json` is valid JSON and matches the current documented schema
      (checked docs directly per this file's own SDK-version-changed warning), but
      **could not validate it against the real EAS schema or actually run a build**
      — `eas` commands require a logged-in Expo account, and no credentials for
      that exist in this sandbox. Config-only work; still blocked on the same two
      things as before: Jake's Apple/Google dev accounts for signing, and — newly
      surfaced while researching this — Android push specifically also needs an FCM
      V1 service account credential uploaded via `eas credentials` (Expo migrated
      off the legacy FCM server-key flow), which needs Firebase Console access to
      the `chalkie-app` project. Also flagged, not fixed: no dedicated white/
      transparent notification icon asset exists for Android (`expo-notifications`
      plugin's `icon` option) — without one, Android falls back to the app icon in
      the notification shade, which usually renders poorly. Not blocking, just
      worth designing before the first real push notification ships.
- [x] Admin role management screen. Done 2026-07-08, scoped **per-team** (not a
      league-wide user browser — decided with Jake to keep captaincy transfer tied to
      the team it happens on): `admin-team.tsx`'s player roster now shows each claimed
      player's current role as a badge (Captain/Vice Captain/Player) with a "Change"
      button opening a `Sheet` role picker. Assigning Captain/VC auto-demotes whoever
      currently holds that slot on the team back to Player (confirmed with Jake — no
      separate manual-demote step needed). Writes `users.role` +
      `teams.captainUserId`/`viceCaptainUserId` in one `writeBatch`; never touches the
      `players` collection, so the promoted/demoted user keeps their existing linked
      player doc, no duplicates. Deliberately does **not** cover changing who the
      league's Admin is — confirmed out of scope, that stays a separate rarer
      operation. `npx tsc --noEmit` clean. **Not verified against live Firestore**:
      this sandbox has no admin test credentials (same limitation noted elsewhere in
      this doc), and worse — trying to view `admin-team.tsx` signed in as a non-admin
      captain (the usual verification workaround used elsewhere in this project)
      crashes the page, because `joinCodes` has `allow list: if isAdmin()` and this
      screen's `onSnapshot` on that collection has no error handler. That's a
      pre-existing gap, not something this change introduced — same class of bug as
      the "Bugs found & fixed" entry below, just not yet hit until now. **Jake: this
      screen needs a real admin-account pass before trusting it.**
- [x] Venue contact field. Done 2026-07-08: `Team.venuePhone` (string | null), editable
      alongside the existing address field on the Home Venue card in both
      `captain.tsx` and `admin-team.tsx` (same save action, no rules change needed —
      the existing team-update rule already covers it). Also wired into
      `NextFixtureTile`: when your team is the away side, the tile now shows the
      venue's contact number in addition to the opposing captain's personal contact
      (confirmed with Jake — venue contact only matters when you're the one
      travelling). Verified live end-to-end for the write path (saved
      "The Red Lion, 12 High St" / "01234 567890" as Test Home Captain, persisted and
      re-rendered correctly). The tile's away-game display of this field was
      exercised by code review only, not a live screenshot — the seeded test fixture
      had already moved out of `'scheduled'` status by the time this was checked
      (resolved during earlier testing this session), so there was no live "upcoming
      away fixture" to screenshot. Re-seeding the test league to get back to a
      `'scheduled'` state requires the admin-only seed tool in `admin-tools.tsx`, which
      hits the same no-admin-credentials wall as above.

- [x] Desktop admin console (goes beyond original Phase 1 scope). Done 2026-07-09
      (`b444ad0`): `src/components/admin/AdminShell.tsx` — a real sidebar console
      (Dashboard/Teams/Fixtures/Results/Standings/Inbox/Tools) replacing the earlier
      single desktop screen, with a persistent season/division context switcher
      (`adminContextStore.ts`, fixes shortcuts getting stuck on one season when several
      exist) and clickable breadcrumbs on every admin screen. Fixtures split out from
      Results as its own section (scheduled/awaiting vs. confirmed/disputed), matching
      how real league-management platforms separate scheduling from reviewing what
      already happened. Also adds genuine new admin authority: **edit or delete an
      already-confirmed match** via `results-entry.tsx` — required a Cloud Functions
      stats-recompute engine so `divisionTables`/`playerSeasonStats` correctly
      reverse/reapply their contribution (previously this aggregation only worked
      correctly the first time a match was confirmed) — plus cascading
      `adminDelete{Team,Division,Season}` callables that refuse to run if confirmed
      match history exists, to avoid silent data loss. New
      `admin-standings-override.tsx` for manual team-points/player-stat corrections.
      Mobile is completely unaffected — everything is gated behind the existing
      `isDesktop` (>=768px) branch already used for the web admin surface.
      **Not pushed, not deployed, not live-verified.** `firestore.rules` and
      `functions/src/index.ts` both changed as part of this — none of the new behavior
      (especially the stats-recompute-on-edit fix) is live until `firebase deploy` runs
      for both rules and functions. Together with `6ca1673` before it, this is 2 commits
      sitting ahead of `origin/JakeDevBranch` as of 2026-07-10.

  **Not yet verified (2026-07-06 build):** typechecks clean (`mobile` + `functions`
  both build with no errors) and the web bundle boots with no console errors (checked
  via Playwright — login screen only, same limitation as before: no admin/captain test
  credentials in this sandbox to drive the actual logged-in flows). Genuinely untested:
  the real Firestore round-trip for results submission → Cloud Function auto-confirm/
  dispute → standings/stats aggregation. Also new to this build and not yet deployed:
  3 new composite indexes in `firestore.indexes.json` (`matches` by leagueId+status,
  `divisionTables` by seasonId+divisionId+position, `playerSeasonStats` by
  seasonId+divisionId) and the two new Cloud Functions themselves (`onSubmissionWrite`,
  `onMatchConfirmed`) — none of this works until `firebase deploy` runs for both
  functions and indexes. Given the pattern already seen once below (missing-index
  queries fail silently with no error), deploy this before demoing, then walk through
  one full match end to end (both captains submit → confirm or dispute → check
  standings/stats update) before trusting it further.

- [x] **Venue entity + fixture scheduling (2026-07-22, code complete — not deployed).**
      Grew out of planning the real walkthrough above: generating fixtures against
      Jake's real league felt too risky to test on live data, and doing so surfaced a
      real gap — the generator had no concept of a season start date, holiday breaks,
      or venue clashes (nothing stopped 3 teams sharing one venue all being drawn home
      the same day). Built as three pieces:
      1. **Venue entity** — new `venues` collection (`name`, `address`, `venuePhone`,
         `boardCount`), league-scoped, admin-write-only (mirrors the existing
         `divisions` rule shape). `Team.address`/`venuePhone` replaced with
         `Team.venueId`, since venuePhone/address are properties of the physical venue,
         not the team relationship, and several teams can share one. Call sites reworked:
         `admin-team.tsx`, `captains.tsx` (both now use a shared `VenuePickerSheet` —
         captains can pick an existing venue but not create one, since venue creation is
         admin-only per the rules), `admin-season.tsx` team creation + Teams table.
         New `admin-venues.tsx` list/create/edit screen, reachable from a new sidebar
         entry in `AdminShell`. `adminDeleteVenue` Cloud Function blocks deletion while
         any team still references the venue (unlink pattern, not cascade — a venue is
         shared, not owned by one team, unlike team/division/season).
      2. **Season schedule** — `Season` gains `startDate` and `breaks` (an array of
         `{start, end, label}` ranges, e.g. Christmas). New "Schedule" panel in
         `admin-season.tsx`. `generateRoundRobinFixtures` (`mobile/src/lib/fixtures.ts`)
         now walks a date cursor round-by-round and jumps it past any break range it
         lands in, pushing every later round back rather than compressing the season.
      3. **Venue-conflict auto-resolution** — the generator also takes each team's
         `venueId` and a `venueId -> boardCount` map; for any round where more teams
         share a venue than it has boards, the excess fixtures shift to consecutive
         following days (deterministic tie-break by team id, so re-generating with the
         same inputs is stable). `admin-fixtures.tsx` shows a summary banner ("moved N
         fixtures to avoid a venue clash") after generating, rather than silently
         rewriting dates.
      Also added: `adminMigrateVenues` Cloud Function (one-time, idempotent — groups
      existing teams by their old free-text address, creates one Venue per distinct
      address at `boardCount: 1`, re-points `venueId`; skips teams that already have a
      venueId or no address) and a **"Migrate Teams to Venues" button in
      `admin-tools.tsx`** (real tool, not `__DEV__`-gated, since Jake's live league needs
      this once) to trigger it. Also added a **"Blank Test Season" dev tool** — 8 teams
      across 2 venues (one deliberately 3-teams-on-1-board, to demonstrate the
      clash-resolution live) with rosters but zero fixtures, so the real Generate
      Fixtures UI can be exercised safely instead of against Jake's live league data.
      Shared `mobile/src/lib/dates.ts` factored out of what were duplicate
      parseDateInput/formatDate helpers in `admin-fixtures.tsx` alone.
      `npx tsc --noEmit` clean for both `mobile` and `functions`; `expo export -p web`
      exports with no errors.
      **Deployed 2026-07-28**: `firestore.rules` (`venues` block), `firestore.indexes.json`
      (`venues` `leagueId+name`), and the two new Cloud Functions (`adminDeleteVenue`,
      `adminMigrateVenues`) all released to `chalkie-app` via `firebase deploy --project
      chalkie-app` using a CI token (`firebase login:ci --no-localhost`, generated by Jake
      from Google Cloud Shell since this sandbox has no standing credentials). Verified
      live via `firebase functions:list` — all 11 functions present, rules released,
      indexes deployed. Not yet live-verified against real data, though (no admin
      credentials in this sandbox, same limitation as elsewhere in this doc).
      **Jake, next:** run "Migrate Teams to Venues" once on your real league (your
      existing teams still carry the old plain-text address until then), then fold
      venue-aware fixture generation into the real walkthrough above. **Also: revoke the
      CI token used for this deploy** (`firebase logout --token <token>` or from the
      Google Cloud Console) now that the deploy is confirmed — it was single-purpose.

### Phase 2 — Cup & individual competitions (build during the season, before they're needed mid-season — not required for the August demo or season kickoff)
- [ ] Team knockout cup: single-elimination, one match per round, cross-division draw.
      Reuses the exact match/results/confirmation infrastructure from Phase 1 — just a
      different bracket wrapper around `matches`.
- [ ] Generalized individual/pairs knockout engine, covering:
  - [ ] Singles knockout (individual players) — must have played a league game this season
  - [ ] Pairs knockout — same eligibility as singles, doubles format
  - [ ] Captains Cup — singles format, eligibility filtered to `role in [captain, viceCaptain]`
  - [ ] Player Championship — top 12 players per division, auto-seeded from
        `playerSeasonStats` once that's live
  - [ ] 180 Cup — auto-eligibility for anyone with `oneEighties > 0` that season
- [ ] Bracket UI: admin creates a competition, draws/seeds (auto where possible),
      records round results, advances winners.

### Phase 3 — Productization (after the trial proves out, not before)
- [ ] Rework user↔league relationship from single `leagueId`/`teamId`/`role` on the
      user doc to a memberships subcollection, so one player account can belong to
      multiple leagues/teams and see combined cross-league stats. This is a real
      breaking schema change — don't attempt it mid-trial.
- [ ] Paid tiers: admin subscription/billing (Stripe), gated advanced fixture wizard.
- [ ] Real app store builds: `eas.json`, Apple/Google dev accounts, TestFlight/Play
      internal testing. **Explicitly deferred here 2026-07-22** — Jake isn't paying
      for Apple Developer Program ($99/yr) yet, and since Apple requires a paid
      account to sign *any* iOS build (dev or prod, unlike Android which can
      sideload an unsigned `.apk` for free), that takes the whole iOS build/
      TestFlight path with it. Google Play dev account moved here too, since it's
      only needed for Play *Store* distribution, not for Android device testing —
      that stays unblocked in the Mobile testing section above.

## Bugs found & fixed

- **2026-07-02 — infinite spinner on admin-fixtures/fixtures screens. FIXED.** Root
  cause: the new `matches` composite indexes were added to `firestore.indexes.json`
  but never deployed (no Firebase CLI auth in the sandbox), so the live query failed
  with a "requires an index" error — and none of the `onSnapshot` listeners in the app
  (pre-existing pattern, not unique to this code) have an error callback, so the
  failure was silent and the UI just hung on the loading spinner forever. Fixed in two
  parts: (1) added error handlers + an on-screen error message to the two new fixtures
  screens, (2) Jake deployed the indexes himself via
  `firebase deploy --only firestore:indexes --token ... --project chalkie-app` from a
  fresh CI token — the CI-token flow does still work for this project, despite the
  `service-account.json`-based `scripts/deploy_rules.py` existing (that script's origin
  is still unclear, don't assume CI tokens are broken here).
  **Worth doing eventually:** audit the other ~18 `onSnapshot` calls across the app
  that also have no error handler — this exact failure mode (stuck spinner, no
  diagnostic) will recur anywhere a query needs an index that doesn't exist yet or a
  rule that doesn't match.
- Also added an explicit header back button to both new screens rather than relying on
  platform default back-button behavior, which wasn't reliably showing.

## Known bugs — open (found in the 2026-07-10 admin QA pass)

Full writeup with repro steps in the QA artifact linked from that session
(https://claude.ai/code/artifact/0302f9e2-a31a-4bee-95c3-e7e02bb0edcd) — these are
just the checkable summary so they don't get lost.

- [x] **2026-07-13 — FIXED.** Players added via admin "Add Player"
      (`admin-team.tsx`'s `addPlayer()`) never got `divisionId` set on the player
      doc, only `leagueId`/`teamId`. Every division-scoped query (the Players stat
      card, the Teams table's per-team Players column, and most likely
      `playerSeasonStats` once matches are confirmed) filters on `divisionId`, so
      these players were invisible to all of it. Contrast with the claim/join-approval
      path, which does set it correctly. While fixing, found the identical bug in the
      captain-side "Add Player" flow (`(tabs)/captains.tsx`'s `addPlayer()`, using
      `appUser.divisionId` since captains don't have the team doc loaded) — fixed
      both. Live-verified the captain-side fix against real production Firestore
      using the seeded Test Home Captain account: added a player through the real UI
      and confirmed `divisionId: "test-division"` landed on the doc. That same check
      also caught a pre-existing casualty of the bug — "Ollie Newman", a player added
      to the test squad in an earlier session before this fix, has no `divisionId`
      field at all — left as-is (not touched without Jake's say-so) as a live example
      of what real admin/captain-added players may look like if this was used on the
      real league before today. **Later the same session**, Jake set up a new test
      admin account (`claude-admin-verify@chalkie-test.dev` — see credentials saved
      in Claude's memory) with real admin access to "Bedford & Kempston District",
      which also live-verified the admin-side fix (`admin-team.tsx`): added a player
      to the real "The Foresters Arms" team and confirmed `divisionId` landed
      correctly, then deleted the test player.
      **Worth doing before the season:** audit real players already in Jake's real
      league for missing `divisionId` (anyone added via admin "Add Player" before
      today) and backfill them — this fix only prevents new occurrences.
- [x] **2026-07-13 — FIXED & live-verified.** Standings tab showed a completely
      blank page with no explanation when a division has teams but zero confirmed
      matches yet — no empty-state message, unlike Results ("No results yet…") and
      Inbox ("All caught up"). Fixed in `admin-standings-override.tsx`'s shared
      `StandingsBody`: "No standings yet" / "No player stats yet" cards, matching the
      Results pattern. Live-verified against Winter 26/27 → Division 3 (3 real teams,
      zero confirmed matches) on both the Team Points and Player Stats sub-tabs.
- [x] **2026-07-13 — FIXED & live-verified.** Nothing stopped two seasons being
      marked "active" simultaneously (3 were active at once during testing) — the
      Dashboard's "Active Season" card just silently picked one. Fixed at the source
      in `admin-season.tsx`'s `setStatus()`: marking a season active now checks for
      other active seasons in the league first and, if found, confirms with the admin
      before demoting them to Completed in the same batch. Live-verified: clicking
      "Active" on Winter 26/27 while Mock Mid-Season and Test Season were both already
      active correctly popped "Mark this season active? Mock Mid-Season, Test Season
      are currently marked active too…" (dismissed without confirming, so the
      league's actual season statuses are untouched — Jake, worth deciding for
      yourself whether to resolve that pre-existing double-active state, since I
      deliberately didn't force it during verification). Also fixed the separate
      issue where the Dashboard's "Teams" stat summed teams across every season the
      league has ever had instead of just the active one — `admin.tsx` now scopes
      that query by the active season's `seasonId`. Live-verified: Dashboard showed
      "5 Teams", matching Mock Mid-Season's own division count exactly (the league
      has 10+ teams total across all its seasons).
- [x] **2026-07-13 — FIXED & live-verified.** On a team's page, the "waiting for
      someone to request this role" hint under Vice Captain only checked whether
      *Captain* had no pending assignment — it disappeared once Captain was
      assigned/pending even if VC was still fully unassigned. Fixed in
      `admin-team.tsx` by giving Captain and VC independent hint checks instead of
      one shared footer gated on Captain's state only. Live-verified: The Foresters
      Arms (real team, Captain assigned, VC unassigned) now correctly shows the hint
      under Vice Captain.

## Suggested improvements (not bugs, raised 2026-07-10)

- [ ] Admin-side "enter/confirm a result" path — right now results only enter the
      system via a captain's own mobile submission; no way for an admin to record
      one on behalf of a captain who's stuck or offline.
- [ ] Team/roster carry-over between seasons — every season's teams are built from
      scratch today; a "copy teams from…" option on a new season/division would cut
      most of the re-entry each season turnover.

## Open risks / things to revisit

- Including Phase 2 (cup + 4 individual competitions) is a lot of scope for the
  timeline. It's sequenced after Phase 1 deliberately — those competitions genuinely
  can't run until standings/stats exist anyway (Player Champ needs seeding data, 180
  Cup needs season 180 counts), so there's natural runway during the season to build
  them without blocking the Sept/Oct kickoff. If Phase 1 slips, Phase 2 slips with it —
  don't compress Phase 1 to protect Phase 2's timeline.
- Results entry UI is the biggest UX risk — captains are filling this in post-match,
  probably at a pub on a phone. Worth a quick paper-prototype/walkthrough with an
  actual captain before building the real screens.
- **2026-07-28 — partially addressed.** Added Jest coverage (`functions/src/index.test.ts`,
  23 tests, `npm test` in `functions/`) for the Cloud Function aggregation logic:
  `computeTotals`, `computeMatchContribution`, `computePlayerAccum`, and
  `normalizeGames`/`gamesEqual`. These were already written as pure functions with no
  Firestore calls (good prior design), just not exported or tested — exporting them
  needed no logic changes. One function (`computeMatchContribution`) was extracted from
  an inline closure inside `applyMatchResultDelta` to make it independently testable;
  behavior unchanged. Covers the actual scoring/attribution math (2pts/0pts, leg-diff
  tiebreak inputs, singles/pairs player attribution, 180s, high checkouts) and — maybe
  more importantly — the auto-confirm-vs-dispute comparison itself: order-independence
  (games/players/180s array order, checkout whitespace) so two captains submitting the
  same result in a different order doesn't wrongly trigger a dispute, and real-mismatch
  detection (leg winner, 180 attribution, checkout value) so genuine disagreements don't
  slip through as an auto-confirm. **Not yet covered:** the Firestore-touching parts —
  `applyMatchResultDelta`'s actual `FieldValue.increment` writes, `onSubmissionWrite`/
  `onMatchConfirmed`/`onMatchDeleted` as triggers, and `recomputeDivisionPositions` — would
  need the Firebase Emulator Suite (`firebase-functions-test` + Firestore emulator) for
  real trigger-level integration tests, not attempted here. `npx tsc --noEmit` clean,
  `expo export -p web` unaffected (functions-only change), test files excluded from the
  `tsc` build/deploy output via `tsconfig.json`.
