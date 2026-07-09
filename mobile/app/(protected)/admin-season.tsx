import { useState, useEffect } from 'react';
import { View, ActivityIndicator, Alert } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import {
  collection, doc, onSnapshot, query, where, updateDoc, addDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { RAW, type SemanticTone } from '@/lib/theme';
import { Screen, Heading, Body, Caption, Button, Card, Chip, ListRow, Input, Label, Sheet } from '@/components/ui';

interface Division { id: string; name: string; order: number }
interface Team { id: string; name: string; divisionId: string; captainUserId: string | null }

const STATUS_OPTIONS: { value: string; label: string; tone: SemanticTone }[] = [
  { value: 'upcoming', label: 'Upcoming', tone: 'butter' },
  { value: 'active', label: 'Active', tone: 'sage' },
  { value: 'completed', label: 'Completed', tone: 'brand' },
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
    <Screen>
      <Stack.Screen options={{ title: seasonName || 'Season' }} />

      {/* Status toggle */}
      <Card className="mb-5">
        <Caption className="mb-2.5">Season Status</Caption>
        <View className="flex-row gap-2">
          {STATUS_OPTIONS.map((opt) => (
            <Chip
              key={opt.value}
              label={opt.label}
              tone={opt.tone}
              selected={seasonStatus === opt.value}
              onPress={() => setStatus(opt.value)}
              className="flex-1"
            />
          ))}
        </View>
      </Card>

      {isLoading ? (
        <ActivityIndicator color={RAW.brand} />
      ) : divisions.length === 0 ? (
        <Body className="text-center py-5">
          No divisions yet. Approve team requests from the home screen to populate this season.
        </Body>
      ) : (
        <>
          {divisions.map((division) => {
            const divTeams = teamsForDivision(division.id);
            return (
              <View key={division.id} className="mb-6">
                <View className="flex-row items-center mb-2">
                  <Heading size="sm" className="flex-1">{division.name}</Heading>
                  <Button variant="secondary" size="sm" className="mr-2" onPress={() => router.push('/(protected)/(tabs)/standings')}>
                    Table
                  </Button>
                  <Button variant="secondary" size="sm" className="mr-2" onPress={() => router.push(`/(protected)/admin-fixtures?divisionId=${division.id}`)}>
                    Fixtures
                  </Button>
                  <Button size="sm" onPress={() => { setAddTeamTarget(division); setNewTeamName(''); setNewTeamAddress(''); }}>
                    + Add Team
                  </Button>
                </View>
                {divTeams.length === 0 ? (
                  <Body size="sm" className="pl-1">No teams yet</Body>
                ) : (
                  <View className="gap-2">
                    {divTeams.map((team) => (
                      <ListRow
                        key={team.id}
                        title={team.name}
                        subtitle={team.captainUserId ? 'Captain assigned' : 'No captain'}
                        trailing={<Body tone="dim">›</Body>}
                        onPress={() => router.push(`/(protected)/admin-team?teamId=${team.id}`)}
                      />
                    ))}
                  </View>
                )}
              </View>
            );
          })}

          {unassignedTeams.length > 0 && (
            <View className="mb-5">
              <Caption className="mb-2">Unassigned</Caption>
              <View className="gap-2">
                {unassignedTeams.map((team) => (
                  <ListRow
                    key={team.id}
                    title={team.name}
                    trailing={<Body tone="dim">›</Body>}
                    onPress={() => router.push(`/(protected)/admin-team?teamId=${team.id}`)}
                  />
                ))}
              </View>
            </View>
          )}
        </>
      )}

      {/* Add team modal */}
      <Sheet visible={!!addTeamTarget} onClose={() => setAddTeamTarget(null)}>
        <Heading size="lg" className="mb-1">Add Team</Heading>
        <Body size="sm" className="mb-5">{addTeamTarget?.name}</Body>

        <Label>Team name</Label>
        <Input value={newTeamName} onChangeText={setNewTeamName} placeholder="e.g. The Arrows" autoCapitalize="words" autoFocus className="mb-4" />

        <Label>Home venue / address (optional)</Label>
        <Input value={newTeamAddress} onChangeText={setNewTeamAddress} placeholder="e.g. The Red Lion, 12 High St" autoCapitalize="words" className="mb-6" />

        <View className="flex-row gap-2.5">
          <Button variant="ghost" className="flex-1" onPress={() => setAddTeamTarget(null)}>Cancel</Button>
          <Button className="flex-1" disabled={isAddingTeam || !newTeamName.trim()} loading={isAddingTeam} onPress={addTeam}>
            Add Team
          </Button>
        </View>
      </Sheet>
    </Screen>
  );
}
