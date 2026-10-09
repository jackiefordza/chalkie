# Pilot Admin VC Link (staging only)

A standalone Admin SDK tool that links the **existing** `pilot.admin@chalkie.test`
staging admin account (created by `scripts/pilot-admin-seed`) to a new claimed
player record on **Burnaby Arms B** (Division 3) as vice-captain, in the
`chalkie-app-staging` Firebase project only.

**This creates no new Auth account, no new team, and no new league/season/
division.** It changes no code — not `firestore.rules`, not `mobile/src/types/
index.ts`, not any permission check. It is a pure data link, proving that
Chalkie's existing data model already supports one account being both a
league admin and a team's vice-captain (see the architectural review that
preceded this script — `isLeagueAdmin` and `role`/`teamId` are independent
fields everywhere in the codebase; nothing needed to change).

**This is a production-capable tool, pointed at staging only.** It
authenticates with a real Firebase Admin SDK service-account credential and
bypasses Firestore security rules entirely. Read this whole file before
running anything.

**Run these first, in order:**
1. `scripts/real-season-import-staging` — creates `teams/bk-d3-team-2`
   (Burnaby Arms B, Division 3).
2. `scripts/pilot-admin-seed` — creates the `pilot.admin@chalkie.test` Auth
   account with `isLeagueAdmin: true`.

This script refuses to run if either prerequisite is missing, rather than
creating them itself.

## What this changes

On the **existing** `pilot.admin@chalkie.test` account (`users/{uid}`):

| Field | Before | After |
|---|---|---|
| `isLeagueAdmin` | `true` | `true` (untouched) |
| `isGlobalAdmin` | `false` | `false` (untouched) |
| `leagueId` | `bedford-kempston-district` | unchanged |
| `role` | `'pending'` | `'viceCaptain'` |
| `teamId` | `null` | `bk-d3-team-2` (Burnaby Arms B) |
| `divisionId` | `null` | `bedford-kempston-winter-2026-27-division-3` |
| `seasonId` | `null` | `bedford-kempston-winter-2026-27` |
| `playerId` | `null` | the new claimed player doc below |

Plus:
- **One new `players/{id}` doc**, claimed by this account, on Burnaby Arms B.
- **`teams/bk-d3-team-2.viceCaptainUserId`** set to this account's uid.

**Deliberately not touched:** `firestore.rules`, `mobile/src/types/index.ts`,
any permission-check function, any other team/player/match, and this
account's own `isLeagueAdmin`/`isGlobalAdmin`/`leagueId`.

## Why this is safe to self-link

Nothing in `firestore.rules` or the mobile app's permission checks treats
`isLeagueAdmin` and `role`/`teamId` as mutually exclusive — `isAdmin()`/
`isAdminFor()` only ever read `isLeagueAdmin`; `isCaptainOrVC()` only ever
reads `role`. The UI already has this layered-not-exclusive case built in
(`TabBar.tsx`: *"an admin can also be a captain or player of a team in the
same league, so the admin tab is layered on top of whatever role-based tabs
apply"*). This script simply sets the fields the existing model already
supports — see the architectural review that preceded it for the full trace.

**One genuine governance note, not a technical blocker:** because
`isLeagueAdmin` carries no recusal logic anywhere in this codebase, this
account will be able to resolve disputes, reset results, and admin-override
matches involving its own team (Burnaby Arms B) — it holds both "player in
the dispute" and "referee of the dispute" capability simultaneously. Fine
for pilot testing; worth deciding deliberately before this becomes a real
production account.

## Prerequisites

1. **Node.js 20+** and npm.
2. **A Firebase Admin SDK service-account key for the `chalkie-app-staging`
   project** — the same `FIREBASE_SERVICE_ACCOUNT_STAGING` credential
   already used by the other staging scripts/workflows.
3. **Never commit that JSON file.**

## Install & build

```bash
cd scripts/pilot-admin-vc-link
npm install
npm run build
```

## Exact command

```bash
node dist/link.js --confirm-pilot-admin-vc-link
```

Accepts **only** `--confirm-pilot-admin-vc-link`; any other argument causes
it to refuse to run before touching anything.

## Safety checks

- **Project verification, three times over** — identical mechanism to every
  other staging script.
- **Never creates an Auth account** — looks up `pilot.admin@chalkie.test` by
  email; if it doesn't exist, refuses to run rather than creating one.
- **Never grants admin status** — refuses to run unless the account already
  has `isLeagueAdmin: true` and the expected `leagueId`.
- **Never reassigns an existing VC or an already-claimed player** — refuses
  to run if `teams/bk-d3-team-2.viceCaptainUserId` or the one player doc is
  already set to a *different* account.
- **A write guard on every single Firestore write** — `safeSet` in
  `src/firebaseAdmin.ts` allowlists exactly: the one resolved admin uid
  (`users`), `teams/bk-d3-team-2` (`teams`), and one deterministic player ID
  (`players`) — nothing else, ever.
- **Explicit confirmation required** — `--confirm-pilot-admin-vc-link` must
  be passed.
- **Idempotent** — safe to re-run; already-correct fields are left alone.
- **A loud pre-flight banner**; a verification report at the end that
  re-reads every field from Firestore/Auth, never a bare "it worked."

## Undoing this link

This is a data change, not a schema change, so undoing it is also just a
data change (not provided as a script — deliberate, same as every other
teardown step in this project):

1. `teams/bk-d3-team-2`: clear `viceCaptainUserId` back to `null`.
2. `players/pilot-admin-vc-bk-d3-team-2`: delete the doc.
3. `users/{uid}`: set `role: 'pending'`, `teamId`/`divisionId`/`seasonId`/
   `playerId` back to `null`. Leave `isLeagueAdmin`/`isGlobalAdmin`/
   `leagueId` exactly as they are — this script never touched them.
