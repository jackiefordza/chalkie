import { useState, useEffect, useMemo } from 'react';
import { View, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import { useColorScheme } from 'nativewind';
import {
  collection, doc, getDoc, onSnapshot, query, where, and, or, orderBy, type DocumentData,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { RAW } from '@/lib/theme';
import {
  Screen, AppBar, Heading, Body, Caption, Badge, Card, StatTile, Avatar, AppIcon, FormBadge,
} from '@/components/ui';
import { formatMatchDate } from '@/components/MatchCentre';
import type { Player, PlayerSeasonStats, Match, MatchGame } from '@/types';

// A single game this player took part in, with their personal win/loss for
// that game — GameRow's own homeWon/awayWon computation, ported here rather
// than imported, since GameRow renders a full row UI this screen doesn't want.
interface PlayerGameEntry {
  match: Match;
  won: boolean;
}

// One row of Match History — a confirmed match this player played at least
// one game in, with their personal games won/lost tally for that match
// (a player can play more than one game per match: singles + pairs).
interface MatchHistoryEntry {
  match: Match;
  opponentId: string;
  isHome: boolean;
  gamesWon: number;
  gamesLost: number;
}

const RECENT_FORM_COUNT = 5;
const MATCH_HISTORY_LIMIT = 8;

function toStats(id: string, data: DocumentData): PlayerSeasonStats {
  return {
    id,
    ...data,
    highCheckouts: (data.highCheckouts ?? []).map((c: any) => ({ ...c, date: c.date?.toDate?.() ?? new Date() })),
  } as PlayerSeasonStats;
}

export default function PlayerProfileScreen() {
  const { playerId } = useLocalSearchParams<{ playerId: string }>();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  const [player, setPlayer] = useState<Player | null>(null);
  const [playerNotFound, setPlayerNotFound] = useState(false);
  const [isLoadingPlayer, setIsLoadingPlayer] = useState(true);

  const [teamNamesById, setTeamNamesById] = useState<Record<string, string>>({});
  const [divisionName, setDivisionName] = useState<string | null>(null);
  const [leagueName, setLeagueName] = useState<string | null>(null);
  const [seasonName, setSeasonName] = useState<string | null>(null);

  const [stats, setStats] = useState<PlayerSeasonStats | null>(null);

  const [teamMatches, setTeamMatches] = useState<Match[]>([]);
  const [isLoadingMatches, setIsLoadingMatches] = useState(true);

  // Player doc — the profile's anchor. A player ID that doesn't exist (bad
  // link, deleted player) trips the same "missing doc throws permission-
  // denied instead of resolving to not-found" Firestore-rules quirk as
  // divisionTables/playerSeasonStats elsewhere in this app (the read rule
  // reads resource.data on a null resource) — so both the "genuinely
  // missing" and "denied" cases land in the same clean not-found state
  // rather than a page-level error.
  useEffect(() => {
    if (!playerId) { setIsLoadingPlayer(false); setPlayerNotFound(true); return; }
    return onSnapshot(
      doc(db, 'players', playerId),
      (snap) => {
        if (snap.exists()) {
          setPlayer({ id: snap.id, ...snap.data() } as Player);
          setPlayerNotFound(false);
        } else {
          setPlayer(null);
          setPlayerNotFound(true);
        }
        setIsLoadingPlayer(false);
      },
      () => { setPlayer(null); setPlayerNotFound(true); setIsLoadingPlayer(false); },
    );
  }, [playerId]);

  // League-wide team names — needed both for this player's own team and for
  // match-history opponent names, so one listener serves both rather than a
  // separate single-team read (same query shape fixtures.tsx/HomeDashboard
  // already use for their own opponent-name lookups).
  useEffect(() => {
    if (!player?.leagueId) return;
    return onSnapshot(
      query(collection(db, 'teams'), where('leagueId', '==', player.leagueId)),
      (snap) => {
        const map: Record<string, string> = {};
        snap.docs.forEach((d) => { map[d.id] = d.data().name; });
        setTeamNamesById(map);
      },
    );
  }, [player?.leagueId]);

  // League/division/season names — one-time reads, same pattern as
  // HomeDashboard's own league/division name lookups (this data essentially
  // never changes, so a live listener would just be an idle connection).
  // divisionId/seasonId are nullable on Player — handled gracefully by
  // simply leaving the name unset rather than erroring.
  useEffect(() => {
    if (player?.leagueId) {
      getDoc(doc(db, 'leagues', player.leagueId)).then((s) => setLeagueName(s.exists() ? s.data().name : null));
    } else {
      setLeagueName(null);
    }
    if (player?.divisionId) {
      getDoc(doc(db, 'divisions', player.divisionId)).then((s) => setDivisionName(s.exists() ? s.data().name : null));
    } else {
      setDivisionName(null);
    }
    if (player?.seasonId) {
      getDoc(doc(db, 'seasons', player.seasonId)).then((s) => setSeasonName(s.exists() ? s.data().name : null));
    } else {
      setSeasonName(null);
    }
  }, [player?.leagueId, player?.divisionId, player?.seasonId]);

  // Season stats — single doc read via the established `${seasonId}_${playerId}`
  // ID pattern (already used by stats.tsx's "My Stats" and HomeDashboard's
  // PersonalSnapshotCard). Same missing-doc-throws quirk as the player doc
  // above — a player with no confirmed games yet simply has no doc, and the
  // error handler here treats that the same as "no stats" rather than
  // surfacing a page-level error.
  useEffect(() => {
    if (!player?.seasonId || !player?.id) { setStats(null); return; }
    return onSnapshot(
      doc(db, 'playerSeasonStats', `${player.seasonId}_${player.id}`),
      (snap) => setStats(snap.exists() ? toStats(snap.id, snap.data()) : null),
      () => setStats(null),
    );
  }, [player?.seasonId, player?.id]);

  // This player's team's matches — Firestore can't query into
  // games[].homePlayerIds/awayPlayerIds directly, so there's no query shape
  // for "matches containing this player." The proven approach (identical to
  // fixtures.tsx/HomeDashboard's own team-matches query) is to fetch the
  // team's matches and filter client-side for this player's actual
  // participation — same read volume already fetched elsewhere for this team.
  useEffect(() => {
    if (!player?.teamId || !player?.leagueId) { setIsLoadingMatches(false); return; }
    return onSnapshot(
      query(
        collection(db, 'matches'),
        and(where('leagueId', '==', player.leagueId), or(where('homeTeamId', '==', player.teamId), where('awayTeamId', '==', player.teamId))),
        orderBy('scheduledDate', 'asc'),
      ),
      (snap) => {
        setTeamMatches(snap.docs.map((d) => ({
          id: d.id, ...d.data(), scheduledDate: d.data().scheduledDate?.toDate() ?? new Date(),
        } as Match)));
        setIsLoadingMatches(false);
      },
      () => { setTeamMatches([]); setIsLoadingMatches(false); },
    );
  }, [player?.teamId, player?.leagueId]);

  // Every game (singles or pairs) this player actually appeared in, across
  // this team's confirmed matches, oldest first (same order as the query —
  // reversed at the point of use, mirroring fixtures.tsx's own
  // `[...matches].reverse()` convention rather than requesting a `desc`
  // variant of this compound query, which would risk needing a new,
  // unverified composite index).
  const playerGames = useMemo<PlayerGameEntry[]>(() => {
    if (!player) return [];
    const entries: PlayerGameEntry[] = [];
    teamMatches
      .filter((m) => m.status === 'confirmed' && m.games)
      .forEach((m) => {
        (m.games as MatchGame[]).forEach((g) => {
          const isHome = g.homePlayerIds.includes(player.id);
          const isAway = g.awayPlayerIds.includes(player.id);
          if (!isHome && !isAway) return;
          const homeLegs = g.legs.filter((l) => l.winner === 'home').length;
          const awayLegs = g.legs.filter((l) => l.winner === 'away').length;
          const won = isHome ? homeLegs > awayLegs : awayLegs > homeLegs;
          entries.push({ match: m, won });
        });
      });
    return entries;
  }, [teamMatches, player]);

  // Recent Form — this player's personal per-game outcomes (consistent with
  // PlayerSeasonStats itself counting games, not matches), most recent first.
  const recentForm = useMemo<('W' | 'L')[]>(
    () => playerGames.slice(-RECENT_FORM_COUNT).reverse().map((e) => (e.won ? 'W' : 'L')),
    [playerGames],
  );

  // Match History — one row per match (a player can play multiple games in
  // the same match), most recent first, capped to a sensible recent window
  // rather than full career history.
  const matchHistory = useMemo<MatchHistoryEntry[]>(() => {
    if (!player) return [];
    const byMatchId = new Map<string, MatchHistoryEntry>();
    playerGames.forEach(({ match, won }) => {
      const isHome = match.homeTeamId === player.teamId;
      const opponentId = isHome ? match.awayTeamId : match.homeTeamId;
      const existing = byMatchId.get(match.id);
      if (existing) {
        if (won) existing.gamesWon += 1; else existing.gamesLost += 1;
      } else {
        byMatchId.set(match.id, { match, opponentId, isHome, gamesWon: won ? 1 : 0, gamesLost: won ? 0 : 1 });
      }
    });
    return [...byMatchId.values()].reverse().slice(0, MATCH_HISTORY_LIMIT);
  }, [playerGames, player]);

  const winPct = stats && stats.played > 0 ? Math.round((stats.won / stats.played) * 100) : null;
  const highestCheckout = stats && stats.highCheckouts.length > 0
    ? stats.highCheckouts.map((c) => Number(c.value)).filter((v) => !Number.isNaN(v)).sort((a, b) => b - a)[0]
    : undefined;

  const contextLine = player
    ? [teamNamesById[player.teamId], divisionName, leagueName, seasonName].filter(Boolean).join(' · ')
    : '';

  const body = (
    <>
      {isLoadingPlayer ? (
        <ActivityIndicator color={RAW.brand} style={{ marginTop: 60 }} />
      ) : playerNotFound || !player ? (
        <View className="flex-1 items-center justify-center px-8">
          <View className="w-14 h-14 rounded-full items-center justify-center bg-brand-fill dark:bg-brand-fill-dark mb-3">
            <AppIcon name="target" size={28} color={isDark ? RAW.brandInkDark : RAW.brandInk} />
          </View>
          <Body tone="strong" weight="semibold" className="mb-1 text-center">Player not found</Body>
          <Body size="sm" className="text-center">
            This player may have been removed, or you may not have access to view them.
          </Body>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          {/* PLAYER HEADER */}
          <View className="items-center mb-5">
            <Avatar initial={player.name.charAt(0)} tone="brand" size="md" />
            <Heading size="lg" className="mt-3 text-center">{player.name}</Heading>
            {contextLine ? <Body size="sm" className="mt-1 text-center">{contextLine}</Body> : null}
          </View>

          {/* SEASON STATS + NOTABLE PERFORMANCE — consolidated into one card;
              the task's own examples for these two sections overlap entirely
              (win %, 180s, highest checkout), so a second card would just
              repeat the first rather than adding information. */}
          {!player.seasonId ? (
            <Card className="mb-4">
              <Caption className="mb-2">Season Stats</Caption>
              <Body size="sm">This player isn't assigned to a season yet.</Body>
            </Card>
          ) : !stats || stats.played === 0 ? (
            <Card className="mb-4">
              <Caption className="mb-2">Season Stats</Caption>
              <Body size="sm">No stats yet — these fill in once {player.name.split(' ')[0]}'s matches are confirmed.</Body>
            </Card>
          ) : (
            <Card className="mb-4">
              <Caption className="mb-3">Season Stats{seasonName ? ` · ${seasonName}` : ''}</Caption>
              <View className="flex-row gap-2.5">
                <StatTile label="Played" value={stats.played} tone="brand" />
                <StatTile label="Won" value={stats.won} tone="sage" />
                <StatTile label="Win %" value={winPct !== null ? `${winPct}%` : '—'} tone="sage" />
                <StatTile label="180s" value={stats.oneEighties} tone="butter" />
              </View>
              {highestCheckout !== undefined && (
                <Body size="sm" className="mt-3">
                  Highest checkout: <Body size="sm" tone="butter" weight="bold">{highestCheckout}</Body>
                </Body>
              )}
            </Card>
          )}

          {/* RECENT FORM */}
          <Card className="mb-4">
            <Caption className="mb-3">Recent Form</Caption>
            {isLoadingMatches ? (
              <ActivityIndicator color={RAW.brand} />
            ) : recentForm.length === 0 ? (
              <Body size="sm">No completed matches yet this season.</Body>
            ) : (
              <View className="flex-row gap-1.5">
                {recentForm.map((r, i) => <FormBadge key={i} result={r} />)}
              </View>
            )}
          </Card>

          {/* MATCH HISTORY */}
          <Heading size="sm" className="mb-2.5">Match History</Heading>
          {isLoadingMatches ? (
            <ActivityIndicator color={RAW.brand} style={{ marginVertical: 12 }} />
          ) : matchHistory.length === 0 ? (
            <Card className="mb-2"><Body size="sm">No completed matches yet this season.</Body></Card>
          ) : (
            matchHistory.map((entry) => {
              const opponentName = teamNamesById[entry.opponentId] ?? '…';
              const teamWon = entry.isHome
                ? (entry.match.homeGamesWon ?? 0) > (entry.match.awayGamesWon ?? 0)
                : (entry.match.awayGamesWon ?? 0) > (entry.match.homeGamesWon ?? 0);
              return (
                <TouchableOpacity
                  key={entry.match.id}
                  activeOpacity={0.7}
                  onPress={() => router.push(`/(protected)/results-entry?matchId=${entry.match.id}`)}
                >
                  <Card className="mb-2.5">
                    <View className="flex-row items-center justify-between mb-1">
                      <Body tone="strong" weight="semibold" className="flex-1" numberOfLines={1}>
                        {entry.isHome ? 'vs' : '@'} {opponentName}
                      </Body>
                      <Badge tone={teamWon ? 'sage' : 'coral'}>{teamWon ? 'Won' : 'Lost'}</Badge>
                    </View>
                    <View className="flex-row items-center justify-between">
                      <Body size="sm">{formatMatchDate(entry.match.scheduledDate)}</Body>
                      <Body size="sm">Games: {entry.gamesWon}-{entry.gamesLost}</Body>
                    </View>
                  </Card>
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      )}
    </>
  );

  return (
    <Screen scroll={false} header={<AppBar title={player?.name ?? 'Player Profile'} />}>
      <Stack.Screen options={{ headerShown: false }} />
      {body}
    </Screen>
  );
}
