// Thin AsyncStorage wrapper for result-entry drafts (MW-001). AsyncStorage
// is already a project dependency and resolves to a localStorage-backed
// implementation on web (and native storage on iOS/Android) with the same
// API, so no new package or platform-branching is needed here — this file
// only exists to keep results-entry.tsx free of raw storage-key/JSON
// plumbing. All encode/validate logic lives in resultDraftCodec.ts.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DraftGame } from './matchResultDraft';
import { buildDraftPayload, parseDraftPayload, type PersistedResultDraft } from './resultDraftCodec';

const KEY_PREFIX = 'chalkie:resultDraft:';
const keyFor = (matchId: string) => `${KEY_PREFIX}${matchId}`;

export async function saveResultDraft(
  matchId: string,
  games: DraftGame[],
  editedGameIndexes: number[],
  activeLeg: Record<number, number>,
): Promise<void> {
  try {
    const payload = buildDraftPayload(matchId, games, editedGameIndexes, activeLeg);
    await AsyncStorage.setItem(keyFor(matchId), JSON.stringify(payload));
  } catch {
    // Storage can fail (private browsing, quota, disabled). Best-effort only
    // — the draft just won't survive a reload; entry itself must not break.
  }
}

export async function loadResultDraft(matchId: string): Promise<PersistedResultDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(matchId));
    return parseDraftPayload(raw, matchId);
  } catch {
    return null;
  }
}

export async function clearResultDraft(matchId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(keyFor(matchId));
  } catch {
    // Worst case a stale draft lingers until the next save overwrites it.
  }
}
