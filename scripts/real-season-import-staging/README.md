# Real Season Import (staging) — Bedford & Kempston District Darts League (Winter 2026/27)

**STAGING-ONLY VARIANT.** This directory is a copy of PR #36's
`scripts/real-season-import`, with exactly one change — the target project
is `chalkie-app-staging`, not `chalkie-app`. Everything else (dataset,
validation, importer logic, write-guard allowlist) is unchanged from the
reviewed original. See `src/constants.ts`'s `EXPECTED_PROJECT_ID`.

A standalone Admin SDK tool that imports the **real** Division 2 and
Division 3 season into the `chalkie-app-staging` Firebase project, from a
canonical dataset transcribed directly from the official league fixture
poster.

**This is a production-capable tool, pointed at staging.** It authenticates
with a real Firebase Admin SDK service-account credential and bypasses
Firestore security rules entirely. Read this whole file before running
anything.

It is completely separate from the mobile app and Cloud Functions, and
from the `darts-fixture-generator` project — nothing here is imported by
`mobile/` or `functions/`, and this tool does not call, read from, or
depend on the fixture-generator's database, API, or CSV export in any way.
It never touches whichever league a signed-in user happens to belong to —
it only ever reads or writes a fixed set of IDs, all scoped under
`leagueId: "bedford-kempston-district"`.

## Where the data comes from

The compact source data lives entirely in `src/constants.ts`:

- 16 real team names (8 per division), in the poster's own official
  numbering
- the poster's single shared 7-week team-number pairing matrix (weeks 1-7;
  weeks 8-14 are mechanically derived by reversing home/away, per the
  poster's own stated rule — never separately transcribed)
- the poster's 14-week date calendar

`src/dataset.ts` expands these into the full 112-fixture canonical dataset
(`buildCanonicalDataset()`) — deterministically, with no hand-typed
112-row fixture table anywhere, to minimize transcription risk. Every
fixture this produces was cross-checked against the official poster image
directly before this script was written.

**The `darts-fixture-generator` project is NOT used as a data source.**
An earlier investigation found that its own recorded generation seed
produces a schedule that does **not** match the official poster — the
poster is the sole authority here. See the project's own audit reports for
the full reconciliation.

**Venue note:** the poster provides no separate venue field. Team name is
used as the venue name (`Team.address`), following the pub-league
convention the poster's own team names confirm (e.g. "Burnaby Arms A/B/C"
sharing one physical venue across three divisions) — this is an inference,
not printed data, and is flagged as such in the accompanying audit report.

## What this creates

- **1 league** — Bedford and Kempston District Darts League
  (`bedford-kempston-district`)
- **1 season** — Winter 2026-27 (`bedford-kempston-winter-2026-27`)
- **2 divisions** — Division 2, Division 3
- **16 teams** (8 per division)
- **112 fixtures** (56 per division, a full double round-robin, 14 weeks)

**Deliberately not created**: any player, captain, vice-captain, or user
account. That's a separate, later step — see the accompanying audit
report's onboarding section.

## Prerequisites

1. **Node.js 20+** and npm.
2. **A Firebase Admin SDK service-account key for the `chalkie-app-staging`
   project.** Reuse an existing one if you have access (the same
   `FIREBASE_SERVICE_ACCOUNT_STAGING` credential already used by
   `.github/workflows/deploy-firebase-staging.yml`), or generate a fresh one:
   Firebase Console → chalkie-app-staging → Project Settings → Service
   Accounts → **Generate new private key**.
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
cd scripts/real-season-import
npm install
npm run build
```

## Exact commands

```bash
# Dry run (default) — validates the dataset and prints the exact
# create/update/skip plan; writes NOTHING.
node dist/import.js

# Same as above, explicit.
node dist/import.js --dry-run

