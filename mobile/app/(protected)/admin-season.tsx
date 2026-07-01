import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Modal, TextInput, Alert } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import {
  collection, doc, onSnapshot, query, where, updateDoc, addDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import * as S from '@/styles/common';

interface Division { id: string; name: string; order: number }
interface Team { id: string; name: string; divisionId: string; captainUserId: string | null }

const STATUS_OPTIONS = [
  { value: 'upcoming', label: 'Upcoming', color: '#FF9500' },
  { value: 'active', label: 'Active', color: '#34C759' },
  { value: 'completed', label: 'Completed', color: 'rgba(255,255,255,0.4)' },
];

export default function AdminSeasonScreen() {
  const { seasonId } = useLocalSearchParams<{ seasonId: string }>();
  const { appUser } = useAuthStore();

  const [seasonName, setSeasonName] = useState('');
  const [seasonStatus, setSeasonStatus] = useState('upcoming');
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [addTeamTarget, setAddTeamTarget] = useState<Division | null>(null);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamAddress, setNewTeamAddress] = useState('');
  const [isAddingTeam, setIsAddingTeam] = useState(false);

  useEffect(() => {
    if (!seasonId) return;

    const unsubSeason = onSnapshot(doc(db, 'seasons', seasonId), (snap) => {
      if (snap.exists()) {
        setSeasonName(snap.data().name);
        setSeasonStatus(snap.data().status);
      }
    });

    const unsubDivisions = onSnapshot(
      query(collection(db, 'divisions'), where('seasonId', '==', seasonId)),
      (snap) => {
        setDivisions(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() } as Division))
            .sort((a, b) => a.order - b.order),
        );
      },
    );

    const unsubTeams = onSnapshot(
      query(collection(db, 'teams'), where('seasonId', '==', seasonId)),
      (snap) => {
        setTeams(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Team)));
        setIsLoading(false);
      },
    );

    return () => { unsubSeason(); unsubDivisions(); unsubTeams(); };
  }, [seasonId]);

  async function setStatus(status: string) {
    if (!seasonId) return;
    await updateDoc(doc(db, 'seasons', seasonId), { status });
  }

  async function addTeam() {
    if (!newTeamName.trim() || !addTeamTarget || !appUser?.leagueId) return;
    setIsAddingTeam(true);
    try {
      await addDoc(collection(db, 'teams'), {
        leagueId: appUser.leagueId,
        seasonId,
        divisionId: addTeamTarget.id,
        name: newTeamName.trim(),
        address: newTeamAddress.trim() || null,
        captainUserId: null,
        viceCaptainUserId: null,
        playerInviteCode: null,
        createdAt: serverTimestamp(),
      });
      setAddTeamTarget(null);
      setNewTeamName('');
      setNewTeamAddress('');
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error).message ?? 'Something went wrong');
    } finally {
      setIsAddingTeam(false);
    }
  }

  const teamsForDivision = (divId: string) => teams.filter((t) => t.divisionId === divId);
  const unassignedTeams = teams.filter((t) => !divisions.find((d) => d.id === t.divisionId));

  return (
    <LinearGradient colors={S.GRADIENT} style={{ flex: 1 }}>
      <Stack.Screen options={{ title: seasonName || 'Season' }} />
      <ScrollView contentContainerStyle={{ padding: 20 }}>

        {/* Status toggle */}
        <BlurView intensity={20} tint="dark" style={{ borderRadius: 16, overflow: 'hidden', marginBottom: 20 }}>
          <View style={[S.glassCard, { padding: 16 }]}>
            <Text style={{ color: S.WHITE_50, fontSize: 12, marginBottom: 10 }}>SEASON STATUS</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {STATUS_OPTIONS.map((opt) => {
                const isSelected = seasonStatus === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    onPress={() => setStatus(opt.value)}
                    style={{
                      flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center',
                      backgroundColor: isSelected ? `${opt.color}33` : 'rgba(255,255,255,0.05)',
                      borderWidth: 1,
                      borderColor: isSelected ? opt.color : 'rgba(255,255,255,0.1)',
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={{ color: isSelected ? opt.color : S.WHITE_50, fontSize: 13, fontWeight: '600' }}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </BlurView>

        {isLoading ? (
          <ActivityIndicator color={S.BLUE} />
        ) : divisions.length === 0 ? (
          <Text style={{ color: S.WHITE_50, textAlign: 'center', paddingVertical: 20 }}>
            No divisions yet. Approve team requests from the home screen to populate this season.
          </Text>
        ) : (
          <>
            {divisions.map((division) => {
              const divTeams = teamsForDivision(division.id);
              return (
                <View key={division.id} style={{ marginBottom: 24 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                    <Text style={{ color: S.WHITE, fontSize: 15, fontWeight: '700', flex: 1 }}>
                      {division.name}
                    </Text>
                    <TouchableOpacity
                      onPress={() => { setAddTeamTarget(division); setNewTeamName(''); setNewTeamAddress(''); }}
                      style={{ backgroundColor: 'rgba(0,122,255,0.2)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}
                      activeOpacity={0.7}
                    >
                      <Text style={{ color: S.BLUE, fontSize: 12, fontWeight: '600' }}>+ Add Team</Text>
                    </TouchableOpacity>
                  </View>
                  {divTeams.length === 0 ? (
                    <Text style={{ color: S.WHITE_50, fontSize: 13, paddingLeft: 4 }}>No teams yet</Text>
                  ) : (
                    divTeams.map((team) => (
                      <TouchableOpacity
                        key={team.id}
                        onPress={() => router.push(`/(protected)/admin-team?teamId=${team.id}`)}
                        activeOpacity={0.7}
                        style={{
                          padding: 14, borderRadius: 12, marginBottom: 8,
                          backgroundColor: 'rgba(255,255,255,0.07)',
                          borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
                          flexDirection: 'row', alignItems: 'center',
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: S.WHITE, fontWeight: '600' }}>{team.name}</Text>
                          <Text style={{ color: S.WHITE_50, fontSize: 12, marginTop: 2 }}>
                            {team.captainUserId ? 'Captain assigned' : 'No captain'}
                          </Text>
                        </View>
                        <Text style={{ color: S.WHITE_50 }}>›</Text>
                      </TouchableOpacity>
                    ))
                  )}
                </View>
              );
            })}

            {unassignedTeams.length > 0 && (
              <View style={{ marginBottom: 20 }}>
                <Text style={{ color: S.WHITE_50, fontSize: 13, fontWeight: '700', marginBottom: 8 }}>
                  UNASSIGNED
                </Text>
                {unassignedTeams.map((team) => (
                  <TouchableOpacity
                    key={team.id}
                    onPress={() => router.push(`/(protected)/admin-team?teamId=${team.id}`)}
                    activeOpacity={0.7}
                    style={{
                      padding: 14, borderRadius: 12, marginBottom: 8,
                      backgroundColor: 'rgba(255,255,255,0.07)',
                      borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
                      flexDirection: 'row', alignItems: 'center',
                    }}
                  >
                    <Text style={{ color: S.WHITE, flex: 1, fontWeight: '600' }}>{team.name}</Text>
                    <Text style={{ color: S.WHITE_50 }}>›</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Add team modal */}
      <Modal visible={!!addTeamTarget} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', padding: 24 }}>
          <BlurView intensity={30} tint="dark" style={{ borderRadius: 20, overflow: 'hidden' }}>
            <View style={S.glassCard}>
              <Text style={{ color: S.WHITE, fontSize: 20, fontWeight: '700', marginBottom: 4 }}>
                Add Team
              </Text>
              <Text style={{ color: S.WHITE_50, fontSize: 13, marginBottom: 20 }}>
                {addTeamTarget?.name}
              </Text>

              <Text style={S.label}>TEAM NAME</Text>
              <TextInput
                value={newTeamName}
                onChangeText={setNewTeamName}
                placeholder="e.g. The Arrows"
                placeholderTextColor={S.WHITE_30}
                autoCapitalize="words"
                autoFocus
                style={[S.input, { marginBottom: 16 }]}
              />

              <Text style={S.label}>HOME VENUE / ADDRESS (OPTIONAL)</Text>
              <TextInput
                value={newTeamAddress}
                onChangeText={setNewTeamAddress}
                placeholder="e.g. The Red Lion, 12 High St"
                placeholderTextColor={S.WHITE_30}
                autoCapitalize="words"
                style={[S.input, { marginBottom: 24 }]}
              />

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity
                  onPress={() => setAddTeamTarget(null)}
                  style={{ flex: 1, padding: 14, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center' }}
                >
                  <Text style={{ color: S.WHITE_60 }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={addTeam}
                  disabled={isAddingTeam || !newTeamName.trim()}
                  style={[isAddingTeam || !newTeamName.trim() ? S.primaryButtonDisabled : S.primaryButton, { flex: 1 }]}
                >
                  {isAddingTeam
                    ? <ActivityIndicator color={S.WHITE} />
                    : <Text style={S.primaryButtonText}>Add Team</Text>
                  }
                </TouchableOpacity>
              </View>
            </View>
          </BlurView>
        </View>
      </Modal>
    </LinearGradient>
  );
}
