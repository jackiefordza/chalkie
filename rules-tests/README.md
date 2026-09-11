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

- `vc-removal.rules.test.js` — the two rules clauses changed for Phase C
  (Vice-Captain removal): `teams/{teamId}` `allow update`'s captain/VC
  branch gains a third alternative (the current captain clearing an
  existing `viceCaptainUserId` to null), and `users/{userId}` `allow
  update` gains a new branch (the current captain demoting that team's
  active `viceCaptain` back to `player`). Tests the actual batched-write
  shape the app uses and reads back both documents afterwards, so a
  wrongly-accepted partial write would be caught, not just an individually
  rejected write.

This is intentionally narrow, not a full rules test suite for the whole
schema — add to it as future phases change other security-relevant rules.

## A note on `withSecurityRulesDisabled` and return values

The installed `@firebase/rules-unit-testing` version (`^3.0.4`) does not
propagate a value returned from inside a `withSecurityRulesDisabled`
callback — confirmed by reading its own transpiled source, not assumed.
`vc-removal.rules.test.js`'s `readTeamAndUser` works around this by writing
into an outer closure variable instead of `return`ing from the callback. If
you add a helper that needs to read data back via a rules-bypassing
context, follow that pattern rather than `return`ing from the callback.