# The real thing — writes League/Season/Division 2/Division 3/16 teams/112
# fixtures to production. Only after reviewing a dry run first.
node dist/import.js --confirm
```

There is no other way to invoke this script. It accepts **only**
`--confirm` and `--dry-run`; any other argument (including anything that
looks like it's trying to specify a league ID, a project ID, or any other
target) causes it to refuse to run before touching anything.

## Safety checks

- **Project verification, three times over** — identical pattern to
  `scripts/showcase-seed`: the credential file's own `project_id` is
  checked before Admin SDK init, `projectId` is pinned to a hard-coded
  constant at init (never from the credential file, env, or argv), and the
  live initialized app's resolved project ID is checked again. Any
  mismatch throws immediately, before any Firestore call.
- **Dataset validation runs before every import, dry run or real** — 17
  structural checks (team/division/fixture counts, one-fixture-per-team-
  per-week, every pair meets exactly twice with home/away reversed, no
  duplicates, no cross-division fixtures, dates match the official
  calendar). A failing validation aborts before any Firestore call.
- **A write guard on every single Firestore write** — every write goes
  through `guardedFirestore()` in `src/firebaseAdmin.ts`, which checks the
  target collection/document ID against an allowlist of exactly this
  dataset's own fixed ID patterns (`bedford-kempston-district`,
  `bedford-kempston-winter-2026-27`, `bedford-kempston-winter-2026-27-
  division-2`/`-3`, `bk-d[23]-team-[1-8]`, `bk-d[23]-w##-#v#`) before
  allowing it. Anything else — a showcase ID, a Division 1 or 4 ID, a
  `users/` write (this script never touches `users/` at all) — throws and
  aborts that write immediately.
- **Default is always a dry run.** `--confirm` is required for any write
  to actually happen.
- **A loud pre-flight banner** naming the target project, league, season,
  and mode before anything happens.

## Idempotency — running the import more than once

Every document uses a fixed, deterministic ID. Re-running is safe and
intentionally does **not** re-assert everything on every run — see
`src/importer.ts`'s top comment for the full reasoning. In short:

- **Structural/identity fields** (name, leagueId/seasonId/divisionId
  relationships) are reconciled on every run.
- **Fields the app or a human admin might reasonably change afterward**
  (`captainUserId`, `viceCaptainUserId`, `address`, `venuePhone`,
  `League.adminUserId`, `createdAt`) are written **only at creation** and
  never touched again — so re-running this importer can never silently
  undo a real captain assignment or a manually-corrected venue address.
- **A match that has moved past `'scheduled'`** (a result has been
  submitted/confirmed/disputed against it) is **never touched again by
  this importer**, full stop — not even to "fix" a structural field —
  reported separately as `skippedPlayed`, regardless of how many times the
  importer is re-run.

This was verified two ways (see **Testing performed** below): against an
in-memory fake with zero network access, and against a genuinely live
Firestore emulator using the real production code path.

`League.adminUserId` is written as the placeholder
`PENDING_REAL_ADMIN_ACCOUNT` at creation, because no real admin account
exists yet at this stage — this field is not read/enforced anywhere in
Chalkie's rules or Cloud Functions (confirmed by the accompanying audit;
real permission checks go through `users/{uid}.isLeagueAdmin`), so this is
safe to leave as a placeholder until a real admin account is onboarded,
at which point it can be corrected with a single manual field update.

## Testing performed

- **`npm run offline-checks`** (`src/offlineChecks.ts`) — zero network, no
  Firebase project, no credentials, no emulator. Runs against
  `src/fakeFirestore.ts`, an in-memory stand-in implementing the same
  `FirestoreLike` interface the real importer uses. Proves: dataset
  validation, dry-run counts against an empty target, a real run's counts,
  full idempotency across a second real run and a third dry run, the
  write-guard's refusal of 10 different out-of-scope targets (showcase
  IDs, Division 1/4 IDs, a malformed-looking team ID, `users/`), that a
  legitimate write still succeeds through the same guard, that a real
  captain assignment survives a re-import, and that an already-played
  match is never reset.
- **Live Firestore emulator** — the exact same checks re-run against a
  genuinely live `firebase emulators:start --only firestore` instance,
  through the real `import.ts` CLI and `initializeRealAdminApp()` code
  path (not the fake). This caught one real bug the offline fake couldn't:
  real Firestore returns match dates as `Timestamp` objects, not plain JS
  `Date`s, which broke the idempotency comparison until fixed. All checks
  pass against both backends.

## Not implemented here

Players, captains, and vice-captains — a separate, later step, once real
account onboarding is ready (see the accompanying audit report). No
Firestore rules, Cloud Functions, or mobile app code were touched to build
this.
