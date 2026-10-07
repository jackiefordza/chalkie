# Real Captain Invite — Burnaby Arms C (staging, one real invite)

A standalone Admin SDK tool that creates exactly **one** real Captain
invite for `teams/bk-d2-team-1` (Burnaby Arms C, Division 2, Bedford &
Kempston District Darts League) in `chalkie-app-staging`, for the real
captain Geri Sampson's pilot onboarding.

**This is a production-capable tool, pointed at staging only.** It
authenticates with a real Firebase Admin SDK service-account credential and
bypasses Firestore security rules entirely. Read this whole file before
running anything.

## What this does

Mirrors `functions/src/index.ts`'s `performCreateTeamInvite` field-for-field
(same CSPRNG token generation, same sha256 hashing, same 14-day expiry) —
the same "Admin SDK is the trusted server-side path" convention every
other script in `scripts/` already uses — rather than a raw client-side
Firestore write, which `firestore.rules`' `invites/{inviteId}` (`allow
create: if false`) makes structurally impossible anyway.

## Pre-flight checks (run in order, read-only, before anything is written)

1. `teams/bk-d2-team-1` exists.
2. Its `name` is exactly "Burnaby Arms C".
3. Its `leagueId` is exactly `bedford-kempston-district`.
4. Its `divisionId`/`seasonId` match Division 2 of the real 2026/27 season.
5. Its `captainUserId` is currently empty/null.
6. Its current `viceCaptainUserId` is read (never written) so the
   verification step afterward can prove it was left unchanged.
7. No existing *pending* Captain invite already exists for this team.

**If any single check fails, the script throws immediately and writes
nothing** — no invite is created, nothing is "fixed up" automatically. The
failure message states exactly which check failed and why.

## What this never does

- Never creates a Firebase Auth account.
- Never creates a `users/{uid}` document.
- Never creates a `players/{id}` document.
- Never writes to `teams/bk-d2-team-1` (or any team) at all — not even
  `captainUserId`. That field is only ever set later, when Geri actually
  accepts the invite, by the real `acceptTeamInvite` Cloud Function — the
  same as if an admin had clicked "Invite Captain" in the app itself.
- Never binds the invite to an email address — the invite model has no
  email binding (see `functions/src/index.ts`'s `performAcceptTeamInvite`:
  it only requires the accepting account's `role` to be `'pending'`).
- Never touches any other team, league, season, or division.

The write-guard allowlist in `src/firebaseAdmin.ts` enforces this
structurally: the only write this script is permitted to perform, at all,
is the one `invites/{auto-id}` document it creates. There is no `teams`
entry in its allowlist.

## Prerequisites

1. **Node.js 20+** and npm.
2. **A Firebase Admin SDK service-account key for `chalkie-app-staging`.**
3. **Never commit that JSON file.**
4. **`scripts/pilot-admin-seed` and `scripts/real-season-import-staging`
   must already have run** (they have, in this repo's staging project).

## Install & build

```bash
cd scripts/real-captain-invite-burnaby-c
npm install
npm run build
```

## Exact command

```bash
node dist/invite.js --confirm-real-captain-invite
```

There is no other way to invoke this script — it accepts only this one
flag; any other argument causes it to refuse to run before touching
anything.

## After running

The verification report re-reads Firestore (never trusts the write
succeeded) and confirms: the invite exists with the right shape;
`captainUserId` is still empty (no overwrite happened); `viceCaptainUserId`
is unchanged from before this run; and every write this run performed was
in scope. The deliverable block prints the invite ID, full invite URL
(with the raw token — this is the one piece of output this script exists
to produce), and expiry.

This script is single-use by design: re-running it after a successful
first run will fail pre-flight check 7 (an existing pending invite is now
present) rather than silently creating a second one.
