import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { router, Stack } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { collection, getDocs, query, where, addDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import * as S from '@/styles/common';

interface TeamDoc { id: string; name: string; captainUserId: string | null }

export default function BrowseTeamsScreen() {
  const [teams, setTeams] = useState<TeamDoc[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<TeamDoc | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { appUser } = useAuthStore();
  const { league, team: preselectedTeam } = useOnboardingStore();

  useEffect(() => {
    if (!league) return;
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
  }, [league]);

  // Pre-select team if arrived via tc invite code
  useEffect(() => {
    if (preselectedTeam) setSelected({ id: preselectedTeam.id, name: preselectedTeam.name, captainUserId: null });
  }, [preselectedTeam]);

  const filtered = search.trim()
    ? teams.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
    : teams;

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
        status: 'pending',
        createdAt: serverTimestamp(),
      });

      await updateDoc(doc(db, 'users', appUser.uid), {
        leagueId: league.id,
        pendingRequestType: 'join',
        pendingRequestId: reqRef.id,
      });

      router.replace('/(protected)/request-pending');
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Something went wrong');
      setIsSubmitting(false);
    }
  }

  return (
    <LinearGradient colors={S.GRADIENT} style={{ flex: 1 }}>
      <Stack.Screen options={{ title: 'Join a Team' }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          <BlurView intensity={20} tint="dark" style={{ borderRadius: 20, overflow: 'hidden' }}>
            <View style={S.glassCard}>
              <Text style={{ color: S.WHITE_50, fontSize: 13, marginBottom: 4 }}>{league?.name}</Text>
              <Text style={{ color: S.WHITE, fontSize: 22, fontWeight: '700', marginBottom: 16 }}>
                {preselectedTeam ? 'Confirm your team' : 'Find your team'}
              </Text>

              {error ? (
                <View style={S.errorBox}>
                  <Text style={{ color: S.RED, fontSize: 14 }}>{error}</Text>
                </View>
              ) : null}

              {!preselectedTeam && (
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search teams…"
                  placeholderTextColor={S.WHITE_30}
                  style={[S.input, { marginBottom: 16 }]}
                />
              )}

              {isLoading ? (
                <ActivityIndicator color={S.BLUE} />
              ) : filtered.length === 0 ? (
                <Text style={{ color: S.WHITE_50, textAlign: 'center', paddingVertical: 12 }}>
                  No teams found
                </Text>
              ) : (
                filtered.map((team) => {
                  const isSelected = selected?.id === team.id;
                  return (
                    <TouchableOpacity
                      key={team.id}
                      onPress={() => setSelected(isSelected ? null : team)}
                      activeOpacity={0.7}
                      style={{
                        paddingVertical: 14,
                        paddingHorizontal: 16,
                        backgroundColor: isSelected ? 'rgba(0,122,255,0.25)' : 'rgba(255,255,255,0.08)',
                        borderRadius: 12,
                        marginBottom: 8,
                        borderWidth: 1.5,
                        borderColor: isSelected ? S.BLUE : 'rgba(255,255,255,0.22)',
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <View>
                        <Text style={{ color: S.WHITE, fontSize: 16, fontWeight: '500' }}>{team.name}</Text>
                        <Text style={{ color: S.WHITE_50, fontSize: 12, marginTop: 2 }}>
                          {team.captainUserId ? 'Captain assigned' : 'No captain yet'}
                        </Text>
                      </View>
                      {isSelected && (
                        <Text style={{ color: S.BLUE, fontSize: 20 }}>✓</Text>
                      )}
                    </TouchableOpacity>
                  );
                })
              )}

              {selected && (
                <TouchableOpacity
                  onPress={submitJoinRequest}
                  disabled={isSubmitting}
                  style={[isSubmitting ? S.primaryButtonDisabled : S.primaryButton, { marginTop: 16 }]}
                  activeOpacity={0.8}
                >
                  {isSubmitting
                    ? <ActivityIndicator color={S.WHITE} />
                    : <Text style={S.primaryButtonText}>Request to Join {selected.name}</Text>
                  }
                </TouchableOpacity>
              )}

              <TouchableOpacity
                onPress={() => router.push('/(protected)/claim-profile')}
                style={{ marginTop: 20 }}
                activeOpacity={0.7}
              >
                <Text style={{ color: S.BLUE, fontSize: 14, textAlign: 'center' }}>
                  My captain already added me — I have a claim code
                </Text>
              </TouchableOpacity>
            </View>
          </BlurView>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}
