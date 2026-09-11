# Firestore rules regression tests

Runs `firestore.rules` (the real file, one directory up) against a **local
Firestore emulator only**, using `@firebase/rules-unit-testing`. Nothing here
ever touches the real `chalkie-app` Firebase project — the project ID used
(`demo-chalkie-rules-test`) is a `demo-`-prefixed ID, which the emulator
treats specially: it never contacts production Firebase, and no real
credentials are involved anywhere in this directory.

## Running

```sh
cd rules-tests
npm install   # first time only
npm test
```

`npm test` shells out to `firebase-tools emulators:exec`, which starts a
throwaway Firestore emulator, runs `node --test --test-concurrency=1
*.rules.test.js` against it, then tears the emulator down again — win or
lose, no state persists between runs.

`--test-concurrency=1` is required, not cosmetic: every `*.rules.test.js`
file shares the same running emulator and the same `demo-` project ID, and
each file's `beforeEach` calls `clearFirestore()` — if Node ran two files in
parallel (its default for multiple test files), one file's `clearFirestore`
could wipe the data another file's test had just seeded mid-run, causing
flaky, cross-file failures unrelated to the rules themselves. Running the
files one at a time avoids that entirely.

## Scope

- `matches.rules.test.js` — the two rules clauses changed for Phase A
  (fixture exceptions — postponed/cancelled `MatchStatus` values):
  - `matches/{matchId}` `allow delete` — postponed/cancelled added alongside
    the pre-existing scheduled/confirmed.
  - `matches/{matchId}/submissions/{submissionId}` `allow create, update` —
    now also blocked when the match is postponed or cancelled, not just
    confirmed.

  Plus regression coverage proving the *unchanged* parts of both rules still
  behave the same way (scheduled/confirmed submission and delete behaviour,
  admin-only status changes, league-scoping via `isAdminFor`).

- `availability.rules.test.js` — the new `availability/{availabilityId}`
  collection added for Phase B (player availability): a player can only
  create/update their own doc (own userId/playerId/teamId/leagueId, never
  someone else's, another team's, or another league's); a captain/VC can
  read their own team's docs but not another team's; league/global admin
  read (and a delete-only cleanup escape hatch) still work.

This is intentionally narrow, not a full rules test suite for the whole
schema — add to it as future phases change other security-relevant rules.
