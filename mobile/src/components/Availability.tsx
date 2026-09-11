import { View } from 'react-native';
import { Body, Caption, Badge, Chip } from '@/components/ui';
import { AVAILABILITY_LABEL, AVAILABILITY_TONE } from '@/lib/availability';
import type { AvailabilityStatus } from '@/types';

const STATUSES: AvailabilityStatus[] = ['available', 'unavailable', 'unsure'];

interface AvailabilityPickerProps {
  value: AvailabilityStatus | null;
  onSelect: (status: AvailabilityStatus) => void;
  disabled?: boolean;
  isSaving?: boolean;
  error?: string | null;
}

// A player's own availability picker for one fixture — three mutually
// exclusive chips, reused wherever a player needs to set/change it (today:
// fixtures.tsx's Upcoming list). Presentational only, same split as
// MatchCentre.tsx's exported components — the Firestore read/write and
// loading/saving state live in the caller.
export function AvailabilityPicker({ value, onSelect, disabled, isSaving, error }: AvailabilityPickerProps) {
  return (
    <View className="mt-3 pt-3 border-t border-border dark:border-border-dark">
      <Caption className="mb-2">Your availability</Caption>
      <View className="flex-row gap-2">
        {STATUSES.map((status) => (
          <Chip
            key={status}
            label={AVAILABILITY_LABEL[status]}
            tone={AVAILABILITY_TONE[status]}
            selected={value === status}
            onPress={() => onSelect(status)}
            disabled={disabled}
            className="flex-1"
          />
        ))}
      </View>
      {isSaving && <Body size="xs" className="mt-1.5">Saving…</Body>}
      {error && <Body size="xs" tone="coral" className="mt-1.5">{error}</Body>}
    </View>
  );
}

interface SquadAvailabilityListProps {
  players: { id: string; name: string }[];
  statusByPlayerId: Record<string, AvailabilityStatus>;
}

// Captain/VC-only read-only squad view for one upcoming fixture —
// "Player | Availability". `players` is always the CURRENT roster (the
// caller queries `players` by teamId, not the availability docs
// themselves), so a player who has since moved to another team simply
// drops off this list along with any availability they set while still
// here — no migration/cleanup of the old doc needed. Anyone on the current
// roster with no saved response yet shows a neutral "No response" instead
// of a colored badge, matching how matchStatus.ts renders a null tone.
export function SquadAvailabilityList({ players, statusByPlayerId }: SquadAvailabilityListProps) {
  if (players.length === 0) {
    return <Body size="sm">No players on this team yet.</Body>;
  }
  return (
    <View className="gap-2.5">
      {players.map((player) => {
        const status = statusByPlayerId[player.id];
        return (
          <View key={player.id} className="flex-row items-center justify-between">
            <Body size="sm" tone="strong" className="flex-1 mr-2" numberOfLines={1}>{player.name}</Body>
            {status ? (
              <Badge tone={AVAILABILITY_TONE[status]}>{AVAILABILITY_LABEL[status]}</Badge>
            ) : (
              <Body size="xs">No response</Body>
            )}
          </View>
        );
      })}
    </View>
  );
}
