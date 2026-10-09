# Pilot Captains Seed (staging only)

A standalone Admin SDK tool that creates **placeholder** captain accounts
and roster players for exactly **two** real Division 2 teams — Oakley
Sports Club and Burnaby Arms C — in the `chalkie-app-staging` Firebase
project, for the Captain A / Captain B pilot smoke test on fixture
`bk-d2-w01-2v1` (Division 2, Week 1, 2026-10-14).

**This is a production-capable tool, pointed at staging only.** It
authenticates with a real Firebase Admin SDK service-account credential
and bypasses Firestore security rules entirely. Read this whole file
before running anything.

**Run `scripts/real-season-import-staging` first.** This script never
creates a league, season, division, team, or match itself — it only links
captain accounts and roster players onto teams that import already
created. Running this before that import will fail its own checks.

## Why these fields, specifically

Before writing this script, the deployed `firestore.rules` and
`mobile/src/types/index.ts`/`authStore.ts` were read directly (not
assumed from `scripts/showcase-seed` alone) to confirm exactly what makes
an account "recognised as a captain" by the real app:

- Match-sheet submission permission is gated by `users/{uid}.teamId` and
  `users/{uid}.role` (`firestore.rules`'s `submissions` rule:
  `me().teamId == submittedByTeamId`, `isCaptainOrVC()`) — **not** by
  `teams.captainUserId` directly.
- `teams/{teamId}.captainUserId` is what the rest of the app's UI (e.g.
  `captains.tsx`, admin screens) uses to identify/display "who is the
  captain."
- A captain is always also a player: `users/{uid}.playerId` links to a
  `players/{id}` doc with `claimedByUserId` set to that same uid.

This script sets all three, and its own verification report (printed at
the end of every run) re-reads them back from Firestore to prove it,
rather than assuming the write succeeded.

## What this creates

- **5 placeholder players per team** (`Oakley Pilot Player 1`–`5`,
  `Burnaby C Pilot Player 1`–`5`) — enough to fill all 7 games of a real
  match sheet (5 singles + 2 pairs, reusing players from the 5-person
  squad).
- **2 captain accounts**, one per team — a real linked Firebase Auth user
  + `users/{uid}` doc (`role: 'captain'`) + a claimed `players/{id}` doc +
  `teams/{teamId}.captainUserId` set to that uid.

**Deliberately not created:** a vice-captain, any other team's accounts,
an admin account, or anything on the match document itself — this script
never writes to `matches/` at all. The match is left exactly as
`scripts/real-season-import-staging` created it (`status: 'scheduled'`),
so the real captain UI's own submission flow is what you're testing next,
not something this script already did for you.

## Pilot accounts

| Team | Email | Role |
|---|---|---|
| Oakley Sports Club | `pilot.captain.oakley@chalkie.test` | Captain |
| Burnaby Arms C | `pilot.captain.burnabyc@chalkie.test` | Captain |

### Getting the password

**No password is hard-coded in this repo, even a throwaway test one.**
`src/seedCore.ts` generates one random password per run with
`crypto.randomBytes`, shared by whichever of the two captain accounts
above are actually created during that run, and `seed.ts` prints it
**once**, to that run's own console output — it is never written to
Firestore, a file, or any source file in this tree.

- Running via the `staging-pilot-seed.yml` workflow: open the **"Seed
  pilot captain accounts..."** step's log for that run — the password is
  printed there, inside a clearly marked banner.
- Running locally: it prints directly to your terminal.

Re-running this script once both accounts already exist does **not**
reprint or change either password — it leaves them untouched and says so
instead.

> **Note on this script's history:** earlier versions of this file
> committed a fixed password (`ChalkiePilotTest2026!`) directly in
> `src/constants.ts`, and the two live pilot captain accounts in
> `chalkie-app-staging` were created under that password before this
> change. This script never resets an existing account's password, so
> those two accounts still use that original value today — this change
> only affects accounts created from now on. If you want those two
> rotated onto a freshly generated password, that needs a deliberate,
> separate step (e.g. Firebase Console → reset password), not a re-run of
> this script.

#### If you lose the password

This script never stores it, so if you didn't copy it from the run output:

1. **Firebase Console → Authentication → (the captain's email) → Reset
   password**, and set a new one by hand, or
2. Delete that Auth user and their `users/{uid}` Firestore doc, then
   re-run this script — it will create a fresh account with a freshly
   generated password (and re-link the same placeholder player/team, since
   those are keyed by fixed, deterministic IDs, not by the uid).

## Prerequisites

1. **Node.js 20+** and npm.
2. **A Firebase Admin SDK service-account key for the `chalkie-app-staging`
   project** — the same `FIREBASE_SERVICE_ACCOUNT_STAGING` credential
   already used by `.github/workflows/deploy-firebase-staging.yml`.
3. **Never commit that JSON file.** Keep it somewhere outside this repo
   (this directory's `.gitignore` also defensively ignores common
   service-account filename patterns as a backstop).

## How credentials are supplied

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/your-service-account.json
```

The script refuses to run if this isn't set, and refuses to run if the
credential file's own `project_id` isn't exactly `chalkie-app-staging` —
see **Safety checks** below.

## Install & build

```bash
cd scripts/pilot-captains-seed
npm install
npm run build
```

## Exact seed command

```bash
node dist/seed.js --confirm-pilot-seed
```

There is no other way to invoke this script. It accepts **only**
`--confirm-pilot-seed`; any other argument (including anything that looks
like it's trying to specify a team ID, a project ID, or any other target)
causes it to refuse to run before touching anything.

## Safety checks

- **Project verification, three times over** — identical mechanism to
  `scripts/showcase-seed`/`scripts/real-season-import-staging`: the
  credential file's own `project_id`, `initializeApp()`'s pinned
  `projectId` option, and the live resolved app's project ID must all
  equal `chalkie-app-staging`. Any mismatch throws before any Firestore or
  Auth call.
- **A write guard on every single Firestore write** — every write goes
  through `safeSet` in `src/firebaseAdmin.ts`, which checks the target
  collection/document ID against an allowlist of exactly: the two pilot
  teams' IDs (`teams`), the 10 pilot player IDs (`players`), and the uids
  resolved from the two fixed pilot emails (`users`) — nothing else, ever.
  No `leagues`/`seasons`/`divisions`/`matches` access exists in this
  script's allowlist at all.
- **Explicit confirmation required** — `--confirm-pilot-seed` must be
  passed; omit it and the script refuses to run.
- **No configurable target** — team IDs, emails, and player names are all
  compile-time constants in `src/constants.ts`. Never read from argv, an
  environment variable, or the currently-authenticated user.
- **Idempotent** — every document uses a fixed, deterministic ID. Running
  the seed more than once never resets an already-claimed player or
  rewrites an unchanged `claimedAt`.
- **A loud pre-flight banner** before anything happens, naming the target
  project, fixture, and teams; a verification report at the end, never a
  bare "it worked."
