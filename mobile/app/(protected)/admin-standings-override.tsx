import { useState, useEffect, useMemo } from 'react';
import { View, TouchableOpacity, ActivityIndicator, Alert, useWindowDimensions } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import {
  collection, doc, onSnapshot, query, where, setDoc, writeBatch,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { RAW } from '@/lib/theme';
import { Screen, Heading, Body, Caption, Chip, Button, Card, Input, Label, Sheet, AppBar } from '@/components/ui';
import { AdminShell } from '@/components/admin/AdminShell';

const DESKTOP_BREAKPOINT = 768;

interface TeamRow {
  id: string; teamId: string; teamName: string;
  played: number; won: number; lost: number; points: number; legsFor: number; legsAgainst: number;
}
interface PlayerRow {
  id: string; playerId: string; playerName: string; teamName: string;
  played: number; won: number; lost: number; oneEighties: number;
}

function n(v: string): number {
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Extracted so both the standalone route and admin-season.tsx's Standings
// tab share one implementation instead of two copies of this logic.
function useStandingsOverrideController(seasonId: string | undefined, divisionId: string | undefined, leagueId: string | undefined) {
  const [tab, setTab] = useState<'teams' | 'players'>('teams');
  const [teamNames, setTeamNames] = useState<Record<string, string>>({});
  const [playerNames, setPlayerNames] = useState<Record<string, string>>({});
  // Raw Firestore data, name-less — kept separate from the name-resolved
  // TeamRow/PlayerRow shape below so a name arriving after the table/stats
  // snapshot already fired still triggers a re-render with names filled in.
  const [rawTeamRows, setRawTeamRows] = useState<Record<string, unknown>[]>([]);
  const [rawPlayerRows, setRawPlayerRows] = useState<Record<string, unknown>[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [editTeamRow, setEditTeamRow] = useState<TeamRow | null>(null);
  const [teamDraft, setTeamDraft] = useState({ played: '', won: '', lost: '', points: '', legsFor: '', legsAgainst: '' });
  const [isSavingTeam, setIsSavingTeam] = useState(false);

  const [editPlayerRow, setEditPlayerRow] = useState<PlayerRow | null>(null);
  const [playerDraft, setPlayerDraft] = useState({ played: '', won: '', lost: '', oneEighties: '' });
  const [isSavingPlayer, setIsSavingPlayer] = useState(false);

  useEffect(() => {
    if (!divisionId || !leagueId) return;

    const unsubTeams = onSnapshot(
      query(collection(db, 'teams'), where('leagueId', '==', leagueId), where('divisionId', '==', divisionId)),
      (snap) => {
        const map: Record<string, string> = {};
        snap.docs.forEach((d) => { map[d.id] = d.data().name; });
        setTeamNames(map);
      },
    );

    const unsubPlayers = onSnapshot(
      query(collection(db, 'players'), where('leagueId', '==', leagueId)),
      (snap) => {
        const map: Record<string, string> = {};
        snap.docs.forEach((d) => { map[d.id] = d.data().name; });
        setPlayerNames(map);
      },
    );

    return () => { unsubTeams(); unsubPlayers(); };
  }, [divisionId, leagueId]);

  useEffect(() => {
    if (!seasonId || !divisionId) return;

    const unsubTables = onSnapshot(
      query(collection(db, 'divisionTables'), where('seasonId', '==', seasonId), where('divisionId', '==', divisionId)),
      (snap) => {
        setRawTeamRows(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setIsLoading(false);
      },
    );

    const unsubStats = onSnapshot(
      query(collection(db, 'playerSeasonStats'), where('seasonId', '==', seasonId), where('divisionId', '==', divisionId)),
      (snap) => {
        setRawPlayerRows(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
    );

    return () => { unsubTables(); unsubStats(); };
  }, [seasonId, divisionId]);

  // Resolved into display rows here, not inside the snapshot callbacks above —
  // that way a name arriving after its table/stats row already loaded (the
  // normal case, since these are two independent listeners with no ordering
  // guarantee) still re-resolves instead of getting stuck showing '…' forever.
  const teamRows: TeamRow[] = useMemo(() => rawTeamRows.map((data) => ({
    id: data.id as string, teamId: data.teamId as string, teamName: teamNames[data.teamId as string] ?? '…',
    played: (data.played as number) ?? 0, won: (data.won as number) ?? 0, lost: (data.lost as number) ?? 0,
    points: (data.points as number) ?? 0, legsFor: (data.legsFor as number) ?? 0, legsAgainst: (data.legsAgainst as number) ?? 0,
  })), [rawTeamRows, teamNames]);

  const playerRows: PlayerRow[] = useMemo(() => rawPlayerRows.map((data) => ({
    id: data.id as string, playerId: data.playerId as string, playerName: playerNames[data.playerId as string] ?? '…',
    teamName: teamNames[data.teamId as string] ?? '…',
    played: (data.played as number) ?? 0, won: (data.won as number) ?? 0, lost: (data.lost as number) ?? 0,
    oneEighties: (data.oneEighties as number) ?? 0,
  })), [rawPlayerRows, teamNames, playerNames]);

  const sortedTeamRows = useMemo(
    () => [...teamRows].sort((a, b) => (b.points - a.points) || ((b.legsFor - b.legsAgainst) - (a.legsFor - a.legsAgainst))),
    [teamRows],
  );

  function openEditTeam(row: TeamRow) {
    setEditTeamRow(row);
    setTeamDraft({
      played: String(row.played), won: String(row.won), lost: String(row.lost),
      points: String(row.points), legsFor: String(row.legsFor), legsAgainst: String(row.legsAgainst),
    });
  }

  async function saveTeamRow() {
    if (!editTeamRow || !leagueId || !seasonId || !divisionId) return;
    setIsSavingTeam(true);
    try {
      const updated: TeamRow = {
        ...editTeamRow,
        played: n(teamDraft.played), won: n(teamDraft.won), lost: n(teamDraft.lost),
        points: n(teamDraft.points), legsFor: n(teamDraft.legsFor), legsAgainst: n(teamDraft.legsAgainst),
      };
      await setDoc(doc(db, 'divisionTables', editTeamRow.id), {
        leagueId, seasonId, divisionId, teamId: editTeamRow.teamId,
        played: updated.played, won: updated.won, lost: updated.lost, points: updated.points,
        legsFor: updated.legsFor, legsAgainst: updated.legsAgainst, legDiff: updated.legsFor - updated.legsAgainst,
      }, { merge: true });

      // Recompute standings order across the whole division to reflect this edit.
      const nextRows = teamRows.map((r) => (r.id === updated.id ? updated : r));
      const ordered = [...nextRows].sort((a, b) => (b.points - a.points) || ((b.legsFor - b.legsAgainst) - (a.legsFor - a.legsAgainst)));
      const batch = writeBatch(db);
      ordered.forEach((row, i) => batch.update(doc(db, 'divisionTables', row.id), { position: i + 1 }));
      await batch.commit();

      setEditTeamRow(null);
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error).message ?? 'Something went wrong');
    } finally {
      setIsSavingTeam(false);
    }
  }

  function openEditPlayer(row: PlayerRow) {
    setEditPlayerRow(row);
    setPlayerDraft({ played: String(row.played), won: String(row.won), lost: String(row.lost), oneEighties: String(row.oneEighties) });
  }

  async function savePlayerRow() {
    if (!editPlayerRow || !leagueId || !seasonId) return;
    setIsSavingPlayer(true);
    try {
      await setDoc(doc(db, 'playerSeasonStats', editPlayerRow.id), {
        played: n(playerDraft.played), won: n(playerDraft.won), lost: n(playerDraft.lost), oneEighties: n(playerDraft.oneEighties),
      }, { merge: true });
      setEditPlayerRow(null);
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error).message ?? 'Something went wrong');
    } finally {
      setIsSavingPlayer(false);
    }
  }

  return {
    tab, setTab, teamRows, sortedTeamRows, playerRows, isLoading,
    editTeamRow, setEditTeamRow, teamDraft, setTeamDraft, isSavingTeam, openEditTeam, saveTeamRow,
    editPlayerRow, setEditPlayerRow, playerDraft, setPlayerDraft, isSavingPlayer, openEditPlayer, savePlayerRow,
  };
}

type StandingsController = ReturnType<typeof useStandingsOverrideController>;

function StandingsBody({ c }: { c: StandingsController }) {
  return (
    <>
      <View className="flex-row gap-2 mb-5">
        <Chip label="Team Points" selected={c.tab === 'teams'} onPress={() => c.setTab('teams')} />
        <Chip label="Player Stats" selected={c.tab === 'players'} onPress={() => c.setTab('players')} />
      </View>
      <Body size="sm" className="mb-4">
        Manual corrections — use for a scoring dispute resolved outside the normal result flow. Team point edits
        immediately re-sort the standings.
      </Body>

      {c.isLoading ? (
        <ActivityIndicator color={RAW.brand} />
      ) : c.tab === 'teams' ? (
        <View className="gap-2">
          {c.sortedTeamRows.map((row, i) => (
            <TouchableOpacity key={row.id} activeOpacity={0.7} onPress={() => c.openEditTeam(row)}>
              <Card className="flex-row items-center">
                <Body tone="dim" className="w-6">{i + 1}</Body>
                <Body tone="strong" weight="semibold" className="flex-1">{row.teamName}</Body>
                <Body size="sm" className="w-16 text-right">P {row.played}</Body>
                <Body size="sm" className="w-16 text-right">Pts {row.points}</Body>
                <Body size="sm" className="w-20 text-right">{row.legsFor - row.legsAgainst >= 0 ? '+' : ''}{row.legsFor - row.legsAgainst}</Body>
              </Card>
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <View className="gap-2">
          {c.playerRows
            .sort((a, b) => b.won - a.won)
            .map((row) => (
              <TouchableOpacity key={row.id} activeOpacity={0.7} onPress={() => c.openEditPlayer(row)}>
                <Card className="flex-row items-center">
                  <View className="flex-1">
                    <Body tone="strong" weight="semibold">{row.playerName}</Body>
                    <Caption className="mt-0.5">{row.teamName}</Caption>
                  </View>
                  <Body size="sm" className="w-16 text-right">P {row.played}</Body>
                  <Body size="sm" className="w-16 text-right">W {row.won}</Body>
                  <Body size="sm" className="w-16 text-right">180s {row.oneEighties}</Body>
                </Card>
              </TouchableOpacity>
            ))}
        </View>
      )}

      <Sheet visible={!!c.editTeamRow} onClose={() => c.setEditTeamRow(null)}>
        <Heading size="lg" className="mb-1">Edit Team Points</Heading>
        <Body size="sm" className="mb-5">{c.editTeamRow?.teamName}</Body>
        <View className="flex-row gap-2.5 mb-2.5">
          <View className="flex-1">
            <Label>Played</Label>
            <Input value={c.teamDraft.played} onChangeText={(v) => c.setTeamDraft((d) => ({ ...d, played: v }))} keyboardType="number-pad" />
          </View>
          <View className="flex-1">
            <Label>Points</Label>
            <Input value={c.teamDraft.points} onChangeText={(v) => c.setTeamDraft((d) => ({ ...d, points: v }))} keyboardType="number-pad" />
          </View>
        </View>
        <View className="flex-row gap-2.5 mb-2.5">
          <View className="flex-1">
            <Label>Won</Label>
            <Input value={c.teamDraft.won} onChangeText={(v) => c.setTeamDraft((d) => ({ ...d, won: v }))} keyboardType="number-pad" />
          </View>
          <View className="flex-1">
            <Label>Lost</Label>
            <Input value={c.teamDraft.lost} onChangeText={(v) => c.setTeamDraft((d) => ({ ...d, lost: v }))} keyboardType="number-pad" />
          </View>
        </View>
        <View className="flex-row gap-2.5 mb-6">
          <View className="flex-1">
            <Label>Legs For</Label>
            <Input value={c.teamDraft.legsFor} onChangeText={(v) => c.setTeamDraft((d) => ({ ...d, legsFor: v }))} keyboardType="number-pad" />
          </View>
          <View className="flex-1">
            <Label>Legs Against</Label>
            <Input value={c.teamDraft.legsAgainst} onChangeText={(v) => c.setTeamDraft((d) => ({ ...d, legsAgainst: v }))} keyboardType="number-pad" />
          </View>
        </View>
        <View className="flex-row gap-2.5">
          <Button variant="ghost" className="flex-1" onPress={() => c.setEditTeamRow(null)}>Cancel</Button>
          <Button className="flex-1" disabled={c.isSavingTeam} loading={c.isSavingTeam} onPress={c.saveTeamRow}>Save</Button>
        </View>
      </Sheet>

      <Sheet visible={!!c.editPlayerRow} onClose={() => c.setEditPlayerRow(null)}>
        <Heading size="lg" className="mb-1">Edit Player Stats</Heading>
        <Body size="sm" className="mb-5">{c.editPlayerRow?.playerName}</Body>
        <View className="flex-row gap-2.5 mb-2.5">
          <View className="flex-1">
            <Label>Played</Label>
            <Input value={c.playerDraft.played} onChangeText={(v) => c.setPlayerDraft((d) => ({ ...d, played: v }))} keyboardType="number-pad" />
          </View>
          <View className="flex-1">
            <Label>Won</Label>
            <Input value={c.playerDraft.won} onChangeText={(v) => c.setPlayerDraft((d) => ({ ...d, won: v }))} keyboardType="number-pad" />
          </View>
        </View>
        <View className="flex-row gap-2.5 mb-6">
          <View className="flex-1">
            <Label>Lost</Label>
            <Input value={c.playerDraft.lost} onChangeText={(v) => c.setPlayerDraft((d) => ({ ...d, lost: v }))} keyboardType="number-pad" />
          </View>
          <View className="flex-1">
            <Label>180s</Label>
            <Input value={c.playerDraft.oneEighties} onChangeText={(v) => c.setPlayerDraft((d) => ({ ...d, oneEighties: v }))} keyboardType="number-pad" />
          </View>
        </View>
        <View className="flex-row gap-2.5">
          <Button variant="ghost" className="flex-1" onPress={() => c.setEditPlayerRow(null)}>Cancel</Button>
          <Button className="flex-1" disabled={c.isSavingPlayer} loading={c.isSavingPlayer} onPress={c.savePlayerRow}>Save</Button>
        </View>
      </Sheet>
    </>
  );
}

// Consumed by admin-season.tsx's Standings tab.
export function StandingsTab({ seasonId, divisionId, leagueId }: { seasonId: string | undefined; divisionId: string | undefined; leagueId: string | undefined }) {
  const c = useStandingsOverrideController(seasonId, divisionId, leagueId);
  return <StandingsBody c={c} />;
}

export default function AdminStandingsOverrideScreen() {
  const { divisionId } = useLocalSearchParams<{ divisionId: string }>();
  const { appUser } = useAuthStore();
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;

  const [divisionName, setDivisionName] = useState('');
  const [seasonId, setSeasonId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!divisionId) return;
    const unsub = onSnapshot(doc(db, 'divisions', divisionId), (snap) => {
      if (snap.exists()) {
        setDivisionName(snap.data().name ?? '');
        setSeasonId(snap.data().seasonId ?? undefined);
      }
    });
    return unsub;
  }, [divisionId]);

  const c = useStandingsOverrideController(seasonId, divisionId, appUser?.leagueId ?? undefined);
  const title = divisionName ? `${divisionName} — Adjust` : 'Adjust Standings';

  if (isDesktop) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <AdminShell title={title} breadcrumb={[{ label: 'Dashboard', path: '/(protected)/(tabs)/admin' }, { label: 'Standings' }]}>
          <View style={{ maxWidth: 860 }}><StandingsBody c={c} /></View>
        </AdminShell>
      </>
    );
  }

  return (
    <Screen header={<AppBar title={title} />}>
      <Stack.Screen options={{ headerShown: false }} />
      <StandingsBody c={c} />
    </Screen>
  );
}
