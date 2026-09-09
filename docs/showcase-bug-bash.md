# Chalkie Showcase Bug Bash

## Current status

Date: 2026-09-09
Current production commit: `8e56219873f1c506812f3a88cb4a8e3631cf2465` (main — includes PR #16, Hosting-deployed and verified)
Overall status: League Admin walkthrough (session 1) complete. Captain + Normal Player walkthrough (session 2) complete. BUG-004 (session 3) implemented, merged (PR #17), deployed to production, and manually runtime-verified by the user for League Admin, Captain, and Normal Player — CLOSED. Global Admin walkthrough (session 4) found BUG-005; session 5 implemented, verified by typecheck + build + full 5-persona routing trace (CODE-REVIEWED ONLY — not yet runtime-verified), and opened a clean PR (not merged, not deployed). BUG-001 (dormant), BUG-002, BUG-003 remain open and untouched.

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

**Session 4 additions (Global Admin, CODE-REVIEWED ONLY — not runtime-verified, see methodology note above):**

Persona traced: `showcase.globaladmin@chalkie.test`, seeded (`scripts/showcase-seed/src/seedCore.ts`) as `role: 'pending', pendingRequestType: null, leagueId: null, isLeagueAdmin: false, isGlobalAdmin: true` — deliberately unscoped to any league ("the most honest representation of 'genuinely global'", per the seed script's own comment).

- **Login/post-login routing** (`app/index.tsx`): traced the exact showcase persona through the `role === 'pending'` switch case. As found (pre-fix), since `pendingRequestType` is `null` and `isLeagueAdmin` is `false`, it fell to the `else` branch — `router.replace('/(protected)/find-league')`. **This was the actual landing page for the showcase Global Admin: the new-player "search for your league to join" onboarding screen** — filed and fixed as BUG-005 (see Fixed bugs; PR open, not yet merged/deployed).
- **Whether Admin access is available via normal navigation**: As found (pre-fix), no. `find-league.tsx` has no admin affordance (just a league search box); the tab bar (`TabBar.tsx`) rendered zero tabs for this exact `role`+flag combination; `find-league.tsx` doesn't even render the header avatar that opens the account menu (that's wired only into `(tabs)/_layout.tsx`, not this standalone route) — filed and fixed as BUG-005 (see Fixed bugs; PR open, not yet merged/deployed).
- **Whether accidentally blocked by the new BUG-004 route guard**: **No — confirmed not blocked.** `(protected)/_layout.tsx`'s guard correctly checks `isLeagueAdmin || isGlobalAdmin`, so a Global Admin who reaches `/admin` by any means (a typed URL is currently the only way — see above) passes through cleanly. This was the one piece of good news to specifically verify given BUG-004 shipped this session, and it holds.
- **What happens once at `/admin` with no `leagueId`**: `admin.tsx` has no internal `isLeagueAdmin`/`isGlobalAdmin` check of its own — it only branches on `appUser.leagueId`. With `leagueId: null`, it always renders the "Set up your league" prompt (the same screen a brand-new League Admin sees), never any cross-league or "choose a league" view. This is the confirmed, precise shape of the existing architectural limitation the task described — see Existing Limitations below. Not filed as a bug.
- **Existing global-admin-specific UI controls**: none exist. The only client-side references to `isGlobalAdmin` at all are the BUG-004 guard (`_layout.tsx`), the `isAdmin` flag in `results-entry.tsx`, and an explanatory code comment in `team-profile.tsx`. There is no global-admin dashboard, league picker, or cross-league summary anywhere in the UI.
- **Inappropriate/non-global controls exposed**: none found — a Global Admin never reaches any team/fixture/standings data without a league context first (there's nothing to leak), so this is a clean PASS.
- **Navigation / back behavior**: `find-league.tsx` is reached via `router.replace()` (no back-stack entry), consistent with how every other post-login landing route in `index.tsx` works — no dead end beyond the discovery problem already noted.
- **Loading/error/empty states**: `find-league.tsx` has a proper `onSnapshot` error handler and loading spinner — no defects there.

## Open bugs

| ID | Priority | Area | Issue | Status |
|---|---|---|---|---|
| BUG-001 | P1 (dormant — see notes) | Standings navigation | Mobile League Admin "Table" button ignores which division was tapped; always opens the tab-bar Standings screen with no division context | Investigated — fix proposed, not implemented |
| BUG-002 | P2 | Fixtures | "Delete all & regenerate" has no status guard, unlike the single-fixture delete path | Investigated — fix proposed, not implemented |
| BUG-003 | P2 | Multiple admin screens | Several `onSnapshot` listeners have no error callback, so a permission/rules failure fails silently into "all caught up" / empty states instead of a visible error | Investigated — fix proposed, not implemented |
| BUG-004 | P1 | Security / role-based navigation | No admin screen checked `isLeagueAdmin`/`isGlobalAdmin` — a Captain or Normal Player who navigated directly to `/admin` or any `/admin-*` route saw the real admin dashboard shell with real data | **FIXED, deployed (`34330725367`), user-verified for League Admin/Captain/Normal Player — CLOSED** |
| BUG-005 | P1 (Functional bug) | Global Admin navigation | `index.tsx`, `TabBar.tsx`, `AppHeader.tsx`, `AccountMenu.tsx` check `appUser.isLeagueAdmin` only, never `isGlobalAdmin` — the showcase Global Admin persona lands on the new-player "find your league" onboarding screen after login, with zero tab-bar or menu path to `/admin` | **FIXED — see Fixed bugs** (PR open, not merged/deployed) |

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

## Existing limitations

*(Confirmed via code, not filed as bugs — matches the pre-existing architectural gap the task described up front. No fix proposed or implied; a league-selector feature is explicitly out of scope.)*

### Admin screens are single-league-scoped by design; Global Admin has no way to select which league to manage

Every `admin-*.tsx` screen, plus `AdminShell.tsx`'s season/division "Working In" context switcher, reads exclusively from `appUser.leagueId` — there is no concept anywhere in the client of "the league I'm currently managing" as something distinct from "the league on my own user doc." That's correct and sufficient for a League Admin (their `leagueId` is permanently, and correctly, pinned to the one league they created). For a Global Admin — deliberately seeded with `leagueId: null` ("the most honest representation of 'genuinely global'," per `seedCore.ts`'s own comment) — it means there is currently no UI path to select and manage an *existing* league (e.g. the showcase league itself). The only available action once at `/admin` is "Set up your league," i.e. **create a brand-new league**, which would also set `leagueId` on the Global Admin's own user doc going forward (`handleCreateLeague()` in `admin.tsx` does `batch.update(doc(db,'users',appUser.uid), { leagueId: leagueRef.id })` unconditionally) — permanently narrowing a genuinely platform-wide admin into a single-league admin, as an unintended side effect of the only button available. This was not tested live (no Firebase credentials, and doing so would create real showcase data) — flagged as a code-confirmed risk, not a live-observed one.

This is exactly the limitation described up front in this task's brief. `firestore.rules` and the Cloud Functions already grant a Global Admin full cross-league read/write, so this is purely a client UI/product gap, not a data-layer one — nothing here blocks a hypothetical future league-selector from working immediately once built. No fix proposed, per explicit scope.

## Fixed bugs

*(carried forward from prior sessions this engagement unless noted)*

- **BUG-004 — No role-based route guard on League Admin screens (fixed, merged, deployed, and user-verified — CLOSED).**

  **Shipped:** PR #17 (`fix/bug-004-admin-route-guard`, cut clean from `origin/main`, exactly 2 files), merged as `cc2b36a3452f29f7f75ceae81c8f35f03cac9e37`. Deployed to production via `deploy-hosting-production.yml` run `34330725367` (Hosting only, Firebase version `projects/947789418402/sites/chalkie-app/versions/442ad5f5d8293868`). Manually runtime-verified by the user in production for League Admin, Captain, and Normal Player.

  **Root cause:** No admin screen, and no shared layout, ever checked `appUser.isLeagueAdmin`/`isGlobalAdmin`. `(protected)/_layout.tsx` — the one layout wrapping every route under `(protected)/`, including all 8 admin routes (`/admin` tab plus `admin-team`, `admin-dispute`, `admin-inbox`, `admin-fixtures`, `admin-tools`, `admin-season`, `admin-standings-override`) — only guarded on *authentication* (`firebaseUser` present), never on *role*. `TabBar.tsx` hides the Admin tab from non-admins, but that's tab-bar cosmetics only; it doesn't stop a typed URL, deep link, or `router.push`. Confirmed via `firestore.rules` that this was a real, if read-only, exposure — `seasons`/`matches`/`teams` are readable by any league member (by design, used legitimately elsewhere), so a non-admin landing on `/admin` directly saw real season names/statuses and accurate dispute/team counts (not just an empty shell); `seasons`/`teams`/etc. **write** rules are correctly `isAdminFor(...)`-gated, so no unauthorized write was ever possible — the gap was UI-layer exposure of admin screens/data, not a data-mutation risk.

  **Fix:** Added a single centralized guard to `mobile/app/(protected)/_layout.tsx` — the one shared layout already identified as covering every admin route:
  - `isAdminPath(pathname)` matches exactly the 8 admin routes (`pathname === '/admin' || pathname.startsWith('/admin-')`), confirmed exhaustive by listing every `admin*` file in `mobile/app/`.
  - `isAuthorizedAdmin = !!appUser?.isLeagueAdmin || !!appUser?.isGlobalAdmin` — reuses the exact boolean expression `results-entry.tsx` already uses for its own admin-only buttons, deliberately independent of `role` and `leagueId` (so Global Admin, who has no `leagueId`, is unaffected).
  - The existing `useEffect` (which already redirected a signed-out user to `/login`) now also redirects an authenticated-but-unauthorized user away from an admin route to `/` — reusing `index.tsx`'s existing role-based landing logic rather than duplicating a new role→route mapping.
  - A synchronous conditional render (`if (onAdminRoute && (isLoading || !firebaseUser || !isAuthorizedAdmin)) return <spinner>`) blocks the `<Stack>` — and therefore the admin screen itself — from ever mounting while loading or for an unauthorized viewer, so no admin UI or data is exposed even for one frame (a plain `useEffect`-only redirect would still render the screen once before firing).

  **Files changed:** `mobile/app/(protected)/_layout.tsx` only (1 file).

  **Tests/checks:**
  - `npx tsc --noEmit` — clean, no errors.
  - `npx expo export -p web` — production web build succeeds (build output removed afterward, not committed).
  - No automated test framework exists in this repo for this layer, so verification is by code-path inspection (documented per-role below) plus the two checks above, per the task's own guidance not to introduce a new test framework for this fix.
  - Traced all 5 required scenarios against the new guard logic:
    1. **League Admin** (`isLeagueAdmin: true`) → `isAuthorizedAdmin` true → block condition false → admin screens render normally, no change from before.
    2. **Global Admin** (`isGlobalAdmin: true`, `leagueId: null`) → `isAuthorizedAdmin` true via the `isGlobalAdmin` branch, `leagueId` never consulted → not blocked, reaches `/admin` directly if they get there by any means. (Note: `index.tsx`'s own *initial-login* routing switch, and three other UI spots, only check `isLeagueAdmin`, not `isGlobalAdmin` — confirmed and filed as **BUG-005** in the session 4 Global Admin walkthrough below; untouched by this fix and out of this task's scope. It does not affect this guard, which never blocks a Global Admin who navigates to an admin route by any means — confirmed live-relevant in BUG-005's own investigation.)
    3. **Captain** (`role: 'captain'`, no admin flags) → `isAuthorizedAdmin` false → blocked (spinner, no admin content mounts) → effect redirects to `/` → `index.tsx` sends them to the Captain Home tab, exactly where they'd already land after login.
    4. **Normal Player** (`role: 'player'`) → same as Captain, redirected to the Home tab.
    5. **Pending/non-admin user** (`role: 'pending'`, no admin flags) → blocked, redirected to `/` → `index.tsx` sends them to `request-pending` or `find-league` as appropriate — existing onboarding destinations, no new UX invented. A `pending`-role user who *is* `isLeagueAdmin` (the legitimate "admin with no team yet" persona) is correctly **not** blocked.
  - Confirmed no regression: every non-admin pathname leaves `onAdminRoute` false, so the block condition is always false and the layout renders exactly as before for `home`, `captain`, `captains`, `fixtures`, `standings`, `stats`, `results-entry`, `player-profile`, `team-profile`, `edit-profile`, etc. Confirmed `AdminShell.tsx`'s internal sidebar navigation (between admin-season/admin-team/admin-inbox/etc.) is unaffected since an already-authorized admin's `isAuthorizedAdmin` stays true throughout.

  **Remaining limitations:**
  - This is a client-side UI guard, not a new security boundary — the actual data-mutation protection was already, and remains, enforced by `firestore.rules` (unchanged in this fix, per scope). This fix closes the *exposure* gap (seeing admin screens/data you shouldn't), not a *mutation* gap (which didn't exist).
  - `index.tsx`'s own initial-login routing still doesn't special-case a `pending`-role pure Global Admin (see note under scenario 2) — pre-existing, unrelated to BUG-004, and out of scope for this fix. **Fixed separately as BUG-005, below.**
  - BUG-001, BUG-002, BUG-003 are unchanged and still open — explicitly out of scope for this task.

- **BUG-005 — `isGlobalAdmin` not checked in 4 client-side navigation/UI spots (fixed, PR open, not yet merged/deployed).**

  **Root cause:** `isGlobalAdmin` was introduced as a platform-wide flag independent of `isLeagueAdmin`/`role`/`leagueId`, and every data-layer check (`firestore.rules`' `isAdminFor()`, every admin-only Cloud Function, `results-entry.tsx`'s `isAdmin` flag, and BUG-004's own `_layout.tsx` guard) was already written to treat it as equivalent to `isLeagueAdmin` — but four earlier-written UI files were missed and never updated to match: `app/index.tsx`'s post-login routing switch, `TabBar.tsx`'s `visibleRouteNames()`, `AppHeader.tsx`'s avatar badge, and `AccountMenu.tsx`'s "Admin" info row all checked `appUser.isLeagueAdmin` alone. Concrete effect on the showcase persona (`role: 'pending'`, `pendingRequestType: null`, `leagueId: null`, `isLeagueAdmin: false`, `isGlobalAdmin: true`): landed on `/find-league` (the new-player onboarding screen) on every login, with no tab, badge, or menu entry pointing at `/admin` anywhere in normal navigation. Confirmed the BUG-004 route guard itself was never affected — it already checked both flags, so a Global Admin was never blocked from `/admin` once there by any means (only *getting* there was broken).

  **Fix:** The same minimal `appUser.isLeagueAdmin || appUser.isGlobalAdmin` expression applied at each of the 4 call sites, mirroring the pattern already proven in `results-entry.tsx` and the BUG-004 guard — no shared helper introduced, since none existed to prefer (both prior correct usages are inline, so inline is the established pattern):
  - `app/index.tsx` — `case 'pending'`: `else if (appUser.isLeagueAdmin || appUser.isGlobalAdmin) { .../admin }`.
  - `components/ui/TabBar.tsx` — `visibleRouteNames(role, isAdmin)` (parameter renamed for honesty), called as `visibleRouteNames(appUser?.role, appUser?.isLeagueAdmin || appUser?.isGlobalAdmin)`.
  - `components/ui/AppHeader.tsx` — `const isAdmin = appUser?.isLeagueAdmin || appUser?.isGlobalAdmin; const badge = isAdmin ? 'A' : ...`.
  - `components/ui/AccountMenu.tsx` — condition changed to `(appUser?.isLeagueAdmin || appUser?.isGlobalAdmin)`, and the previously-hardcoded label text "League Admin" is now conditional (`appUser?.isGlobalAdmin ? 'Global Admin' : 'League Admin'`) since showing "League Admin" for a genuine Global Admin would itself have been inaccurate.

  No new routes, no league selector, no schema change, no other file touched.

  **Files changed:** `mobile/app/index.tsx`, `mobile/src/components/ui/TabBar.tsx`, `mobile/src/components/ui/AppHeader.tsx`, `mobile/src/components/ui/AccountMenu.tsx` (4 files).

  **Tests/checks:**
  - `npx tsc --noEmit` — clean, no errors.
  - `npx expo export -p web` — production web build succeeds (build output removed afterward, not committed).
  - Full routing trace for all 5 personas against the actual seeded field values (`scripts/showcase-seed/src/seedCore.ts`), confirming the fix changes *only* the Global Admin case and leaves every other persona provably unchanged (the OR only flips an already-true value to still-true for League Admin, or leaves an already-false pair false for everyone else):

    | Persona | `role` | `isLeagueAdmin` | `isGlobalAdmin` | `index.tsx` destination | Tab bar |
    |---|---|---|---|---|---|
    | League Admin | `pending` | `true` | `false` | `/admin` (unchanged) | `[admin]` (unchanged) |
    | Global Admin | `pending` | `false` | `true` | `/find-league` → **`/admin` (fixed)** | `[]` → **`[admin]` (fixed)** |
    | Captain | `captain` | `false` | `false` | `/captain` (unchanged — routed before the pending/admin check is even reached) | `[captain, captains, fixtures, standings, stats]` (unchanged) |
    | Normal Player | `player` | `false` | `false` | `/home` (unchanged) | `[home, fixtures, standings, stats]` (unchanged) |
    | Pending non-admin | `pending` | `false` | `false` | `/find-league` (unchanged) | `[]` (unchanged) |

  **Remaining limitation (unchanged by this fix, exactly as scoped):** the existing admin UI remains league-scoped and has no league selector; this is a future product feature, not part of BUG-005. A Global Admin who now reaches `/admin` via normal navigation still only sees "Set up your league" (see Existing Limitations above) — this fix only gets them to that screen through the UI instead of a typed URL, it does not add any way to manage an existing league.

  **Deployment status:** Not merged, not deployed. PR opened against `main` from a clean branch (see PR link below); awaiting review/merge/deploy approval, same as BUG-004's process.

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
| League Admin | Route-level access control | **CLOSED — BUG-004** (centralized guard in `(protected)/_layout.tsx`, deployed, user-verified) |
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
| Normal Player | Role-gating (no captain/admin controls visible) | CODE-REVIEWED ONLY — PASS *within the tab bar*; direct-navigation gap **CLOSED — BUG-004** |
| Global Admin | Login / post-login routing | CODE-REVIEWED ONLY — **FIXED, BUG-005** (now routes to `/admin`; not yet merged/deployed) |
| Global Admin | Admin access via normal navigation (tabs/menu) | CODE-REVIEWED ONLY — **FIXED, BUG-005** (tab, badge, and menu label all now appear; not yet merged/deployed) |
| Global Admin | Admin access via direct URL, and BUG-004 guard interaction | CODE-REVIEWED ONLY — PASS (not blocked by BUG-004 — confirmed) |
| Global Admin | Admin dashboard behavior with no `leagueId` | CODE-REVIEWED ONLY — matches the pre-existing Existing Limitation described above; not a new bug |
| Global Admin | Inappropriate/non-global control exposure | CODE-REVIEWED ONLY — PASS (none found) |
| Global Admin | Navigation/back behavior, loading/error/empty states | CODE-REVIEWED ONLY — PASS |

*No row above is "actually tested and PASS" in the sense of a live interactive session, with one exception: BUG-004 was manually runtime-verified by the user in production for League Admin, Captain, and Normal Player (noted in Fixed bugs). Everything else, Global Admin included, is a traced-code-path result only — this remote environment has no Firebase credentials, so those roles could not be signed in and driven live. See the methodology note at the top of this file.*

## Showcase readiness

- Core functionality: PASS (code-reviewed)
- Showcase dataset: PASS (previously verified; single division/season, so BUG-001 does not manifest)
- Captain journey: PASS (code-reviewed only — see Role coverage)
- Normal player journey: PASS (code-reviewed only — see Role coverage)
- League admin journey: PASS (code-reviewed; BUG-001 dormant, BUG-002/BUG-003 non-blocking follow-ups; BUG-004 fixed, deployed, and user-verified)
- Global admin journey: **FIXED (BUG-005), not yet deployed.** Code-reviewed only, not runtime-verified — a PR is open but not merged or deployed. Once deployed, the named showcase persona will route to `/admin` on login, with a tab, header badge, and "Global Admin" account-menu label all present. `admin.tsx` will still only offer "Set up your league" once there (the pre-existing, out-of-scope Existing Limitation, unchanged by this fix) — that is expected and documented, not a defect.
- Result submission: PASS (code-reviewed)
- Result confirmation: PASS (code-reviewed; confirmed automatic/backend-driven, not a missing captain feature)
- Dispute handling: PASS (code-reviewed, both League Admin and Captain-side reconcile flow)
- Standings: PASS (PR #16 verified on `origin/main` and in production; correct for all three roles)
- Player statistics: PASS (code-reviewed)
- Team/player profiles: PASS (code-reviewed)
- Production deployment: PASS. BUG-004 merged (PR #17) and deployed to production Hosting (run `34330725367`, Hosting-only, confirmed). Manually runtime-verified by the user for League Admin, Captain, and Normal Player.

**Overall recommendation: READY FOR SHOWCASE for League Admin, Captain, and Normal Player** — no P0s; BUG-001 dormant, BUG-002/BUG-003 non-blocking follow-ups still open; BUG-004 fixed, deployed, and user-verified. **The Global Admin persona's fix (BUG-005) is code-complete and checks-passing but NOT yet merged or deployed** — production still has the old behavior until the open PR is reviewed, merged, and a Hosting deploy is run (same process as BUG-004). Once deployed: `showcase.globaladmin@chalkie.test` will route to `/admin` on login with a visible tab/badge/menu label; `admin.tsx` will still only offer "Set up your league" (the pre-existing, out-of-scope Existing Limitation) — that remains expected, not a defect. Do not treat Global Admin as demo-ready until this PR is merged and deployed and BUG-005 is runtime-verified the same way BUG-004 was.
