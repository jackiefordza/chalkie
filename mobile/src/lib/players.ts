// Pure name-normalization/ID logic shared by every "Add Player" call site
// (captains.tsx, admin-team.tsx, results-entry.tsx's picker). Each of those
// screens runs its own `runTransaction` (get the doc at playerDocId, throw
// DuplicatePlayerNameError if it already exists, else create it) using the
// helpers below — there's no single shared write function, since each
// screen's create call already had bespoke field sets and local state
// updates before this fix, which this preserves. This file deliberately has
// no Firebase import — see players.test.ts, and tsconfig.test.json's
// comment on why the actual Firestore transaction stays out of it.

export class DuplicatePlayerNameError extends Error {
  constructor(public readonly playerName: string) {
    super(`${playerName} is already on this team.`);
    this.name = 'DuplicatePlayerNameError';
  }
}

// Case-insensitive, leading/trailing-whitespace-insensitive, and collapses
// internal run-on whitespace ("Paul  Smith" / "Paul Smith") — but never
// touches anything else, so "Paul" and "Paula" (or "Paul S") stay distinct.
export function normalizePlayerName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Deterministic, per-team document ID: creating two players with the same
// (teamId, normalized name) always targets the exact same Firestore
// document, which is what lets a transaction (see each screen's addPlayer/
// addPlayerFromPicker function) reject the second one atomically instead of
// relying on a separate, racy query-then-write check. Scoping by teamId is
// what allows the same name to exist on two different teams.
// encodeURIComponent keeps the result a valid, legible Firestore doc ID
// (which can't contain '/') rather than hashing it to something opaque.
export function playerDocId(teamId: string, name: string): string {
  return `${teamId}__${encodeURIComponent(normalizePlayerName(name))}`;
}
