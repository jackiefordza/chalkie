import { useState, useEffect } from 'react';
import { View } from 'react-native';
import {
  collection, doc, onSnapshot, query, where, and, or, orderBy, getDoc,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { Alert } from '@/lib/alert';
import { useAuthStore } from '@/stores/authStore';
import { RAW } from '@/lib/theme';
import { Heading, Body, Caption, Badge, Card, AppIcon } from '@/components/ui';
import type { Match, DivisionTable } from '@/types';

interface OpponentContact { name: string; phone: string }

const CARD_CAPTION = ['Next Fixture', 'Following Fixture'];

function formatFixtureDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

// A captain/VC's phone is only surfaced here if their chosen visibility permits
// the *viewer's* own role to see it — 'public' = everyone, 'captains' = captain/VC
// viewers only, 'private' (or unset) = never shown in this tile.
function canViewContact(viewerRole: string | undefined, visibility: string | null | undefined): boolean {
  if (visibility === 'public') return true;
  if (visibility === 'captains') return viewerRole === 'captain' || viewerRole === 'viceCaptain';
  return false;
}

function FormBadge({ result }: { result: 'W' | 'L' }) {
  const isWin = result === 'W';
  return (
    <View
      className={`w-6 h-6 rounded-full items-center justify-center ${isWin ? 'bg-sage-fill dark:bg-sage-fill-dark' : 'bg-coral-fill dark:bg-coral-fill-dark'}`}
    >
      <Body size="sm" weight="bold" tone={isWin ? 'sage' : 'coral'}>{result}</Body>
    </View>
  );
}

interface FixtureCardProps {
  match: Match;
  teamId: string;
  opponentName: string;
  caption: string;
  tableRow: DivisionTable | null;
  showTeamStatus: boolean;
}

function FixtureCard({ match, teamId, opponentName, caption, tableRow, showTeamStatus }: FixtureCardProps) {
  const { appUser } = useAuthStore();
  const [opponentContact, setOpponentContact] = useState<OpponentContact | null>(null);
  const [venuePhone, setVenuePhone] = useState<string | null>(null);
  const [opponentForm, setOpponentForm] = useState<('W' | 'L')[]>([]);

  const opponentId = match.homeTeamId === teamId ? match.awayTeamId : match.homeTeamId;
  const isHome = match.homeTeamId === teamId;

  useEffect(() => {
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

  // How the *opponent* has been getting on lately — more useful ahead of a
  // fixture than your own form, which you already know. Only fetched for the
  // primary card (showTeamStatus) to avoid an extra query per fixture shown.
  useEffect(() => {
    if (!showTeamStatus || !appUser?.leagueId) { setOpponentForm([]); return; }
    const unsub = onSnapshot(
      query(
        collection(db, 'matches'),
        and(
          where('leagueId', '==', appUser.leagueId),
          or(where('homeTeamId', '==', opponentId), where('awayTeamId', '==', opponentId)),
        ),
        orderBy('scheduledDate', 'asc'),
      ),
      (snap) => {
        const form = snap.docs
          .map((d) => d.data())
          .filter((m) => m.status === 'confirmed')
          .slice(-3)
          .map((m): 'W' | 'L' => {
            const oppIsHome = m.homeTeamId === opponentId;
            const won = oppIsHome
              ? (m.homeGamesWon ?? 0) > (m.awayGamesWon ?? 0)
              : (m.awayGamesWon ?? 0) > (m.homeGamesWon ?? 0);
            return won ? 'W' : 'L';
          });
        setOpponentForm(form);
      },
      (e) => Alert.alert('Error', (e as Error).message ?? 'Something went wrong'),
    );
    return unsub;
  }, [opponentId, showTeamStatus, appUser?.leagueId]);

  return (
    <Card className="mb-3">
      <View className="flex-row items-center justify-between mb-3">
        <Caption>{caption}</Caption>
        {showTeamStatus && tableRow && <Badge tone="brand">{ordinal(tableRow.position)} in table</Badge>}
      </View>

      <View className="flex-row items-center justify-between mb-1">
        <Heading size="sm" className="flex-1" numberOfLines={1}>vs {opponentName}</Heading>
        <Badge tone={isHome ? 'sage' : 'butter'}>{isHome ? 'Home' : 'Away'}</Badge>
      </View>
      <Body size="sm" className="mb-3">
        {formatFixtureDate(match.scheduledDate)}
        {match.venue ? ` · ${match.venue}` : ''}
      </Body>

      {opponentContact && (
        <View className="flex-row items-center gap-2 mb-2 py-2.5 px-3 rounded-xl bg-surface-2 dark:bg-surface-2-dark">
          <AppIcon name="phone" size={15} color={RAW.brand} />
          <Body size="sm" tone="strong" weight="semibold" numberOfLines={1} className="flex-1">
            {opponentContact.name}
          </Body>
          <Body size="sm" tone="brand">{opponentContact.phone}</Body>
        </View>
      )}

      {/* Venue contact — only relevant when we're the ones travelling */}
      {!isHome && venuePhone && (
        <View className="flex-row items-center gap-2 py-2.5 px-3 rounded-xl bg-surface-2 dark:bg-surface-2-dark">
          <AppIcon name="home" size={15} color={RAW.brand} />
          <Body size="sm" tone="strong" weight="semibold" className="flex-1">Venue Contact</Body>
          <Body size="sm" tone="brand">{venuePhone}</Body>
        </View>
      )}

      {showTeamStatus && opponentForm.length > 0 && (
        <View className="flex-row items-center gap-2 pt-3 mt-1 border-t border-border dark:border-border-dark">
          <Caption>{opponentName}'s Form</Caption>
          <View className="flex-row gap-1.5">
            {opponentForm.map((result, i) => <FormBadge key={i} result={result} />)}
          </View>
        </View>
      )}
    </Card>
  );
}

export function NextFixtureTile({ teamId, count = 2 }: { teamId: string; count?: number }) {
  const { appUser } = useAuthStore();

  const [matches, setMatches] = useState<Match[]>([]);
  const [teamNames, setTeamNames] = useState<Record<string, string>>({});
  const [tableRow, setTableRow] = useState<DivisionTable | null>(null);

  useEffect(() => {
    if (!teamId || !appUser?.leagueId) return;
    const onErr = (e: unknown) => Alert.alert('Error', (e as Error).message ?? 'Something went wrong');

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
        setMatches(snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
          scheduledDate: d.data().scheduledDate?.toDate() ?? new Date(),
        } as Match)));
      },
      onErr,
    );

    const unsubTeams = onSnapshot(
      query(collection(db, 'teams'), where('leagueId', '==', appUser.leagueId)),
      (snap) => {
        const map: Record<string, string> = {};
        snap.docs.forEach((d) => { map[d.id] = d.data().name; });
        setTeamNames(map);
      },
      onErr,
    );

    return () => { unsubMatches(); unsubTeams(); };
  }, [teamId, appUser?.leagueId]);

  useEffect(() => {
    if (!appUser?.seasonId || !appUser?.divisionId || !teamId) { setTableRow(null); return; }
    const unsub = onSnapshot(
      doc(db, 'divisionTables', `${appUser.seasonId}_${appUser.divisionId}_${teamId}`),
      (snap) => setTableRow(snap.exists() ? ({ id: snap.id, ...snap.data() } as DivisionTable) : null),
      (e) => Alert.alert('Error', (e as Error).message ?? 'Something went wrong'),
    );
    return unsub;
  }, [appUser?.seasonId, appUser?.divisionId, teamId]);

  const upcomingMatches = matches.filter((m) => m.status === 'scheduled').slice(0, count);
  const recentForm = matches
    .filter((m) => m.status === 'confirmed')
    .slice(-3)
    .map((m): 'W' | 'L' => {
      const isHome = m.homeTeamId === teamId;
      const won = isHome ? (m.homeGamesWon ?? 0) > (m.awayGamesWon ?? 0) : (m.awayGamesWon ?? 0) > (m.homeGamesWon ?? 0);
      return won ? 'W' : 'L';
    });

  if (upcomingMatches.length === 0) {
    return (
      <Card className="mb-5">
        <View className="flex-row items-center justify-between mb-3">
          <Caption>Next Fixture</Caption>
          {tableRow && <Badge tone="brand">{ordinal(tableRow.position)} in table</Badge>}
        </View>
        <Body size="sm" className={recentForm.length > 0 ? 'mb-3' : ''}>No upcoming fixture scheduled</Body>
        {recentForm.length > 0 && (
          <View className="flex-row items-center gap-2 pt-3 border-t border-border dark:border-border-dark">
            <Caption>Your Form</Caption>
            <View className="flex-row gap-1.5">
              {recentForm.map((result, i) => <FormBadge key={i} result={result} />)}
            </View>
          </View>
        )}
      </Card>
    );
  }

  return (
    <View className="mb-2">
      {upcomingMatches.map((match, i) => {
        const opponentId = match.homeTeamId === teamId ? match.awayTeamId : match.homeTeamId;
        return (
          <FixtureCard
            key={match.id}
            match={match}
            teamId={teamId}
            opponentName={teamNames[opponentId] ?? '…'}
            caption={CARD_CAPTION[i] ?? 'Fixture'}
            tableRow={tableRow}
            showTeamStatus={i === 0}
          />
        );
      })}
    </View>
  );
}
