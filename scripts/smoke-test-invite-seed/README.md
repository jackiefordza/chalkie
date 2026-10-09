# Smoke-Test Invite Seed (staging only, temporary)

A standalone Admin SDK tool that creates **one** throwaway, wholly isolated
Captain Invite in the `chalkie-app-staging` Firebase project, so the
just-deployed invite-flow fix (commit `0c0d8ba`) can be manually smoke
tested end-to-end — signed-out visit → Create Account → brand-new
registration → automatic return to the pending invite → Accept Invitation —
before any real captain/VC invitations are sent.

**This is a production-capable tool, pointed at staging only.** It
authenticates with a real Firebase Admin SDK service-account credential and
bypasses Firestore security rules entirely. Read this whole file before
running anything.

## Why this exists

The real `createTeamInvite` Cloud Function (`functions/src/index.ts`) can
only ever be called by an authenticated league admin from inside the app —
there's no way to mint a one-off invite from a script without either (a)
signing in as a real admin in a browser, or (b) a trusted Admin-SDK script
that performs the exact same write the function performs. This script is
(b): it mirrors `performCreateTeamInvite`'s Firestore writes field-for-field
(same token generation, same sha256 hashing, same expiry), the same
"Admin SDK is the trusted server-side path" convention every other script
in `scripts/` already uses (see `scripts/pilot-admin-vc-link`,
`scripts/real-team-contacts-seed`) — never a raw client-side Firestore
write, which `firestore.rules`' `invites/{inviteId}` (`allow create: if
false`) makes structurally impossible anyway.

## What this creates

- **One throwaway team**, `teams/smoke-test-team`, under a brand-new
  isolated `leagueId`/`seasonId`/`divisionId` (`smoke-test-league` /
  `smoke-test-season` / `smoke-test-division`) that exists nowhere else in
  `chalkie-app-staging` — deliberately **not** under the real
  `bedford-kempston-district` league, so there is zero chance of this
  script ever reading, writing, or colliding with any real team's
  `captainUserId`/`viceCaptainUserId` or any real contact data seeded by
  `scripts/real-team-contacts-seed`. Both captain/VC slots are created
  `null` and the script refuses to run if it ever finds either slot
  already occupied.
- **One pending invite**, `invites/{auto-id}`, for that team, role
  `captain`, with a freshly generated CSPRNG token (only its sha256 hash is
  ever written to Firestore — identical to the real function).

**Deliberately not created:** any Firebase Auth account, any `users/{uid}`
document, any password. The invite is not bound to any email address at
all (see `functions/src/index.ts`'s `performAcceptTeamInvite` — it only
requires the accepting account's `role` to be `'pending'`), so this script
has nothing to reserve: any not-yet-registered email may be used during the
manual registration step of the smoke test.

**Deliberately not touched:** `pilot.admin@chalkie.test` (looked up by
email, read-only, used only to attribute the invite's `createdByUserId`),
any real league/season/division/team, `firestore.rules`, `functions/`, or
any mobile/app code.

## Prerequisites

1. **Node.js 20+** and npm.
2. **A Firebase Admin SDK service-account key for the `chalkie-app-staging`
   project.** The same credential already used by every other `scripts/*`
   staging tool (`FIREBASE_SERVICE_ACCOUNT_STAGING`).
3. **Never commit that JSON file.**
4. **`scripts/pilot-admin-seed` must already have run** (it has, in this
   repo's staging project) — this script looks up `pilot.admin@chalkie.test`
   by email and refuses to run if that account doesn't exist.

## How credentials are supplied

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/your-service-account.json
```

The script refuses to run if this isn't set, and refuses to run if the
credential file's own `project_id` isn't exactly `chalkie-app-staging` —
see **Safety checks** below.

## Install & build

```bash
cd scripts/smoke-test-invite-seed
npm install
npm run build
```

## Exact command

```bash
node dist/seed.js --confirm-smoke-test-invite
```

There is no other way to invoke this script. It accepts **only** this one
flag; any other argument (including anything that looks like it's trying to
specify a team ID, project ID, or recipient email) causes it to refuse to
run before touching anything.

## Safety checks

- **Project verification, three times over** — identical mechanism to
  every other `scripts/*` tool (see `src/firebaseAdmin.ts`).
- **Explicit confirmation required**: `--confirm-smoke-test-invite`. Omit
  it and the script refuses to run.
- **No configurable target**: every ID (`smoke-test-team`,
  `smoke-test-league`, etc.) is a compile-time constant in
  `src/constants.ts`. There is no flag that can point this script at a
  different team or a real one.
- **A write guard on every single Firestore write**: every write goes
  through `safeSet` in `src/firebaseAdmin.ts`, which checks the target
  collection/document ID against an allowlist of exactly
  `teams/smoke-test-team` and the one invite doc this run itself creates —
  anything else throws and aborts the whole run immediately.
- **Refuses to proceed if the throwaway team's captain/VC slots are ever
  found occupied** (should be impossible in a fresh, isolated namespace,
  but checked anyway).
- **A loud pre-flight banner**, then a post-run re-read verification report
  from Firestore itself — never trusts the write succeeded.
- **Never prints the raw token in the verification report**, and never
  prints the `tokenHash` value — only whether one is present. The raw
  token is printed exactly once, in the final deliverable block, as part of
  the invite URL this run was asked to produce (the one piece of output
  this script exists to generate).

## Idempotency

Re-running this script is safe: if `teams/smoke-test-team` already exists
and matches the expected identity with both slots still empty, it's left
untouched. Each run still creates a **new** pending invite (matching the
real `createTeamInvite` function's own behavior — it has no dedup either;
the admin-team.tsx UI can be clicked more than once too). If you re-run
this script, revoke or ignore any earlier pending invite on
`smoke-test-team` first to avoid confusing which invite URL is "the"
current one.

## Cleanup after the smoke test

Everything this script creates is confined to two documents:

- `teams/smoke-test-team`
- `invites/{inviteId}` (printed by this run)

Delete both directly via the Firebase Console (Firestore Database →
`teams` → `smoke-test-team` → delete; `invites` → the printed ID →
delete), or via a one-off Admin SDK delete of those two exact paths. If the
smoke test also results in a brand-new Auth account + `users/{uid}`
document being registered (the inevitable result of actually performing
the registration step), that account is **not** created by this script and
is **not** covered by this cleanup — delete it separately (Firebase
Console → Authentication) once the smoke test is done, the same way any
other throwaway test account would be removed.
