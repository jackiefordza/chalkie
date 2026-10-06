// The one file in this script allowed to touch the Firebase Admin SDK
// directly. Every other module writes Firestore documents only through the
// guarded helper exported here (safeSet) — narrowed to exactly the 16 real
// team IDs listed in src/contacts.ts. No users/players/matches/leagues
// access exists in this script's allowlist at all.
import * as fs from 'node:fs';
import * as admin from 'firebase-admin';
import { EXPECTED_PROJECT_ID } from './constants';
import { TEAM_CONTACTS } from './contacts';

let initialized: { app: admin.app.App; db: admin.firestore.Firestore } | null = null;

export function initializeRealTeamContactsSeedApp(): { db: admin.firestore.Firestore } {
  if (initialized) return { db: initialized.db };

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
  initialized = { app, db };
  console.log(`Firebase Admin SDK initialized against project "${resolvedProjectId}" — verified.`);
  return { db };
}

export function getResolvedProjectId(): string {
  if (!initialized) throw new Error('initializeRealTeamContactsSeedApp() must be called first.');
  return initialized.app.options.projectId ?? '(unknown)';
}

const ALLOWED_TEAM_IDS = new Set(TEAM_CONTACTS.map((t) => t.teamId));

interface AuditEntry { op: 'set'; collectionPath: string; docId: string; at: string }
const auditLog: AuditEntry[] = [];
export function getAuditLog(): readonly AuditEntry[] {
  return auditLog;
}

function assertAllowed(collectionPath: string, docId: string): void {
  if (collectionPath !== 'teams' || !ALLOWED_TEAM_IDS.has(docId)) {
    throw new Error(
      `WRITE GUARD REJECTED a write outside this script's scope: collection="${collectionPath}" docId="${docId}". `
      + 'This is a bug — every write in this script must go through safeSet and match the 16-team allowlist. Aborting.',
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
