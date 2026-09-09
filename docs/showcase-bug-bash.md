# Chalkie Showcase Bug Bash

## Current status

Date: 2026-09-09
Current production commit: `8e56219873f1c506812f3a88cb4a8e3631cf2465` (main — includes PR #16, Hosting-deployed and verified)
Overall status: League Admin walkthrough (session 1) complete. Captain + Normal Player walkthrough (session 2) complete. One P1 (BUG-004, newly found this session — no role-based route guard on admin screens), one dormant P1 (BUG-001), two P2s (BUG-002, BUG-003) open. No P0s. No code changes made in either session — everything below is pending approval.

**Methodology note (applies to both sessions):** all testing was a systematic static code walkthrough (reading the actual routed screens against `origin/main`) rather than interactive device/browser testing — this remote environment has no Firebase credentials and no way to sign in as any live user (League Admin, Captain, or Normal Player) against the real showcase data. Every finding below is a traced code-path defect, not an observed runtime failure, except where noted otherwise. Every screen/component below is explicitly noted as **CODE-REVIEWED ONLY** — none of it was interactively exercised — and no showcase data was seeded, reset, or modified, consistent with the standing instruction, since no live session was possible in the first place. The working branch (`claude/chalkie-audit-prep-5o84ya`) was found to be behind `origin/main` (missing PRs #14/#15/#16); every file cited below was individually diff-checked against `origin/main` (via `git diff HEAD origin/main -- <path>`) before being trusted, and findings reflect the **current production code**, not the stale branch.

## Completed / verified

- **PR #16 — League Admin Team Points names**: confirmed on `origin/main`. `admin-standings-override.tsx`'s `sortedTeamRows` re-resolves `teamName` from the live `teamNames` map on every render (not baked in at snapshot time), matching the fix described in the PR.
- **PR #16 — League Admin Player Stats names**: confirmed on `origin/main`. `sortedPlayerRows` re-resolves both `playerName` and `teamName` the same way; `StandingsBody`'s player tab renders `c.sortedPlayerRows`, not the raw unsorted `playerRows`.
- **PR #16 — Hosting deployment**: production Hosting redeployed from commit `8e56219` (workflow run `34323588630`, `conclusion: success`, Hosting-only — confirmed no Functions/Firestore rules/indexes touched).
- **Dashboard** (`(tabs)/admin.tsx`): setup flow, season list/status badges, desktop Quick Actions, Inbox/Disputes badge counts — walked the code, no defects found.
- **Teams** (`admin-season.tsx` Teams tab, `admin-team.tsx`): team list, team detail, venue edit, squad list, add/move/delete player, Change Role sheet (captain/VC demotion logic), Delete Team — walked the code, no defects found.
- **Players** (`player-profile.tsx`): season stats, recent form, match history, not-found state (including the "missing doc reads as permission-denied" Firestore-rules quirk, which this screen already handles gracefully) — no defects found.
- **Team profile** (`team-profile.tsx`): team performance card, recent form, upcoming fixtures, recent results, squad, team statistics — no defects found.
- **Result management — resolved results** (`admin-fixtures.tsx` `ResultsTab`/`ResultsTable`): confirmed + disputed matches list, correct routing to Resolve Dispute vs. the full result editor — no defects found.
- **Result management — result entry/correction** (`results-entry.tsx`): admin view/edit/delete-fixture gate (`isAdmin = isLeagueAdmin || isGlobalAdmin`), reconcile/review/waiting modes, admin correction flow — no defects found.
- **Dispute handling** (`admin-dispute.tsx`): both teams' submitted versions are shown side-by-side per game, agreement is auto-detected and pre-resolved, leg-winner override works, "nothing to resolve yet" empty state present — no defects found.
- **Admin controls** (`admin-tools.tsx`): dev-only seeding tools are correctly gated behind `__DEV__` (false in the production Expo web export), so production shows the intended "Nothing here yet" empty state — no defects found.
- **Navigation shell** (`components/admin/AdminShell.tsx`, desktop console): sidebar section highlighting, breadcrumbs, season/division context switcher, sign-out — no dead ends found.

**Session 2 additions (Captain + Normal Player, all CODE-REVIEWED ONLY — see methodology note above):**

- **Login/landing routing** (`app/index.tsx`, `(protected)/_layout.tsx`): role-based post-login redirect (`captain`/`viceCaptain` → Home tab, `player` → Home tab, `pending` → find-league/request-pending/admin as appropriate) — no defects found. Note: `(protected)/_layout.tsx` only guards on *authentication* (is there a signed-in Firebase user), not on *role* — see BUG-004 below.
- **Tab visibility** (`components/ui/TabBar.tsx`): `visibleRouteNames()` correctly shows `home/fixtures/standings/stats` for `player`, `captain/captains/fixtures/standings/stats` for `captain`/`viceCaptain`, and layers `admin` on top independently via `isLeagueAdmin` — no defects found. (This hides tabs from the tab bar only — it is not a route guard; see BUG-004.)
- **Home dashboard** (`components/HomeDashboard.tsx`, shared by both the `home` and `captain` tabs — literally the same component): Next Match card, Team Snapshot, Personal Snapshot, Recent Result, pending-requests notice — all correctly gated on `isCaptainOrVC` where action buttons are involved; a normal player sees the same cards with no action buttons. No defects found.
- **Fixtures tab** (`(tabs)/fixtures.tsx`, shared by all roles): upcoming/previous tabs, opponent name/date/status, "Enter Result"/"Resolve Differences" button correctly gated on `canSubmitResults = role === 'captain' || role === 'viceCaptain'` — no defects found.
- **Match Centre** (`components/MatchCentre.tsx` — `MatchHeader`/`MatchSummary`/`GameRow`/`ActionBanner`, `results-entry.tsx`): thorough, explicit role gating (`canView = isHome || isAway || isAdmin`; `canAct = isCaptainOrVC && (isHome || isAway)`); state machine (`blank`/`review`/`waiting`/`reconcile`) correctly reflects each side's submission state; player-picker enforces one singles-game-per-player while allowing a pairs game too; player names resolved live from state (not stale-baked) — no defects found.
- **Result confirmation / auto-confirm / dispute** (`functions/src/index.ts` `onSubmissionWrite`): confirmed there is no manual "Confirm" action for captains — the backend auto-confirms when both teams' submissions match (`games` normalized and compared), moves to `disputed` if they don't, and to `awaiting_confirmation` on the first valid submission. This matches the UI copy in `results-entry.tsx` exactly. No defects found; this is by-design behavior, not a missing feature.
- **My Team** (`(tabs)/captains.tsx` — captain/VC only, hidden from `player` role by the tab bar): roster, add/remove player, venue + personal contact-details editing, join/claim/VC-role request approval (VC-role requests correctly gated to the team's actual captain via `appUser.uid === captainUserId`), "Needs Your Action" actionable-matches list (correctly includes `disputed` matches, not just `awaiting_confirmation`) — no defects found.
- **Standings / Player Stats tabs** (`(tabs)/standings.tsx`, `(tabs)/stats.tsx`, shared by all roles): for a captain/player, `appUser.divisionId` is populated (unlike a League Admin), so both screens correctly default to the viewer's own division — no defects found for this role.
- **Personal profile** (`edit-profile.tsx`, `components/ui/AccountMenu.tsx`, `components/ui/AppHeader.tsx`): name/nickname editing available to every role equally; account menu correctly shows "Contact Details" only for captain/VC, "Admin" line only when `isLeagueAdmin`, role label for everyone else — no defects found, no privileged actions exposed.
- **Availability / RSVP feature**: does not exist anywhere in the current codebase (`grep -ri availab` across `mobile/` turns up nothing but an unrelated code comment using the word "available"). Not a bug — nothing to test.

## Open bugs

| ID | Priority | Area | Issue | Status |
|---|---|---|---|---|
| BUG-001 | P1 (dormant — see notes) | Standings navigation | Mobile League Admin "Table" button ignores which division was tapped; always opens the tab-bar Standings screen with no division context | Investigated — fix proposed, not implemented |
| BUG-002 | P2 | Fixtures | "Delete all & regenerate" has no status guard, unlike the single-fixture delete path | Investigated — fix proposed, not implemented |
| BUG-003 | P2 | Multiple admin screens | Several `onSnapshot` listeners have no error callback, so a permission/rules failure fails silently into "all caught up" / empty states instead of a visible error | Investigated — fix proposed, not implemented |
| BUG-004 | P1 | Security / role-based navigation | No admin screen checks `isLeagueAdmin`/`isGlobalAdmin` — a Captain or Normal Player who navigates directly to `/admin` or any `/admin-*` route (deep link, typed URL on the web build) sees the real admin dashboard shell with real data, not a permission error | Investigated — fix proposed, not implemented |

## Detailed findings

### BUG-001 — "Table" button on mobile League Admin doesn't target the tapped division

**Priority:** P1 as a general code defect. **Dormant for the showcase specifically** — the showcase seed (`scripts/showcase-seed/src/seedCore.ts`) creates exactly one division, so this bug is not currently reachable/visible and will not affect the showcase demo.

**Area:** Standings / navigation.

**Reproduction steps:**
1. Sign in as League Admin on a narrow (mobile-width, < 768px) viewport, on a league with 2+ divisions in a season.
2. Go to Dashboard → open a season (mobile drill-down view in `admin-season.tsx`).
3. For Division 2's row, tap **Table**.

**Expected:** Division 2's table.

**Actual:** The button navigates to `/(protected)/(tabs)/standings` with no parameters at all:
```tsx
// mobile/app/(protected)/admin-season.tsx, mobile (non-desktop) branch
<Button variant="secondary" size="sm" className="mr-2" onPress={() => router.push('/(protected)/(tabs)/standings')}>
  Table
</Button>
```
That screen (`(tabs)/standings.tsx`) has no route-param awareness — it defaults its own division selection to `appUser.divisionId` (which a League Admin doesn't have, since admins aren't players) and falls back to `list[0]?.id`, i.e. whichever division sorts first by `order`. So tapping **Table** on any division's row always lands on the same division (division `order: 1`), regardless of which row was tapped. It's silently wrong, not broken — a division-picker chip row is shown at the top when there are 2+ divisions, so the admin *can* self-correct, but the button's own destination is misleading.

Contrast with the adjacent **Adjust** button on the same row, which correctly targets the division:
```tsx
onPress={() => router.push(`/(protected)/admin-standings-override?divisionId=${division.id}`)}
```

**Root cause:** `admin-season.tsx`'s mobile "Table" shortcut was wired to the shared player/captain-facing Standings tab instead of to the admin's own division-aware standings screen, and that shared tab was never given a route param to accept a caller-specified division.

**Code changes required:** Yes — one line in `admin-season.tsx`.
**Firebase/data changes required:** No.

**Recommended action (proposed, not applied):** Point "Table" at the same read-consistent destination "Adjust" already uses (`/(protected)/admin-standings-override?divisionId=${division.id}`), since that screen already renders each division's table correctly (and is the exact screen fixed in PR #16). This makes "Table" and "Adjust" open the same screen — which is arguably correct, since `admin-standings-override.tsx` already displays the live table; there'd be nothing lost by removing the separate "Table" button entirely and relying on "Adjust" alone, if a read-only distinction isn't actually wanted. Flagging both options for a decision rather than picking one, since it's a product-scope question (should League Admin have a read-only Table view separate from an editable Adjust view?), not just a code fix.

---

### BUG-002 — "Delete all & regenerate" fixtures has no per-status guard

**Priority:** P2 — data itself is not at risk (see root cause), but the UI doesn't protect against an action its own confirmation text says shouldn't be run.

**Area:** Fixtures.

**Reproduction steps:**
1. Sign in as League Admin, desktop viewport, open a division with confirmed match results already recorded.
2. Fixtures tab → "Delete all & regenerate".
3. Confirm the dialog.

**Expected:** Consistent with the single-fixture delete path (`deleteFixture()` in the same file), which explicitly refuses: *"This fixture already has results submitted against it,"* for anything except `status === 'scheduled'`.

**Actual:** `deleteAllFixtures()` has no such check — it deletes every match in the division regardless of status:
```tsx
const snap = await getDocs(query(collection(db, 'matches'), where('divisionId', '==', divisionId)));
const batch = writeBatch(db);
snap.docs.forEach((d) => batch.delete(d.ref));
await batch.commit();
```
The confirmation dialog itself warns *"This can't be undone — only do this if no results have been submitted yet"* — implying the developers intended this to be scheduled-only, but nothing enforces it.

**Root cause / why data isn't actually corrupted:** I checked `functions/src/index.ts`'s `onMatchDeleted` trigger — it fires per-document on **any** deletion of a `matches/{matchId}` doc (individual `deleteDoc` or a batch delete both trigger it identically), and for a `confirmed` match it correctly reverses that match's contribution to `divisionTables`/`playerSeasonStats` via `applyMatchResultDelta`. So bulk-deleting confirmed matches this way does **not** leave standings/stats stale — the derived numbers stay correct. What's lost is the match history/audit trail itself (and, per the warning, this is clearly not the intended use of the button).

**Code changes required:** Yes, if the team wants the guard enforced rather than advisory.
**Firebase/data changes required:** No.

**Recommended action (proposed, not applied):** Either (a) filter `deleteAllFixtures()`'s target set to `status === 'scheduled'` only (matching the single-delete guard, and updating the confirmation copy to say so), or (b) leave as-is if an admin nuking a whole division's history — with stats still correctly reversed — is considered acceptable "reset a division" behavior. Recommend (a) for consistency with the existing single-fixture guard, since the current copy already promises that behavior.

---

### BUG-003 — Missing `onSnapshot` error handlers on several League Admin screens

**Priority:** P2 — no evidence any of these reads are currently failing against the showcase data (unlike the now-fixed Table tab bug, which had a confirmed failure); this is a latent-risk/defensive-programming gap, not an active symptom.

**Area:** Dashboard, Inbox, Teams, Standings-override, Dispute — cross-cutting.

**What was expected:** Every live Firestore listener either surfaces a load error to the UI or is deliberately fire-and-forget for non-critical data — matching the pattern already used consistently in the newer `admin-fixtures.tsx`/`admin-season.tsx` (every `onSnapshot` there has an `(e) => setLoadError(e.message)` second callback).

**What actually happened:** These listeners have no error callback at all, so a permission-denied (or any other) error on any of them fails **silently** — the screen just keeps showing its empty/zero state (e.g. Inbox would show "All caught up — No pending requests or disputed results right now" even if the actual read was denied, not merely empty):

- `mobile/app/(protected)/(tabs)/admin.tsx` — `unsubSeasons`, `unsubReqs`, `unsubDisputes`, `unsubTeamsCount`
- `mobile/app/(protected)/admin-inbox.tsx` — `unsubReqs`, `unsubDisputes`, `unsubTeams`
- `mobile/app/(protected)/admin-team.tsx` — `unsubTeam`, `unsubPlayers`, the "other teams" listener (Move Player sheet)
- `mobile/app/(protected)/admin-standings-override.tsx` — the team/player name-lookup listeners, and the `divisionTables`/`playerSeasonStats` row listeners
- `mobile/app/(protected)/admin-dispute.tsx` — `unsubPlayers` (the primary match/team/submission fetch is correctly wrapped in try/catch)

**Why this matters given history:** the Table tab production bug earlier in this engagement was exactly this failure mode — a denied read that looked like "nothing to show" rather than an error — until temporary diagnostic instrumentation isolated it. None of the reads above are currently known to fail (the showcase dataset and current rules were verified working for the screens already tested), but the pattern is inconsistent across the codebase and worth closing opportunistically.

**Code changes required:** Yes, if addressed — a mechanical, low-risk addition of `(e) => setLoadError(...)` (or equivalent) to each listener above, following the exact pattern already used in `admin-fixtures.tsx`.
**Firebase/data changes required:** No.

**Recommended action (proposed, not applied):** Not urgent — no active failure — but worth a follow-up pass to bring these screens in line with the error-handling pattern already established elsewhere, given the direct precedent of the Table tab bug.

---

### BUG-004 — No role-based route guard on League Admin screens (found during the Captain/Normal Player security check)

**Priority:** P1. Not a data-mutation risk (Firestore write rules still hold — see below), but a genuine UI-layer privilege/exposure gap, found while specifically checking for "a lower-privilege user presented with an action they should not have," as requested.

**Area:** Cross-cutting — navigation / security boundary between roles.

**Reproduction steps (traced in code, not live-tested — see methodology note):**
1. Sign in as a Captain or Normal Player (not a League Admin).
2. On the web build, type `/admin` (or any `/admin-team`, `/admin-season?...`, etc. URL) directly into the address bar, or otherwise deep-link there.

**Expected:** Redirected away, or shown a clear "you don't have access" state — the same way `(protected)/_layout.tsx` already redirects a signed-out user to `/login`.

**Actual:** The screen renders. I grepped every `admin-*.tsx` screen plus the `admin` tab for `isLeagueAdmin`/`isGlobalAdmin` and found **zero** matches outside of `results-entry.tsx` (which does gate its own admin-only buttons correctly) and one code comment in `team-profile.tsx`. `(protected)/_layout.tsx` — the one shared wrapper for every protected route — only checks `firebaseUser` (is someone signed in at all), never `appUser.role` or `appUser.isLeagueAdmin`. The `TabBar` hides the "Admin" tab from non-admins, but that's tab-bar cosmetics, not a route guard — `router.push`/a typed URL bypasses it entirely.

I checked `firestore.rules` to see how much of this is actually harmful vs. cosmetic:
- `seasons` read rule: `me().leagueId == resource.data.leagueId || isGlobalAdmin()` — **any** league member can read season docs. So the Dashboard's real season list/status badges *do* render for a non-admin who lands here.
- `matches` read rule: same `me().leagueId == resource.data.leagueId` shape — so the "Disputes" stat tile shows a real, accurate count.
- `teams` read: also league-member-readable — so the "Teams" stat tile is accurate too.
- `joinRequests` read rule is properly restricted to captain/VC-of-that-team or an admin — a normal player's "Pending Requests" query would be denied, but because of BUG-003 (no error handler on that specific listener in `admin.tsx`), it just silently shows `0` rather than erroring.
- `seasons`/`teams`/`divisions`/etc. **write** rules (`create`/`update`/`delete`) are all `isAdminFor(...)`-gated — so pressing "+ New Season," "Manage Teams," "Delete Team," etc. as a non-admin would still fail at the Firestore layer. I did not find a path to an actual unauthorized *write* — the exposure is read-level UI shell + real season/dispute/team counts, not a way to mutate anything.

So the concrete impact: a Captain or Normal Player who navigates here directly sees a real (if partially non-functional) League Admin dashboard — real season names and statuses, real dispute/team counts, a "Pending Requests" tile silently stuck at 0, and fully clickable "+ New Season"/"Manage Teams"/etc. buttons that lead deeper into the admin console (team lists, fixture generators, standings overrides all partially render with real league data) before any actual write attempt would be rejected by Firestore rules.

**Root cause:** Route-level authorization was never added for the `/admin*` route family — access control relies entirely on the tab bar not offering a link, which only stops accidental navigation, not direct/typed/deep-link navigation.

**Code changes required:** Yes.
**Firebase/data changes required:** No — this is a client-side gap; `firestore.rules` writes are already correctly enforced. (Read rules that are broader than "admin only" — e.g. `seasons`, `matches`, `teams` — are all long-standing, deliberate design elsewhere in the app, used legitimately by every non-admin screen too; not a rules bug.)

**Recommended action (proposed, not applied):** Add a role check to `(protected)/_layout.tsx` (or a small wrapper covering just the `/admin*` route group) mirroring the existing `firebaseUser` guard pattern already in that file: if `appUser` is loaded and `!appUser.isLeagueAdmin && !appUser.isGlobalAdmin`, redirect away from any `/admin*` path (e.g., to `/(protected)/(tabs)/home` or `/(protected)/(tabs)/captain` per `appUser.role`, same mapping `index.tsx` already uses). Smallest safe version: a single `useEffect` + `usePathname()` check in the existing protected layout, no new files.

## Fixed bugs

*(carried forward from prior sessions this engagement — not part of this session's new findings)*

- **Admin standings/leaderboard missing team & player names** — stale-closure bug in `admin-standings-override.tsx` (names resolved inside the `onSnapshot` callback at fetch time instead of re-derived at render time). Fixed in PR #16 (commit `359cfea71ae7c14630cdafeec9fe1ce4ff59d008`, merged as `8e56219873f1c506812f3a88cb4a8e3631cf2465`). Verified present and correct on `origin/main` this session; user manually verified in production (all 8 team names + player names display correctly).
- **Table tab "Missing or insufficient permissions"** — root cause was a stale production Hosting build (pre-`df8b791`), not a Firestore rules defect. Fixed by deploying Hosting from current `main` (workflow run `34323588630`, success).
- **Showcase verifier false failures** — 4 instances of an exact-comparison bug where an approximate check was intended, in `scripts/showcase-seed/src/verify.ts`. Fixed with `checkApprox`/`checkPresent` helpers; regression test added to `offline-checks.js`.

## Deferred / future improvements

- `(tabs)/standings.tsx` still carries the TEMPORARY diagnostic panel and per-read logging added for the Table tab investigation (PR #13, still unmerged on this branch, not present on `main`/production). Worth deleting once PR #13 is closed out, per its own code comments — not a production concern since it never shipped.
- `admin.tsx` Dashboard's desktop "Manage Teams / Generate Fixtures / Adjust Standings" Quick Actions fall back to the most-recently-created season if none is marked `active`. Not reachable with the showcase dataset (single, `active` season) — noted for awareness only, not filed as a bug.
- Dashboard's pending-request badge count (`admin.tsx`) is deliberately a slightly looser count than the Inbox screen's own precise filtered list (documented in-code as intentional/acceptable for a badge). No action needed.

## Role coverage

| Role | Area | Status |
|---|---|---|
| League Admin | Dashboard | PASS (code walkthrough) |
| League Admin | Standings | PASS with 1 dormant P1 (BUG-001) |
| League Admin | Fixtures | PASS with 1 P2 (BUG-002) |
| League Admin | Teams | PASS (code walkthrough) |
| League Admin | Players | PASS (code walkthrough) |
| League Admin | Results | PASS (code walkthrough) |
| League Admin | Disputes | PASS (code walkthrough) |
| League Admin | Admin controls (Tools) | PASS (code walkthrough) |
| League Admin | Navigation (desktop shell) | PASS (code walkthrough) |
| League Admin | Navigation (mobile) | 1 P1 found (BUG-001) |
| League Admin | Loading/error/empty states | PASS with 1 P2 (BUG-003, latent) |
| League Admin | Route-level access control | **FAIL — BUG-004** (no role guard on `/admin*` routes) |
| Captain | Navigation (login, tabs, dead ends) | CODE-REVIEWED ONLY — PASS |
| Captain | Home / Dashboard | CODE-REVIEWED ONLY — PASS |
| Captain | Fixtures | CODE-REVIEWED ONLY — PASS |
| Captain | Match Centre (view) | CODE-REVIEWED ONLY — PASS |
| Captain | Team (My Team / roster / requests) | CODE-REVIEWED ONLY — PASS |
| Captain | Standings | CODE-REVIEWED ONLY — PASS |
| Captain | Player Stats | CODE-REVIEWED ONLY — PASS |
| Captain | Availability | N/A — feature does not exist in the product |
| Captain | Enter/submit result, select players | CODE-REVIEWED ONLY — PASS |
| Captain | Confirm results | CODE-REVIEWED ONLY — PASS (confirmed automatic, not manual — verified in `functions/src/index.ts`) |
| Captain | Awaiting confirmation / disputed handling | CODE-REVIEWED ONLY — PASS |
| Normal Player | Navigation (login, tabs, dead ends) | CODE-REVIEWED ONLY — PASS |
| Normal Player | Home / Dashboard | CODE-REVIEWED ONLY — PASS |
| Normal Player | Personal profile | CODE-REVIEWED ONLY — PASS |
| Normal Player | Team profile / squad | CODE-REVIEWED ONLY — PASS |
| Normal Player | Fixtures / Match Centre (read-only) | CODE-REVIEWED ONLY — PASS |
| Normal Player | Standings | CODE-REVIEWED ONLY — PASS |
| Normal Player | Player statistics (own + leaderboard) | CODE-REVIEWED ONLY — PASS |
| Normal Player | Role-gating (no captain/admin controls visible) | CODE-REVIEWED ONLY — PASS *within the tab bar*; **FAIL via direct navigation — BUG-004** |

*No row above is "actually tested and PASS" in the sense of a live interactive session — this remote environment has no Firebase credentials, so no role could be signed in and driven live. Every PASS is a traced-code-path result; see the methodology note at the top of this file.*

## Showcase readiness

- Core functionality: PASS (code-reviewed)
- Showcase dataset: PASS (previously verified; single division/season, so BUG-001 does not manifest)
- Captain journey: PASS (code-reviewed only — see Role coverage)
- Normal player journey: PASS (code-reviewed only — see Role coverage)
- League admin journey: PASS (code-reviewed; BUG-001 dormant, BUG-002/BUG-003 non-blocking follow-ups, BUG-004 is a real gap but not showcase-blocking — see below)
- Result submission: PASS (code-reviewed)
- Result confirmation: PASS (code-reviewed; confirmed automatic/backend-driven, not a missing captain feature)
- Dispute handling: PASS (code-reviewed, both League Admin and Captain-side reconcile flow)
- Standings: PASS (PR #16 verified on `origin/main` and in production; correct for all three roles)
- Player statistics: PASS (code-reviewed)
- Team/player profiles: PASS (code-reviewed)
- Production deployment: PASS (Hosting redeployed from `8e56219`, verified Hosting-only)

**Overall recommendation: READY FOR SHOWCASE**, with one caveat. No P0s. BUG-001 is dormant (unreachable with the current single-division showcase dataset). BUG-002/BUG-003 are non-blocking follow-ups. **BUG-004** (no role-based guard on admin routes) is a real P1: it doesn't put data at risk and won't visibly break the demo unless someone deliberately types an admin URL while signed in as a non-admin persona — but if the showcase is being driven live in front of an audience, it's worth a quick, small, isolated fix (or at minimum, awareness not to demo captain/player personas anywhere near the admin URL) before presenting. Recommend fixing BUG-004 before the showcase if there's any chance of live role-switching during the demo; otherwise it's safe to defer with the others.
