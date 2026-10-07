import { useState } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { RAW, type SemanticTone } from '@/lib/theme';
import { STATUS_LABEL, STATUS_TONE } from '@/lib/matchStatus';
import { competitionTypeLabel, isNotableCompetitionType } from '@/lib/competitionType';
import { computeGamesTotals } from '@/lib/matchResultDraft';
import {
  Heading, Body, Caption, Stat, Badge, Card, Button, AppIcon,
} from '@/components/ui';
import type { Match, MatchGame } from '@/types';

export function formatMatchDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

// ─────────────────────────────────────────────────────────────────────────
// MATCH HEADER — always shown. The score is only ever rendered once the
// match is genuinely confirmed; every other status shows a clear "not a
// real result yet" line instead, never a fabricated 0-0 or blank score.
// "Time" is deliberately not shown here: scheduledDate is entered admin-side
// as a date only (see admin-fixtures.tsx), with no real per-match kickoff
// time anywhere in the schema — showing one would be fabricated data.
// ─────────────────────────────────────────────────────────────────────────
export function MatchHeader({ match, homeTeamName, awayTeamName }: { match: Match; homeTeamName: string; awayTeamName: string }) {
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
            <Stat size="lg" tone={homeWonLegs ? 'sage' : undefined}>{match.homeLegsWon}</Stat>
            <Body size="sm">–</Body>
            <Stat size="lg" tone={awayWonLegs ? 'sage' : undefined}>{match.awayLegsWon}</Stat>
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

      <View className="flex-row items-center gap-1.5 mt-3 pt-3 border-t border-border dark:border-border-dark">
        <AppIcon name="calendar" size={14} color={isDark ? RAW.textFaintDark : RAW.textFaint} />
        <Body size="sm">
          {formatMatchDate(match.scheduledDate)}
          {match.venue ? ` · ${match.venue}` : ''}
        </Body>
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
