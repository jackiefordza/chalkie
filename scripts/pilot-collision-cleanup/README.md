# Pilot Collision Cleanup (staging only)

A standalone Admin SDK tool that retires exactly **three** pilot/test
accounts' team/role access, ahead of onboarding the real Division 2/3
captains via the new Captain Invite flow, in `chalkie-app-staging` only.

**This never deletes an Auth account, a league, a season, a division, a
fixture, or any match-result data.** It only clears the specific fields
that let an account be *recognised* as a team's captain/VC, and (for one
specific artifact) deletes one player doc that was never real roster data.

## Why this is needed

Three real teams already have a pilot/test account sitting in the exact
captain/VC slot a real invite would target:

| Team | Slot | Occupied by |
|---|---|---|
| Oakley Sports Club (`bk-d2-team-2`) | Captain | `pilot.captain.oakley@chalkie.test` |
| Burnaby Arms C (`bk-d2-team-1`) | Captain | `pilot.captain.burnabyc@chalkie.test` |
| Burnaby Arms B (`bk-d3-team-2`) | Vice-Captain | `pilot.admin@chalkie.test` |

Simply overwriting `teams.captainUserId`/`viceCaptainUserId` when a real
captain accepts their invite would **not** be enough: match-sheet
submission is authorized by the *submitting user's own*
`users/{uid}.teamId` + `role` (see `firestore.rules`' `isCaptainOrVC()`),
not by `teams.captainUserId`. Left alone, the old pilot account would
still be able to submit results for that team after a real captain takes
over the `teams` doc's pointer — two accounts both nominally able to act
for the same team. This script closes that gap *before* any real invite
is generated.

## What this does, per account

- **`pilot.captain.oakley@chalkie.test`** / **`pilot.captain.burnabyc@chalkie.test`**:
  `users/{uid}` reset to `role:'pending'`, `teamId:null`, `divisionId:null`,
  `seasonId:null`, `playerId:null`, `leagueId:null` — the same shape
  `authStore.ts`'s `register()` produces for a fresh signup. The matching
  `teams/{id}.captainUserId` is cleared to `null`.
- **`pilot.admin@chalkie.test`**: the same reset for its VC-specific
  fields (`role`/`teamId`/`divisionId`/`seasonId`/`playerId`) — but
  **`isLeagueAdmin`, `isGlobalAdmin`, and `leagueId` are never touched**;
  this account remains the real league admin test account throughout.
  `teams/bk-d3-team-2.viceCaptainUserId` is cleared to `null`.
  Also **deletes** `players/pilot-admin-vc-bk-d3-team-2` — the one bespoke
  player doc `scripts/pilot-admin-vc-link` created purely as an artifact of
  that link (not real roster data, not the pilot-captains-seed placeholder
  convention, not referenced by any match).

**Deliberately not touched:** the Oakley/Burnaby C pilot captains' own
5-placeholder-per-team roster players (from `scripts/pilot-captains-seed`)
are left exactly as they are — this script only clears the *user accounts'*
team/role recognition, not the placeholder roster data those two teams
already have for the ongoing match-result pilot.

## Prerequisites

1. **Node.js 20+** and npm.
2. **A Firebase Admin SDK service-account key for the `chalkie-app-staging`
   project** — the same `FIREBASE_SERVICE_ACCOUNT_STAGING` credential
   already used by the other staging scripts/workflows.
3. **Never commit that JSON file.**

## Install & build

```bash
cd scripts/pilot-collision-cleanup
npm install
npm run build
```

## Exact command

```bash
node dist/cleanup.js --confirm-pilot-collision-cleanup
```

Accepts **only** `--confirm-pilot-collision-cleanup`; any other argument
causes it to refuse to run before touching anything.

## Safety checks

- **Project verification, three times over** — identical mechanism to
  every other staging script.
- **A write guard on every single Firestore write/delete** — allowlisted
  to exactly the three resolved pilot uids (`users`), the three specific
  team IDs (`teams`), and the one specific player ID (`players`) —
  nothing else, ever.
- **Refuses to clear a team slot occupied by anyone other than the
  expected pilot uid** — if a real captain has already been linked some
  other way, this script stops rather than overwriting them.
- **Refuses to delete the Burnaby Arms B player doc unless it's still
  claimed by the admin uid** — the same "don't touch it if it's not what
  I think it is" guard.
- **Idempotent** — safe to re-run; already-retired accounts/slots are
  left alone and logged as such, not re-written.
- **Looks up each account by email at runtime** — never hardcodes a uid —
  and skips gracefully (with a log line) if an account doesn't exist at
  all, rather than failing.
- **A loud pre-flight banner**; a verification report at the end that
  re-reads every field from Firestore, never a bare "it worked."
