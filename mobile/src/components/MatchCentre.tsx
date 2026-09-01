import { useState } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { RAW, type SemanticTone } from '@/lib/theme';
import {
  Heading, Body, Caption, Stat, Badge, Card, Button, AppIcon,
} from '@/components/ui';
import type { Match, MatchGame, MatchStatus } from '@/types';

export const STATUS_LABEL: Record<MatchStatus, string> = {
  scheduled: 'Scheduled',
  awaiting_confirmation: 'Awaiting Confirmation',
  disputed: 'Disputed',
  confirmed: 'Confirmed',
};
export const STATUS_TONE: Record<MatchStatus, SemanticTone | null> = {
  scheduled: null,
  awaiting_confirmation: 'butter',
  disputed: 'coral',
  confirmed: 'sage',
};

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

  return (
    <Card className="mb-4">
      {tone ? (
        <Badge tone={tone} className="self-start mb-3">{STATUS_LABEL[match.status]}</Badge>
      ) : (
        <Caption className="mb-3">Not yet played</Caption>
      )}

      <Heading size="lg" numberOfLines={1} className="mb-3">
        <Heading size="lg" onPress={() => router.push(`/(protected)/team-profile?teamId=${match.homeTeamId}`)}>{homeTeamName}</Heading>
        {' vs '}
        <Heading size="lg" onPress={() => router.push(`/(protected)/team-profile?teamId=${match.awayTeamId}`)}>{awayTeamName}</Heading>
      </Heading>

      {isConfirmed ? (
        <View className="items-center py-2">
          <View className="flex-row items-center gap-3">
            <Stat size="lg">{match.homeGamesWon}</Stat>
            <Body size="sm">–</Body>
            <Stat size="lg">{match.awayGamesWon}</Stat>
          </View>
          <Caption className="mt-1">{match.homeLegsWon}-{match.awayLegsWon} legs · games</Caption>
        </View>
      ) : (
        <Body size="sm" className="mb-1">
          {match.status === 'scheduled' && 'This fixture hasn\'t been played yet.'}
          {match.status === 'awaiting_confirmation' && 'A result has been submitted and is waiting to be confirmed.'}
          {match.status === 'disputed' && 'The two submitted results don\'t match — an admin needs to review this one.'}
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
// MATCH SUMMARY — confirmed matches only. Games/legs won reuse the
// backend-computed totals directly (never recomputed client-side); 180s and
// highest checkout are derived from match.games, which is already fully
// loaded once a match is confirmed — no extra reads.
// ─────────────────────────────────────────────────────────────────────────
export function MatchSummary({ match, playerName }: { match: Match; playerName: (id: string) => string }) {
  const games = match.games ?? [];
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
        <View className="flex-1 rounded-2xl bg-surface-2 dark:bg-surface-2-dark p-3 items-center">
          <Stat size="md" tone="sage">{match.homeGamesWon}-{match.awayGamesWon}</Stat>
          <Caption className="mt-1">Games</Caption>
        </View>
        <View className="flex-1 rounded-2xl bg-surface-2 dark:bg-surface-2-dark p-3 items-center">
          <Stat size="md">{match.homeLegsWon}-{match.awayLegsWon}</Stat>
          <Caption className="mt-1">Legs</Caption>
        </View>
        <View className="flex-1 rounded-2xl bg-surface-2 dark:bg-surface-2-dark p-3 items-center">
          <Stat size="md" tone="butter">{oneEightyCount}</Stat>
          <Caption className="mt-1">180s</Caption>
        </View>
      </View>
      {highest && (
        <Body size="sm" className="mt-3">
          Highest checkout: <Body size="sm" tone="butter" weight="bold">{highest.value}</Body> ({playerName(highest.playerId)})
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
          {oneEightyCount > 0 && <Badge tone="butter">{oneEightyCount} × 180</Badge>}
          {checkouts.map((c, i) => <Badge key={i} tone="butter">{playerName(c.playerId)} {c.value}</Badge>)}
        </View>
      )}

      <TouchableOpacity activeOpacity={0.7} onPress={() => setExpanded((e) => !e)} className="mt-2.5 flex-row items-center gap-1">
        <Body size="sm" tone="brand">{expanded ? 'Hide legs' : 'Show legs'}</Body>
        <AppIcon name={expanded ? 'chevron-down' : 'chevron-right'} size={12} color={isDark ? RAW.brandInkDark : RAW.brandInk} />
      </TouchableOpacity>

      {expanded && (
        <View className="mt-2 gap-1.5">
          {game.legs.map((leg, i) => (
            <View key={i} className="flex-row items-center justify-between py-2 px-3 rounded-lg bg-surface-2 dark:bg-surface-2-dark">
              <Body size="sm">Leg {i + 1}</Body>
              <View className="flex-row items-center gap-2 flex-1 justify-end">
                {leg.oneEighties.length > 0 && (
                  <Body size="xs" tone="butter">180: {leg.oneEighties.map(playerName).join(', ')}</Body>
                )}
                {leg.highCheckout && (
                  <Body size="xs" tone="butter">{playerName(leg.highCheckout.playerId)} {leg.highCheckout.value}</Body>
                )}
                <Body size="sm" tone={leg.winner === 'home' ? 'sage' : 'coral'} weight="semibold">
                  {leg.winner === 'home' ? 'Home' : 'Away'}
                </Body>
              </View>
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
