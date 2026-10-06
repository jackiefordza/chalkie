// All READ operations for this diagnostic. Every function here ends in
// a Firestore `get` call — none ever calls a Firestore write method (set,
// update, delete, add, commit, batch) or any Auth write method. Never
// returns the raw invite token (never stored anywhere) or the tokenHash's
// value — only whether tokenHash exists.
import * as admin from 'firebase-admin';
import { BURNABY_B_TEAM_ID, TARGET_INVITE_ROLE } from './constants';

export interface InviteReport {
  inviteId: string;
  leagueId: string | null;
  seasonId: string | null;
  divisionId: string | null;
  teamId: string | null;
  role: string | null;
  status: string | null;
  isExpired: boolean | null;
  tokenHashExists: boolean;
  createdAt: string | null;
  acceptedAt: string | null;
  acceptedByUserId: string | null;
}

export interface UserReport {
  uid: string;
  email: string | null;
  role: string | null;
  leagueId: string | null;
  seasonId: string | null;
  teamId: string | null;
  divisionId: string | null;
  playerId: string | null;
  isLeagueAdmin: boolean | null;
  isGlobalAdmin: boolean | null;
  pendingRequestType: string | null;
  pendingRequestId: string | null;
}

export interface JoinRequestReport {
  id: string;
  status: string | null;
}

function tsToIso(v: unknown): string | null {
  const ts = v as admin.firestore.Timestamp | undefined;
  return ts && typeof ts.toDate === 'function' ? ts.toDate().toISOString() : null;
}

export async function findBurnabyBViceCaptainInvites(db: admin.firestore.Firestore): Promise<InviteReport[]> {
  const snap = await db.collection('invites')
    .where('teamId', '==', BURNABY_B_TEAM_ID)
    .where('role', '==', TARGET_INVITE_ROLE)
    .get();

  const now = Date.now();
  return snap.docs.map((d) => {
    const data = d.data();
    const expiresAt = data.expiresAt as admin.firestore.Timestamp | undefined;
    return {
      inviteId: d.id,
      leagueId: data.leagueId ?? null,
      seasonId: data.seasonId ?? null,
      divisionId: data.divisionId ?? null,
      teamId: data.teamId ?? null,
      role: data.role ?? null,
      status: data.status ?? null,
      isExpired: expiresAt ? expiresAt.toMillis() < now : null,
      tokenHashExists: typeof data.tokenHash === 'string' && data.tokenHash.length > 0,
      createdAt: tsToIso(data.createdAt),
      acceptedAt: tsToIso(data.acceptedAt),
      acceptedByUserId: data.acceptedByUserId ?? null,
    };
  });
}

// Identifies the test account two ways, both read-only: (1) exact match on
// the real reference name already seeded onto teams/bk-d3-team-2 (never a
// hardcoded "Jake Fordham" string independent of that seeded data), and
// (2) a bounded fallback scan of pending accounts in case the registered
// display name doesn't match exactly (different casing/whitespace).
export async function findCandidateUserIds(db: admin.firestore.Firestore): Promise<{ referenceName: string | null; uids: string[] }> {
  const teamSnap = await db.collection('teams').doc(BURNABY_B_TEAM_ID).get();
  const referenceName = (teamSnap.data()?.viceCaptainName as string | undefined) ?? null;

  let found: string[] = [];

  if (referenceName) {
    const exact = await db.collection('users').where('displayName', '==', referenceName).get();
    found = exact.docs.map((d) => d.id);
  }

  if (found.length === 0 && referenceName) {
    const needle = referenceName.toLowerCase().split(/\s+/).filter(Boolean);
    const pending = await db.collection('users').where('role', '==', 'pending').limit(200).get();
    found = pending.docs
      .filter((d) => {
        const dn = ((d.data().displayName as string | undefined) ?? '').toLowerCase();
        return needle.length > 0 && needle.every((part) => dn.includes(part));
      })
      .map((d) => d.id);
  }

  return { referenceName, uids: Array.from(new Set(found)) };
}

export async function buildUserReport(
  db: admin.firestore.Firestore, authClient: admin.auth.Auth, uid: string,
): Promise<UserReport> {
  const [userSnap, authUser] = await Promise.all([
    db.collection('users').doc(uid).get(),
    authClient.getUser(uid).catch(() => null),
  ]);
  const data = userSnap.data() ?? {};
  return {
    uid,
    email: authUser?.email ?? null,
    role: data.role ?? null,
    leagueId: data.leagueId ?? null,
    seasonId: data.seasonId ?? null,
    teamId: data.teamId ?? null,
    divisionId: data.divisionId ?? null,
    playerId: data.playerId ?? null,
    isLeagueAdmin: data.isLeagueAdmin ?? null,
    isGlobalAdmin: data.isGlobalAdmin ?? null,
    pendingRequestType: data.pendingRequestType ?? null,
    pendingRequestId: data.pendingRequestId ?? null,
  };
}

export async function lookUpJoinRequest(
  db: admin.firestore.Firestore, joinRequestId: string,
): Promise<JoinRequestReport | null> {
  const snap = await db.collection('joinRequests').doc(joinRequestId).get();
  if (!snap.exists) return null;
  return { id: snap.id, status: (snap.data()?.status as string | undefined) ?? null };
}
