import { useState, useEffect } from 'react';
import { View, TouchableOpacity, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { router, Stack } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { collection, getDocs, query, where, addDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { RAW } from '@/lib/theme';
import { Heading, Body, Caption, Button, Card, Input, AppIcon } from '@/components/ui';

interface TeamDoc { id: string; name: string; captainUserId: string | null }
interface UnclaimedPlayer { id: string; name: string }

export default function BrowseTeamsScreen() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [teams, setTeams] = useState<TeamDoc[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<TeamDoc | null>(null);
  const [unclaimedPlayers, setUnclaimedPlayers] = useState<UnclaimedPlayer[]>([]);
  const [isLoadingRoster, setIsLoadingRoster] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [claimingPlayerId, setClaimingPlayerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { appUser } = useAuthStore();
  const { league, team: preselectedTeam, hasHydrated } = useOnboardingStore();

  useEffect(() => {
    if (!hasHydrated) return;
    if (!league) { router.replace('/(protected)/find-league'); return; }
    getDocs(query(collection(db, 'teams'), where('leagueId', '==', league.id)))
      .then((snap) =>
        setTeams(
          snap.docs
            .map((d) => ({ id: d.id, name: d.data().name, captainUserId: d.data().captainUserId ?? null }))
            .sort((a, b) => a.name.localeCompare(b.name))
        )
      )
      .catch(() => setError('Could not load teams.'))
      .finally(() => setIsLoading(false));
  }, [league, hasHydrated]);

  // Pre-select team if arrived via tc invite code
  useEffect(() => {
    if (preselectedTeam) setSelected({ id: preselectedTeam.id, name: preselectedTeam.name, captainUserId: null });
  }, [preselectedTeam]);

  // Once a team is picked, fetch the roster its captain has already added but
  // nobody's claimed yet — lets someone say "that's me" instead of typing a code.
  useEffect(() => {
    if (!selected) { setUnclaimedPlayers([]); return; }
    setIsLoadingRoster(true);
    getDocs(query(collection(db, 'players'), where('teamId', '==', selected.id), where('claimedByUserId', '==', null)))
      .then((snap) => {
        setUnclaimedPlayers(
          snap.docs
            .map((d) => ({ id: d.id, name: d.data().name as string }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      })
      .finally(() => setIsLoadingRoster(false));
  }, [selected]);

  const filtered = search.trim()
    ? teams.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
    : teams;

  async function markPendingRequest(reqId: string, requestType: 'join' | 'claim') {
    if (!appUser || !league) return;
    await updateDoc(doc(db, 'users', appUser.uid), {
      leagueId: league.id,
      pendingRequestType: requestType,
      pendingRequestId: reqId,
    });
    useOnboardingStore.getState().clear();
    router.replace('/(protected)/request-pending');
  }

  async function claimPlayer(player: UnclaimedPlayer) {
    if (!selected || !league || !appUser) return;
    setClaimingPlayerId(player.id);
    setError(null);
    try {
      const reqRef = await addDoc(collection(db, 'joinRequests'), {
        leagueId: league.id,
        teamId: selected.id,
        teamName: selected.name,
        userId: appUser.uid,
        displayName: appUser.displayName,
        requestType: 'claim',
        claimPlayerId: player.id,
        requestedRole: null,
        status: 'pending',
        createdAt: serverTimestamp(),
      });
      await markPendingRequest(reqRef.id, 'claim');
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Something went wrong');
      setClaimingPlayerId(null);
    }
  }

  async function submitJoinRequest() {
    if (!selected || !league || !appUser) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const reqRef = await addDoc(collection(db, 'joinRequests'), {
        leagueId: league.id,
        teamId: selected.id,
        teamName: selected.name,
        userId: appUser.uid,
        displayName: appUser.displayName,
        requestType: 'join',
        claimPlayerId: null,
        requestedRole: null,
        status: 'pending',
        createdAt: serverTimestamp(),
      });
      await markPendingRequest(reqRef.id, 'join');
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Something went wrong');
      setIsSubmitting(false);
    }
  }

  return (
    <View className="flex-1 bg-bg dark:bg-bg-dark">
      <Stack.Screen options={{ title: 'Join a Team' }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 24 }} keyboardShouldPersistTaps="handled">
          <Card>
            <Caption className="mb-1">{league?.name}</Caption>
            <Heading size="lg" className="mb-4">
              {preselectedTeam ? 'Confirm your team' : 'Find your team'}
            </Heading>

            {error ? (
              <Card tone="coral" className="mb-4" padded={false}>
                <Body tone="coral" className="p-3">{error}</Body>
              </Card>
            ) : null}

            {!preselectedTeam && (
              <Input value={search} onChangeText={setSearch} placeholder="Search teams…" className="mb-4" />
            )}

            {isLoading ? (
              <ActivityIndicator color={RAW.brand} />
            ) : filtered.length === 0 ? (
              <Body className="text-center py-3">No teams found</Body>
            ) : (
              filtered.map((team) => {
                const isSelected = selected?.id === team.id;
                return (
                  <TouchableOpacity
                    key={team.id}
                    onPress={() => setSelected(isSelected ? null : team)}
                    activeOpacity={0.7}
                    className={[
                      'flex-row items-center justify-between py-3.5 px-4 rounded-2xl mb-2',
                      isSelected ? 'bg-brand-fill dark:bg-brand-fill-dark' : 'bg-surface-2 dark:bg-surface-2-dark',
                    ].join(' ')}
                  >
                    <View>
                      <Body tone="strong">{team.name}</Body>
                      <Body size="xs" className="mt-0.5">
                        {team.captainUserId ? 'Captain assigned' : 'No captain yet'}
                      </Body>
                    </View>
                    {isSelected && <AppIcon name="check" size={20} color={isDark ? RAW.brandInkDark : RAW.brandInk} />}
                  </TouchableOpacity>
                );
              })
            )}
          </Card>

          {selected && (
            <Card className="mt-4">
              <Heading size="sm" className="mb-1">Is one of these you?</Heading>
              <Body size="sm" className="mb-4">
                Your captain may have already added you to the squad — pick your name to link your account.
              </Body>

              {isLoadingRoster ? (
                <ActivityIndicator color={RAW.brand} />
              ) : unclaimedPlayers.length === 0 ? (
                <Body size="sm" className="mb-2">No unclaimed players on this team yet.</Body>
              ) : (
                <View className="mb-2">
                  {unclaimedPlayers.map((player) => (
                    <View key={player.id} className="flex-row items-center justify-between py-3 px-4 rounded-2xl mb-2 bg-surface-2 dark:bg-surface-2-dark">
                      <Body tone="strong" className="flex-1" numberOfLines={1}>{player.name}</Body>
                      <Button
                        size="sm"
                        disabled={claimingPlayerId === player.id}
                        loading={claimingPlayerId === player.id}
                        onPress={() => claimPlayer(player)}
                      >
                        This is me
                      </Button>
                    </View>
                  ))}
                </View>
              )}

              <View className="h-px my-3 bg-border dark:bg-border-dark" />

              <Body size="sm" className="mb-3">Not on the list?</Body>
              <Button
                variant="secondary"
                onPress={submitJoinRequest}
                disabled={isSubmitting || claimingPlayerId !== null}
                loading={isSubmitting}
              >
                I'm not here — request to join {selected.name}
              </Button>
            </Card>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
