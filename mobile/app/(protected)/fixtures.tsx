import { useState, useEffect } from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { collection, onSnapshot, query, where, orderBy, and, or } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import type { Match } from '@/types';
import * as S from '@/styles/common';

interface TeamName { id: string; name: string }

const STATUS_LABEL: Record<Match['status'], string> = {
  scheduled: 'Upcoming',
  awaiting_confirmation: 'Awaiting confirmation',
  disputed: 'Disputed — admin reviewing',
  confirmed: 'Final',
};

const STATUS_COLOR: Record<Match['status'], string> = {
  scheduled: S.WHITE_50,
  awaiting_confirmation: '#FF9500',
  disputed: S.RED,
  confirmed: '#34C759',
};

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function FixturesScreen() {
  const { appUser } = useAuthStore();
  const teamId = appUser?.teamId ?? null;

  const [matches, setMatches] = useState<Match[]>([]);
  const [teamNames, setTeamNames] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!teamId || !appUser?.leagueId) return;

    const unsubMatches = onSnapshot(
      query(
        collection(db, 'matches'),
        and(
          where('leagueId', '==', appUser.leagueId),
          or(where('homeTeamId', '==', teamId), where('awayTeamId', '==', teamId)),
        ),
        orderBy('scheduledDate', 'asc'),
      ),
      (snap) => {
        setMatches(
          snap.docs.map((d) => ({
            id: d.id,
            ...d.data(),
            scheduledDate: d.data().scheduledDate?.toDate() ?? new Date(),
          } as Match)),
        );
        setIsLoading(false);
      },
    );

    const unsubTeams = onSnapshot(
      query(collection(db, 'teams'), where('leagueId', '==', appUser.leagueId)),
      (snap) => {
        const map: Record<string, string> = {};
        snap.docs.forEach((d) => { map[d.id] = d.data().name; });
        setTeamNames(map);
      },
    );

    return () => { unsubMatches(); unsubTeams(); };
  }, [teamId, appUser?.leagueId]);

  const now = new Date();
  const upcoming = matches.filter((m) => m.scheduledDate >= now || m.status !== 'confirmed');
  const past = matches.filter((m) => m.scheduledDate < now && m.status === 'confirmed');

  function FixtureRow({ match }: { match: Match }) {
    const opponentId = match.homeTeamId === teamId ? match.awayTeamId : match.homeTeamId;
    const isHome = match.homeTeamId === teamId;
    return (
      <View
        style={{
          padding: 14, borderRadius: 12, marginBottom: 8,
          backgroundColor: 'rgba(255,255,255,0.07)',
          borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
          <Text style={{ color: S.WHITE, fontWeight: '600', flex: 1 }}>
            {isHome ? 'vs' : '@'} {teamNames[opponentId] ?? '…'}
          </Text>
          <Text style={{ color: STATUS_COLOR[match.status], fontSize: 12, fontWeight: '600' }}>
            {STATUS_LABEL[match.status]}
          </Text>
        </View>
        <Text style={{ color: S.WHITE_50, fontSize: 12 }}>
          {formatDate(match.scheduledDate)} · {isHome ? (match.venue ?? 'Home') : 'Away'}
        </Text>
        {match.status === 'confirmed' && (
          <Text style={{ color: S.WHITE_60, fontSize: 13, marginTop: 6 }}>
            {isHome
              ? `${match.homeGamesWon} - ${match.awayGamesWon}`
              : `${match.awayGamesWon} - ${match.homeGamesWon}`}
          </Text>
        )}
      </View>
    );
  }

  return (
    <LinearGradient colors={S.GRADIENT} style={{ flex: 1 }}>
      <Stack.Screen options={{ title: 'Fixtures' }} />
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        {isLoading ? (
          <ActivityIndicator color={S.BLUE} style={{ marginTop: 40 }} />
        ) : matches.length === 0 ? (
          <BlurView intensity={20} tint="dark" style={{ borderRadius: 16, overflow: 'hidden' }}>
            <View style={[S.glassCard, { alignItems: 'center', paddingVertical: 32 }]}>
              <Text style={{ fontSize: 36, marginBottom: 12 }}>🎯</Text>
              <Text style={{ color: S.WHITE, fontWeight: '600', marginBottom: 4 }}>No fixtures yet</Text>
              <Text style={{ color: S.WHITE_50, fontSize: 13, textAlign: 'center' }}>
                Your league admin hasn't generated the schedule yet.
              </Text>
            </View>
          </BlurView>
        ) : (
          <>
            <Text style={{ color: S.WHITE, fontSize: 15, fontWeight: '700', marginBottom: 10 }}>
              Upcoming
            </Text>
            {upcoming.length === 0 ? (
              <Text style={{ color: S.WHITE_50, fontSize: 13, marginBottom: 20 }}>Nothing scheduled</Text>
            ) : (
              upcoming.map((match) => <FixtureRow key={match.id} match={match} />)
            )}

            {past.length > 0 && (
              <>
                <Text style={{ color: S.WHITE, fontSize: 15, fontWeight: '700', marginTop: 16, marginBottom: 10 }}>
                  Results
                </Text>
                {past.map((match) => <FixtureRow key={match.id} match={match} />)}
              </>
            )}
          </>
        )}
      </ScrollView>
    </LinearGradient>
  );
}
