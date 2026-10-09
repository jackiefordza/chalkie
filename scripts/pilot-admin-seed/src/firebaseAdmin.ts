// The one file in this script allowed to touch the Firebase Admin SDK
// directly. Every other module writes Firestore documents only through the
// guarded helper exported here (safeSet) — never through a raw
// `docRef.set()` call anywhere else in this codebase. Mirrors
// scripts/pilot-captains-seed's src/firebaseAdmin.ts (itself mirroring
// scripts/showcase-seed's) deliberately: the same project-identity triple
// check, the same "every write goes through one guarded function" rule —
// narrowed here to exactly the one pilot admin user doc and the one
// leagues/{LEAGUE_ID}.adminUserId correction, and to chalkie-app-staging
// instead of chalkie-app.
import * as fs from 'node:fs';
import * as admin from 'firebase-admin';
import { EXPECTED_PROJECT_ID, LEAGUE_ID } from './constants';

let initialized: { app: admin.app.App; db: admin.firestore.Firestore; auth: admin.auth.Auth } | null = null;

// ── Project-identity verification — the core production-safety rail ────────
// Reads GOOGLE_APPLICATION_CREDENTIALS, checks the *credential file's own*
// project_id BEFORE ever calling initializeApp, then pins initializeApp's
// own `projectId` option to the hard-coded EXPECTED_PROJECT_ID (never taken
// from the credential file, an env var, or argv), then re-checks the live
// app's resolved project ID after init as a final belt-and-braces check.
// Any mismatch at any of these three points throws immediately — the
// script never proceeds with an ambiguous or wrong project.
export function initializePilotAdminSeedApp(): { db: admin.firestore.Firestore; auth: admin.auth.Auth } {
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
    // Hard-coded, not configurable — never sourced from env/argv/the
    // credential file's own claims beyond the check just performed above.
    projectId: EXPECTED_PROJECT_ID,
  });

  // Final runtime check: the live app must agree with what we asked for.
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
  if (!initialized) throw new Error('initializePilotAdminSeedApp() must be called first.');
  return initialized.app.options.projectId ?? '(unknown)';
}

// ── Write guard — an allowlist of exactly the document paths this script is
// permitted to touch, enforced on every single write. Deliberately the
// narrowest of the three pilot scripts: no teams/players/matches access at
// all — just the one admin user doc (uid resolved from the one fixed admin
// email, never from arbitrary input) and the one league doc's
// adminUserId correction. ───────────────────────────────────────────────────
let allowedUserId: string | null = null;
export function registerPilotAdminUserId(uid: string): void {
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
    || (collectionPath === 'leagues' && docId === LEAGUE_ID)
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

// Every path recorded in the audit log was, by construction, checked by
// assertAllowed before the write happened — this is a printable
// "scope stayed admin-seed-only" proof for the verification report, not the
// primary safety mechanism (assertAllowed, which runs BEFORE every write and
// throws immediately, is that).
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
