# Real Team Contacts Seed (staging only)

A standalone Admin SDK tool that writes the real Division 2/3 captain/
vice-captain reference contact info (name + mobile number) and real venue
addresses onto the 16 existing real team documents in
`chalkie-app-staging`, so the league admin knows exactly who to send each
team's Captain Invite link to.

**Run `scripts/real-season-import-staging` first.** This script never
creates a team — it only adds fields onto the 16 teams that import already
created.

## What this writes, per team

Four new fields on `teams/{teamId}` (merge-set, never overwrites `name`/
`captainUserId`/`viceCaptainUserId`/etc.):

- `address` — the real venue address, replacing the placeholder
  team-name-as-venue string `real-season-import-staging` wrote.
- `captainName`, `captainPhone` — the real captain's name and mobile
  number.
- `viceCaptainName`, `viceCaptainPhone` — the real vice-captain's name and
  mobile number.

**Deliberately never writes a venue telephone number** (`venuePhone`
stays whatever it already was — `null`, from the original import).

All data is transcribed in `src/contacts.ts`, with the specific
instructions it followed documented in that file's header: numbers are
reproduced exactly as supplied (whitespace-trimmed only, never
reformatted or given a country-code prefix), a blank phone means none was
supplied (never fabricated), Kings Arms Sandy's VC number is deliberately
blank (a supplied duplicate of another contact), Burnaby Arms B's Captain/
VC assignment (Dan Beddow / Jake Fordham) is exactly as confirmed by the
league, and North End Club B's captain number is recorded as a landline
as-is.

## Prerequisites

1. **Node.js 20+** and npm.
2. **A Firebase Admin SDK service-account key for the `chalkie-app-staging`
   project** — the same `FIREBASE_SERVICE_ACCOUNT_STAGING` credential
   already used by the other staging scripts/workflows.
3. **Never commit that JSON file.**

## Install & build

```bash
cd scripts/real-team-contacts-seed
npm install
npm run build
```

## Exact command

```bash
node dist/seed.js --confirm-real-team-contacts-seed
```

Accepts **only** `--confirm-real-team-contacts-seed`; any other argument
causes it to refuse to run before touching anything.

## Safety checks

- **Project verification, three times over** — identical mechanism to
  every other staging script.
- **A write guard on every single Firestore write** — allowlisted to
  exactly the 16 real team IDs in `src/contacts.ts` — no
  users/players/matches/leagues access exists in this script's allowlist
  at all.
- **Refuses to write if a team's existing `name` doesn't match the
  expected name** — a mismatch means the team-ID mapping might be wrong,
  and this script stops before writing anything for that team rather than
  silently attaching the wrong contact info to the wrong team.
- **Idempotent** — safe to re-run; always converges on the same 16 teams'
  data, never partially.
- **A loud pre-flight banner**; a verification report at the end that
  re-reads every field from Firestore for all 16 teams, never a bare
  "it worked."
