# Production Preflight (read-only)

Checks whether the exact deterministic documents the real-season importer
(`scripts/real-season-import`) would create for **Bedford & Kempston
District Darts League, Winter 2026/27, Division 2 + Division 3** already
exist in production Firestore (`chalkie-app`), and reports enough detail to
judge whether it's safe to run that importer.

This script **never writes anything**. It exists to be run *before* the
real importer, not instead of a dry run of it.

## What it checks

- `leagues/bedford-kempston-district`
- the canonical season document
- the canonical Division 2 and Division 3 documents
- all 16 canonical team documents
- all 112 canonical match documents (fixtures)
- every other document under `leagueId == bedford-kempston-district` in
  `seasons`, `divisions`, `teams`, and `matches` — so it also surfaces
  anything **unexpected** under this league that isn't part of the
  canonical set, and any doc that reuses a canonical ID but holds
  different data (e.g. a match ID that already exists with different
  teams or a different date).

For every canonical document that already exists, it prints the fields
needed to judge safety (see the task spec this was built against) and a
per-field diff against what the importer would write — but it never prints
more than that: no unrelated document contents, no user data, no
credentials.

It ends with the exact summary block:

```
PRODUCTION PREFLIGHT
====================

League: EXISTS/MISSING
Season: EXISTS/MISSING
Division 2: EXISTS/MISSING
Division 3: EXISTS/MISSING

Teams:
X/16 exist

Fixtures:
X/112 exist

Conflicts:
0 / number

Unexpected data:
0 / number

SAFE TO IMPORT:
YES / NO
```

`SAFE TO IMPORT: YES` is only printed when there are zero conflicts (an
existing canonical document whose data differs from what the importer
would write) and zero unexpected documents under this league. When it
prints `YES`, it also prints the literal line `No production data was
modified by this preflight.` — because none was; this script has no code
path capable of doing so (see below).

## Why this is safe

Two independent things make this read-only, not just documented as such:

**1. Structural proof, not a claim.** Run:

```sh
./prove-read-only.sh
```

which checks (a) that no Firestore write-method call
(`.set`/`.update`/`.delete`/`.batch`/`.commit`/`.add`) appears anywhere in
`preflight.ts` outside of a comment, and (b) that `preflight.ts` never
imports `real-season-import/src/firebaseAdmin.ts` or
`real-season-import/src/importer.ts` — the two modules in this repo that
*do* have write capability. Both checks currently pass. You can also just
run the underlying grep yourself:

```sh
grep -n '\.set(\|\.update(\|\.delete(\|\.batch(\|\.commit(\|\.add(' preflight.ts
```

The only match is the comment near the top of the file that documents the
absence of any such call.

**2. Single-file, single-purpose script.** `preflight.ts` is the entire
program — not a package with a write path buried in another module. The
only code from `real-season-import` it imports is `constants.ts` and
`dataset.ts`, which are pure data/derivation with zero Firestore calls of
their own (same grep, run against those two files, also comes back empty).
It calls `db.doc(...).get()` and `db.collection(...).where(...).get()` and
nothing else on the Firestore client.

Note: the service-account credential this script is given is not itself
"read-only" — Firebase Admin SDK keys don't have a read-only mode, and the
same `FIREBASE_SERVICE_ACCOUNT` secret is used for actual deploys
elsewhere in this repo. The safety property here is that *this script's
own code* never exercises write capability, which is what the two checks
above verify.

## Running it

**Locally**, against production (read-only, but still real production
credentials — treat the key file with the same care as any other):

```sh
cd scripts/production-preflight
npm install
npm run build
GOOGLE_APPLICATION_CREDENTIALS=/path/to/chalkie-app-service-account.json node dist/production-preflight/preflight.js
```

The script refuses to run (before any Firestore read) if the credential's
`project_id` isn't `chalkie-app`, or if the Firebase app it initializes
doesn't resolve back to `chalkie-app` — the same triple project-ID check
`scripts/showcase-seed` and `scripts/real-season-import` use.

**Via GitHub Actions**: the `Production Preflight (read-only)` workflow
(`.github/workflows/production-preflight.yml`) is `workflow_dispatch`-only
— it never fires on its own. From the repo's **Actions** tab, select it and
click **Run workflow**. It uses the existing `FIREBASE_SERVICE_ACCOUNT`
repository secret (the same one `deploy-firebase.yml` uses), writes it to a
temp file for the duration of the run, and removes that file unconditionally
afterward. The credential is never printed to the log.

## What this does NOT do

- Does not write, update, delete, or batch-commit anything.
- Does not run the real importer (`real-season-import`) in any mode,
  including dry-run — it's an independent script.
- Does not touch the showcase league/season.
- Does not deploy anything.
- Takes no arguments — there is nothing to parameterize; it always checks
  the one fixed canonical dataset from `real-season-import/src/constants.ts`
  and `dataset.ts`.
