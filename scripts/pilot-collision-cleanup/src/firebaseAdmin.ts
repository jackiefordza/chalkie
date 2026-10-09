// The one file in this script allowed to touch the Firebase Admin SDK
// directly. Every other module writes/deletes Firestore documents only
// through the guarded helpers exported here — never through a raw
// `docRef.set()`/`.update()`/`.delete()` call anywhere else in this
// codebase. Mirrors every other scripts/* script's firebaseAdmin.ts
// deliberately: the same project-identity triple check, the same "every
// write goes through one guarded function" rule — narrowed here to exactly
// the three pre-identified pilot/test uids (resolved at runtime from their
// three fixed emails), the three teams they collide on, and the one
// bespoke player doc being deleted.
import * as fs from 'node:fs';
import * as admin from 'firebase-admin';
import { BURNABY_B_ADMIN_PLAYER_ID, BURNABY_B_TEAM_ID, BURNABY_C_TEAM_ID, EXPECTED_PROJECT_ID, OAKLEY_TEAM_ID } from './constants';

let initialized: { app: admin.app.App; db: admin.firestore.Firestore; auth: admin.auth.Auth } | null = null;

export function initializePilotCollisionCleanupApp(): { db: admin.firestore.Firestore; auth: admin.auth.Auth } {
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
  if (!initialized) throw new Error('initializePilotCollisionCleanupApp() must be called first.');
  return initialized.app.options.projectId ?? '(unknown)';
}

// ── Write guard — an allowlist of exactly the document paths this script is
// permitted to touch. The three uids are resolved at runtime from their
// three fixed emails (never from arbitrary input); the three team IDs and
// the one player ID are the compile-time constants above. Nothing else,
// ever — in particular, no leagues/seasons/divisions/matches/submissions/
// confirmations access, and no OTHER player doc (the Oakley/Burnaby C
// placeholder rosters are deliberately left untouched). ────────────────────
const allowedUserIds = new Set<string>();
export function registerAllowedUserId(uid: string): void {
  allowedUserIds.add(uid);
}

const ALLOWED_TEAM_IDS = new Set([OAKLEY_TEAM_ID, BURNABY_C_TEAM_ID, BURNABY_B_TEAM_ID]);

interface AuditEntry { op: 'set' | 'delete'; collectionPath: string; docId: string; at: string }
const auditLog: AuditEntry[] = [];
export function getAuditLog(): readonly AuditEntry[] {
  return auditLog;
}

function assertAllowed(collectionPath: string, docId: string): void {
  const allowed = (
    (collectionPath === 'users' && allowedUserIds.has(docId))
    || (collectionPath === 'teams' && ALLOWED_TEAM_IDS.has(docId))
    || (collectionPath === 'players' && docId === BURNABY_B_ADMIN_PLAYER_ID)
  );
  if (!allowed) {
    throw new Error(
      `WRITE GUARD REJECTED a write outside this script's scope: collection="${collectionPath}" docId="${docId}". `
      + 'This is a bug — every write in this script must go through safeSet/safeDelete and match the allowlist. Aborting.',
    );
  }
}

export async function safeSet(
  db: admin.firestore.Firestore,
  collectionPath: string,
  docId: string,
  data: FirebaseFirestore.DocumentData,
): Promise<void> {
  assertAllowed(collectionPath, docId);
  await db.collection(collectionPath).doc(docId).set(data, { merge: true });
  auditLog.push({ op: 'set', collectionPath, docId, at: new Date().toISOString() });
}

export async function safeDelete(
  db: admin.firestore.Firestore,
  collectionPath: string,
  docId: string,
): Promise<void> {
  assertAllowed(collectionPath, docId);
  await db.collection(collectionPath).doc(docId).delete();
  auditLog.push({ op: 'delete', collectionPath, docId, at: new Date().toISOString() });
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
