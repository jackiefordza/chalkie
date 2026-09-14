// The one file in this script allowed to touch the Firebase Admin SDK
// directly, and the only place any write happens — same discipline as
// scripts/showcase-seed/src/firebaseAdmin.ts.
import * as fs from 'node:fs';
import * as admin from 'firebase-admin';
import { EXPECTED_PROJECT_ID } from './constants';

let initialized: { app: admin.app.App; db: admin.firestore.Firestore } | null = null;

// ── Project-identity verification — same three-point check as
// scripts/showcase-seed: the credential file's own project_id, BEFORE
// initializeApp is ever called; initializeApp's own `projectId` option
// pinned to the hard-coded constant (never the credential file, an env var,
// or argv); then the live, initialized app's resolved project ID, checked
// again. Any mismatch throws immediately — no Firestore call is ever made
// with an ambiguous or wrong project. ──────────────────────────────────────
export function initializeBackfillAdminApp(): { db: admin.firestore.Firestore } {
  if (initialized) return { db: initialized.db };

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
      + 'This script only ever operates on chalkie-app.',
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

interface AuditEntry { docPath: string; oldValue: number | null; newValue: number; at: string }
const auditLog: AuditEntry[] = [];
export function getAuditLog(): readonly AuditEntry[] {
  return auditLog;
}

// The ONLY write this entire script ever performs: update() (never set() —
// set() would succeed even against a document that doesn't exist, silently
// creating a malformed playerSeasonStats doc with only this one field; this
// script deliberately refuses to create playerSeasonStats docs, see
// runner.ts's missingDocs handling) of exactly one field, legsWon, on
// exactly one collection, playerSeasonStats. Every other field on that
// document — played, won, lost, oneEighties, highCheckouts, leagueId,
// seasonId, divisionId, teamId, playerId — is untouched. matches, fixtures,
// divisionTables, and every other collection are never written to at all.
export async function guardedUpdateLegsWon(
  db: admin.firestore.Firestore, docId: string, oldValue: number | null, newValue: number,
): Promise<void> {
  await db.collection('playerSeasonStats').doc(docId).update({ legsWon: newValue });
  auditLog.push({ docPath: `playerSeasonStats/${docId}`, oldValue, newValue, at: new Date().toISOString() });
}
