# Chalkie Showcase Bug Bash

## Current status

Date: 2026-09-09
Current production commit: `8e56219873f1c506812f3a88cb4a8e3631cf2465` (main — includes PR #16, Hosting-deployed and verified)
Overall status: League Admin walkthrough (session 1) complete. One P1 (dormant, not reachable with the current single-division showcase dataset) and two P2s found. No P0s. No code changes made this session — everything below is pending approval.

**Methodology note:** this session's testing was a systematic static code walkthrough (reading the actual routed screens against `origin/main`) rather than interactive device/browser testing — this remote environment has no Firebase credentials and no way to sign in as a live League Admin against the real showcase data. Every finding below is a traced code-path defect, not an observed runtime failure, except where noted otherwise. The working branch (`claude/chalkie-audit-prep-5o84ya`) was found to be behind `origin/main` (missing PRs #14/#15/#16); every file below was diff-checked against `origin/main` before being trusted, and findings reflect the **current production code**, not the stale branch.

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

## Open bugs

| ID | Priority | Area | Issue | Status |
|---|---|---|---|---|
| BUG-001 | P1 (dormant — see notes) | Standings navigation | Mobile League Admin "Table" button ignores which division was tapped; always opens the tab-bar Standings screen with no division context | Investigated — fix proposed, not implemented |
| BUG-002 | P2 | Fixtures | "Delete all & regenerate" has no status guard, unlike the single-fixture delete path | Investigated — fix proposed, not implemented |
| BUG-003 | P2 | Multiple admin screens | Several `onSnapshot` listeners have no error callback, so a permission/rules failure fails silently into "all caught up" / empty states instead of a visible error | Investigated — fix proposed, not implemented |

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
| Captain | *(not yet tested this session)* | Not started |
| Normal Player | *(not yet tested this session)* | Not started |

## Showcase readiness

- Core functionality: PASS
- Showcase dataset: PASS (previously verified; single division/season, so BUG-001 does not manifest)
- Captain journey: Not tested this session
- Normal player journey: Not tested this session
- League admin journey: PASS (with BUG-001 dormant, BUG-002 and BUG-003 as non-blocking follow-ups)
- Result submission: PASS (code walkthrough, captain-side entry not independently re-tested this session)
- Result confirmation: PASS
- Dispute handling: PASS
- Standings: PASS (PR #16 verified on `origin/main` and in production)
- Player statistics: PASS
- Team/player profiles: PASS
- Production deployment: PASS (Hosting redeployed from `8e56219`, verified Hosting-only)

**Overall recommendation: READY FOR SHOWCASE** — no P0s, no reachable P1s against the actual showcase dataset. Captain and Normal Player journeys still need a dedicated pass before full sign-off; BUG-001/002/003 are all follow-up items, not blockers.
