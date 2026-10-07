# Smoke-Test Invite Cleanup (staging only, temporary)

A standalone Admin SDK tool that deletes the throwaway data created by
`scripts/smoke-test-invite-seed` and used for the now-completed manual
Captain Invite registration smoke test, from `chalkie-app-staging` only.

**This is a production-capable tool, pointed at staging only.** It
authenticates with a real Firebase Admin SDK service-account credential and
bypasses Firestore security rules entirely. Read this whole file before
running anything.

## What this deletes

- `teams/smoke-test-team`
- `invites/MPMApUNQ7WZgzY6BQQ5Q`
- The one throwaway Firebase Auth account (`jake.test@test.com`) that was
  registered and used to accept the smoke-test invite, plus its
  `users/{uid}` document.

## Safety checks (fail closed, not open)

Before deleting the Auth account, this script re-reads Firestore and
**refuses to delete anything** unless ALL of the following hold:

- An Auth account exists for `jake.test@test.com`.
- Its `users/{uid}` document has `teamId`/`leagueId`/`seasonId`/
  `divisionId` set to the exact throwaway smoke-test namespace (not any
  real team/league) and `isLeagueAdmin`/`isGlobalAdmin` are not `true`.
- `teams/smoke-test-team.captainUserId` equals that same uid (i.e. this is
  genuinely the account that accepted the smoke-test invite as captain of
  the throwaway team, not some other account that merely shares the
  email constant).

If any of these checks fail, the script throws before deleting anything —
it never falls back to deleting "the closest match."

Every delete additionally goes through a write-guard allowlist
(`src/firebaseAdmin.ts`'s `safeDelete`/`safeDeleteAuthUser`) scoped to
exactly `teams/smoke-test-team`, `invites/MPMApUNQ7WZgzY6BQQ5Q`, and the one
verified uid — anything else throws and aborts the run immediately.

**Never touches**: `pilot.admin@chalkie.test`, `jfordham95@gmail.com`,
any real Bedford & Kempston Division 2/3 team, `firestore.rules`,
`functions/`, or any mobile/app code. The post-run verification report
re-reads all three (read-only) to prove they're unchanged.

## Prerequisites

1. **Node.js 20+** and npm.
2. **A Firebase Admin SDK service-account key for `chalkie-app-staging`.**
3. **Never commit that JSON file.**

## Install & build

```bash
cd scripts/smoke-test-invite-cleanup
npm install
npm run build
```

## Exact command

```bash
node dist/cleanup.js --confirm-smoke-test-cleanup
```

There is no other way to invoke this script — it accepts only this one
flag.

## After running

The printed verification report confirms (by re-reading Firestore/Auth,
not by trusting the deletes):

1. `teams/smoke-test-team` no longer exists.
2. `invites/MPMApUNQ7WZgzY6BQQ5Q` no longer exists.
3. `users/{uid}` for the throwaway account no longer exists.
4. The Auth account for `jake.test@test.com` no longer exists.
5. `pilot.admin@chalkie.test` is unchanged.
6. `jfordham95@gmail.com` is unchanged.
7. `teams/bk-d3-team-2` (Burnaby Arms B) is unchanged.
8. Every delete this run performed was in scope.
