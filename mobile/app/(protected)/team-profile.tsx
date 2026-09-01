import { useState, useEffect, useMemo } from 'react';
import { View, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import { useColorScheme } from 'nativewind';
import {
  collection, doc, getDoc, onSnapshot, query, where, and, or, orderBy,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { RAW } from '@/lib/theme';
import {
  Screen, AppBar, Heading, Body, Caption, Badge, Card, StatTile, Avatar, AppIcon, FormBadge,
} from '@/components/ui';
import { formatMatchDate } from '@/components/MatchCentre';
import { recentForm, ordinal } from '@/components/HomeDashboard';
import type { Team, DivisionTable, Match, MatchGame, Player } from '@/types';

type TeamRole = 'captain' | 'viceCaptain' | 'player';

const RECENT_FORM_COUNT = 5;
const RECENT_RESULTS_LIMIT = 6;
const UPCOMING_FIXTURES_LIMIT = 2;

// Captain/VC resolution — the same cross-reference already used by
// captains.tsx/admin-team.tsx (a player is captain/VC if their linked
// account matches the team's own captainUserId/viceCaptainUserId). Ported
// locally rather than imported since it's a 4-line pure function embedded
// in two unrelated screens this task shouldn't touch.
function roleOf(player: Player, captainUserId: string | null, vcUserId: string | null): TeamRole | null {
  if (!player.claimedByUserId) return null;
  if (player.claimedByUserId === captainUserId) return 'captain';
  if (player.claimedByUserId === vcUserId) return 'viceCaptain';
  return 'player';
}
const ROLE_BADGE_LABEL: Record<TeamRole, string> = {
  captain: 'Captain',
  viceCaptain: 'Vice Captain',
  player: 'Player',
};

export default function TeamProfileScreen() {
  const { teamId } = useLocalSearchParams<{ teamId: string }>();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  const [team, setTeam] = useState<Team | null>(null);
  const [teamNotFound, setTeamNotFound] = useState(false);
  const [isLoadingTeam, setIsLoadingTeam] = useState(true);

  const [leagueName, setLeagueName] = useState<string | null>(null);
  const [divisionName, setDivisionName] = useState<string | null>(null);
  const [seasonName, setSeasonName] = useState<string | null>(null);

  const [tableRow, setTableRow] = useState<DivisionTable | null>(null);

  const [teamNamesById, setTeamNamesById] = useState<Record<string, string>>({});

  const [teamMatches, setTeamMatches] = useState<Match[]>([]);
  const [isLoadingMatches, setIsLoadingMatches] = useState(true);

  const [players, setPlayers] = useState<Player[]>([]);
  const [isLoadingPlayers, setIsLoadingPlayers] = useState(true);

  // Team doc — the profile's anchor. Same missing-doc-throws-permission-
  // denied Firestore-rules quirk already worked around elsewhere on this
  // branch (divisionTables, playerSeasonStats, the player doc in
  // player-profile.tsx) applies here too (the read rule reads
  // resource.data on a null resource), so a bad/foreign teamId lands on a
  // clean "Team not found" state rather than an error dump.
  useEffect(() => {
    if (!teamId) { setIsLoadingTeam(false); setTeamNotFound(true); return; }
    return onSnapshot(
      doc(db, 'teams', teamId),
      (snap) => {
        if (snap.exists()) {
          setTeam({ id: snap.id, ...snap.data() } as Team);
          setTeamNotFound(false);
        } else {
          setTeam(null);
          setTeamNotFound(true);
        }
        setIsLoadingTeam(false);
      },
      () => { setTeam(null); setTeamNotFound(true); setIsLoadingTeam(false); },
    );
  }, [teamId]);

  // League-wide team names — needed both to resolve this team's own
  // opponents' names and (in principle) reused if this screen is ever
  // linked from a page already holding that map; same query shape
  // fixtures.tsx/HomeDashboard/player-profile.tsx already use.
  useEffect(() => {
    if (!team?.leagueId) return;
    return onSnapshot(
      query(collection(db, 'teams'), where('leagueId', '==', team.leagueId)),
      (snap) => {
        const map: Record<string, string> = {};
        snap.docs.forEach((d) => { map[d.id] = d.data().name; });
        setTeamNamesById(map);
      },
    );
  }, [team?.leagueId]);

  // League/division/season names — one-time reads, same pattern as
  // HomeDashboard/player-profile.tsx (this data essentially never changes).
  useEffect(() => {
    if (team?.leagueId) {
      getDoc(doc(db, 'leagues', team.leagueId)).then((s) => setLeagueName(s.exists() ? s.data().name : null));
    } else {
      setLeagueName(null);
    }
    if (team?.divisionId) {
      getDoc(doc(db, 'divisions', team.divisionId)).then((s) => setDivisionName(s.exists() ? s.data().name : null));
    } else {
      setDivisionName(null);
    }
    if (team?.seasonId) {
      getDoc(doc(db, 'seasons', team.seasonId)).then((s) => setSeasonName(s.exists() ? s.data().name : null));
    } else {
      setSeasonName(null);
    }
  }, [team?.leagueId, team?.divisionId, team?.seasonId]);

  // League-table row — the exact same doc-ID pattern and single-doc read
  // already used by HomeDashboard's own "Team Snapshot" (which only ever
  // reads the viewer's own team's row); this is the same read applied to
  // an arbitrary team. Same missing-doc-before-first-confirmed-match quirk,
  // handled the same defensive way.
  useEffect(() => {
    if (!team?.seasonId || !team?.divisionId || !teamId) { setTableRow(null); return; }
    return onSnapshot(
      doc(db, 'divisionTables', `${team.seasonId}_${team.divisionId}_${teamId}`),
      (snap) => setTableRow(snap.exists() ? ({ id: snap.id, ...snap.data() } as DivisionTable) : null),
      () => setTableRow(null),
    );
  }, [team?.seasonId, team?.divisionId, teamId]);

  // This team's matches — identical query shape to fixtures.tsx/
  // HomeDashboard/player-profile.tsx's own team-matches queries, just for
  // an arbitrary team rather than the viewer's own.
  useEffect(() => {
    if (!teamId || !team?.leagueId) { setIsLoadingMatches(false); return; }
    return onSnapshot(
      query(
        collection(db, 'matches'),
        and(where('leagueId', '==', team.leagueId), or(where('homeTeamId', '==', teamId), where('awayTeamId', '==', teamId))),
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
  }, [teamId, team?.leagueId]);

  // Roster — same `where('teamId', '==', …)` query shape already used by
  // captains.tsx/admin-team.tsx/browse-teams.tsx, with one addition: an
  // explicit `where('leagueId', '==', team.leagueId)` filter. Firestore
  // can't statically prove the players rule's `me().leagueId ==
  // resource.data.leagueId` branch true for a *list* query unless the
  // query itself constrains leagueId — the exact same constraint already
  // documented against divisionTables in this codebase (standings.tsx and
  // admin-standings-override.tsx both add the same filter for the same
  // reason). Using the *target* team's leagueId (not the viewer's own)
  // means this doesn't restrict a global admin viewing another league's
  // team — their `isGlobalAdmin()` rule branch holds unconditionally,
  // independent of this filter.
  useEffect(() => {
    if (!teamId || !team?.leagueId) { setIsLoadingPlayers(false); return; }
    return onSnapshot(
      query(collection(db, 'players'), where('teamId', '==', teamId), where('leagueId', '==', team.leagueId)),
      (snap) => {
        setPlayers(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Player)));
        setIsLoadingPlayers(false);
      },
      () => { setPlayers([]); setIsLoadingPlayers(false); },
    );
  }, [teamId, team?.leagueId]);

  const confirmedMatches = useMemo(
    () => teamMatches.filter((m) => m.status === 'confirmed' && m.games),
    [teamMatches],
  );
  const upcomingFixtures = useMemo(
    () => teamMatches.filter((m) => m.status !== 'confirmed').slice(0, UPCOMING_FIXTURES_LIMIT),
    [teamMatches],
  );
  const recentResults = useMemo(
    () => [...confirmedMatches].reverse().slice(0, RECENT_RESULTS_LIMIT),
    [confirmedMatches],
  );
  const form = useMemo(() => (teamId ? recentForm(teamMatches, teamId, RECENT_FORM_COUNT) : []), [teamMatches, teamId]);

  // Team Statistics — total 180s / highest checkout / games won-lost,
  // derived entirely from the confirmed matches already fetched above for
  // Recent Form/Recent Results (zero new reads). Deliberately NOT summed
  // from PlayerSeasonStats docs: PlayerSeasonStats.played/won counts each
  // player's own game appearances, which would double-count every pairs
  // game (two players, one game) if simply added together. Iterating
  // match.games[] directly and counting each game once from this team's
  // home/away side avoids that, and reuses the exact same per-game
  // win/loss computation already used by GameRow/player-profile.tsx.
  // Legs won/lost are deliberately not repeated here — they're already
  // shown in Team Performance from the same divisionTables row.
  const teamGameStats = useMemo(() => {
    let gamesWon = 0;
    let gamesLost = 0;
    let total180s = 0;
    let highestCheckout: number | undefined;
    confirmedMatches.forEach((m) => {
      const isHome = m.homeTeamId === teamId;
      (m.games as MatchGame[]).forEach((g) => {
        const ourIds = isHome ? g.homePlayerIds : g.awayPlayerIds;
        const homeLegs = g.legs.filter((l) => l.winner === 'home').length;
        const awayLegs = g.legs.filter((l) => l.winner === 'away').length;
        const weWon = isHome ? homeLegs > awayLegs : awayLegs > homeLegs;
        if (weWon) gamesWon += 1; else gamesLost += 1;
        g.legs.forEach((leg) => {
          total180s += leg.oneEighties.filter((pid) => ourIds.includes(pid)).length;
          if (leg.highCheckout && ourIds.includes(leg.highCheckout.playerId)) {
            const v = Number(leg.highCheckout.value);
            if (!Number.isNaN(v) && (highestCheckout === undefined || v > highestCheckout)) highestCheckout = v;
          }
        });
      });
    });
    return { gamesWon, gamesLost, total180s, highestCheckout };
  }, [confirmedMatches, teamId]);

  const contextLine = team
    ? [divisionName, leagueName, seasonName].filter(Boolean).join(' · ')
    : '';

  const body = (
    <>
      {isLoadingTeam ? (
        <ActivityIndicator color={RAW.brand} style={{ marginTop: 60 }} />
      ) : teamNotFound || !team ? (
        <View className="flex-1 items-center justify-center px-8">
          <View className="w-14 h-14 rounded-full items-center justify-center bg-brand-fill dark:bg-brand-fill-dark mb-3">
            <AppIcon name="users" size={28} color={isDark ? RAW.brandInkDark : RAW.brandInk} />
          </View>
          <Body tone="strong" weight="semibold" className="mb-1 text-center">Team not found</Body>
          <Body size="sm" className="text-center">
            This team may have been removed, or you may not have access to view it.
          </Body>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          {/* TEAM HEADER */}
          <View className="items-center mb-5">
            <Avatar initial={team.name.charAt(0)} tone="brand" size="md" />
            <Heading size="lg" className="mt-3 text-center">{team.name}</Heading>
            {contextLine ? <Body size="sm" className="mt-1 text-center">{contextLine}</Body> : null}
          </View>

          {/* TEAM PERFORMANCE — from the existing league-table (divisionTables) row */}
          {!team.divisionId || !team.seasonId ? (
            <Card className="mb-4">
              <Caption className="mb-2">Team Performance</Caption>
              <Body size="sm">This team isn't assigned to a division yet.</Body>
            </Card>
          ) : !tableRow ? (
            <Card className="mb-4">
              <Caption className="mb-2">Team Performance</Caption>
              <Body size="sm">No table position yet — this fills in once matches are confirmed.</Body>
            </Card>
          ) : (
            <Card className="mb-4">
              <Caption className="mb-3">Team Performance</Caption>
              <View className="flex-row gap-2.5 mb-2.5">
                <StatTile label="Position" value={ordinal(tableRow.position)} tone="brand" />
                <StatTile label="Points" value={tableRow.points} tone="butter" />
                <StatTile label="Played" value={tableRow.played} tone="sage" />
                <StatTile label="W-L" value={`${tableRow.won}-${tableRow.lost}`} tone="sage" />
              </View>
              <View className="flex-row gap-2.5">
                <StatTile label="Legs For" value={tableRow.legsFor} />
                <StatTile label="Legs Against" value={tableRow.legsAgainst} />
                <StatTile
                  label="Leg Diff"
                  value={tableRow.legDiff > 0 ? `+${tableRow.legDiff}` : tableRow.legDiff}
                  tone={tableRow.legDiff >= 0 ? 'sage' : 'coral'}
                />
              </View>
            </Card>
          )}

          {/* RECENT FORM */}
          <Card className="mb-4">
            <Caption className="mb-3">Recent Form</Caption>
            {isLoadingMatches ? (
              <ActivityIndicator color={RAW.brand} />
            ) : form.length === 0 ? (
              <Body size="sm">No completed matches yet this season.</Body>
            ) : (
              <View className="flex-row gap-1.5">
                {form.map((r, i) => <FormBadge key={i} result={r} />)}
              </View>
            )}
          </Card>

          {/* UPCOMING FIXTURES */}
          <Heading size="sm" className="mb-2.5">Upcoming Fixtures</Heading>
          {isLoadingMatches ? (
            <ActivityIndicator color={RAW.brand} style={{ marginVertical: 12 }} />
          ) : upcomingFixtures.length === 0 ? (
            <Card className="mb-4"><Body size="sm">No upcoming fixture scheduled.</Body></Card>
          ) : (
            <View className="mb-4">
              {upcomingFixtures.map((m) => {
                const isHome = m.homeTeamId === teamId;
                const opponentId = isHome ? m.awayTeamId : m.homeTeamId;
                return (
                  <TouchableOpacity
                    key={m.id}
                    activeOpacity={0.7}
                    onPress={() => router.push(`/(protected)/results-entry?matchId=${m.id}`)}
                  >
                    <Card className="mb-2.5">
                      <View className="flex-row items-center justify-between mb-1">
                        <Body tone="strong" weight="semibold" className="flex-1" numberOfLines={1}>
                          {isHome ? 'vs' : '@'} {teamNamesById[opponentId] ?? '…'}
                        </Body>
                        <Badge tone={m.status === 'disputed' ? 'coral' : m.status === 'awaiting_confirmation' ? 'butter' : 'brand'}>
                          {m.status === 'disputed' ? 'Disputed' : m.status === 'awaiting_confirmation' ? 'Awaiting confirmation' : 'Scheduled'}
                        </Badge>
                      </View>
                      <Body size="sm">
                        {formatMatchDate(m.scheduledDate)} · {isHome ? (m.venue ?? 'Home') : 'Away'}
                      </Body>
                    </Card>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* RECENT RESULTS */}
          <Heading size="sm" className="mb-2.5">Recent Results</Heading>
          {isLoadingMatches ? (
            <ActivityIndicator color={RAW.brand} style={{ marginVertical: 12 }} />
          ) : recentResults.length === 0 ? (
            <Card className="mb-4"><Body size="sm">No completed matches yet this season.</Body></Card>
          ) : (
            <View className="mb-4">
              {recentResults.map((m) => {
                const isHome = m.homeTeamId === teamId;
                const opponentId = isHome ? m.awayTeamId : m.homeTeamId;
                const won = isHome
                  ? (m.homeGamesWon ?? 0) > (m.awayGamesWon ?? 0)
                  : (m.awayGamesWon ?? 0) > (m.homeGamesWon ?? 0);
                const gamesFor = isHome ? m.homeGamesWon : m.awayGamesWon;
                const gamesAgainst = isHome ? m.awayGamesWon : m.homeGamesWon;
                return (
                  <TouchableOpacity
                    key={m.id}
                    activeOpacity={0.7}
                    onPress={() => router.push(`/(protected)/results-entry?matchId=${m.id}`)}
                  >
                    <Card className="mb-2.5">
                      <View className="flex-row items-center justify-between mb-1">
                        <Body tone="strong" weight="semibold" className="flex-1" numberOfLines={1}>
                          {isHome ? 'vs' : '@'} {teamNamesById[opponentId] ?? '…'}
                        </Body>
                        <Badge tone={won ? 'sage' : 'coral'}>{won ? 'Won' : 'Lost'}</Badge>
                      </View>
                      <View className="flex-row items-center justify-between">
                        <Body size="sm">{formatMatchDate(m.scheduledDate)}</Body>
                        <Body size="sm" tone={won ? 'sage' : 'coral'} weight="semibold">{gamesFor}-{gamesAgainst} games</Body>
                      </View>
                    </Card>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* SQUAD */}
          <Heading size="sm" className="mb-2.5">Squad</Heading>
          {isLoadingPlayers ? (
            <ActivityIndicator color={RAW.brand} style={{ marginVertical: 12 }} />
          ) : players.length === 0 ? (
            <Card className="mb-4"><Body size="sm">No players on this team yet.</Body></Card>
          ) : (
            <View className="mb-4">
              {players.map((player) => {
                const role = roleOf(player, team.captainUserId, team.viceCaptainUserId);
                const isClaimed = !!player.claimedByUserId;
                return (
                  <TouchableOpacity
                    key={player.id}
                    activeOpacity={0.7}
                    onPress={() => router.push(`/(protected)/player-profile?playerId=${player.id}`)}
                  >
                    <Card tone={isClaimed ? 'sage' : 'default'} className="mb-2.5">
                      <View className="flex-row items-center">
                        <Avatar initial={player.name.charAt(0)} tone={isClaimed ? 'sage' : 'brand'} size="sm" className="mr-3" />
                        <View className="flex-1">
                          <Body tone="strong" weight="semibold">{player.name}</Body>
                          {!isClaimed && <Body size="xs" className="mt-0.5">Not yet claimed</Body>}
                        </View>
                        {role && role !== 'player' && (
                          <Badge tone="brand" className="mr-2">{ROLE_BADGE_LABEL[role]}</Badge>
                        )}
                      </View>
                    </Card>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* TEAM STATISTICS */}
          {confirmedMatches.length > 0 && (
            <Card className="mb-2">
              <Caption className="mb-3">Team Statistics</Caption>
              <View className="flex-row gap-2.5">
                <StatTile label="Games Won" value={teamGameStats.gamesWon} tone="sage" />
                <StatTile label="Games Lost" value={teamGameStats.gamesLost} tone="coral" />
                <StatTile label="180s" value={teamGameStats.total180s} tone="butter" />
              </View>
              {teamGameStats.highestCheckout !== undefined && (
                <Body size="sm" className="mt-3">
                  Highest checkout: <Body size="sm" tone="butter" weight="bold">{teamGameStats.highestCheckout}</Body>
                </Body>
              )}
            </Card>
          )}
        </ScrollView>
      )}
    </>
  );

  return (
    <Screen scroll={false} header={<AppBar title={team?.name ?? 'Team Profile'} />}>
      <Stack.Screen options={{ headerShown: false }} />
      {body}
    </Screen>
  );
}
