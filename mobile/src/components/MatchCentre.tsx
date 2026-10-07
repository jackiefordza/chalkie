import { useState } from 'react';
import { View, TouchableOpacity, Linking } from 'react-native';
import { router } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { RAW, type SemanticTone } from '@/lib/theme';
import { STATUS_LABEL, STATUS_TONE } from '@/lib/matchStatus';
import { competitionTypeLabel, isNotableCompetitionType } from '@/lib/competitionType';
import { computeGamesTotals } from '@/lib/matchResultDraft';
import {
  Heading, Body, Caption, Stat, Badge, Card, Button, AppIcon, Avatar, ListRow,
} from '@/components/ui';
import type { Match, MatchGame } from '@/types';

export function formatMatchDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

// scheduledDate is written as a date only (midnight UTC) by every path that
// creates/edits a fixture today — see real-season-import-staging/importer.ts
// and admin-fixtures.tsx's own date-only edit field — there is no real
// per-match kickoff-time field in the schema. Rather than invent one, this
// shows a time only when scheduledDate's own time-of-day is genuinely
// non-midnight (checked in UTC, matching exactly how it's written, so a
// browser timezone offset never turns a date-only value into a fake time) —
// it will start showing automatically the day a real time is ever written,
// without fabricating one for today's date-only data.
export function formatMatchTime(date: Date): string | null {
  if (date.getUTCHours() === 0 && date.getUTCMinutes() === 0) return null;
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

// ─────────────────────────────────────────────────────────────────────────
// HOME/AWAY — an explicit word + icon, never colour alone (the fixture
// list/Home dashboard previously leaned on "@"/"vs"/"(H)" as the only
// signal). Shared so fixtures.tsx, HomeDashboard and this file's own
// MatchHeader never disagree on how this reads.
// ─────────────────────────────────────────────────────────────────────────
export function HomeAwayBadge({ isHome }: { isHome: boolean }) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  return (
    <View className="flex-row items-center gap-1">
      <AppIcon name={isHome ? 'home' : 'map-pin'} size={11} color={isDark ? RAW.textDark : RAW.text} />
      <Caption className="text-text dark:text-text-dark">{isHome ? 'Home' : 'Away'}</Caption>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// MATCH HEADER — always shown. The score is only ever rendered once the
// match is genuinely confirmed; every other status shows a clear "not a
// real result yet" line instead, never a fabricated 0-0 or blank score.
// Time (see formatMatchTime above) only ever appears once scheduledDate
// genuinely carries one — never fabricated for today's date-only data.
// ─────────────────────────────────────────────────────────────────────────
export function MatchHeader({
  match, homeTeamName, awayTeamName, divisionName, viewerSide,
}: {
  match: Match;
  homeTeamName: string;
  awayTeamName: string;
  // Optional Matchday Details context — division name and which side (if
  // any) the viewer is actually on. Both omittable so this still renders
  // exactly as before for any future caller that doesn't have them yet.
  divisionName?: string | null;
  viewerSide?: 'home' | 'away' | null;
}) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const tone = STATUS_TONE[match.status];
  const isConfirmed = match.status === 'confirmed';

  // The scoreboard side-tint below is purely a display convention (sage =
  // winning side, matching the same win/loss colour language used
  // everywhere else — RecentResultsList, fixtures.tsx) — it never affects
  // which number is which; a drawn leg count (possible even though the
  // match itself can't draw — see Match's own comment) tints neither side.
  const homeLegsWon = match.homeLegsWon ?? 0;
  const awayLegsWon = match.awayLegsWon ?? 0;
  const homeWonLegs = homeLegsWon > awayLegsWon;
  const awayWonLegs = awayLegsWon > homeLegsWon;

  return (
    <Card className="mb-4">
      <View className="flex-row items-center gap-2 mb-3">
        {tone ? (
          <Badge tone={tone}>{STATUS_LABEL[match.status]}</Badge>
        ) : (
          <Caption>Not yet played</Caption>
        )}
        {isNotableCompetitionType(match.competitionType) && (
          <Badge tone="butter">{competitionTypeLabel(match.competitionType)}</Badge>
        )}
      </View>

      <Heading size="lg" numberOfLines={1} className="mb-3">
        <Heading size="lg" onPress={() => router.push(`/(protected)/team-profile?teamId=${match.homeTeamId}`)}>{homeTeamName}</Heading>
        {' vs '}
        <Heading size="lg" onPress={() => router.push(`/(protected)/team-profile?teamId=${match.awayTeamId}`)}>{awayTeamName}</Heading>
      </Heading>

      {isConfirmed ? (
        <View className="items-center py-2">
          {/* The match score is total legs (e.g. 12-9), not games won — see
              matchScore.ts. Games decide who won and are shown small below,
              clearly labeled, never as the headline figure. The winning
              side's figure carries the same sage "win" tint used
              everywhere else in the app; a draw (legs only, never the
              match itself) tints neither. */}
          <View className="flex-row items-center gap-3">
            <Stat size="xl" tone={homeWonLegs ? 'sage' : undefined}>{match.homeLegsWon}</Stat>
            <Body size="sm">–</Body>
            <Stat size="xl" tone={awayWonLegs ? 'sage' : undefined}>{match.awayLegsWon}</Stat>
          </View>
          <Caption className="mt-1">{match.homeGamesWon}-{match.awayGamesWon} games</Caption>
        </View>
      ) : (
        <Body size="sm" className="mb-1">
          {match.status === 'scheduled' && 'This fixture hasn\'t been played yet.'}
          {match.status === 'awaiting_confirmation' && 'A result has been submitted and is waiting to be confirmed.'}
          {match.status === 'pending_confirmation' && 'Both teams\' results match — review the sheet below and confirm.'}
          {/* Deliberately doesn't say "an admin needs to review this" — a
              captain of either team can resolve this themselves (see the
              reconcile flow below), admin review is the fallback, not the
              only path. */}
          {match.status === 'disputed' && 'The two submitted results don\'t match.'}
        </Body>
      )}

      {(() => {
        const time = formatMatchTime(match.scheduledDate);
        const metaLine = [divisionName, competitionTypeLabel(match.competitionType)].filter(Boolean).join(' · ');
        return (
          <View className="gap-1.5 mt-3 pt-3 border-t border-border dark:border-border-dark">
            <View className="flex-row items-center gap-1.5">
              <AppIcon name="calendar" size={14} color={isDark ? RAW.textFaintDark : RAW.textFaint} />
              <Body size="sm">
                {formatMatchDate(match.scheduledDate)}{time ? ` · ${time}` : ''}
              </Body>
              {viewerSide && <HomeAwayBadge isHome={viewerSide === 'home'} />}
            </View>
            {metaLine && <Body size="sm">{metaLine}</Body>}
          </View>
        );
      })()}
    </Card>
  );
}

function openDirections(address: string) {
  Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`);
}

function callPhone(phone: string) {
  Linking.openURL(`tel:${phone.replace(/\s+/g, '')}`);
}

// ─────────────────────────────────────────────────────────────────────────
// VENUE — always the HOSTING team's own ground (match.homeTeamId). That's
// simply a fact about the fixture, independent of which side the viewer is
// on — for a home fixture that's "us", for an away fixture that's "them" —
// so the caller always passes the home team's own name/address, no
// isHome/isAway branching needed here. "Get Directions" is a plain
// Linking.openURL to a Google Maps search query — opens the platform's own
// maps app via its universal link on iOS/Android, or Google Maps in a
// browser tab on web — not a new maps SDK/integration.
// ─────────────────────────────────────────────────────────────────────────
export function VenueCard({ teamName, address }: { teamName: string; address: string | null }) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  return (
    <Card className="mb-4">
      <Caption className="mb-2">Venue</Caption>
      <View className="flex-row items-center gap-2 mb-1">
        <AppIcon name="map-pin" size={15} color={isDark ? RAW.textDimDark : RAW.textDim} />
        <Body tone="strong" weight="semibold">{teamName}</Body>
      </View>
      <Body size="sm" className="mb-3">{address ?? 'Address not on file'}</Body>
      {address && (
        <Button variant="secondary" size="sm" onPress={() => openDirections(address)}>Get Directions</Button>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// OPPOSITION — non-sensitive opponent info (name + their own home ground),
// visible to anyone who can view the fixture at all — never gated the way
// TeamContactsCard below is. Deliberately never invents an address: a team
// with none on file says so rather than reusing the fixture's own Venue
// (which, for a home fixture, is OUR ground, not theirs).
// ─────────────────────────────────────────────────────────────────────────
export function OppositionCard({ teamId, teamName, address }: { teamId: string; teamName: string; address: string | null }) {
  return (
    <Card className="mb-4">
      <Caption className="mb-2">Opposition</Caption>
      <Body
        tone="strong"
        weight="semibold"
        className="mb-1"
        onPress={() => router.push(`/(protected)/team-profile?teamId=${teamId}`)}
      >
        {teamName}
      </Body>
      <Body size="sm">Home ground: {address ?? 'not on file'}</Body>
    </Card>
  );
}

interface TeamContactsCardProps {
  // "Opposition Contacts" for the common one-opponent case (viewer is on
  // one of the two teams); a specific team name for the rare neutral-admin
  // case (see results-entry.tsx), where there's no single "opposition".
  label: string;
  captainName: string | null | undefined;
  captainPhone: string | null | undefined;
  viceCaptainName: string | null | undefined;
  viceCaptainPhone: string | null | undefined;
}

// ─────────────────────────────────────────────────────────────────────────
// CONTACTS — captain/VC name + mobile number. Sensitive: the CALLER is
// responsible for only ever rendering this for a captain/VC of either team
// on this match, or a league admin (see results-entry.tsx's canAct/isAdmin)
// — this component itself has no permission logic, same convention
// ActionBanner above already uses. Sourced from Team.captainName/
// captainPhone/viceCaptainName/viceCaptainPhone — the real reference
// contact info an admin seeds (scripts/real-team-contacts-seed), never the
// self-reported AppUser.phone/phoneVisibility NextMatchHero already shows
// separately (that one stays as-is; this is additive, not a replacement).
// Never fabricates a missing name/number. Each row's own onPress opens the
// dialer — a large tap target (ListRow's full row), not just the number text.
// ─────────────────────────────────────────────────────────────────────────
export function TeamContactsCard({ label, captainName, captainPhone, viceCaptainName, viceCaptainPhone }: TeamContactsCardProps) {
  const rows = [
    { role: 'Captain', name: captainName, phone: captainPhone },
    { role: 'Vice Captain', name: viceCaptainName, phone: viceCaptainPhone },
  ];
  return (
    <Card className="mb-4">
      <Caption className="mb-3">{label}</Caption>
      <View className="gap-2">
        {rows.map((r) => (
          <ListRow
            key={r.role}
            avatar={<Avatar initial={(r.name ?? '?').charAt(0)} size="sm" />}
            title={r.name ?? 'Not on file'}
            subtitle={r.role}
            trailing={r.phone ? <Body tone="brand" weight="bold" size="sm">{r.phone}</Body> : (
              <Body tone="dim" size="sm">No number</Body>
            )}
            onPress={r.phone ? () => callPhone(r.phone!) : undefined}
          />
        ))}
      </View>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// MATCH SUMMARY — confirmed matches, and the reconciled-but-not-yet-
// confirmed sheet shown at pending_confirmation. Games/legs won reuse the
// backend-computed totals directly when they're already set (once
// confirmed); before that, match.homeGamesWon etc are still null (only
// onMatchConfirmed sets them), so they're computed client-side from
// match.games instead — display only, never written anywhere. 180s and
// highest checkout are always derived from match.games directly, which is
// populated as soon as the match reaches pending_confirmation — no extra
// reads either way.
// ─────────────────────────────────────────────────────────────────────────
export function MatchSummary({ match, playerName }: { match: Match; playerName: (id: string) => string }) {
  const games = match.games ?? [];
  const totals = match.homeGamesWon != null && match.awayGamesWon != null && match.homeLegsWon != null && match.awayLegsWon != null
    ? { homeGamesWon: match.homeGamesWon, awayGamesWon: match.awayGamesWon, homeLegsWon: match.homeLegsWon, awayLegsWon: match.awayLegsWon }
    : computeGamesTotals(games);
  const oneEightyCount = games.reduce((n, g) => n + g.legs.reduce((m, l) => m + l.oneEighties.length, 0), 0);
  const highest = games
    .flatMap((g) => g.legs.map((l) => l.highCheckout))
    .filter((hc): hc is NonNullable<typeof hc> => hc !== null)
    .map((hc) => ({ ...hc, numeric: Number(hc.value) }))
    .filter((hc) => !Number.isNaN(hc.numeric))
    .sort((a, b) => b.numeric - a.numeric)[0];

  return (
    <Card className="mb-4">
      <Caption className="mb-3">Match Summary</Caption>
      <View className="flex-row gap-2.5">
        {/* Legs first — the actual match score (see matchScore.ts). Games
            (the team match record, which decides who won) is real and
            useful but secondary, and always explicitly labeled "Games" so
            it's never mistaken for the match score. */}
        <View className="flex-1 rounded-2xl bg-surface-2 dark:bg-surface-2-dark p-3 items-center">
          <Stat size="md" tone="sage">{totals.homeLegsWon}-{totals.awayLegsWon}</Stat>
          <Caption className="mt-1">Legs</Caption>
        </View>
        <View className="flex-1 rounded-2xl bg-surface-2 dark:bg-surface-2-dark p-3 items-center">
          <Stat size="md">{totals.homeGamesWon}-{totals.awayGamesWon}</Stat>
          <Caption className="mt-1">Games</Caption>
        </View>
        <View className="flex-1 rounded-2xl bg-surface-2 dark:bg-surface-2-dark p-3 items-center">
          <Stat size="md">{oneEightyCount}</Stat>
          <Caption className="mt-1">180s</Caption>
        </View>
      </View>
      {highest && (
        <Body size="sm" className="mt-3">
          Highest checkout: <Body size="sm" tone="strong" weight="bold">{highest.value}</Body> ({playerName(highest.playerId)})
        </Body>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// GAME ROW — the read-only per-game display, reused everywhere a game's
// result needs showing (confirmed match, an un-edited submission being
// reviewed, either side of a reconcile-mode comparison). Takes the raw
// MatchGame (leg-level detail intact) rather than the entry form's
// flattened DraftGame, so leg-by-leg breakdown is always available.
// ─────────────────────────────────────────────────────────────────────────
interface GameRowProps {
  game: MatchGame;
  gameIndex: number;
  playerName: (id: string) => string;
  tone?: SemanticTone;
  label?: string;
}

export function GameRow({ game, gameIndex, playerName, tone, label }: GameRowProps) {
  const [expanded, setExpanded] = useState(false);
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  const homeLegs = game.legs.filter((l) => l.winner === 'home').length;
  const awayLegs = game.legs.filter((l) => l.winner === 'away').length;
  const homeWon = homeLegs > awayLegs;
  const awayWon = awayLegs > homeLegs;
  const oneEightyCount = game.legs.reduce((n, l) => n + l.oneEighties.length, 0);
  const checkouts = game.legs.map((l) => l.highCheckout).filter((hc): hc is NonNullable<typeof hc> => hc !== null);
  const hasDetail = oneEightyCount > 0 || checkouts.length > 0;

  return (
    <Card tone={tone} className="mb-3">
      <Caption className="mb-2">{label ?? `Game ${gameIndex + 1} · ${game.type === 'singles' ? 'Singles' : 'Pairs'}`}</Caption>

      <View className="flex-row items-center justify-between">
        <Body tone={homeWon ? 'strong' : 'dim'} weight={homeWon ? 'bold' : 'normal'} className="flex-1" numberOfLines={2}>
          {game.homePlayerIds.length === 0 ? '—' : game.homePlayerIds.map((id, i) => (
            <Body
              key={id}
              tone={homeWon ? 'strong' : 'dim'}
              weight={homeWon ? 'bold' : 'normal'}
              onPress={() => router.push(`/(protected)/player-profile?playerId=${id}`)}
            >
              {playerName(id)}{i < game.homePlayerIds.length - 1 ? ' & ' : ''}
            </Body>
          ))}
        </Body>
        <Stat size="sm" className="mx-3">{homeLegs} – {awayLegs}</Stat>
        <Body tone={awayWon ? 'strong' : 'dim'} weight={awayWon ? 'bold' : 'normal'} className="flex-1 text-right" numberOfLines={2}>
          {game.awayPlayerIds.length === 0 ? '—' : game.awayPlayerIds.map((id, i) => (
            <Body
              key={id}
              tone={awayWon ? 'strong' : 'dim'}
              weight={awayWon ? 'bold' : 'normal'}
              onPress={() => router.push(`/(protected)/player-profile?playerId=${id}`)}
            >
              {playerName(id)}{i < game.awayPlayerIds.length - 1 ? ' & ' : ''}
            </Body>
          ))}
        </Body>
      </View>

      {hasDetail && (
        <View className="flex-row flex-wrap gap-1.5 mt-2.5">
          {oneEightyCount > 0 && <Badge>{oneEightyCount} × 180</Badge>}
          {checkouts.map((c, i) => <Badge key={i}>{playerName(c.playerId)} {c.value}</Badge>)}
        </View>
      )}

      <TouchableOpacity activeOpacity={0.7} onPress={() => setExpanded((e) => !e)} className="mt-2.5 flex-row items-center gap-1">
        <Body size="sm" tone="brand">{expanded ? 'Hide legs' : 'Show legs'}</Body>
        <AppIcon name={expanded ? 'chevron-down' : 'chevron-right'} size={12} color={isDark ? RAW.brandInkDark : RAW.brandInk} />
      </TouchableOpacity>

      {/* Per leg, only the winner — the one thing that's still real,
          leg-accurate data. 180s/high checkouts are recorded per player,
          not per leg (see Issue 6/matchResultDraft.ts), so the game-level
          summary above is the accurate place to show them; breaking them
          out by leg here would just be an arbitrary internal detail. */}
      {expanded && (
        <View className="mt-2 gap-1.5">
          {game.legs.map((leg, i) => (
            <View key={i} className="flex-row items-center justify-between py-2 px-3 rounded-lg bg-surface-2 dark:bg-surface-2-dark">
              <Body size="sm">Leg {i + 1}</Body>
              <Body size="sm" tone={leg.winner === 'home' ? 'sage' : 'coral'} weight="semibold">
                {leg.winner === 'home' ? 'Home' : 'Away'}
              </Body>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// ACTION BANNER — the one prominent "what do I need to do" element. Only
// ever rendered by the caller when there's a real, permitted action for the
// current viewer — this component itself has no permission logic.
// ─────────────────────────────────────────────────────────────────────────
interface ActionBannerProps {
  eyebrow: string;
  description?: string;
  buttonLabel: string;
  onPress: () => void;
  tone?: SemanticTone;
  variant?: 'primary' | 'secondary';
}

export function ActionBanner({ eyebrow, description, buttonLabel, onPress, tone = 'brand', variant = 'primary' }: ActionBannerProps) {
  return (
    <Card tone={tone} className="mb-4">
      <Caption className="mb-1">{eyebrow}</Caption>
      {description && <Body size="sm" className="mb-3">{description}</Body>}
      <Button variant={variant} size="sm" className={description ? '' : 'mt-3'} onPress={onPress}>{buttonLabel}</Button>
    </Card>
  );
}
