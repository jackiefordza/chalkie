// Converts a Firestore error into a short, plain-English message safe to
// show a captain or player — mirrors the pattern already established by
// authStore.ts's friendlyAuthError, but deliberately stricter: an
// unrecognized code (or anything that isn't a Firestore error at all) always
// falls back to one generic message rather than the raw underlying error.
// Firestore's own messages routinely mention document paths, field names,
// and security-rule internals that make sense to a developer, not an
// ordinary user — see FirestoreErrorCode in the Firebase JS SDK for the
// full set this is drawn from.
const FRIENDLY_FIRESTORE_MESSAGES: Record<string, string> = {
  'permission-denied': "You don't have permission to do that.",
  'unauthenticated': 'Please sign in again to continue.',
  'not-found': 'That item could not be found. It may have been removed or changed.',
  'already-exists': 'That already exists.',
  // 'deadline-exceeded' is this SDK's practical stand-in for a request
  // timing out — from a user's point of view that's the same experience as
  // 'unavailable' (couldn't reach the backend), so it gets the same message.
  'unavailable': "We couldn't connect to Chalkie. Please check your connection and try again.",
  'deadline-exceeded': "We couldn't connect to Chalkie. Please check your connection and try again.",
};

const GENERIC_FALLBACK = 'Something went wrong. Please try again.';

export function friendlyFirestoreError(e: unknown): string {
  // Safe against any thrown shape — null/undefined short-circuit on `?.`,
  // and reading a property off a primitive (string/number/boolean) returns
  // undefined rather than throwing, so this never assumes `e` is an Error.
  const code = (e as { code?: unknown } | null | undefined)?.code;
  if (typeof code === 'string' && code in FRIENDLY_FIRESTORE_MESSAGES) {
    return FRIENDLY_FIRESTORE_MESSAGES[code];
  }
  return GENERIC_FALLBACK;
}
