# Chalkie Showcase Seed System

A standalone Admin SDK tool that creates (and can cleanly remove) a fully
isolated, realistic demo dataset — the **"Alderbrook & District Darts
League"** — inside the live `chalkie-app` Firebase project, for the
16 September 2026 showcase.

**This is a production-capable tool.** It authenticates with a real
Firebase Admin SDK service-account credential and bypasses Firestore
security rules entirely. Read this whole file before running anything.

It is completely separate from the mobile app and Cloud Functions: nothing
here is imported by `mobile/` or `functions/`, and nothing in `mobile/` or
`functions/` was changed to build this. It never touches whichever league a
signed-in user happens to belong to — it only ever reads or writes a fixed
set of IDs, all scoped under `leagueId: "showcase-league"`.

## What this creates

- **1 league** — Alderbrook & District Darts League (`showcase-league`)
- **1 season** — 2026/27 Winter Season (`showcase-season`)
- **1 division** — Division One (`showcase-division`)
- **8 teams**, 6 players each (**48 players** total)
- **8 captains + 8 vice-captains** (one of each per team, real linked accounts)
- **1 normal player** account (claims a specific unclaimed roster slot)
- **1 league admin** account, scoped to `showcase-league`
- **1 global admin** account, deliberately unscoped to any league
- **56 fixtures** (a full double round-robin across the 8 teams)
- **~20 confirmed matches**, submitted and confirmed through the real
  `onSubmissionWrite` → `onMatchConfirmed` Cloud Function pipeline —
  realistic 180s and high checkouts included, standings and player stats
  genuinely computed by the app's own backend, not fabricated
