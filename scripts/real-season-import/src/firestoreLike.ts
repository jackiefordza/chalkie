// The minimal Firestore surface this importer needs, factored out as an
// interface so the exact same importer logic (src/importer.ts) can run
// against either the real Firebase Admin SDK or a lightweight in-memory
// fake (src/fakeFirestore.ts) used for offline testing. Neither the
// importer nor the write-guard in firebaseAdmin.ts cares which one it's
// handed — that's what lets offlineChecks.ts prove dry-run counts,
// idempotency, and safety-guard refusal with zero network access.
export interface DocSnapshotLike {
  readonly exists: boolean;
  data(): Record<string, unknown> | undefined;
}

export interface DocRefLike {
  get(): Promise<DocSnapshotLike>;
  set(data: Record<string, unknown>, options?: { merge?: boolean }): Promise<unknown>;
}

export interface CollectionRefLike {
  doc(id: string): DocRefLike;
}

export interface FirestoreLike {
  collection(path: string): CollectionRefLike;
}
