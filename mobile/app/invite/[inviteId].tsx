import { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { clearPendingInvite, hasUsableInviteToken, loadPendingInvite, savePendingInvite } from '@/lib/pendingInvite';
import { RAW } from '@/lib/theme';
import { Heading, Body, Button, Card } from '@/components/ui';

// Reachable signed-out (no (protected) or (auth) wrapper, no auth gate in
// the root layout) — the one entry point a Captain/VC invite link lands
// on. See app/index.tsx's post-auth redirect for the other half of this:
// it checks for a pending invite (persisted here) before its normal
// role-based routing, so a brand-new registration still comes back here.
export default function AcceptInviteScreen() {
  const { inviteId, t } = useLocalSearchParams<{ inviteId: string; t?: string }>();
  const { firebaseUser, appUser, isLoading } = useAuthStore();

  const [isAccepting, setIsAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ teamName: string; role: string } | null>(null);
  // null while still checking this device's storage for a token saved by
  // an earlier visit to this same link — only once resolved do we know
  // whether to show the real flow or fail clearly. Starts resolved when
  // the URL itself already carries a token.
  const [hasToken, setHasToken] = useState<boolean | null>(t ? true : null);

  useEffect(() => {
    if (!inviteId || !t) return;
    savePendingInvite({ inviteId, token: t });
  }, [inviteId, t]);

  // The actual "is there a usable token" check — covers both a live ?t= in
  // the URL and a token saved to this device by an earlier visit (the path
  // app/index.tsx's post-auth redirect relies on). If neither is true,
  // this invite link never carried its security token and there is
  // nothing to recover: fail clearly instead of silently letting the
  // visitor proceed into Create Account/Sign In as if nothing were wrong.
  useEffect(() => {
    if (t) { setHasToken(true); return; }
    let cancelled = false;
    loadPendingInvite().then((stored) => {
      if (cancelled) return;
      setHasToken(hasUsableInviteToken({ inviteId, token: t, stored }));
    });
    return () => { cancelled = true; };
  }, [inviteId, t]);

  async function accept() {
    const pending = (inviteId && t) ? { inviteId, token: t } : await loadPendingInvite();
    if (!pending) {
      setError('No invite found on this device. Ask your admin to resend the link.');
      return;
    }
    setIsAccepting(true);
    setError(null);
    try {
      const res = await httpsCallable(functions, 'acceptTeamInvite')({ inviteId: pending.inviteId, token: pending.token });
      setResult(res.data as { teamName: string; role: string });
      await clearPendingInvite();
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Something went wrong');
    } finally {
      setIsAccepting(false);
    }
  }

  if (!inviteId || hasToken === false) {
    return (
      <View className="flex-1 bg-bg dark:bg-bg-dark items-center justify-center p-6">
        <Stack.Screen options={{ headerShown: false }} />
        <Body>This invite link looks incomplete. Ask your admin to resend it.</Body>
      </View>
    );
  }

  if (isLoading || hasToken === null) {
    return (
      <View className="flex-1 bg-bg dark:bg-bg-dark items-center justify-center">
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator size="large" color={RAW.brand} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg dark:bg-bg-dark items-center justify-center p-6">
      <Stack.Screen options={{ headerShown: false }} />
      <Card className="w-full" style={{ maxWidth: 420 }}>
        {result ? (
          <>
            <Heading size="lg" className="mb-2">You're in!</Heading>
            <Body className="mb-4">
              You're now {result.role === 'viceCaptain' ? 'Vice Captain' : 'Captain'} of {result.teamName}.
            </Body>
            <Button onPress={() => router.replace('/')}>Continue</Button>
          </>
        ) : !firebaseUser ? (
          <>
            <Heading size="lg" className="mb-2">You've been invited to Chalkie</Heading>
            <Body className="mb-4">Sign in or create an account to accept this invitation.</Body>
            <Button className="mb-2.5" onPress={() => router.push('/(auth)/register')}>Create Account</Button>
            <Button variant="secondary" onPress={() => router.push('/(auth)/login')}>Sign In</Button>
          </>
        ) : (
          <>
            <Heading size="lg" className="mb-2">Accept Invitation</Heading>
            <Body className="mb-4">
              Signed in as {appUser?.displayName || appUser?.email}. Tap below to accept this team invitation.
            </Body>
            <Button disabled={isAccepting} loading={isAccepting} onPress={accept}>Accept Invitation</Button>
          </>
        )}
        {error && (
          <Card tone="coral" className="mt-3">
            <Body size="sm" tone="coral">{error}</Body>
          </Card>
        )}
      </Card>
    </View>
  );
}
