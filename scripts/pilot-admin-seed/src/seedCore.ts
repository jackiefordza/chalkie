import * as crypto from 'node:crypto';
import * as admin from 'firebase-admin';
import {
  ADMIN_DISPLAY_NAME, ADMIN_EMAIL, LEAGUE_ID, PENDING_ADMIN_PLACEHOLDER,
} from './constants';
import { safeSet, registerPilotAdminUserId } from './firebaseAdmin';

const FieldValue = admin.firestore.FieldValue;

// Only ever called when actually creating the Auth user below — never
// stored anywhere (not Firestore, not a file, not this source tree). The
// caller prints it once to this run's own console output.
function generateOneTimePassword(): string {
  return crypto.randomBytes(24).toString('base64url');
}

async function ensureAuthUser(auth: admin.auth.Auth): Promise<{ uid: string; newPassword: string | null }> {
  try {
    const existing = await auth.getUserByEmail(ADMIN_EMAIL);
    registerPilotAdminUserId(existing.uid);
    return { uid: existing.uid, newPassword: null };
  } catch (e: unknown) {
    if ((e as { code?: string }).code !== 'auth/user-not-found') throw e;
    const password = generateOneTimePassword();
    const created = await auth.createUser({ email: ADMIN_EMAIL, password, displayName: ADMIN_DISPLAY_NAME });
    registerPilotAdminUserId(created.uid);
    return { uid: created.uid, newPassword: password };
  }
}

// Mirrors scripts/showcase-seed's seedAdminPersonas two-step pattern
// exactly: a minimal "just signed up" doc on first creation only (so
// `createdAt` is never bumped on a re-run, and every genuine account always
// has isLeagueAdmin/isGlobalAdmin explicitly false at creation, matching the
// real signup flow in authStore.ts's register()), then this script's own
// deliberate second write is the ONLY thing that ever flips isLeagueAdmin to
// true. role stays 'pending' forever — this account is never a captain/VC/
// player of any team, and isLeagueAdmin (not role) is what the deployed
// firestore.rules / assertLeagueAdmin actually gate admin access on.
async function ensureBaseUserDoc(db: admin.firestore.Firestore, uid: string): Promise<void> {
  const existing = await db.collection('users').doc(uid).get();
  if (existing.exists) return;
  await safeSet(db, 'users', uid, {
    email: ADMIN_EMAIL, displayName: ADMIN_DISPLAY_NAME, role: 'pending',
    leagueId: null, seasonId: null, teamId: null, divisionId: null, playerId: null,
    isLeagueAdmin: false, isGlobalAdmin: false,
    pendingRequestType: null, pendingRequestId: null, phone: null, phoneVisibility: null,
    createdAt: FieldValue.serverTimestamp(),
  });
}

export async function seedPilotAdmin(
  db: admin.firestore.Firestore, auth: admin.auth.Auth, log: (msg: string) => void,
): Promise<{ uid: string; newPassword: string | null }> {
  log('Pilot admin account: ensuring Auth user + base user doc…');
  const { uid, newPassword } = await ensureAuthUser(auth);
  await ensureBaseUserDoc(db, uid);

  log(`Pilot admin account: granting league-scoped admin (leagueId=${LEAGUE_ID})…`);
  // Scoped to the real pilot league specifically — never isGlobalAdmin, so
  // this account can only ever act within bedford-kempston-district, same
  // restraint scripts/showcase-seed's own league-admin persona uses.
  await safeSet(db, 'users', uid, { leagueId: LEAGUE_ID, isLeagueAdmin: true, isGlobalAdmin: false });

  // leagues/{LEAGUE_ID}.adminUserId is a required, non-nullable string in
  // the real schema (mobile/src/types/index.ts) — scripts/
  // real-season-import-staging left it as PENDING_ADMIN_PLACEHOLDER
  // ("pending real admin onboarding", see that script's importer.ts) because
  // no real admin account existed yet at that point. This is that onboarding
  // step, now that this account's uid is actually resolved — only ever
  // overwrites the placeholder, never a different real admin someone else
  // may have already set.
  const leagueSnap = await db.collection('leagues').doc(LEAGUE_ID).get();
  if (!leagueSnap.exists) {
    throw new Error(`leagues/${LEAGUE_ID} does not exist — run scripts/real-season-import-staging first.`);
  }
  const currentAdminUserId = leagueSnap.data()?.adminUserId;
  if (currentAdminUserId === PENDING_ADMIN_PLACEHOLDER) {
    log(`leagues/${LEAGUE_ID}: correcting adminUserId placeholder → this pilot admin's uid…`);
    await safeSet(db, 'leagues', LEAGUE_ID, { adminUserId: uid });
  } else if (currentAdminUserId !== uid) {
    log(
      `leagues/${LEAGUE_ID}.adminUserId is already "${currentAdminUserId}" (not the placeholder, and not this `
      + 'account) — leaving it untouched. This script only ever corrects the pending-onboarding placeholder, '
      + 'never a different already-set real admin.',
    );
  }

  return { uid, newPassword };
}
