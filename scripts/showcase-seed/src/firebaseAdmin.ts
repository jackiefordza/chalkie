// The one file in this script allowed to touch the Firebase Admin SDK
// directly. Every other module writes/deletes Firestore documents only
// through the guarded helpers exported here (safeSet/safeDelete/etc) —
// never through a raw `docRef.set()`/`docRef.delete()` call anywhere else
// in this codebase. That's a deliberate, load-bearing discipline: it means
// a bug in *any other file* that tries to write somewhere it shouldn't
// fails loudly, here, in one place, instead of silently succeeding.
import * as fs from 'node:fs';
import * as admin from 'firebase-admin';
import {
  EXPECTED_PROJECT_ID, LEAGUE_ID, SEASON_ID, DIVISION_ID,
} from './constants';

let initialized: { app: admin.app.App; db: admin.firestore.Firestore; auth: admin.auth.Auth } | null = null;

// ── Project-identity verification — the core production-safety rail ────────
// Reads GOOGLE_APPLICATION_CREDENTIALS, checks the *credential file's own*
// project_id BEFORE ever calling initializeApp, then pins initializeApp's
// own `projectId` option to the hard-coded EXPECTED_PROJECT_ID (never taken
// from the credential file, an env var, or argv), then re-checks the live
// app's resolved project ID after init as a final belt-and-braces check.
// Any mismatch at any of these three points throws immediately — the
// script never proceeds with an ambiguous or wrong project.
export function initializeShowcaseAdminApp(): { db: admin.firestore.Firestore; auth: admin.auth.Auth } {
  if (initialized) return { db: initialized.db, auth: initialized.auth };

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
  if (!initialized) throw new Error('initializeShowcaseAdminApp() must be called first.');
  return initialized.app.options.projectId ?? '(unknown)';
}

// ── Write guard — an allowlist of exactly the document paths this dataset
// is permitted to touch, enforced on every single write/delete. ───────────
const TEAM_ID_RE = /^showcase-team-[1-8]$/;
const PLAYER_ID_RE = /^showcase-player-[1-8]-[1-6]$/;
const MATCH_ID_RE = /^showcase-match-r\d+-[1-8]v[1-8]$/;
const DIVISION_TABLE_ID_RE = new RegExp(`^${SEASON_ID}_${DIVISION_ID}_showcase-team-[1-8]$`);
const PLAYER_STATS_ID_RE = new RegExp(`^${SEASON_ID}_showcase-player-[1-8]-[1-6]$`);
const SUBMISSIONS_COLLECTION_RE = /^matches\/showcase-match-r\d+-[1-8]v[1-8]\/submissions$/;

// Populated at runtime as each showcase Auth account is resolved (created or
// found) — a `users/{uid}` write is only ever allowed for a uid that has
// been explicitly registered here first. This is what stops a `users/`
// write from being a blanket "any uid" allowance.
const allowedUserIds = new Set<string>();
export function registerShowcaseUserId(uid: string): void {
  allowedUserIds.add(uid);
}

interface AuditEntry { op: 'set' | 'delete'; collectionPath: string; docId: string; at: string }
const auditLog: AuditEntry[] = [];
export function getAuditLog(): readonly AuditEntry[] {
  return auditLog;
}

function assertAllowed(collectionPath: string, docId: string): void {
  const allowed = (
    (collectionPath === 'leagues' && docId === LEAGUE_ID)
    || (collectionPath === 'seasons' && docId === SEASON_ID)
    || (collectionPath === 'divisions' && docId === DIVISION_ID)
    || (collectionPath === 'teams' && TEAM_ID_RE.test(docId))
    || (collectionPath === 'players' && PLAYER_ID_RE.test(docId))
    || (collectionPath === 'matches' && MATCH_ID_RE.test(docId))
    || (SUBMISSIONS_COLLECTION_RE.test(collectionPath) && TEAM_ID_RE.test(docId))
    || (collectionPath === 'divisionTables' && DIVISION_TABLE_ID_RE.test(docId))
    || (collectionPath === 'playerSeasonStats' && PLAYER_STATS_ID_RE.test(docId))
    || (collectionPath === 'users' && allowedUserIds.has(docId))
  );
  if (!allowed) {
    throw new Error(
      `WRITE GUARD REJECTED a write outside the showcase dataset: collection="${collectionPath}" docId="${docId}". `
      + 'This is a bug — every write in this script must go through safeSet/safeDelete and match the showcase-only allowlist. Aborting.',
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

export async function safeDelete(
  db: admin.firestore.Firestore,
  collectionPath: string,
  docId: string,
): Promise<void> {
  assertAllowed(collectionPath, docId);
  await db.collection(collectionPath).doc(docId).delete();
  auditLog.push({ op: 'delete', collectionPath, docId, at: new Date().toISOString() });
}

// Every path recorded in the audit log was, by construction, checked by
// assertAllowed before the write happened — so this can never actually find
// a violation unless assertAllowed itself has a bug. It exists as an
// explicit, printable "REAL LEAGUE TOUCHED: NO" proof for the verification
// report, not as the primary safety mechanism (assertAllowed, which runs
// BEFORE every write and throws immediately, is that).
export function auditLogIsEntirelyShowcaseScoped(): boolean {
  return auditLog.every((e) => {
    try {
      assertAllowed(e.collectionPath, e.docId);
      return true;
    } catch {
      return false;
    }
  });
}
