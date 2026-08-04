import { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import type { SinglesCompetition, SinglesTie } from '@/types';

// Big-screen, read-only display meant to run on a shared device pointed at
// a projector or TV during the event — same idea as the club's existing
// tournament-tracker tool's projector mode, just reading live Chalkie data
// instead of that tool's own room. No admin controls here, and deliberately
// no AppBar/back chrome — it's meant to be left open and unattended, not
// navigated around. Plain RN Text/View with hardcoded colors rather than
// the app's Heading/Body/tone system — this view is always dark regardless
// of the viewing device's own theme, so it deliberately opts out of the
// light/dark tokens the rest of the app follows.

export default function SinglesProjectorScreen() {
  const { competitionId } = useLocalSearchParams<{ competitionId: string }>();
  const { appUser } = useAuthStore();
  const leagueId = appUser?.leagueId ?? null;

  const [competition, setCompetition] = useState<SinglesCompetition | null>(null);
  const [ties, setTies] = useState<SinglesTie[]>([]);
  const [playerNames, setPlayerNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!leagueId || !competitionId) return;
    const unsub = onSnapshot(
      query(collection(db, 'singlesCompetitions'), where('leagueId', '==', leagueId)),
      (snap) => {
        const compDoc = snap.docs.find((d) => d.id === competitionId);
        if (!compDoc) { setCompetition(null); return; }
        setCompetition({
          id: compDoc.id, ...compDoc.data(),
          eventDate: compDoc.data().eventDate?.toDate() ?? new Date(), createdAt: compDoc.data().createdAt?.toDate() ?? new Date(),
        } as SinglesCompetition);
      },
    );
    const unsubPlayers = onSnapshot(
      query(collection(db, 'players'), where('leagueId', '==', leagueId)),
      (snap) => {
        const names: Record<string, string> = {};
        snap.docs.forEach((d) => { names[d.id] = d.data().name; });
        setPlayerNames(names);
      },
    );
    return () => { unsub(); unsubPlayers(); };
  }, [leagueId, competitionId]);

  useEffect(() => {
    if (!leagueId || !competitionId) { setTies([]); return; }
    const unsub = onSnapshot(
      query(collection(db, 'singlesTies'), where('leagueId', '==', leagueId), where('competitionId', '==', competitionId)),
      (snap) => setTies(snap.docs.map((d) => ({ id: d.id, ...d.data() } as SinglesTie))),
    );
    return unsub;
  }, [leagueId, competitionId]);

  function playerName(id: string | null): string {
    if (!id) return 'TBD';
    return playerNames[id] ?? '…';
  }

  const upNext = useMemo(
    () => ties
      .filter((t) => t.status === 'ready')
      .sort((a, b) => a.drawOrder - b.drawOrder)
      .slice(0, 6),
    [ties],
  );

  if (!competition) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' }}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ paddingHorizontal: 32, paddingTop: 40, paddingBottom: 16 }}>
        <Text style={{ color: '#6ee7b7', fontSize: 13, fontWeight: '700', letterSpacing: 2 }}>SINGLES KNOCKOUT</Text>
        <Text style={{ color: '#fff', fontSize: 24, fontWeight: '800', marginTop: 4 }}>{competition.name}</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 24, flexGrow: 1 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
          {competition.boards.map((tieId, boardId) => {
            const tie = tieId ? ties.find((t) => t.id === tieId) : null;
            const label = competition.boardNames?.[boardId] || `Board ${boardId + 1}`;
            return (
              <View
                key={boardId}
                style={{
                  minWidth: 320, flexGrow: 1, backgroundColor: tie ? '#132a1f' : '#18181b',
                  borderRadius: 20, padding: 24, borderWidth: 2, borderColor: tie ? '#22c55e' : '#3f3f46',
                }}
              >
                <Text style={{ color: tie ? '#6ee7b7' : '#71717a', fontWeight: '700', letterSpacing: 1, marginBottom: 12 }}>
                  {label.toUpperCase()}
                </Text>
                {tie ? (
                  <>
                    <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800', marginBottom: 6 }} numberOfLines={1}>{playerName(tie.homePlayerId)}</Text>
                    <Text style={{ color: '#71717a', marginBottom: 6 }}>vs</Text>
                    <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800' }} numberOfLines={1}>{playerName(tie.awayPlayerId)}</Text>
                  </>
                ) : (
                  <Text style={{ color: '#52525b', fontSize: 22, fontWeight: '800' }}>Board Open</Text>
                )}
              </View>
            );
          })}
        </View>

        {upNext.length > 0 && (
          <View style={{ marginTop: 32 }}>
            <Text style={{ color: '#a1a1aa', fontWeight: '700', letterSpacing: 1, marginBottom: 10 }}>UP NEXT</Text>
            <View style={{ gap: 8 }}>
              {upNext.map((tie) => (
                <View
                  key={tie.id}
                  style={{
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#18181b', borderRadius: 12,
                  }}
                >
                  <Text style={{ color: '#e4e4e7', fontSize: 15 }}>{playerName(tie.homePlayerId)} vs {playerName(tie.awayPlayerId)}</Text>
                  <Text style={{ color: '#71717a', fontSize: 13 }}>Round {tie.round}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
