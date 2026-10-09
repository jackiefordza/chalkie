// The one file in this script allowed to touch the Firebase Admin SDK
// directly. The one write this script ever performs goes through the
// guarded helper exported here (safeSet) — never through a raw
// `docRef.set()` call anywhere else in this codebase. Same project-identity
// triple check as every other script in scripts/. Deliberately: this
// write-guard allowlist contains NO entry for `teams` at all — this script
// never writes to teams/bk-d2-team-1 or any other team, only reads it.
import * as fs from 'node:fs';
import * as admin from 'firebase-admin';
import { EXPECTED_PROJECT_ID } from './constants';

let initialized: { app: admin.app.App; db: admin.firestore.Firestore; auth: admin.auth.Auth } | null = null;

export function initializeRealCaptainInviteApp(): { db: admin.firestore.Firestore; auth: admin.auth.Auth } {
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
  if (!initialized) throw new Error('initializeRealCaptainInviteApp() must be called first.');
  return initialized.app.options.projectId ?? '(unknown)';
}

// ── Write guard — an allowlist of exactly the one document path this
// script is permitted to write: the one invite doc this run itself
// creates. Its server-generated auto-ID is registered once generated. ────
let allowedInviteId: string | null = null;
export function registerCreatedInviteId(inviteId: string): void {
  allowedInviteId = inviteId;
}

interface AuditEntry { op: 'set'; collectionPath: string; docId: string; at: string }
const auditLog: AuditEntry[] = [];
export function getAuditLog(): readonly AuditEntry[] {
  return auditLog;
}

function assertAllowed(collectionPath: string, docId: string): void {
  const allowed = collectionPath === 'invites' && docId === allowedInviteId;
  if (!allowed) {
    throw new Error(
      `WRITE GUARD REJECTED a write outside this script's scope: collection="${collectionPath}" docId="${docId}". `
      + 'This script is permitted to write ONLY the one invite doc it creates — no team, user, or player write '
      + 'is ever allowed here. This is a bug. Aborting.',
    );
  }
}

export async function safeSet(
  db: admin.firestore.Firestore,
  collectionPath: string,
  docId: string,
  data: FirebaseFirestore.DocumentData,
  options: FirebaseFirestore.SetOptions = { merge: false },
): Promise<void> {
  assertAllowed(collectionPath, docId);
  await db.collection(collectionPath).doc(docId).set(data, options as FirebaseFirestore.SetOptions);
  auditLog.push({ op: 'set', collectionPath, docId, at: new Date().toISOString() });
}

export function auditLogIsEntirelyInScope(): boolean {
  return auditLog.every((e) => {
    try {
      assertAllowed(e.collectionPath, e.docId);
      return true;
    } catch {
      return false;
    }
  });
}
