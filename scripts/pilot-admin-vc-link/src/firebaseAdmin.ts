// The one file in this script allowed to touch the Firebase Admin SDK
// directly. Every other module writes Firestore documents only through the
// guarded helper exported here (safeSet) — never through a raw
// `docRef.set()`/`.update()` call anywhere else in this codebase. Mirrors
// scripts/pilot-admin-seed's src/firebaseAdmin.ts deliberately: the same
// project-identity triple check, the same "every write goes through one
// guarded function" rule — narrowed here to exactly the one existing admin
// user doc, the one Burnaby Arms B team doc, and the one new player doc.
import * as fs from 'node:fs';
import * as admin from 'firebase-admin';
import { EXPECTED_PROJECT_ID, PLAYER_ID, TEAM_ID } from './constants';

let initialized: { app: admin.app.App; db: admin.firestore.Firestore; auth: admin.auth.Auth } | null = null;

// ── Project-identity verification — the core production-safety rail ────────
// Identical mechanism to every other script in scripts/: the credential
// file's own project_id, initializeApp()'s pinned projectId option, and the
// live resolved app's project ID must all equal EXPECTED_PROJECT_ID. Any
// mismatch at any of these three points throws immediately.
export function initializePilotAdminVcLinkApp(): { db: admin.firestore.Firestore; auth: admin.auth.Auth } {
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
  if (!initialized) throw new Error('initializePilotAdminVcLinkApp() must be called first.');
  return initialized.app.options.projectId ?? '(unknown)';
}

// ── Write guard — an allowlist of exactly the document paths this script is
// permitted to touch, enforced on every single write. The uid is resolved
// at runtime from the one fixed admin email (never from arbitrary input) —
// this script never creates or looks up any other user. ───────────────────
let allowedUserId: string | null = null;
export function registerLinkedAdminUserId(uid: string): void {
  allowedUserId = uid;
}

interface AuditEntry { op: 'set'; collectionPath: string; docId: string; at: string }
const auditLog: AuditEntry[] = [];
export function getAuditLog(): readonly AuditEntry[] {
  return auditLog;
}

function assertAllowed(collectionPath: string, docId: string): void {
  const allowed = (
    (collectionPath === 'users' && docId === allowedUserId)
    || (collectionPath === 'teams' && docId === TEAM_ID)
    || (collectionPath === 'players' && docId === PLAYER_ID)
  );
  if (!allowed) {
    throw new Error(
      `WRITE GUARD REJECTED a write outside this script's scope: collection="${collectionPath}" docId="${docId}". `
      + 'This is a bug — every write in this script must go through safeSet and match the allowlist. Aborting.',
    );
  }
}

export async function safeSet(
  db: admin.firestore.Firestore,
  collectionPath: string,
  docId: string,
  data: FirebaseFirestore.DocumentData,
  options: FirebaseFirestore.SetOptions = { merge: true },
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
