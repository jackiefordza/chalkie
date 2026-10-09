# Production Readiness Audit (chalkie-app, strictly read-only)

A standalone Admin SDK tool that reports what currently exists in the
**real, live `chalkie-app` Firebase project** — Firestore collection
counts, Auth user counts, and known test/pilot-account existence — ahead
of the Bedford & Kempston production rollout.

**This is the one script in this repository deliberately pointed at
`chalkie-app`.** Every other script in `scripts/` hard-codes
`chalkie-app-staging` and refuses to run against production; this one
inverts that check. It is safe to do so only because this script contains
**zero write-capable code anywhere** — no `.set()`, `.update()`,
`.delete()`, `.add()`, `.batch()`, `.commit()`, `auth.createUser()`,
`auth.updateUser()`, or `auth.deleteUser()` call exists in its source, at
all. This is not just a claim — `prove-read-only.sh` greps the entire
`src/` tree (and `audit.ts`) for exactly those calls and refuses to let
the workflow proceed if it finds one, **before any credential is ever
touched**. Same convention `scripts/production-preflight` (PR #38)
already established for exactly this kind of production-safe read.

## What this reports

**Firestore** (counts and existence only — never full documents):
- Document counts for `leagues`, `seasons`, `divisions`, `teams`,
  `players`, `matches`, `invites`, `users`.
- Whether `leagues/bedford-kempston-district`, its season, and its two
  divisions exist.
- How many `teams`/`matches` documents currently have
  `leagueId == bedford-kempston-district` (compared against the expected
  16 teams / 112 fixtures).

**Auth** (counts and boolean existence only — never dumps emails/names):
- Total Auth user count, and how many of those have a `password`
  sign-in provider (an indirect signal for whether Email/Password auth is
  in active use).
- Whether each of a fixed list of known `@chalkie.test` pilot/showcase
  emails, and the throwaway `jake.test@test.com` smoke-test email, exist
  in **production** (they should not — their presence would indicate
  staging/test contamination).
- Whether the real `jfordham95@gmail.com` account exists in production
  (unrelated to its staging account) — existence only, nothing else.
- Best-effort read of the project's Auth config via
  `projectConfigManager().getProjectConfig()` (may not be fully
  determinative of which sign-in providers are enabled — the Admin SDK
  doesn't expose that as cleanly as the Console does).

**What this does NOT determine** (needs separate tooling/access this
sandbox doesn't have): Cloud Functions deployment status, Hosting
deployment status, and currently-deployed Firestore rules/indexes content
are checked separately via plain read-only `firebase-tools` subcommands
(`functions:list`, `hosting:sites:list`, `hosting:channel:list`,
`firestore:indexes` — never `deploy`) as separate steps in the companion
workflow, not by this script. Billing status is not independently
checkable from this sandbox at all (no `gcloud`/Cloud Billing API access)
— that needs the Firebase/GCP Console directly.

## Prerequisites

1. **Node.js 20+** and npm.
2. **A Firebase Admin SDK service-account key for `chalkie-app`** — the
   same `FIREBASE_SERVICE_ACCOUNT` secret `deploy-firebase.yml` already
   uses for production deploys. This script only ever reads with it.
3. **Never commit that JSON file.**

## Install & build

```bash
cd scripts/production-readiness-audit
npm install
npm run build
```

## Exact command

```bash
./prove-read-only.sh && node dist/audit.js --confirm-production-readonly-audit
```

There is no other way to invoke this script — it accepts only the one
flag; any other argument causes it to refuse to run.

## Safety

- **Project verification, three times over** — identical mechanism to
  every other script in `scripts/`, inverted to require `chalkie-app`
  instead of refusing it.
- **No write-capable code exists in this script's source at all** —
  statically verified by `prove-read-only.sh`, not just asserted.
- **No configurable target** — every ID is a compile-time constant.
- **Minimal data exposure** — reports counts and booleans, never dumps
  a list of users, emails, or full documents.
