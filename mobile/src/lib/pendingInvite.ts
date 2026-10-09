import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'chalkie:pendingInvite';

export interface PendingInvite {
  inviteId: string;
  token: string;
}

// Persists the one invite a device is mid-accepting across the
// login/register redirect chain — app/index.tsx's post-auth redirect reads
// this BEFORE its normal role-based switch, so a captain who registers a
// brand-new account from the invite link still lands back on the invite
// screen afterward instead of being swept into the default onboarding flow.
// Same AsyncStorage-backed, load-once pattern already used for theme
// preference (src/lib/themePreference.ts) and onboarding state
// (src/stores/onboardingStore.ts) — nothing new introduced here.
export async function savePendingInvite(invite: PendingInvite): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(invite));
}

export async function loadPendingInvite(): Promise<PendingInvite | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingInvite>;
    if (typeof parsed.inviteId === 'string' && typeof parsed.token === 'string') {
      return { inviteId: parsed.inviteId, token: parsed.token };
    }
  } catch {
    // Malformed storage (shouldn't happen) — treat as no pending invite.
  }
  return null;
}

export async function clearPendingInvite(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

export interface InviteTokenCheck {
  inviteId: string | undefined;
  token: string | undefined;
  stored: PendingInvite | null;
}

// Whether app/invite/[inviteId].tsx has an actual token to work with for
// THIS invite — either live in the URL, or previously saved to this
// device by an earlier visit to this same link (the second case is what
// lets the screen work when app/index.tsx redirects back to it without
// re-appending ?t=). False means the link itself never carried a token
// and nothing recoverable exists either — the caller should fail clearly
// instead of letting the visitor fall through into Create Account/Sign In
// as if nothing were wrong.
export function hasUsableInviteToken({ inviteId, token, stored }: InviteTokenCheck): boolean {
  if (!inviteId) return false;
  if (token) return true;
  return !!stored && stored.inviteId === inviteId;
}
