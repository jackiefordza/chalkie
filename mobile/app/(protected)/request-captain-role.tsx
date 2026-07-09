import { useState, useEffect } from 'react';
import { View, TouchableOpacity, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { router, Stack } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { collection, getDocs, query, where, addDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { RAW } from '@/lib/theme';
import { Heading, Body, Caption, Button, Card, Input, Label, VisibilityPicker, AppIcon } from '@/components/ui';
import type { PhoneVisibility } from '@/types';

interface TeamDoc { id: string; name: string; captainUserId: string | null; viceCaptainUserId: string | null }

const ROLE_OPTIONS: { value: 'captain' | 'viceCaptain'; label: string; description: string }[] = [
  { value: 'captain', label: 'Captain', description: 'Approved by the league admin.' },
  { value: 'viceCaptain', label: 'Vice Captain', description: "Approved by the team's captain." },
];

export default function RequestCaptainRoleScreen() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [teams, setTeams] = useState<TeamDoc[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<TeamDoc | null>(null);
  const [role, setRole] = useState<'captain' | 'viceCaptain'>('captain');
  const [phone, setPhone] = useState('');
  const [phoneVisibility, setPhoneVisibility] = useState<PhoneVisibility>('captains');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { appUser } = useAuthStore();
  const { league, hasHydrated, setCaptainPath } = useOnboardingStore();

  const captainTaken = !!selected?.captainUserId;
  const vcTaken = !!selected?.viceCaptainUserId;
  const bothRolesTaken = captainTaken && vcTaken;

  function goAsPlayerInstead() {
    setCaptainPath(false);
    router.replace('/(protected)/browse-teams');
  }

  useEffect(() => {
    if (!hasHydrated) return;
    if (!league) { router.replace('/(protected)/find-league'); return; }
    getDocs(query(collection(db, 'teams'), where('leagueId', '==', league.id)))
      .then((snap) =>
        setTeams(
          snap.docs
            .map((d) => ({
              id: d.id, name: d.data().name,
              captainUserId: d.data().captainUserId ?? null,
              viceCaptainUserId: d.data().viceCaptainUserId ?? null,
            }))
            .sort((a, b) => a.name.localeCompare(b.name))
        )
      )
      .catch(() => setError('Could not load teams.'))
      .finally(() => setIsLoading(false));
  }, [league, hasHydrated]);

  // Steer toward whichever role is actually open on the selected team — a
  // team that already has a Captain should default to Vice Captain, and
  // vice versa, rather than letting a request pile onto a filled slot.
  useEffect(() => {
    if (!selected) return;
    if (selected.captainUserId && !selected.viceCaptainUserId) setRole('viceCaptain');
    else if (!selected.captainUserId) setRole('captain');
  }, [selected]);

  const filtered = search.trim()
    ? teams.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
    : teams;

  async function submit() {
    if (!selected || !league || !appUser) return;
    if (!phone.trim()) { setError('Enter your mobile number'); return; }
    setError(null);
    setIsSubmitting(true);
    try {
      const reqRef = await addDoc(collection(db, 'joinRequests'), {
        leagueId: league.id,
        teamId: selected.id,
        teamName: selected.name,
        userId: appUser.uid,
        displayName: appUser.displayName,
        requestType: 'captainRole',
        claimPlayerId: null,
        requestedRole: role,
        status: 'pending',
        createdAt: serverTimestamp(),
      });

      await updateDoc(doc(db, 'users', appUser.uid), {
        leagueId: league.id,
        pendingRequestType: 'captainRole',
        pendingRequestId: reqRef.id,
        phone: phone.trim(),
        phoneVisibility,
      });

      useOnboardingStore.getState().clear();
      router.replace('/(protected)/request-pending');
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Something went wrong');
      setIsSubmitting(false);
    }
  }

  return (
    <View className="flex-1 bg-bg dark:bg-bg-dark">
      <Stack.Screen options={{ title: 'Join as Captain / VC' }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 24 }} keyboardShouldPersistTaps="handled">
          <Card>
            <Caption className="mb-1">{league?.name}</Caption>
            <Heading size="lg" className="mb-1.5">Find your team</Heading>
            <Body size="sm" className="mb-4">
              Search for the team your league admin has already set up.
            </Body>

            {error ? (
              <Card tone="coral" className="mb-4" padded={false}>
                <Body tone="coral" className="p-3">{error}</Body>
              </Card>
            ) : null}

            <Input value={search} onChangeText={setSearch} placeholder="Search teams…" className="mb-4" />

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

          {selected && bothRolesTaken && (
            <Card className="mt-4">
              <Heading size="sm" className="mb-1.5">Already fully staffed</Heading>
              <Body size="sm" className="mb-4">
                {selected.name} already has both a Captain and a Vice Captain. You can still join the
                team as a player.
              </Body>
              <Button variant="secondary" onPress={goAsPlayerInstead}>Join as a Player instead</Button>
            </Card>
          )}

          {selected && !bothRolesTaken && (
            <Card className="mt-4">
              <Label>Which role?</Label>
              <View className="gap-2 mb-5">
                {ROLE_OPTIONS.map((opt) => {
                  const taken = opt.value === 'captain' ? captainTaken : vcTaken;
                  const isSelected = role === opt.value && !taken;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      onPress={() => { if (!taken) setRole(opt.value); }}
                      disabled={taken}
                      activeOpacity={taken ? 1 : 0.7}
                      className={[
                        'flex-row items-center min-h-[44px] p-3 rounded-2xl',
                        taken ? 'opacity-40' : '',
                        isSelected ? 'bg-brand-fill dark:bg-brand-fill-dark' : 'bg-surface-2 dark:bg-surface-2-dark',
                      ].join(' ')}
                    >
                      <View
                        className={[
                          'w-5 h-5 rounded-full mr-3 border-2 items-center justify-center',
                          isSelected ? 'border-brand-ink dark:border-brand-ink-dark' : 'border-border dark:border-border-dark',
                        ].join(' ')}
                      >
                        {isSelected && <View className="w-2.5 h-2.5 rounded-full bg-brand dark:bg-brand-dark" />}
                      </View>
                      <View className="flex-1">
                        <Body tone="strong" weight="semibold">{opt.label}</Body>
                        <Body size="xs" className="mt-0.5">
                          {taken ? `Already has a ${opt.label}` : opt.description}
                        </Body>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Label>Your mobile number</Label>
              <Input value={phone} onChangeText={setPhone} placeholder="e.g. 07700 900123" keyboardType="phone-pad" className="mb-5" />

              <Label>Who can see your number?</Label>
              <VisibilityPicker value={phoneVisibility} onChange={setPhoneVisibility} />

              <Button
                onPress={submit}
                disabled={isSubmitting || !phone.trim()}
                loading={isSubmitting}
                className="mt-6"
              >
                Request to Join as {ROLE_OPTIONS.find((o) => o.value === role)?.label}
              </Button>
            </Card>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
