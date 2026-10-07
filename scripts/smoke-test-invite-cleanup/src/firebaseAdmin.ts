// The one file in this script allowed to touch the Firebase Admin SDK
// directly. Every delete goes through the guarded helper exported here
// (safeDelete) — never through a raw `docRef.delete()` call anywhere else
// in this codebase. Same project-identity triple check as every other
// script in scripts/, with the write-guard allowlist narrowed to exactly
// the documents this cleanup is permitted to remove.
import * as fs from 'node:fs';
import * as admin from 'firebase-admin';
import { EXPECTED_PROJECT_ID, SMOKE_TEST_INVITE_ID, SMOKE_TEST_TEAM_ID } from './constants';

let initialized: { app: admin.app.App; db: admin.firestore.Firestore; auth: admin.auth.Auth } | null = null;

export function initializeSmokeTestCleanupApp(): { db: admin.firestore.Firestore; auth: admin.auth.Auth } {
  if (initialized) return { db: initialized.db, auth: initialized.auth };

  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) {
    throw new Error(
      'GOOGLE_APPLICATION_CREDENTIALS is not set. This script refuses to guess at credentials — '
      + `point it at a service-account JSON key for the ${EXPECTED_PROJECT_ID} project. See README.md.`,
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
      + `This script only ever operates on ${EXPECTED_PROJECT_ID} — point GOOGLE_APPLICATION_CREDENTIALS at the correct key.`,
    );
  }

  const app = admin.initializeApp({
    credential: admin.credential.cert(credPath),
    projectId: EXPECTED_PROJECT_ID,
  });

  const resolvedProjectId = app.options.projectId;
  if (resolvedProjectId !== EXPECTED_PROJECT_ID) {
    throw new Error(
      `REFUSING TO RUN: initialized Firebase app resolved to project "${resolvedProjectId}", `
      + `expected "${EXPECTED_PROJECT_ID}". Aborting before any read or write.`,
    );
  }

  const db = admin.firestore(app);
  const auth = admin.auth(app);
  initialized = { app, db, auth };
  console.log(`Firebase Admin SDK initialized against project "${resolvedProjectId}" — verified.`);
  return { db, auth };
}

export function getResolvedProjectId(): string {
  if (!initialized) throw new Error('initializeSmokeTestCleanupApp() must be called first.');
  return initialized.app.options.projectId ?? '(unknown)';
}

// ── Write(delete) guard — an allowlist of exactly the document paths and
// the one Auth uid this script is permitted to delete, enforced on every
// single delete. The smoke-test account's uid is resolved at runtime from
// its fixed email (never from arbitrary input) and registered here only
// after the caller has independently verified it belongs to the throwaway
// team — see src/cleanupCore.ts. ──────────────────────────────────────────
let allowedUserId: string | null = null;
export function registerVerifiedSmokeTestUserId(uid: string): void {
  allowedUserId = uid;
}
export function getRegisteredSmokeTestUserId(): string | null {
  return allowedUserId;
}

interface AuditEntry { op: 'delete' | 'deleteAuthUser'; collectionPath?: string; docId?: string; uid?: string; at: string }
const auditLog: AuditEntry[] = [];
export function getAuditLog(): readonly AuditEntry[] {
  return auditLog;
}

function assertAllowedDoc(collectionPath: string, docId: string): void {
  const allowed = (
    (collectionPath === 'teams' && docId === SMOKE_TEST_TEAM_ID)
    || (collectionPath === 'invites' && docId === SMOKE_TEST_INVITE_ID)
    || (collectionPath === 'users' && docId === allowedUserId)
  );
  if (!allowed) {
    throw new Error(
      `DELETE GUARD REJECTED a delete outside this script's scope: collection="${collectionPath}" docId="${docId}". `
      + 'This is a bug — every delete in this script must go through safeDelete and match the allowlist. Aborting.',
    );
  }
}

export async function safeDelete(
  db: admin.firestore.Firestore, collectionPath: string, docId: string,
): Promise<void> {
  assertAllowedDoc(collectionPath, docId);
  await db.collection(collectionPath).doc(docId).delete();
  auditLog.push({ op: 'delete', collectionPath, docId, at: new Date().toISOString() });
}

export async function safeDeleteAuthUser(auth: admin.auth.Auth, uid: string): Promise<void> {
  if (uid !== allowedUserId) {
    throw new Error(
      `DELETE GUARD REJECTED an Auth account delete outside this script's scope: uid="${uid}". `
      + 'This is a bug — aborting.',
    );
  }
  await auth.deleteUser(uid);
  auditLog.push({ op: 'deleteAuthUser', uid, at: new Date().toISOString() });
}

export function auditLogIsEntirelyInScope(): boolean {
  return auditLog.every((e) => {
    try {
      if (e.op === 'deleteAuthUser') {
        return e.uid === allowedUserId;
      }
      assertAllowedDoc(e.collectionPath!, e.docId!);
      return true;
    } catch {
      return false;
    }
  });
}
