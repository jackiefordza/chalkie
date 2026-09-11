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
throwaway Firestore emulator, runs `node --test *.rules.test.js` against it,
then tears the emulator down again — win or lose, no state persists between
runs.

## Scope

Currently covers the two rules clauses changed for Phase A (fixture
exceptions — postponed/cancelled `MatchStatus` values):

- `matches/{matchId}` `allow delete` — postponed/cancelled added alongside
  the pre-existing scheduled/confirmed.
- `matches/{matchId}/submissions/{submissionId}` `allow create, update` —
  now also blocked when the match is postponed or cancelled, not just
  confirmed.

Plus regression coverage proving the *unchanged* parts of both rules still
behave the same way (scheduled/confirmed submission and delete behaviour,
admin-only status changes, league-scoping via `isAdminFor`).

This is intentionally narrow, not a full rules test suite for the whole
schema — add to it as future phases change other security-relevant rules.
