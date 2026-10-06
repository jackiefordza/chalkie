# Pilot Admin Seed (staging only, temporary)

A standalone Admin SDK tool that creates **one** temporary, clearly
staging-only league-admin account in the `chalkie-app-staging` Firebase
project, so the admin dispute-resolution screen (`admin-dispute.tsx`) can be
tested against the real Captain A / Captain B pilot data on fixture
`bk-d2-w01-2v1` (Division 2, Week 1, 2026-10-14).

**This is a production-capable tool, pointed at staging only.** It
authenticates with a real Firebase Admin SDK service-account credential and
bypasses Firestore security rules entirely. Read this whole file before
running anything.

**Run `scripts/real-season-import-staging` first.** This script never
creates the league itself — it only onboards an admin account onto a league
that import already created, correcting the `adminUserId` placeholder that
script leaves pending (see **Why this is needed** below).

## Why this is needed

`firestore.rules` deliberately makes `isLeagueAdmin`/`isGlobalAdmin`
**ungrantable through any client write path** — every signup/self-update
rule forces them unchanged or `false` (see `firestore.rules`'s `users`
rules). The only way a real account ever becomes a league admin is a manual
Admin-SDK write, same mechanism `scripts/showcase-seed`'s own
`seedAdminPersonas` uses for its showcase league-admin persona. This script
is that same one-time grant, scoped to exactly one temporary pilot account
and exactly one league.

It also corrects `leagues/bedford-kempston-district.adminUserId`, which
`scripts/real-season-import-staging` deliberately leaves as the literal
placeholder string `PENDING_REAL_ADMIN_ACCOUNT` (a required, non-nullable
field in the real schema — `mobile/src/types/index.ts`'s `League`) until a
real admin account exists to put there.

## What this creates

- **One Auth user + `users/{uid}` doc**: `pilot.admin@chalkie.test`,
  `isLeagueAdmin: true`, `leagueId: 'bedford-kempston-district'`,
  `isGlobalAdmin: false` (deliberately league-scoped, never global).
  `role` stays `'pending'` forever — this account is never a captain/VC/
  player of any team; `isLeagueAdmin` (not `role`) is what
  `assertLeagueAdmin` (`functions/src/index.ts`) and `matchPermissions.ts`'s
  `canResetMatch`/`canSignOffMatch` actually gate admin access on.
- **One field correction**: `leagues/bedford-kempston-district.adminUserId`,
  from the pending placeholder to this account's uid — only ever corrects
  that specific placeholder, never a different already-set real admin.

**Deliberately not created or changed:** any team, player, captain, match,
or dispute state. This script does not touch the dispute itself — you
create that by having both pilot captains submit conflicting scores through
the normal app flow, exactly as already tested.

## Pilot admin account

| Field | Value |
|---|---|
| Email | `pilot.admin@chalkie.test` |
| Password | `ChalkiePilotAdminTest2026!` |
| Scope | League admin for `bedford-kempston-district` only (not global) |

## Prerequisites

1. **Node.js 20+** and npm.
2. **A Firebase Admin SDK service-account key for the `chalkie-app-staging`
   project** — the same `FIREBASE_SERVICE_ACCOUNT_STAGING` credential
   already used by the other staging scripts/workflows.
3. **Never commit that JSON file.** Keep it somewhere outside this repo
   (this directory's `.gitignore` also defensively ignores common
   service-account filename patterns as a backstop).

## How credentials are supplied

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/your-service-account.json
```

The script refuses to run if this isn't set, and refuses to run if the
credential file's own `project_id` isn't exactly `chalkie-app-staging` — see
**Safety checks** below.

## Install & build

```bash
cd scripts/pilot-admin-seed
npm install
npm run build
```

## Exact seed command

```bash
node dist/seed.js --confirm-pilot-admin-seed
```

There is no other way to invoke this script. It accepts **only**
`--confirm-pilot-admin-seed`; any other argument (including anything that
looks like it's trying to specify a league ID, a project ID, or any other
target) causes it to refuse to run before touching anything.

## Safety checks

- **Project verification, three times over** — identical mechanism to the
  other staging scripts: the credential file's own `project_id`,
  `initializeApp()`'s pinned `projectId` option, and the live resolved app's
  project ID must all equal `chalkie-app-staging`. Any mismatch throws
  before any Firestore or Auth call.
- **A write guard on every single Firestore write** — every write goes
  through `safeSet` in `src/firebaseAdmin.ts`, which checks the target
  collection/document ID against an allowlist of exactly: the one uid
  resolved from the one fixed admin email (`users`), and
  `leagues/bedford-kempston-district` (`leagues`) — nothing else, ever. No
  `teams`/`players`/`matches` access exists in this script's allowlist at
  all.
- **Explicit confirmation required** — `--confirm-pilot-admin-seed` must be
  passed; omit it and the script refuses to run.
- **No configurable target** — the league ID, email, and password are all
  compile-time constants in `src/constants.ts`. Never read from argv, an
  environment variable, or the currently-authenticated user.
- **Idempotent** — re-running finds the existing Auth user/doc by email and
  never resets `createdAt`; the league-doc correction only ever fires while
  `adminUserId` is still the pending placeholder.
- **A loud pre-flight banner** before anything happens, naming the target
  project, league, and account; a verification report at the end, never a
  bare "it worked."

## Cleaning this account up afterward

This account is explicitly temporary — once admin-dispute-resolution
testing is done, remove it by hand in the Firebase Console (the same
manual-Console-only mechanism that granted it in the first place):

1. **Firebase Console → Authentication**: delete the
   `pilot.admin@chalkie.test` user.
2. **Firebase Console → Firestore**: delete the `users/{that uid}` document.
3. **`leagues/bedford-kempston-district.adminUserId`**: set it to a real,
   permanent admin account's uid once one exists (or back to
   `PENDING_REAL_ADMIN_ACCOUNT` if testing continues without one) — this
   script will never touch it again on its own once it's past the
   placeholder.

No script in this repo deletes this account automatically — deleting Auth
users/admin grants is exactly the kind of irreversible action the write-guard
model in every one of these scripts is built to make deliberate, not
automatic.
