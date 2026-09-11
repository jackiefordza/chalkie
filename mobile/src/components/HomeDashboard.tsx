import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Image, Linking } from 'react-native';
import { router } from 'expo-router';
import {
  collection, doc, onSnapshot, getDoc, query, where, and, or, orderBy,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { RAW, homeToneClasses } from '@/lib/theme';
import { FONT_MONO, FONT_DISPLAY } from '@/styles/typography';
import { STATUS_LABEL, STATUS_TONE, isFixtureException } from '@/lib/matchStatus';
import { Screen, Header, Button, AppIcon } from '@/components/ui';
import type { Match, DivisionTable, PlayerSeasonStats, LeagueSponsor } from '@/types';

// ─────────────────────────────────────────────────────────────────────────
// Phase E, Step 2 — Home V1 visual prototype. Every data-fetching effect,
// every piece of state, and every existing decision (which match counts as
// "next", the CTA's state machine, contact-visibility rules, the postponed/
// cancelled exclusion) is preserved EXACTLY as it was — this file's actual
// rewrite is the JSX/styling below each. The one genuinely new piece of
// data-fetching is the League Snapshot query, added where it's computed.
//
// Deliberately NOT built from the shared Card/Badge/StatTile/ListRow/
// FormBadge/SponsorBanner primitives: those components' colours are driven
// by the app's actual light/dark colorScheme, which is an orthogonal signal
// to "is this the new Home direction" — a reviewer with their phone set to
// light mode would otherwise see e.g. a pale mint Badge floating on this
// screen's near-black background. Home's fixed palette (tailwind.config.js's
// home-* tokens, see lib/theme.ts's homeToneClasses) is fixed regardless of
// colorScheme, so this file uses plain View/Text with those classes directly
// instead. Small, genuinely new pieces (Button's 'accent' variant, Screen's
// backgroundClassName override, the shared Header component) were added to
// the real shared primitives where doing so was safe and additive — see
// each file's own comment.
//
// Step 3 — colour pass ("graphite + muted Chalkie green + off-white"): the
// interface is mostly neutral graphite/off-white; the accent green is used
// sparingly for genuine emphasis (primary CTA, active/selected state,
// important numerical emphasis) rather than as decoration. Amber/warning
// only ever appears for a real warning/status meaning, never as a general
// secondary brand colour — see each section below for what changed and why.
// ─────────────────────────────────────────────────────────────────────────

interface OpponentContact { name: string; phone: string }

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
export function ordinal(n: number): string {
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

export function recentForm(matches: Match[], teamId: string, count = 3): ('W' | 'L')[] {
  return matches
    .filter((m) => m.status === 'confirmed')
    .slice(-count)
    .map((m): 'W' | 'L' => {
      const isHome = m.homeTeamId === teamId;
      const won = isHome ? (m.homeGamesWon ?? 0) > (m.awayGamesWon ?? 0) : (m.awayGamesWon ?? 0) > (m.homeGamesWon ?? 0);
      return won ? 'W' : 'L';
    });
}

// Small W/L indicator with the fixed dark palette — the same visual role as
// the shared FormBadge, not reused for the reason given at the top of this
// file (FormBadge's colours follow the app's actual colorScheme).
function FormDot({ result }: { result: 'W' | 'L' }) {
  const isWin = result === 'W';
  return (
    <View className={`w-5 h-5 rounded-full items-center justify-center ${isWin ? 'bg-home-success/15' : 'bg-home-error/15'}`}>
      <Text className={`text-[10px] font-bold ${isWin ? 'text-home-success' : 'text-home-error'}`}>{result}</Text>
    </View>
  );
}

function EyebrowCaption({ children }: { children: string }) {
  return <Text className="text-[11px] font-semibold uppercase tracking-wider text-home-text-faint">{children}</Text>;
}

// ─────────────────────────────────────────────────────────────────────────
// NEXT MATCH — the primary hero. "Next" is still deliberately scheduled/
// awaiting_confirmation/disputed only (a postponed/cancelled match is an
// admin exception, never surfaced here as "what needs my attention next")
// — that selection happens in HomeDashboard below, unchanged; this
// component only renders whatever match it's given.
// ─────────────────────────────────────────────────────────────────────────
interface NextMatchHeroProps {
  match: Match | null;
  teamId: string;
  opponentName: string;
  tableRow: DivisionTable | null;
  form: ('W' | 'L')[];
  isCaptainOrVC: boolean;
}

function NextMatchHero({ match, teamId, opponentName, tableRow, form, isCaptainOrVC }: NextMatchHeroProps) {
  const { appUser } = useAuthStore();
  const [opponentContact, setOpponentContact] = useState<OpponentContact | null>(null);
  const [venuePhone, setVenuePhone] = useState<string | null>(null);
  // Whether OUR team has a saved submission for this match yet — only
  // meaningful (and only fetched) once there's actually a submission to
  // check for, i.e. once the match is past 'scheduled'. Lets the action
  // label below distinguish "it's your move" from "you're waiting on them"
  // instead of a single generic label for every non-scheduled status —
  // directly the "is there anything I need to do?" question this
  // component exists to answer. Single doc read, same permission this
  // screen's own "Enter Result" flow already relies on
  // (matches/{id}/submissions/{teamId}).
  const [hasSubmitted, setHasSubmitted] = useState<boolean | null>(null);

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

  useEffect(() => {
    if (!isCaptainOrVC || !match || (match.status !== 'awaiting_confirmation' && match.status !== 'disputed')) {
      setHasSubmitted(null);
      return;
    }
    getDoc(doc(db, 'matches', match.id, 'submissions', teamId))
      .then((s) => setHasSubmitted(s.exists()))
      .catch(() => setHasSubmitted(null));
  }, [isCaptainOrVC, match?.id, match?.status, teamId]);

  if (!match || !opponentId) {
    return (
      <View className="rounded-lg border border-home-border bg-home-surface px-5 py-5 mb-6">
        <EyebrowCaption>Next Match</EyebrowCaption>
        <Text className={`text-[13px] text-home-text-dim ${form.length > 0 ? 'mt-2 mb-3' : 'mt-2'}`}>
          No upcoming fixture scheduled
        </Text>
        {form.length > 0 && (
          <View className="flex-row items-center gap-2 pt-3 mt-1 border-t border-home-border">
            <EyebrowCaption>Your Form</EyebrowCaption>
            <View className="flex-row gap-1.5">{form.map((r, i) => <FormDot key={i} result={r} />)}</View>
          </View>
        )}
      </View>
    );
  }

  const tone = STATUS_TONE[match.status];
  const toneClasses = tone ? homeToneClasses(tone) : null;
  const ctaLabel = match.status === 'scheduled' ? 'Enter Result'
    : match.status === 'disputed' ? 'Resolve Differences'
      : match.status === 'awaiting_confirmation' && hasSubmitted === false ? 'Review Their Result'
        : match.status === 'awaiting_confirmation' && hasSubmitted === true ? 'View Submission'
          : 'View / Edit Result';

  const content = (
    <View className="rounded-lg border border-home-border bg-home-surface px-5 py-5 mb-6">
      <View className="flex-row items-center justify-between mb-4">
        <EyebrowCaption>Next Match</EyebrowCaption>
        {toneClasses && (
          <View className={`rounded px-2 py-1 ${toneClasses.bg}`}>
            <Text className={`text-[10px] font-bold uppercase tracking-wide ${toneClasses.text}`}>
              {STATUS_LABEL[match.status]}
            </Text>
          </View>
        )}
      </View>

      <View className="flex-row items-baseline gap-1.5">
        <Text className="text-[19px] font-bold text-home-text" style={{ fontFamily: FONT_DISPLAY }}>You</Text>
        <Text className="text-[12px] text-home-text-faint">({isHome ? 'H' : 'A'})</Text>
      </View>
      <Text className="text-[15px] text-home-text-dim mb-4" numberOfLines={1}>vs {opponentName}</Text>

      <View className="flex-row items-center justify-between mb-4">
        <Text className="text-[13px] text-home-text-dim flex-1 mr-2" numberOfLines={1}>
          {formatDate(match.scheduledDate)}{match.venue ? ` · ${match.venue}` : ''}
        </Text>
        {tableRow && (
          <Text
            className="text-[13px] font-bold text-home-accent"
            style={{ fontFamily: FONT_MONO, fontVariant: ['tabular-nums'] }}
          >
            {ordinal(tableRow.position)}
          </Text>
        )}
      </View>

      {isCaptainOrVC && (
        <Button
          variant="accent"
          size="sm"
          onPress={() => router.push(`/(protected)/results-entry?matchId=${match.id}`)}
        >
          {ctaLabel}
        </Button>
      )}

      {(opponentContact || (!isHome && venuePhone)) && (
        <View className="mt-4 pt-4 border-t border-home-border gap-2.5">
          {opponentContact && (
            <View className="flex-row items-center gap-2">
              <AppIcon name="phone" size={13} color={RAW.homeTextFaint} />
              <Text className="text-[12px] text-home-text-dim flex-1" numberOfLines={1}>{opponentContact.name}</Text>
              <Text className="text-[12px] text-home-text-dim">{opponentContact.phone}</Text>
            </View>
          )}
          {!isHome && venuePhone && (
            <View className="flex-row items-center gap-2">
              <AppIcon name="home" size={13} color={RAW.homeTextFaint} />
              <Text className="text-[12px] text-home-text-dim flex-1">Venue Contact</Text>
              <Text className="text-[12px] text-home-text-dim">{venuePhone}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );

  // The Match Centre (results-entry.tsx) shows a proper read-only view for
  // any status to anyone on either team, not just captain/VC with
  // something to submit — so the whole hero is always tappable.
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
// YOUR TEAM — one dominant number (position), not four equal tiles.
// ─────────────────────────────────────────────────────────────────────────
function YourTeamSection({ tableRow, form, teamId }: { tableRow: DivisionTable; form: ('W' | 'L')[]; teamId: string }) {
  const legDiffText = tableRow.legDiff > 0 ? `+${tableRow.legDiff}` : `${tableRow.legDiff}`;
  return (
    <TouchableOpacity activeOpacity={0.7} onPress={() => router.push(`/(protected)/team-profile?teamId=${teamId}`)}>
      <View className="mb-6">
        <EyebrowCaption>Your Team</EyebrowCaption>
        <View className="flex-row items-end gap-4 mt-2">
          <Text
            className="text-[36px] font-bold text-home-accent leading-[38px]"
            style={{ fontFamily: FONT_MONO, fontVariant: ['tabular-nums'] }}
          >
            {ordinal(tableRow.position)}
          </Text>
          <Text className="text-[13px] text-home-text-dim pb-1.5 flex-1" numberOfLines={1}>
            <Text className="font-bold text-home-text" style={{ fontFamily: FONT_MONO, fontVariant: ['tabular-nums'] }}>
              {tableRow.points}
            </Text>
            {' pts  ·  '}
            <Text style={{ fontFamily: FONT_MONO, fontVariant: ['tabular-nums'] }}>{tableRow.won}-{tableRow.lost}</Text>
            {' W-L  ·  '}
            <Text style={{ fontFamily: FONT_MONO, fontVariant: ['tabular-nums'] }}>{legDiffText}</Text>
            {' legs'}
          </Text>
        </View>
        {form.length > 0 && (
          <View className="flex-row items-center gap-1.5 mt-3">
            {form.map((r, i) => <FormDot key={i} result={r} />)}
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// LEAGUE SNAPSHOT — 3-5 rows around the viewer's own position, not the
// full table. The one genuinely new query in this file: the existing
// tableRow read (a single doc, already fetched by HomeDashboard) supplies
// the position to window the range query around.
// ─────────────────────────────────────────────────────────────────────────
// Step 3 — colour pass: V1 turned the whole viewer row green (position,
// team name and points all coloured + a green-tinted background). The
// brief is explicit that this reads as "the entire row is green" — so the
// row is now distinguished by a neutral elevated background (same
// language as every other "this is different" surface in the app) plus
// exactly ONE accent touch, the position number, which is already the
// "important numerical emphasis" this section exists to draw the eye to.
// Team name and points stay neutral (bold weight carries "this is you",
// not colour).
function LeagueSnapshotList({ rows, myTeamId, teamNames }: {
  rows: DivisionTable[]; myTeamId: string; teamNames: Record<string, string>;
}) {
  if (rows.length === 0) return null;
  return (
    <View className="mb-6">
      <EyebrowCaption>League Snapshot</EyebrowCaption>
      <View className="rounded-lg border border-home-border overflow-hidden mt-2">
        {rows.map((row, i) => {
          const isMine = row.teamId === myTeamId;
          return (
            <TouchableOpacity
              key={row.id}
              activeOpacity={0.7}
              onPress={() => router.push(`/(protected)/team-profile?teamId=${row.teamId}`)}
              className={[
                'flex-row items-center px-4 py-2.5',
                isMine ? 'bg-home-elevated' : 'bg-home-surface',
                i > 0 ? 'border-t border-home-border' : '',
              ].join(' ')}
            >
              <Text
                className={`w-6 text-[12px] ${isMine ? 'font-bold text-home-accent' : 'text-home-text-faint'}`}
                style={{ fontFamily: FONT_MONO, fontVariant: ['tabular-nums'] }}
              >
                {row.position}
              </Text>
              <Text
                className={`flex-1 text-[13px] mr-2 text-home-text ${isMine ? 'font-bold' : ''}`}
                numberOfLines={1}
              >
                {teamNames[row.teamId] ?? '…'}
              </Text>
              <Text
                className={`text-[13px] ${isMine ? 'font-bold text-home-text' : 'text-home-text-dim'}`}
                style={{ fontFamily: FONT_MONO, fontVariant: ['tabular-nums'] }}
              >
                {row.points}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => router.push('/(protected)/(tabs)/standings')}
        className="mt-2.5"
      >
        <Text className="text-[12px] font-semibold text-home-accent">View Full Table</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// RECENT RESULTS — rows with dividers, not one card per match.
// ─────────────────────────────────────────────────────────────────────────
function RecentResultsList({ matches, teamId, teamNames }: {
  matches: Match[]; teamId: string; teamNames: Record<string, string>;
}) {
  if (matches.length === 0) return null;
  return (
    <View className="mb-6">
      <EyebrowCaption>Recent Results</EyebrowCaption>
      <View className="rounded-lg border border-home-border overflow-hidden mt-2">
        {matches.map((m, i) => {
          const isHome = m.homeTeamId === teamId;
          const opponentId = isHome ? m.awayTeamId : m.homeTeamId;
          const won = isHome
            ? (m.homeGamesWon ?? 0) > (m.awayGamesWon ?? 0)
            : (m.awayGamesWon ?? 0) > (m.homeGamesWon ?? 0);
          const legsFor = isHome ? m.homeLegsWon : m.awayLegsWon;
          const legsAgainst = isHome ? m.awayLegsWon : m.homeLegsWon;
          return (
            <TouchableOpacity
              key={m.id}
              activeOpacity={0.7}
              onPress={() => router.push(`/(protected)/results-entry?matchId=${m.id}`)}
              className={[
                'flex-row items-center justify-between px-4 py-3 bg-home-surface',
                i > 0 ? 'border-t border-home-border' : '',
              ].join(' ')}
            >
              <View className="flex-1 mr-3">
                <Text className="text-[13px] font-semibold text-home-text" numberOfLines={1}>
                  {isHome ? 'vs' : '@'} {teamNames[opponentId] ?? '…'}
                </Text>
                <Text className="text-[11px] text-home-text-faint mt-0.5">{formatDate(m.scheduledDate)}</Text>
              </View>
              <View className="items-end">
                <Text
                  className={`text-[13px] font-bold ${won ? 'text-home-success' : 'text-home-error'}`}
                  style={{ fontFamily: FONT_MONO, fontVariant: ['tabular-nums'] }}
                >
                  {legsFor}-{legsAgainst}
                </Text>
                {/* Step 3: the score above already carries the semantic
                    colour — repeating it on the label too read as
                    "colouring the W/L indicator twice". Text alone
                    ("Won"/"Lost") still communicates the outcome without it. */}
                <Text className="text-[10px] font-bold uppercase tracking-wide text-home-text-faint">
                  {won ? 'Won' : 'Lost'}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// YOUR STATS — editorial treatment: one dominant figure (Win %), smaller
// supporting figures, not a flat equal-weight grid.
// ─────────────────────────────────────────────────────────────────────────
function YourStatsSection({ stats, playerId }: { stats: PlayerSeasonStats | null; playerId: string | null }) {
  const openProfile = playerId ? () => router.push(`/(protected)/player-profile?playerId=${playerId}`) : undefined;

  if (!stats || stats.played === 0) {
    const content = (
      <View className="mb-6">
        <EyebrowCaption>Your Stats</EyebrowCaption>
        <Text className="text-[13px] text-home-text-dim mt-2">No stats yet — these fill in once your matches are confirmed.</Text>
      </View>
    );
    if (!openProfile) return content;
    return <TouchableOpacity activeOpacity={0.7} onPress={openProfile}>{content}</TouchableOpacity>;
  }

  const winPct = Math.round((stats.won / stats.played) * 100);
  const highest = stats.highCheckouts
    .map((c) => Number(c.value))
    .filter((v) => !Number.isNaN(v))
    .sort((a, b) => b - a)[0];

  const content = (
    <View className="mb-6">
      <EyebrowCaption>Your Stats</EyebrowCaption>
      <View className="flex-row items-end gap-5 mt-2">
        <Text className="text-[30px] font-bold text-home-accent leading-[32px]" style={{ fontFamily: FONT_MONO, fontVariant: ['tabular-nums'] }}>
          {winPct}%
        </Text>
        <View className="flex-row gap-4 pb-1">
          <View>
            <Text className="text-[15px] font-bold text-home-text" style={{ fontFamily: FONT_MONO, fontVariant: ['tabular-nums'] }}>{stats.played}</Text>
            <Text className="text-[10px] text-home-text-faint mt-0.5">Played</Text>
          </View>
          <View>
            <Text className="text-[15px] font-bold text-home-text" style={{ fontFamily: FONT_MONO, fontVariant: ['tabular-nums'] }}>{stats.won}</Text>
            <Text className="text-[10px] text-home-text-faint mt-0.5">Won</Text>
          </View>
          <View>
            <Text className="text-[15px] font-bold text-home-text" style={{ fontFamily: FONT_MONO, fontVariant: ['tabular-nums'] }}>{stats.oneEighties}</Text>
            <Text className="text-[10px] text-home-text-faint mt-0.5">180s</Text>
          </View>
        </View>
      </View>
      {highest !== undefined && (
        // Step 3: this was amber purely decoratively — no warning/status
        // meaning attaches to a highest checkout, so it drops to the same
        // neutral bold treatment as Played/Won/180s above.
        <Text className="text-[12px] text-home-text-dim mt-3">
          Highest checkout <Text className="font-bold text-home-text" style={{ fontFamily: FONT_MONO, fontVariant: ['tabular-nums'] }}>{highest}</Text>
        </Text>
      )}
    </View>
  );
  if (!openProfile) return content;
  return <TouchableOpacity activeOpacity={0.7} onPress={openProfile}>{content}</TouchableOpacity>;
}

// ─────────────────────────────────────────────────────────────────────────
// SPONSOR — same data/behaviour as the shared SponsorBanner (returns
// nothing for a missing/inactive sponsor), re-skinned for the fixed dark
// palette rather than reusing that component directly (see the file-level
// comment). Deliberately placed low on the page — league branding, not
// what the player came to Home to see.
// ─────────────────────────────────────────────────────────────────────────
function HomeSponsorRow({ sponsor }: { sponsor: LeagueSponsor | null | undefined }) {
  if (!sponsor || !sponsor.active) return null;

  const inner = (
    <View className="flex-row items-center gap-3 pt-4 mt-2 border-t border-home-border">
      {sponsor.logoUrl ? (
        <Image source={{ uri: sponsor.logoUrl }} style={{ width: 26, height: 26, borderRadius: 6 }} resizeMode="contain" />
      ) : null}
      <View className="flex-1">
        <Text className="text-[10px] uppercase tracking-wide text-home-text-faint">Proudly sponsored by</Text>
        <Text className="text-[12px] font-semibold text-home-text-dim mt-0.5" numberOfLines={1}>{sponsor.name}</Text>
      </View>
    </View>
  );

  if (sponsor.websiteUrl) {
    return (
      <TouchableOpacity activeOpacity={0.7} onPress={() => Linking.openURL(sponsor.websiteUrl!)}>
        {inner}
      </TouchableOpacity>
    );
  }
  return inner;
}

// ─────────────────────────────────────────────────────────────────────────
// HOME DASHBOARD — shared by both the player ("home") and captain/VC
// ("captain") tabs, exactly as before.
// ─────────────────────────────────────────────────────────────────────────
export function HomeDashboard() {
  const { appUser } = useAuthStore();
  const teamId = appUser?.teamId ?? null;
  const isCaptainOrVC = appUser?.role === 'captain' || appUser?.role === 'viceCaptain';

  const [matches, setMatches] = useState<Match[]>([]);
  const [teamNames, setTeamNames] = useState<Record<string, string>>({});
  const [tableRow, setTableRow] = useState<DivisionTable | null>(null);
  const [leagueSnapshot, setLeagueSnapshot] = useState<DivisionTable[]>([]);
  const [myStats, setMyStats] = useState<PlayerSeasonStats | null>(null);
  const [leagueName, setLeagueName] = useState<string | null>(null);
  const [sponsor, setSponsor] = useState<LeagueSponsor | null>(null);
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

  // League Snapshot (Phase E, Step 2) — 3-5 rows around the viewer's own
  // position, not the full table. A bounded range query on the SAME field
  // set (leagueId, seasonId, divisionId, position) standings.tsx's own
  // query already uses — servable by that same existing composite index,
  // no new index required. Only starts once tableRow has resolved, since
  // it supplies the position to window around.
  useEffect(() => {
    if (!appUser?.leagueId || !appUser?.seasonId || !appUser?.divisionId || !tableRow) { setLeagueSnapshot([]); return; }
    const lo = Math.max(1, tableRow.position - 2);
    const hi = tableRow.position + 2;
    return onSnapshot(
      query(
        collection(db, 'divisionTables'),
        where('leagueId', '==', appUser.leagueId),
        where('seasonId', '==', appUser.seasonId),
        where('divisionId', '==', appUser.divisionId),
        where('position', '>=', lo),
        where('position', '<=', hi),
        orderBy('position', 'asc'),
      ),
      (snap) => setLeagueSnapshot(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DivisionTable))),
      () => setLeagueSnapshot([]),
    );
  }, [appUser?.leagueId, appUser?.seasonId, appUser?.divisionId, tableRow?.position]);

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
    if (appUser?.leagueId) getDoc(doc(db, 'leagues', appUser.leagueId)).then((s) => {
      setLeagueName(s.exists() ? s.data().name : null);
      setSponsor(s.exists() ? s.data().sponsor ?? null : null);
    });
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

  // Division · League — the header's own context line. Team name is
  // deliberately not repeated here now that "Your Team" is its own section
  // below (see the Phase E, Step 2 report for this decision).
  const contextLine = [divisionName, leagueName].filter(Boolean).join(' · ');

  if (!teamId) {
    return (
      <Screen backgroundClassName="bg-home-base" header={<Header contextLine={contextLine || null} />}>
        <Text className="text-[13px] text-home-text-dim text-center mt-10">Join a team to see your dashboard.</Text>
      </Screen>
    );
  }

  // "Next" is deliberately scheduled/awaiting_confirmation/disputed only —
  // a postponed/cancelled match is an admin exception, not something to
  // surface as "what needs my attention next" (see NextMatchHero's own
  // header comment); `!== 'confirmed'` alone would still catch them.
  const nextMatch = matches.find((m) => m.status !== 'confirmed' && !isFixtureException(m.status)) ?? null;
  const nextOpponentId = nextMatch ? (nextMatch.homeTeamId === teamId ? nextMatch.awayTeamId : nextMatch.homeTeamId) : null;
  const confirmedMatches = matches.filter((m) => m.status === 'confirmed');
  const recentMatches = [...confirmedMatches].reverse().slice(0, 3);
  const form = recentForm(matches, teamId);

  return (
    <Screen backgroundClassName="bg-home-base" header={<Header contextLine={contextLine || null} />}>
      <View className="w-full max-w-[640px] self-center">
        {loadError ? (
          <View className="rounded-lg border border-home-error/30 bg-home-error/10 px-4 py-4">
            <Text className="text-[13px] font-semibold text-home-error mb-1">Couldn't load your dashboard</Text>
            <Text className="text-[12px] text-home-error">{loadError}</Text>
          </View>
        ) : isLoading ? (
          <ActivityIndicator color={RAW.homeAccent} style={{ marginTop: 40 }} />
        ) : (
          <>
            {isCaptainOrVC && pendingRequestCount > 0 && (
              // Step 3: this is routine housekeeping (join/claim/VC
              // requests waiting), not a warning — amber was previously
              // used here purely decoratively. Neutral elevated surface,
              // hierarchy carried by bold text, matching the rest of the
              // "mostly neutral graphite" system.
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => router.push('/(protected)/(tabs)/captains')}
                className="flex-row items-center gap-3 rounded-lg bg-home-elevated border border-home-border px-4 py-3 mb-6"
              >
                <AppIcon name="users" size={17} color={RAW.homeTextDim} />
                <View className="flex-1">
                  <Text className="text-[13px] font-semibold text-home-text">
                    {pendingRequestCount} request{pendingRequestCount === 1 ? '' : 's'} waiting
                  </Text>
                  <Text className="text-[11px] text-home-text-faint mt-0.5">Tap to review your team's inbox</Text>
                </View>
                <AppIcon name="chevron-right" size={16} color={RAW.homeTextFaint} />
              </TouchableOpacity>
            )}

            <NextMatchHero
              match={nextMatch}
              teamId={teamId}
              opponentName={nextOpponentId ? (teamNames[nextOpponentId] ?? '…') : ''}
              tableRow={tableRow}
              form={form}
              isCaptainOrVC={isCaptainOrVC}
            />

            {tableRow && <YourTeamSection tableRow={tableRow} form={form} teamId={teamId} />}

            <LeagueSnapshotList rows={leagueSnapshot} myTeamId={teamId} teamNames={teamNames} />

            <RecentResultsList matches={recentMatches} teamId={teamId} teamNames={teamNames} />

            <YourStatsSection stats={myStats} playerId={appUser?.playerId ?? null} />

            <HomeSponsorRow sponsor={sponsor} />
          </>
        )}
      </View>
    </Screen>
  );
}
