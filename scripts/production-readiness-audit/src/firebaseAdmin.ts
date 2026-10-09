// The one file in this script allowed to touch the Firebase Admin SDK
// directly. This module exports ONLY `db` and `auth` handles — there is no
// safeSet/safeDelete/write-guard anywhere in this file, or anywhere else
// in this script's source, because this script is never permitted to
// write anything at all. prove-read-only.sh greps the whole src/ tree for
// any write-capable call and refuses to let the workflow proceed if it
// finds one — see that file and README.md.
import * as fs from 'node:fs';
import * as admin from 'firebase-admin';
import { EXPECTED_PROJECT_ID } from './constants';

let initialized: { app: admin.app.App; db: admin.firestore.Firestore; auth: admin.auth.Auth } | null = null;

export function initializeProductionReadonlyAuditApp(): { db: admin.firestore.Firestore; auth: admin.auth.Auth } {
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
      + `expected "${EXPECTED_PROJECT_ID}". Aborting before any read.`,
    );
  }

  const db = admin.firestore(app);
  const auth = admin.auth(app);
  initialized = { app, db, auth };
  console.log(`Firebase Admin SDK initialized against project "${resolvedProjectId}" — verified. READ-ONLY.`);
  return { db, auth };
}

export function getResolvedProjectId(): string {
  if (!initialized) throw new Error('initializeProductionReadonlyAuditApp() must be called first.');
  return initialized.app.options.projectId ?? '(unknown)';
}
