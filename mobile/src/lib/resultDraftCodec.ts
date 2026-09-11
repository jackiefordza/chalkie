// Pure, framework-free envelope around a DraftGame[] for local persistence
// (MW-001: result-entry drafts must survive a refresh/tab-reclaim). Kept
// separate from the actual AsyncStorage I/O (see resultDraftStorage.ts) so
// the encode/validate logic can be unit-tested without any storage backend,
// the same way matchResultDraft.ts is tested without React/Firebase.
import type { DraftGame } from './matchResultDraft';

export const DRAFT_VERSION = 1;
const EXPECTED_GAME_COUNT = 7;

export interface PersistedResultDraft {
  version: number;
  matchId: string;
  savedAt: number;
  games: DraftGame[];
  editedGameIndexes: number[];
  activeLeg: Record<number, number>;
}

export function buildDraftPayload(
  matchId: string,
  games: DraftGame[],
  editedGameIndexes: number[],
  activeLeg: Record<number, number>,
): PersistedResultDraft {
  return { version: DRAFT_VERSION, matchId, savedAt: Date.now(), games, editedGameIndexes, activeLeg };
}

// Never throws — malformed/old/foreign-match data (corrupted JSON, a schema
// from a future app version, or a draft that somehow belongs to a different
// match) is treated as "no draft" rather than crashing the screen.
export function parseDraftPayload(raw: string | null | undefined, matchId: string): PersistedResultDraft | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isValidPersistedDraft(parsed, matchId) ? parsed : null;
}

function isValidPersistedDraft(value: unknown, matchId: string): value is PersistedResultDraft {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === DRAFT_VERSION
    && v.matchId === matchId
    && Array.isArray(v.games)
    && v.games.length === EXPECTED_GAME_COUNT
    && Array.isArray(v.editedGameIndexes)
    && typeof v.activeLeg === 'object' && v.activeLeg !== null
    && typeof v.savedAt === 'number'
  );
}
