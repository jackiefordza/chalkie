// Production Firebase Admin SDK initialization + the write-guard that
// scopes every write this importer can ever make to exactly the real
// Bedford & Kempston Winter 2026/27 League/Season/Division2/Division3/
// team/match IDs — nothing else, ever. Mirrors scripts/showcase-seed's
// firebaseAdmin.ts pattern deliberately: the same project-identity triple
// check, the same "every write goes through one guarded function" rule.
//
// The guard (guardedFirestore) is written against the FirestoreLike
// interface, not the real Admin SDK directly, so the exact same guard code
// runs — and can be tested — against fakeFirestore.ts in offlineChecks.ts,
// with zero network access. import.ts (the real CLI) is the only file that
// ever calls initializeRealAdminApp(); nothing else in this script talks to
// real Firebase.
import * as fs from 'node:fs';
import * as admin from 'firebase-admin';
import {
  DIVISION_2_ID, DIVISION_3_ID, EXPECTED_PROJECT_ID, LEAGUE_ID, SEASON_ID,
} from './constants';
import { FirestoreLike } from './firestoreLike';

export function initializeRealAdminApp(): FirestoreLike {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) {
    throw new Error(
      'GOOGLE_APPLICATION_CREDENTIALS is not set. This script refuses to guess at credentials — '
      + 'point it at a service-account JSON key for the chalkie-app project. See README.md.',
    );
  }
  if (!fs.existsSync(credPath)) {
    throw new Error(`GOOGLE_APPLICATION_CREDENTIALS points at "${credPath}", which does not exist.`);
  }

  let serviceAccount: { project_id?: string };
  try {
    serviceAccount = JSON.parse(fs.readFileSync(credPath, 'utf8'));
  } catch (e) {
    throw new Error(`Could not parse the service-account file at "${credPath}" as JSON: ${(e as Error).message}`);
  }

  if (serviceAccount.project_id !== EXPECTED_PROJECT_ID) {
    throw new Error(
      `REFUSING TO RUN: the service-account credential at "${credPath}" belongs to project `
      + `"${serviceAccount.project_id ?? '(missing project_id)'}", not the required "${EXPECTED_PROJECT_ID}". `
      + 'This script only ever operates on chalkie-app — point GOOGLE_APPLICATION_CREDENTIALS at the correct key.',
    );
  }

  const app = admin.initializeApp({
    credential: admin.credential.cert(credPath),
    // Hard-coded, not configurable — never sourced from env/argv/the
    // credential file's own claims beyond the check just performed above.
    projectId: EXPECTED_PROJECT_ID,
  }, `real-season-import-${Date.now()}`);

  const resolvedProjectId = app.options.projectId;
  if (resolvedProjectId !== EXPECTED_PROJECT_ID) {
    throw new Error(
      `REFUSING TO RUN: initialized Firebase app resolved to project "${resolvedProjectId}", `
      + `expected "${EXPECTED_PROJECT_ID}". Aborting before any read or write.`,
    );
  }

  console.log(`Firebase Admin SDK initialized against project "${resolvedProjectId}" — verified.`);
  return admin.firestore(app);
}

// ── Write guard — an allowlist of exactly the document paths this dataset
// is permitted to touch, enforced on every single write, regardless of
// which backend (real Firestore or the in-memory fake) is behind it. ──────
const TEAM_ID_RE = /^bk-d[23]-team-[1-8]$/;
const MATCH_ID_RE = /^bk-d[23]-w(0[1-9]|1[0-4])-[1-8]v[1-8]$/;

export function isAllowedWrite(collectionPath: string, docId: string): boolean {
  return (
    (collectionPath === 'leagues' && docId === LEAGUE_ID)
    || (collectionPath === 'seasons' && docId === SEASON_ID)
    || (collectionPath === 'divisions' && (docId === DIVISION_2_ID || docId === DIVISION_3_ID))
    || (collectionPath === 'teams' && TEAM_ID_RE.test(docId))
    || (collectionPath === 'matches' && MATCH_ID_RE.test(docId))
  );
}

interface AuditEntry { collectionPath: string; docId: string; at: string }
const auditLog: AuditEntry[] = [];
export function getAuditLog(): readonly AuditEntry[] {
  return auditLog;
}
export function resetAuditLog(): void {
  auditLog.length = 0;
}

/**
 * Wraps any FirestoreLike backend (real Admin SDK Firestore, or the
 * in-memory fake) so every `.set()` call is checked against the fixed
 * allowlist above BEFORE it reaches the backend. A write to any path
 * outside this dataset — a showcase ID, a Division 1/4 ID, an unrelated
 * league, a typo — throws immediately and writes nothing. Reads are never
 * restricted (the importer needs to read existing docs to diff against).
 */
export function guardedFirestore(inner: FirestoreLike): FirestoreLike {
  return {
    collection(path: string) {
      return {
        doc(id: string) {
          const innerDoc = inner.collection(path).doc(id);
          return {
            get: () => innerDoc.get(),
            set: (data: Record<string, unknown>, options?: { merge?: boolean }) => {
              if (!isAllowedWrite(path, id)) {
                throw new Error(
                  `WRITE GUARD REJECTED a write outside the real-season dataset: `
                  + `collection="${path}" docId="${id}". This importer may only touch the fixed `
                  + `Bedford & Kempston Winter 2026/27 League/Season/Division2/Division3/team/match `
                  + 'IDs declared in constants.ts. Aborting this write.',
                );
              }
              auditLog.push({ collectionPath: path, docId: id, at: new Date().toISOString() });
              return innerDoc.set(data, options);
            },
          };
        },
      };
    },
  };
}
