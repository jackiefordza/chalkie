import { collection, getDocs, query, where, limit } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { generateChalkiePNCandidate } from './chalkiePN';

const MAX_ATTEMPTS = 8;

// Random 6-digit candidate + a pre-write existence check against `players`,
// retried on collision — chosen over a shared counter document specifically
// because it needs no new collection and no new Firestore rule: every
// caller already has write access to whichever player/user doc it's about
// to write this value onto.
//
// The uniqueness check is scoped to `leagueId` (the same value the caller
// is about to write onto the new player doc) because Firestore's rules
// engine requires a list query to filter on every field the matching
// security rule's equality checks reference — the players/{playerId} read
// rule checks resource.data.leagueId, so an unscoped query here would be
// rejected outright for a league-scoped admin/captain (the same class of
// issue BUG-002 hit). This means ChalkiePN uniqueness is guaranteed within
// a league, not globally across every Chalkie league — acceptable for a
// single-league pilot; true global uniqueness would need a Cloud Function.
export async function assignChalkiePN(leagueId: string): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = generateChalkiePNCandidate();
    const existing = await getDocs(
      query(collection(db, 'players'), where('leagueId', '==', leagueId), where('chalkiePN', '==', candidate), limit(1)),
    );
    if (existing.empty) return candidate;
  }
  throw new Error('Could not generate a unique ChalkiePN — please try again.');
}
