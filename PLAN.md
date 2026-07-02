# Chalkie — Product Plan

Living roadmap doc. Update this file as work is completed or decisions change — this is
the source of truth to pick the project back up in a new session. Check items off as
they're actually shipped and tested, not just started.

## Status snapshot

- **Now:** Phase 1 not started. Interview with Jake completed 2026-07-02, this plan
  written from it.
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
                         highCheckout?: { playerId, value } } ] } ]

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
- [ ] Results entry screen (captain/VC): full lineup + leg-by-leg + 180s + optional
      high-checkout text per game, for a scheduled match. This is the most complex
      screen in the app — treat it as its own sub-project, prototype the flow before
      committing to a layout.
- [ ] Submission comparison + auto-confirm logic (Cloud Function, triggered on
      submission write).
- [ ] Dispute view for admin (both submissions side by side, pick/edit, confirm).
- [ ] Cloud Function: on match confirm, recompute `divisionTables` row for both teams
      and `playerSeasonStats` for every player involved.
- [ ] Standings screen (division table, all league members can view their division).
- [ ] Stats screens: player's own stats (personal), division leaderboard (most 180s,
      best win %, notable high checkouts).
- [ ] Push notifications: register Expo push token on user doc; Cloud Functions (or
      scheduled function) for: fixture reminder day-before, "result needs your
      confirmation", "result confirmed", admin/captain approval alerts (team/join
      requests — reuses existing approval flows from the already-built onboarding).

### Phase 2 — Cup & individual competitions (build during the season, before they're needed mid-season — not required for the August demo or season kickoff)
- [ ] Team knockout cup: single-elimination, one match per round, cross-division draw.
      Reuses the exact match/results/confirmation infrastructure from Phase 1 — just a
      different bracket wrapper around `matches`.
- [ ] Generalized individual/pairs knockout engine, covering:
  - [ ] Singles knockout (individual players)
  - [ ] Pairs knockout
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
      internal testing.

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
- No tests exist anywhere in the app currently. Given money/competitive stakes
  (standings, cup seeding) ride on the Cloud Function aggregation logic being correct,
  that logic in particular should get test coverage even if the UI doesn't.
