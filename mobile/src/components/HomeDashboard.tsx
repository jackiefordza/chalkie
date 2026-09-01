import { useState, useEffect } from 'react';
import { View, TouchableOpacity, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useColorScheme } from 'nativewind';
import {
  collection, doc, onSnapshot, getDoc, query, where, and, or, orderBy,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { RAW, type SemanticTone } from '@/lib/theme';
import {
  Screen, Heading, Body, Caption, Badge, Card, StatTile, ListRow, Button, AppIcon,
} from '@/components/ui';
import type { Match, MatchStatus, DivisionTable, PlayerSeasonStats } from '@/types';

interface OpponentContact { name: string; phone: string }

const STATUS_LABEL: Record<MatchStatus, string> = {
  scheduled: 'Scheduled',
  awaiting_confirmation: 'Awaiting confirmation',
  disputed: 'Disputed — admin reviewing',
  confirmed: 'Final',
};
const STATUS_TONE: Record<MatchStatus, SemanticTone | null> = {
  scheduled: null,
  awaiting_confirmation: 'butter',
  disputed: 'coral',
  confirmed: 'sage',
};

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
// A captain/VC's phone is only surfaced here if their chosen visibility permits
// the *viewer's* own role to see it — 'public' = everyone, 'captains' = captain/VC
// viewers only, 'private' (or unset) = never shown here.
function canViewContact(viewerRole: string | undefined, visibility: string | null | undefined): boolean {
  if (visibility === 'public') return true;
  if (visibility === 'captains') return viewerRole === 'captain' || viewerRole === 'viceCaptain';
  return false;
}

function FormBadge({ result }: { result: 'W' | 'L' }) {
  const isWin = result === 'W';
  return (
    <View className={`w-6 h-6 rounded-full items-center justify-center ${isWin ? 'bg-sage-fill dark:bg-sage-fill-dark' : 'bg-coral-fill dark:bg-coral-fill-dark'}`}>
      <Body size="sm" weight="bold" tone={isWin ? 'sage' : 'coral'}>{result}</Body>
    </View>
  );
}

function recentForm(matches: Match[], teamId: string): ('W' | 'L')[] {
  return matches
    .filter((m) => m.status === 'confirmed')
    .slice(-3)
    .map((m): 'W' | 'L' => {
      const isHome = m.homeTeamId === teamId;
      const won = isHome ? (m.homeGamesWon ?? 0) > (m.awayGamesWon ?? 0) : (m.awayGamesWon ?? 0) > (m.homeGamesWon ?? 0);
      return won ? 'W' : 'L';
    });
}

// ─────────────────────────────────────────────────────────────────────────
// NEXT MATCH — the dashboard's primary card. "Next" means the earliest match
// that isn't confirmed yet (scheduled, awaiting confirmation, or disputed),
// not just the next scheduled date — so a stuck-in-limbo result surfaces
// here too, exactly where "what needs my attention" logic belongs.
// ─────────────────────────────────────────────────────────────────────────
interface NextMatchCardProps {
  match: Match | null;
  teamId: string;
  opponentName: string;
  tableRow: DivisionTable | null;
  form: ('W' | 'L')[];
  isCaptainOrVC: boolean;
}

function NextMatchCard({ match, teamId, opponentName, tableRow, form, isCaptainOrVC }: NextMatchCardProps) {
  const { appUser } = useAuthStore();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [opponentContact, setOpponentContact] = useState<OpponentContact | null>(null);
  const [venuePhone, setVenuePhone] = useState<string | null>(null);

  const opponentId = match ? (match.homeTeamId === teamId ? match.awayTeamId : match.homeTeamId) : null;
  const isHome = match?.homeTeamId === teamId;

  useEffect(() => {
    if (!opponentId) { setOpponentContact(null); setVenuePhone(null); return; }
    (async () => {
      const teamSnap = await getDoc(doc(db, 'teams', opponentId));
      if (!teamSnap.exists()) { setOpponentContact(null); setVenuePhone(null); return; }
      const teamData = teamSnap.data();
      setVenuePhone(teamData.venuePhone ?? null);

      const captainUserId = teamData.captainUserId ?? teamData.viceCaptainUserId;
      if (!captainUserId) { setOpponentContact(null); return; }
      const userSnap = await getDoc(doc(db, 'users', captainUserId));
      if (!userSnap.exists()) { setOpponentContact(null); return; }
      const userData = userSnap.data();
      if (canViewContact(appUser?.role, userData.phoneVisibility) && userData.phone) {
        setOpponentContact({ name: userData.displayName ?? 'Captain', phone: userData.phone });
      } else {
        setOpponentContact(null);
      }
    })();
  }, [opponentId, appUser?.role]);

  if (!match || !opponentId) {
    return (
      <Card className="mb-4">
        <Caption>Next Match</Caption>
        <Body size="sm" className={form.length > 0 ? 'mt-2 mb-3' : 'mt-2'}>No upcoming fixture scheduled</Body>
        {form.length > 0 && (
          <View className="flex-row items-center gap-2 pt-3 mt-1 border-t border-border dark:border-border-dark">
            <Caption>Your Form</Caption>
            <View className="flex-row gap-1.5">{form.map((r, i) => <FormBadge key={i} result={r} />)}</View>
          </View>
        )}
      </Card>
    );
  }

  const tone = STATUS_TONE[match.status];
  // Matches fixtures.tsx exactly: anyone can open a confirmed result; an
  // unconfirmed one is only worth opening (to submit/edit) if you're
  // captain/VC — an ordinary player has nothing to do on results-entry for
  // a match that hasn't been played out yet.
  const tappable = isCaptainOrVC;

  const content = (
    <Card className="mb-4">
      <View className="flex-row items-center justify-between mb-3">
        <Caption>Next Match</Caption>
        {tableRow && <Badge tone="brand">{ordinal(tableRow.position)} in table</Badge>}
      </View>

      <View className="flex-row items-center justify-between mb-1">
        <Heading size="md" className="flex-1" numberOfLines={1}>
          {isHome ? `You vs ${opponentName}` : `${opponentName} vs You`}
        </Heading>
        <Badge tone={isHome ? 'sage' : 'butter'}>{isHome ? 'Home' : 'Away'}</Badge>
      </View>

      <Body size="sm" className="mb-1">
        {formatDate(match.scheduledDate)}
        {match.venue ? ` · ${match.venue}` : ''}
      </Body>

      {tone && <Badge tone={tone} className="self-start mt-1 mb-2">{STATUS_LABEL[match.status]}</Badge>}

      {opponentContact && (
        <View className="flex-row items-center gap-2 mt-2 mb-2 py-2.5 px-3 rounded-xl bg-surface-2 dark:bg-surface-2-dark">
          <AppIcon name="phone" size={15} color={RAW.brand} />
          <Body size="sm" tone="strong" weight="semibold" numberOfLines={1} className="flex-1">{opponentContact.name}</Body>
          <Body size="sm" tone="brand">{opponentContact.phone}</Body>
        </View>
      )}
      {!isHome && venuePhone && (
        <View className="flex-row items-center gap-2 py-2.5 px-3 rounded-xl bg-surface-2 dark:bg-surface-2-dark">
          <AppIcon name="home" size={15} color={RAW.brand} />
          <Body size="sm" tone="strong" weight="semibold" className="flex-1">Venue Contact</Body>
          <Body size="sm" tone="brand">{venuePhone}</Body>
        </View>
      )}

      {isCaptainOrVC && (
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
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => router.push(`/(protected)/results-entry?matchId=${match.id}`)}
    >
      {content}
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// TEAM SNAPSHOT
// ─────────────────────────────────────────────────────────────────────────
function TeamSnapshotCard({ tableRow, form }: { tableRow: DivisionTable; form: ('W' | 'L')[] }) {
  return (
    <Card className="mb-4">
      <Caption className="mb-3">Team Snapshot</Caption>
      <View className="flex-row gap-2.5">
        <StatTile label="Position" value={ordinal(tableRow.position)} tone="brand" />
        <StatTile label="Points" value={tableRow.points} tone="butter" />
        <StatTile label="W-L" value={`${tableRow.won}-${tableRow.lost}`} tone="sage" />
        <StatTile label="Leg Diff" value={tableRow.legDiff > 0 ? `+${tableRow.legDiff}` : tableRow.legDiff} tone={tableRow.legDiff >= 0 ? 'sage' : 'coral'} />
      </View>
      {form.length > 0 && (
        <View className="flex-row items-center gap-2 pt-3 mt-3 border-t border-border dark:border-border-dark">
          <Caption>Recent Form</Caption>
          <View className="flex-row gap-1.5">{form.map((r, i) => <FormBadge key={i} result={r} />)}</View>
        </View>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// PERSONAL SNAPSHOT
// ─────────────────────────────────────────────────────────────────────────
function PersonalSnapshotCard({ stats }: { stats: PlayerSeasonStats | null }) {
  if (!stats || stats.played === 0) {
    return (
      <Card className="mb-4">
        <Caption className="mb-2">Your Stats</Caption>
        <Body size="sm">No stats yet — these fill in once your matches are confirmed.</Body>
      </Card>
    );
  }
  const winPct = Math.round((stats.won / stats.played) * 100);
  const highest = stats.highCheckouts
    .map((c) => Number(c.value))
    .filter((v) => !Number.isNaN(v))
    .sort((a, b) => b - a)[0];

  return (
    <Card className="mb-4">
      <Caption className="mb-3">Your Stats</Caption>
      <View className="flex-row gap-2.5">
        <StatTile label="Played" value={stats.played} tone="brand" />
        <StatTile label="Won" value={stats.won} tone="sage" />
        <StatTile label="Win %" value={`${winPct}%`} tone="sage" />
        <StatTile label="180s" value={stats.oneEighties} tone="butter" />
      </View>
      {highest !== undefined && (
        <Body size="sm" className="mt-3">Highest checkout: <Body size="sm" tone="butter" weight="bold">{highest}</Body></Body>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// RECENT RESULT
// ─────────────────────────────────────────────────────────────────────────
function RecentResultCard({ match, teamId, opponentName }: { match: Match; teamId: string; opponentName: string }) {
  const isHome = match.homeTeamId === teamId;
  const won = isHome
    ? (match.homeGamesWon ?? 0) > (match.awayGamesWon ?? 0)
    : (match.awayGamesWon ?? 0) > (match.homeGamesWon ?? 0);
  const legsFor = isHome ? match.homeLegsWon : match.awayLegsWon;
  const legsAgainst = isHome ? match.awayLegsWon : match.homeLegsWon;

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => router.push(`/(protected)/results-entry?matchId=${match.id}`)}
    >
      <Card className="mb-4">
        <Caption className="mb-2">Recent Result</Caption>
        <View className="flex-row items-center justify-between">
          <Body tone="strong" weight="semibold" className="flex-1" numberOfLines={1}>
            {isHome ? 'vs' : '@'} {opponentName}
          </Body>
          <Badge tone={won ? 'sage' : 'coral'}>{won ? 'Won' : 'Lost'}</Badge>
        </View>
        <View className="flex-row items-center justify-between mt-1">
          <Body size="sm">{formatDate(match.scheduledDate)}</Body>
          <Body size="sm" tone={won ? 'sage' : 'coral'} weight="semibold">{legsFor} - {legsAgainst} legs</Body>
        </View>
      </Card>
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// HOME DASHBOARD — shared by both the player ("home") and captain/VC
// ("captain") tabs, exactly as the single old HomeFixturesScreen was.
// ─────────────────────────────────────────────────────────────────────────
export function HomeDashboard() {
  const { appUser } = useAuthStore();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const teamId = appUser?.teamId ?? null;
  const isCaptainOrVC = appUser?.role === 'captain' || appUser?.role === 'viceCaptain';

  const [matches, setMatches] = useState<Match[]>([]);
  const [teamNames, setTeamNames] = useState<Record<string, string>>({});
  const [tableRow, setTableRow] = useState<DivisionTable | null>(null);
  const [myStats, setMyStats] = useState<PlayerSeasonStats | null>(null);
  const [leagueName, setLeagueName] = useState<string | null>(null);
  const [divisionName, setDivisionName] = useState<string | null>(null);
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Team's matches + the league's team-name lookup — same query shape used
  // elsewhere in the app (fixtures.tsx, the old NextFixtureTile).
  useEffect(() => {
    if (!teamId || !appUser?.leagueId) { setIsLoading(false); return; }

    const unsubMatches = onSnapshot(
      query(
        collection(db, 'matches'),
        and(where('leagueId', '==', appUser.leagueId), or(where('homeTeamId', '==', teamId), where('awayTeamId', '==', teamId))),
        orderBy('scheduledDate', 'asc'),
      ),
      (snap) => {
        setMatches(snap.docs.map((d) => ({
          id: d.id, ...d.data(), scheduledDate: d.data().scheduledDate?.toDate() ?? new Date(),
        } as Match)));
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
    );

    return () => { unsubMatches(); unsubTeams(); };
  }, [teamId, appUser?.leagueId]);

  // Own team's standings row. Before a team's first confirmed match, this
  // doc doesn't exist yet — and the read rule (me().leagueId ==
  // resource.data.leagueId) throws rather than cleanly denying when
  // `resource` itself is null, so a missing doc surfaces as a permission
  // error, not "doesn't exist". Treat that specific case as "no row yet"
  // (a real, expected early-season state) rather than a page-level error.
  useEffect(() => {
    if (!appUser?.seasonId || !appUser?.divisionId || !teamId) { setTableRow(null); return; }
    return onSnapshot(
      doc(db, 'divisionTables', `${appUser.seasonId}_${appUser.divisionId}_${teamId}`),
      (snap) => setTableRow(snap.exists() ? ({ id: snap.id, ...snap.data() } as DivisionTable) : null),
      () => setTableRow(null),
    );
  }, [appUser?.seasonId, appUser?.divisionId, teamId]);

  // Personal stats — same doc-ID pattern as the Stats tab's "My Stats", and
  // the same missing-doc-throws-instead-of-denies quirk as tableRow above —
  // a player with no confirmed games yet has no playerSeasonStats doc.
  useEffect(() => {
    if (!appUser?.seasonId || !appUser?.playerId) { setMyStats(null); return; }
    return onSnapshot(
      doc(db, 'playerSeasonStats', `${appUser.seasonId}_${appUser.playerId}`),
      (snap) => setMyStats(snap.exists() ? ({
        id: snap.id, ...snap.data(),
        highCheckouts: (snap.data().highCheckouts ?? []).map((c: any) => ({ ...c, date: c.date?.toDate?.() ?? new Date() })),
      } as PlayerSeasonStats) : null),
      () => setMyStats(null),
    );
  }, [appUser?.seasonId, appUser?.playerId]);

  // League/division names — one-time reads; this data essentially never
  // changes, so a listener would just be an idle connection for no benefit.
  useEffect(() => {
    if (appUser?.leagueId) getDoc(doc(db, 'leagues', appUser.leagueId)).then((s) => setLeagueName(s.exists() ? s.data().name : null));
    if (appUser?.divisionId) getDoc(doc(db, 'divisions', appUser.divisionId)).then((s) => setDivisionName(s.exists() ? s.data().name : null));
  }, [appUser?.leagueId, appUser?.divisionId]);

  // Captain/VC only: how many join/claim/VC requests are waiting on them —
  // same query captains.tsx already uses for its inbox.
  useEffect(() => {
    if (!isCaptainOrVC || !teamId) { setPendingRequestCount(0); return; }
    return onSnapshot(
      query(collection(db, 'joinRequests'), where('teamId', '==', teamId), where('status', '==', 'pending')),
      (snap) => setPendingRequestCount(snap.size),
    );
  }, [isCaptainOrVC, teamId]);

  if (!teamId) {
    return (
      <Screen>
        <Body className="text-center mt-10">Join a team to see your dashboard.</Body>
      </Screen>
    );
  }

  const nextMatch = matches.find((m) => m.status !== 'confirmed') ?? null;
  const nextOpponentId = nextMatch ? (nextMatch.homeTeamId === teamId ? nextMatch.awayTeamId : nextMatch.homeTeamId) : null;
  const confirmedMatches = matches.filter((m) => m.status === 'confirmed');
  const recentMatch = confirmedMatches[confirmedMatches.length - 1] ?? null;
  const recentOpponentId = recentMatch ? (recentMatch.homeTeamId === teamId ? recentMatch.awayTeamId : recentMatch.homeTeamId) : null;
  const form = recentForm(matches, teamId);

  const firstName = appUser?.nickname || appUser?.displayName?.split(' ')[0] || 'there';
  const contextLine = [teamNames[teamId], divisionName, leagueName].filter(Boolean).join(' · ');

  return (
    <Screen>
      <View className="mb-5">
        <Heading size="lg">Welcome back, {firstName}</Heading>
        {contextLine ? <Body size="sm" className="mt-1">{contextLine}</Body> : null}
      </View>

      {loadError ? (
        <Card tone="coral">
          <Body tone="coral" weight="semibold" className="mb-1">Couldn't load your dashboard</Body>
          <Body tone="coral" size="sm">{loadError}</Body>
        </Card>
      ) : isLoading ? (
        <ActivityIndicator color={RAW.brand} style={{ marginTop: 40 }} />
      ) : (
        <>
          {isCaptainOrVC && pendingRequestCount > 0 && (
            <ListRow
              className="mb-4"
              avatar={<AppIcon name="users" size={20} color={isDark ? RAW.brandInkDark : RAW.brandInk} />}
              title={`${pendingRequestCount} request${pendingRequestCount === 1 ? '' : 's'} waiting`}
              subtitle="Tap to review your team's inbox"
              trailing={<AppIcon name="chevron-right" size={18} color={isDark ? RAW.textFaintDark : RAW.textFaint} />}
              onPress={() => router.push('/(protected)/(tabs)/captains')}
            />
          )}

          <NextMatchCard
            match={nextMatch}
            teamId={teamId}
            opponentName={nextOpponentId ? (teamNames[nextOpponentId] ?? '…') : ''}
            tableRow={tableRow}
            form={form}
            isCaptainOrVC={isCaptainOrVC}
          />

          {tableRow && <TeamSnapshotCard tableRow={tableRow} form={form} />}

          <PersonalSnapshotCard stats={myStats} />

          {recentMatch && recentOpponentId && (
            <RecentResultCard match={recentMatch} teamId={teamId} opponentName={teamNames[recentOpponentId] ?? '…'} />
          )}
        </>
      )}
    </Screen>
  );
}
