import { useState, useEffect, useContext } from 'react';
import { View, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { router } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { collection, onSnapshot, query, where, orderBy, and, or } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { RAW, type SemanticTone } from '@/lib/theme';
import { Heading, Body, Badge, Card, Chip, Button, AppIcon } from '@/components/ui';
import type { Match } from '@/types';

const STATUS_LABEL: Record<Match['status'], string> = {
  scheduled: 'Upcoming',
  awaiting_confirmation: 'Awaiting confirmation',
  disputed: 'Disputed — admin reviewing',
  confirmed: 'Final',
};

const STATUS_TONE: Record<Match['status'], SemanticTone | null> = {
  scheduled: null,
  awaiting_confirmation: 'butter',
  disputed: 'coral',
  confirmed: 'sage',
};

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function FixturesScreen() {
  const { appUser } = useAuthStore();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? 0;
  const teamId = appUser?.teamId ?? null;

  const [tab, setTab] = useState<'upcoming' | 'results'>('upcoming');
  const [matches, setMatches] = useState<Match[]>([]);
  const [teamNames, setTeamNames] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

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
      (e) => { setLoadError(e.message); setIsLoading(false); },
    );

    const unsubTeams = onSnapshot(
      query(collection(db, 'teams'), where('leagueId', '==', appUser.leagueId)),
      (snap) => {
        const map: Record<string, string> = {};
        snap.docs.forEach((d) => { map[d.id] = d.data().name; });
        setTeamNames(map);
      },
      (e) => setLoadError(e.message),
    );

    return () => { unsubMatches(); unsubTeams(); };
  }, [teamId, appUser?.leagueId]);

  const upcoming = matches.filter((m) => m.status !== 'confirmed');
  const past = [...matches.filter((m) => m.status === 'confirmed')].reverse();

  const canSubmitResults = appUser?.role === 'captain' || appUser?.role === 'viceCaptain';

  function FixtureRow({ match }: { match: Match }) {
    const opponentId = match.homeTeamId === teamId ? match.awayTeamId : match.homeTeamId;
    const isHome = match.homeTeamId === teamId;
    const canSubmit = canSubmitResults && match.status !== 'confirmed';
    // Anyone on either team can open a confirmed result to see the score card;
    // submitting/editing an unconfirmed one is still captain/VC-only.
    const tappable = canSubmit || match.status === 'confirmed';
    const tone = STATUS_TONE[match.status];

    const content = (
      <Card className="mb-2">
        <View className="flex-row items-center mb-1">
          <Body tone="strong" weight="semibold" className="flex-1">
            {isHome ? 'vs' : '@'} {teamNames[opponentId] ?? '…'}
          </Body>
          {tone ? (
            <Badge tone={tone}>{STATUS_LABEL[match.status]}</Badge>
          ) : (
            <Body size="sm">{STATUS_LABEL[match.status]}</Body>
          )}
        </View>
        <Body size="sm">
          {formatDate(match.scheduledDate)} · {isHome ? (match.venue ?? 'Home') : 'Away'}
        </Body>
        {match.status === 'confirmed' && (() => {
          // The match is won/lost on games, not legs — a team can win fewer
          // legs overall but still win more games (and therefore the match).
          const won = isHome
            ? (match.homeGamesWon ?? 0) > (match.awayGamesWon ?? 0)
            : (match.awayGamesWon ?? 0) > (match.homeGamesWon ?? 0);
          return (
            <Body size="sm" tone={won ? 'sage' : 'coral'} weight="semibold" className="mt-1.5">
              {isHome
                ? `${match.homeLegsWon} - ${match.awayLegsWon}`
                : `${match.awayLegsWon} - ${match.homeLegsWon}`} legs
            </Body>
          );
        })()}
        {canSubmit && (
          <Button
            size="sm"
            className="mt-3"
            onPress={() => router.push(`/(protected)/results-entry?matchId=${match.id}`)}
          >
            {match.status === 'scheduled' ? 'Enter Result' : 'View / Edit Result'}
          </Button>
        )}
      </Card>
    );

    if (!tappable) return content;
    return (
      <TouchableOpacity activeOpacity={0.7} onPress={() => router.push(`/(protected)/results-entry?matchId=${match.id}`)}>
        {content}
      </TouchableOpacity>
    );
  }

  const isPlaceholder = !!loadError || isLoading || matches.length === 0;
  const activeList = tab === 'upcoming' ? upcoming : past;

  return (
    <View className="flex-1 bg-bg dark:bg-bg-dark">
      <View className="flex-row gap-2 px-5 pt-5">
        <Chip label="Upcoming" selected={tab === 'upcoming'} onPress={() => setTab('upcoming')} className="flex-1" />
        <Chip label="Previous Results" selected={tab === 'results'} onPress={() => setTab('results')} className="flex-1" />
      </View>

      <ScrollView
        contentContainerStyle={[
          { padding: 20, paddingBottom: 20 + tabBarHeight },
          isPlaceholder && { flexGrow: 1, justifyContent: 'center' },
        ]}
      >
        {loadError ? (
          <Card tone="coral">
            <Body tone="coral" weight="semibold" className="mb-1">Couldn't load fixtures</Body>
            <Body tone="coral" size="sm">{loadError}</Body>
          </Card>
        ) : isLoading ? (
          <ActivityIndicator color={RAW.brand} style={{ marginTop: 40 }} />
        ) : matches.length === 0 ? (
          <Card className="items-center py-8">
            <View className="w-14 h-14 rounded-full items-center justify-center bg-brand-fill dark:bg-brand-fill-dark mb-3">
              <AppIcon name="calendar" size={28} color={isDark ? RAW.brandInkDark : RAW.brandInk} />
            </View>
            <Body tone="strong" weight="semibold" className="mb-1">No fixtures yet</Body>
            <Body size="sm" className="text-center">
              Your league admin hasn't generated the schedule yet.
            </Body>
          </Card>
        ) : activeList.length === 0 ? (
          <Body size="sm" className="text-center">
            {tab === 'upcoming' ? 'Nothing scheduled' : 'No results yet'}
          </Body>
        ) : (
          activeList.map((match) => <FixtureRow key={match.id} match={match} />)
        )}
      </ScrollView>
    </View>
  );
}
