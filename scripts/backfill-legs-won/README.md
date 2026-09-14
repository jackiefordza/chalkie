# Stats Rules audit (Season 1) — legsWon backfill

A standalone Admin SDK tool that computes and (only with `--apply`) writes
the new `legsWon` field on `playerSeasonStats` documents in the live
`chalkie-app` Firebase project, from matches that are already confirmed —
including the showcase season.

**This is a production-capable tool.** It authenticates with a real Firebase
Admin SDK service-account credential and bypasses Firestore security rules
entirely. Read this whole file before running anything.

It is completely separate from the mobile app and Cloud Functions: nothing
here is imported by, or imports from, `mobile/` or `functions/` — same
discipline as `scripts/showcase-seed`. `src/compute.ts` is an independent
reimplementation of `computePlayerAccum`'s legs-won logic
(`functions/src/index.ts`), proven to produce identical numbers by
`src/compute.test.ts`, which shares the exact same fixtures and expected
values as `functions/src/computePlayerAccum.test.ts`.

## What this does — and does not — touch

- **Reads** `matches` where `status == 'confirmed'`. Nothing else in that
  collection, and never a write to it.
- **Writes** exactly one field, `legsWon`, on `playerSeasonStats/{seasonId}_{playerId}`
  documents — via `update()`, never `set()`, so it can never create a new
  document or touch any other field on an existing one (`played`, `won`,
  `lost`, `oneEighties`, `highCheckouts`, `leagueId`, `seasonId`,
  `divisionId`, `teamId`, `playerId` are all left exactly as they are).
- **Never** touches `matches`, fixtures, `divisionTables`, seed/reset
  scripts, Firestore rules, or any showcase match result.
- A computed player with no existing `playerSeasonStats` document is
  reported as an anomaly and **skipped**, never papered over by creating one.

A match with no `competitionType` field at all (written before the Stats
Rules audit) is treated as `'league'` — the same default
`functions/src/index.ts` uses at read time. A `'friendly'` match
contributes nothing. League and TKO accumulate identically.

## Prerequisites

1. **Node.js 20+** and npm.
2. **A Firebase Admin SDK service-account key for the `chalkie-app`
   project.** Reuse an existing one if you have access (the same kind of
   credential already used by `scripts/showcase-seed` and
   `.github/workflows/deploy-firebase.yml`), or generate a fresh one:
   Firebase Console → chalkie-app → Project Settings → Service Accounts →
   **Generate new private key**.
3. **Never commit that JSON file.**

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/your-service-account.json
```

The script refuses to run if this isn't set, and refuses to run if the
credential file's own `project_id` isn't exactly `chalkie-app` — see
**Safety checks** below.

## Install & build

```bash
cd scripts/backfill-legs-won
npm install
npm run build
```

## Exact commands

Dry run (read-only — always do this first, and read its output):

```bash
node dist/backfill.js --confirm-backfill
```

Apply (writes the `legsWon` values the dry run showed):

```bash
node dist/backfill.js --confirm-backfill --apply
```

There is no other way to invoke this script. It accepts **only**
`--confirm-backfill` and `--apply`; any other argument — including anything
that looks like a league ID, season ID, or project ID — causes it to refuse
to run before touching anything.

## Reading the dry-run report

For every player-season the confirmed matches touch, the report prints:

```
playerSeasonStats/season-1_player-42
  existing legsWon: (field not set)
  computed legsWon: 37
  delta: +37
```

— and a summary count of how many documents are already correct (no write
needed) versus how many will change. Anything the computation finds where
no matching `playerSeasonStats` document exists at all is printed
separately as an **ANOMALY** and is never written to, apply mode or not.

**Always run the dry run and read its full output before ever passing
`--apply`.**

## Safety checks

- **Project verification, three times over** — see
  `src/firebaseAdmin.ts`, same pattern as `scripts/showcase-seed`.
- **Explicit confirmation required**: `--confirm-backfill` is required for
  either mode. Omit it and the script refuses to run.
- **Dry run by default**: omitting `--apply` can never write anything,
  regardless of any other flag.
- **A write guard on the one write path**: `guardedUpdateLegsWon` in
  `src/firebaseAdmin.ts` is the only function in this codebase that writes
  anything, and it only ever `update()`s the single `legsWon` field on
  `playerSeasonStats`.
- **No configurable target**: there is no flag to scope this to one league,
  season, or division — it is deliberately meant to cover every currently
  confirmed match in the project, including the showcase season, exactly as
  requested.

## Idempotency

Safe to run more than once. A second dry run after a successful apply
should show every row as "already correct — no write needed." If the
computation logic itself is later corrected, `computeLegsWonFromMatches`
gives every match participant an explicit entry (even at `legsWon: 0`) —
not just leg-winners — so a re-run can correct a value back down, not just
up.

## Investigating, not backfilling

`investigate.ts` is a second, separate entry point for when the dry run
shows existing `legsWon` values you didn't expect (this happened on first
use — see the implementation report). It is **structurally incapable of
writing anything** — it only imports read-only helpers, never
`guardedUpdateLegsWon` — so there is no `--apply` equivalent here, ever.

```bash
node dist/investigate.js --confirm-investigate
```

For every player-season the confirmed matches touch, it reports the full
`playerSeasonStats` document (`leagueId`/`seasonId`/`divisionId`/`played`/
`won`/`legsWon`) plus that document's Firestore-native `createTime`/
`updateTime`, an exact-match check against a fresh computation, grouped
create/update-time ranges per league/season/division, and any suspicious
values (negative, non-integer, or exceeding `played * 3`).

## Not implemented here

This script does not modify `firestore.rules`, `functions/`, `matches`, any
fixture, any showcase seed/reset script, or any field on
`playerSeasonStats` other than `legsWon`.
