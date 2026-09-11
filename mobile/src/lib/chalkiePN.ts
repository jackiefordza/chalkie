// Pure, framework-free ChalkiePN formatting/validation — the permanent,
// human-friendly identifier for a real person (Phase 9). Not an auth
// credential: knowing a ChalkiePN grants no access to anything. Kept
// separate from assignChalkiePN.ts (the Firestore-touching uniqueness
// check) so the format itself can be unit-tested with no storage backend,
// the same split used by matchResultDraft.ts / resultDraftCodec.ts.
const PREFIX = 'CH-';
const DIGITS = 6;
const PATTERN = new RegExp(`^${PREFIX}\\d{${DIGITS}}$`);

export function generateChalkiePNCandidate(): string {
  const n = Math.floor(Math.random() * 10 ** DIGITS);
  return `${PREFIX}${String(n).padStart(DIGITS, '0')}`;
}

export function isValidChalkiePN(value: string): boolean {
  return PATTERN.test(value);
}
