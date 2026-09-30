// An in-memory stand-in for Firestore, implementing exactly FirestoreLike
// and nothing else. Used ONLY by offlineChecks.ts to prove the importer's
// create/update/skip logic, idempotency, and the write-guard's refusal
// behaviour without any network access, emulator, or credential — the same
// role showcase-seed/offline-checks.js plays for that script. This file is
// never imported by import.ts (the real CLI entry point).
import { CollectionRefLike, DocRefLike, DocSnapshotLike, FirestoreLike } from './firestoreLike';

export class FakeFirestore implements FirestoreLike {
  private readonly store = new Map<string, Record<string, unknown>>();

  collection(path: string): CollectionRefLike {
    return {
      doc: (id: string): DocRefLike => {
        const key = `${path}/${id}`;
        return {
          get: async (): Promise<DocSnapshotLike> => {
            const data = this.store.get(key);
            return {
              exists: data !== undefined,
              data: () => data,
            };
          },
          set: async (data: Record<string, unknown>, options?: { merge?: boolean }): Promise<void> => {
            if (options?.merge) {
              const existing = this.store.get(key) ?? {};
              this.store.set(key, { ...existing, ...data });
            } else {
              this.store.set(key, { ...data });
            }
          },
        };
      },
    };
  }

  // Test-only introspection, not part of FirestoreLike.
  size(): number {
    return this.store.size;
  }

  keys(): string[] {
    return [...this.store.keys()].sort();
  }

  dump(): Record<string, Record<string, unknown>> {
    return Object.fromEntries(this.store);
  }
}