- **1 match sitting in `awaiting_confirmation`** (one team has submitted, the
  other hasn't)
- **1 genuinely disputed match** (two submissions that agree on 6 of 7
  games and deliberately disagree on Game 3)
- The remaining fixtures left as ordinary `scheduled` upcoming matches

See `SHOWCASE_DATASET_DESIGN.md` (sent separately, in the design phase of
this project) for the full reasoning behind every one of these numbers and
names.

## Prerequisites

1. **Node.js 20+** and npm.
2. **A Firebase Admin SDK service-account key for the `chalkie-app`
   project.** This is the *same kind* of credential already used elsewhere
   in this repo — `scripts/deploy_rules.py` and
   `.github/workflows/deploy-firebase.yml` both use one already. Reuse an
   existing one if you have access, or generate a fresh one: Firebase
   Console → chalkie-app → Project Settings → Service Accounts → **Generate
   new private key**. This downloads a JSON file.
3. **Never commit that JSON file.** Keep it somewhere outside this repo
   (or anywhere covered by this directory's `.gitignore`, which also
   defensively ignores common service-account filename patterns as a
   backstop).

## How credentials are supplied

Set the standard Google Application Default Credentials environment
variable to the path of your downloaded key, then run the commands below
from a normal terminal:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/your-service-account.json
```

The script refuses to run if this isn't set, and refuses to run if the
credential file's own `project_id` isn't exactly `chalkie-app` — see
**Safety checks** below.

## Install & build

```bash
cd scripts/showcase-seed
npm install
npm run build
```

## Exact seed command

```bash
node dist/seed.js --confirm-showcase
```

## Exact reset command

```bash
node dist/seed.js --reset --confirm-showcase --confirm-reset
```

Both `--confirm-showcase` and `--confirm-reset` are required together for a
reset — see **Safety checks**.

There is no other way to invoke this script. It accepts **only** the three
flags above (`--confirm-showcase`, `--confirm-reset`, `--reset`); any other
argument (including anything that looks like it's trying to specify a
league ID, a project ID, or any other target) causes it to refuse to run
before touching anything.

## Safety checks

This script is deliberately hard to run by accident or against the wrong
target:

- **Project verification, three times over**: it reads your credential
  file's own `project_id` and refuses to proceed unless it's exactly
  `chalkie-app`, *before* even initializing the Admin SDK; it then pins
  `admin.initializeApp()`'s `projectId` option to that same hard-coded
  constant (never taken from the credential file, an env var, or a CLI
  flag); then it checks the *live, initialized app's* resolved project ID
  matches too. Any mismatch at any of these three points throws
  immediately, with no Firestore/Auth call ever attempted.
- **Explicit confirmation required**: `--confirm-showcase` is required for
  either operation; `--reset` additionally requires `--confirm-reset`. Omit
  either and the script refuses to run — this is what stops it from ever
  firing as a side effect of some other command.
- **No configurable target**: the showcase league ID (`showcase-league`) is
  a compile-time constant in `src/constants.ts`. It is never read from
  argv, an environment variable, or the currently-authenticated user. There
  is no flag that can point this script at a different league.
- **A write guard on every single Firestore write and delete**: every write
  in this codebase goes through `safeSet`/`safeDelete` in
  `src/firebaseAdmin.ts`, which checks the target collection/document ID
  against an allowlist of exactly the showcase-only ID patterns before
  allowing the write — anything else throws and aborts the whole run
  immediately. This means a bug anywhere else in this script that tried to
  write outside the showcase dataset would fail loudly, not silently
  succeed.
- **A loud pre-flight banner** before anything happens, naming the target
  project, target dataset, and operation; reset additionally prints a much
  more explicit multi-line warning listing exactly what will be deleted.

These checks were verified during implementation by deliberately triggering
each refusal path (missing confirmation flags, an unrecognized argument, no
credentials set, and a credentials file for a different project) — every
one refused cleanly before any Firebase network call was made. See the
implementation report for the exact commands used.

## Idempotency — running the seed more than once

Every document uses a fixed, deterministic ID (`showcase-league`,
`showcase-team-1`…`8`, `showcase-player-{team}-{n}`, etc.). Auth accounts
are looked up by email first, created only if missing. `createdAt`
timestamps are only set the first time a document is created, never
refreshed on a re-run.

Documents that must never be silently overwritten once real state has been
computed for them — most importantly `matches`, but also `leagues`,
`seasons`, `divisions`, `teams`, and `players` — are written with a
create-if-missing helper (`createOnce` in `src/seedCore.ts`): if the
document already exists, it is left completely untouched, whatever state
it's since reached. This is what makes re-running
`node dist/seed.js --confirm-showcase` safe even after matches have been
confirmed: an already-confirmed match's `status`/`games`/totals are never
reset back to `'scheduled'`, so the real Cloud Function pipeline's own
`if (match.status === 'confirmed') return;` guard (`onSubmissionWrite`,
`functions/src/index.ts`) is what makes re-submitting the same
(deterministic) result to it a safe no-op — not a double-confirmation, and
not a double-increment of `divisionTables`/`playerSeasonStats`. The same
applies to the awaiting-confirmation and disputed matches: their submission
content is deterministic, so writing it again reproduces the identical
state rather than depending on what happened to already exist. Running the
seed a second time on top of a fully successful first run reproduces the
exact same end state; running it on top of a *partially* successful first
run (e.g. some match confirmations timed out) safely retries only what
didn't complete.

A handful of fields legitimately get re-asserted on every run regardless —
`captainUserId`/`viceCaptainUserId` on `teams`, role/admin flags on
`users` — because they're always resolved to the same deterministic uid or
value, so re-writing them is a genuine no-op, not drift.

See `offline-checks.js` (run with `node offline-checks.js` after
`npm run build` — no Firebase, no network, pure in-memory fakes) for
automated checks covering this, the reset write-guard registration below,
and the admin-flag/`adminUserId` fixes.

## Reset — what it deletes, and in what order

Reset deletes, strictly in this order (nested data first, so nothing is
ever left orphaned):

1. Every `matches/{id}/submissions/{teamId}` document under every one of
   the 56 possible showcase match IDs (found by listing each match's actual
   submissions subcollection, not assumed).
2. `divisionTables` rows for the 8 showcase teams.
3. `playerSeasonStats` documents (queried by `seasonId == "showcase-season"`).
4. The 56 `matches` documents themselves (now safe, since their
   submissions are already gone).
5. The 48 `players`, then the 8 `teams`, then `divisions`, `seasons`, and
   finally `leagues`.
6. The 19 known showcase Firebase Auth accounts (looked up by their fixed
   `@chalkie.test` email addresses — never by a Firestore query) and their
   `users/{uid}` documents.
7. A full re-read of every collection/ID above, printing:

   ```
   SHOWCASE RESET VERIFICATION
   ===========================
   Showcase Firestore documents remaining: 0
   Showcase Auth accounts remaining: 0
   RESULT: PASS
   ```

   If anything is still found, it's listed explicitly and the result is
   `FAIL` — reset never just assumes success.

Reset **never** deletes based on a user-supplied league ID, and never
queries a collection broadly for "anything that looks like showcase data"
— every single deletion targets one of this script's own fixed,
deterministic IDs (or one of the 19 fixed emails), so it is structurally
incapable of touching any other league's data.

## Showcase accounts

All passwords: **`ChalkieShowcase2026!`**

| Persona | Email | Role |
|---|---|---|
| Normal player | `showcase.player@chalkie.test` | Player, The Red Lion (claims "Chris Reid") |
| Captain (primary demo) | `showcase.captain@chalkie.test` | Captain, The Red Lion (Martin Hayes) |
| Vice-captain (primary demo) | `showcase.vc@chalkie.test` | Vice-Captain, The Red Lion (Karen Whitfield) |
| Captains, other 7 teams | `showcase.captain.2@chalkie.test` … `showcase.captain.8@chalkie.test` | Captain |
| Vice-captains, other 7 teams | `showcase.vc.2@chalkie.test` … `showcase.vc.8@chalkie.test` | Vice-Captain |
| League admin | `showcase.leagueadmin@chalkie.test` | `isLeagueAdmin: true`, scoped to `showcase-league` |
| Global admin | `showcase.globaladmin@chalkie.test` | `isGlobalAdmin: true`, **not** scoped to any league |

Team order (index 1–8, matching the numbered emails above): The Red Lion,
The Railway Tavern, Kings Arms, The White Swan, The Miners Arms, The Ferry
Boat Inn, The Coach & Horses, The Plough.

## Admin flags — exact fields written, and the manual fallback

The league-admin and global-admin `users/{uid}` documents get these fields
written directly by this script (Admin SDK writes bypass Firestore rules,
the same way the app's own Cloud Functions do — no manual step is needed):

- League admin: `isLeagueAdmin: true`, `isGlobalAdmin: false`, `leagueId: "showcase-league"`
- Global admin: `isLeagueAdmin: false`, `isGlobalAdmin: true`, `leagueId: null`

Every other showcase persona (the 8 captains, 8 vice-captains, and the one
normal player) explicitly has `isLeagueAdmin: false, isGlobalAdmin: false`
written on their `users/{uid}` doc — matching the real signup flow
(`authStore.ts`'s `register()`) exactly, rather than leaving those fields
unset.

**If you'd rather grant these by hand instead** (e.g. you want a visible,
separately-audited moment where admin access is granted), the equivalent
manual procedure is:

1. Firebase Console → **chalkie-app** → **Authentication** → **Users** →
   find the account by email → copy its **User UID**.
2. Firebase Console → **Firestore Database** → `users` collection → find
   the document with that ID.
3. Add/edit the field `isLeagueAdmin` (boolean) `true` (league admin) or
   `isGlobalAdmin` (boolean) `true` (global admin, and leave `leagueId` as
   `null`).
4. Save. No redeploy needed.

## Expected dataset counts (what the verification report checks)

```
League: 1/1                Fixtures: 56/56
Division: 1/1               Confirmed matches: ~20/20
Season: 1/1                 Scheduled matches: ~34
Teams: 8/8                  Awaiting confirmation: 1/1
Players: 48/48               Disputed: 1/1
Captains: 8/8                Division table rows: 8/8
Vice-captains: 8/8           Player season stats: ~48
Normal player: 1/1           180s: present
League admin: 1/1            High checkouts: present
Global admin: 1/1            REAL LEAGUE TOUCHED: NO
```

The final line is either:

```
SHOWCASE DATASET READY — PASS
```

or

```
SHOWCASE DATASET VERIFICATION FAILED
```

with every failing check listed above it, never a bare "it worked."

## Determinism

Every generated match result (which 5 of each team's 6 players play a given
week, leg splits, 180s, high checkouts, and which non-special fixtures get
confirmed) is driven by a seeded pseudo-random generator (`RNG_SEED =
20260916` in `src/constants.ts`) — `seed → reset → seed again` reproduces
the same generated content. **Calendar dates are the one deliberate
exception**: they're always computed relative to *when the script is run*
(exactly like the existing `mockSeason.ts` already does), so confirmed
matches always sit in the recent past and upcoming fixtures always sit in
the near future, no matter which day you actually run this before the
16 September showcase.

## Cloud Function verification — no fixed sleeps

After writing submissions, this script polls the actual Firestore state
(re-reading the match document / relevant collections every ~1.5s, up to a
45s timeout per check) rather than sleeping a fixed number of seconds — see
`src/poll.ts`. Confirmations are processed **one match at a time**,
waiting for each to fully land before starting the next — this is
deliberate, not just cautious: `onMatchConfirmed`'s division-table position
recompute reads every team's row and writes fresh positions back in one
non-transactional read-then-write, so confirming matches concurrently risks
two recomputes racing on stale data. Sequential + polled removes that race
entirely.

## Not implemented here

This script does not modify `firestore.rules`, `functions/`,
`mobile/src/lib/testData.ts`, `mobile/src/lib/mockSeason.ts`, or any mobile
screen. No `__DEV__` admin-tools button was added. See the implementation
report for the full reasoning.
