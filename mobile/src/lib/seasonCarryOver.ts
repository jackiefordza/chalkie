import {
  collection, doc, getDocs, query, where, orderBy, writeBatch, serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import type { Division, Team, Player } from '@/types';

export interface CarryOverResult {
  divisionsCreated: number;
  teamsCreated: number;
  playersCreated: number;
}

// Firestore batches cap at 500 writes — chunk defensively rather than assume
// this league's size forever (divisions + teams + players could exceed it
// for a bigger league, or once this becomes a multi-league product).
const BATCH_LIMIT = 400;

async function commitInChunks(writes: Array<(batch: ReturnType<typeof writeBatch>) => void>): Promise<void> {
  for (let i = 0; i < writes.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    writes.slice(i, i + BATCH_LIMIT).forEach((write) => write(batch));
    await batch.commit();
  }
}

// Copies divisions, teams, and players from an existing season onto a
// brand-new one, so an admin isn't re-typing an entire league's roster every
// time a season turns over. Preserves captainUserId/viceCaptainUserId and
// each player's claimedByUserId/designatedRole — the point isn't just to
// save admin's typing, it's to save every returning player from having to
// re-find-and-claim themselves too. Admin can edit/remove individual players
// afterward via the normal roster screens; this only ever creates new docs,
// it never touches the source season.
export async function carryOverSeason(
  fromSeasonId: string, toSeasonId: string, leagueId: string,
): Promise<CarryOverResult> {
  const [divisionsSnap, teamsSnap, playersSnap] = await Promise.all([
    getDocs(query(collection(db, 'divisions'), where('seasonId', '==', fromSeasonId), orderBy('order', 'asc'))),
    getDocs(query(collection(db, 'teams'), where('seasonId', '==', fromSeasonId))),
    getDocs(query(collection(db, 'players'), where('seasonId', '==', fromSeasonId))),
  ]);

  const divisionIdMap = new Map<string, string>(); // old divisionId -> new divisionId
  const teamIdMap = new Map<string, string>(); // old teamId -> new teamId

  const divisionWrites = divisionsSnap.docs.map((d) => {
    const data = d.data() as Division;
    const newRef = doc(collection(db, 'divisions'));
    divisionIdMap.set(d.id, newRef.id);
    return (batch: ReturnType<typeof writeBatch>) => { batch.set(newRef, {
      leagueId, seasonId: toSeasonId, name: data.name, order: data.order, createdAt: serverTimestamp(),
    }); };
  });
  await commitInChunks(divisionWrites);

  const teamWrites = teamsSnap.docs.map((d) => {
    const data = d.data() as Team;
    const newDivisionId = divisionIdMap.get(data.divisionId);
    if (!newDivisionId) return null; // team's division wasn't part of this carry-over — skip rather than orphan it
    const newRef = doc(collection(db, 'teams'));
    teamIdMap.set(d.id, newRef.id);
    return (batch: ReturnType<typeof writeBatch>) => { batch.set(newRef, {
      leagueId, seasonId: toSeasonId, divisionId: newDivisionId, name: data.name,
      captainUserId: data.captainUserId, viceCaptainUserId: data.viceCaptainUserId,
      venueId: data.venueId, createdAt: serverTimestamp(),
    }); };
  }).filter((w): w is (batch: ReturnType<typeof writeBatch>) => void => w !== null);
  await commitInChunks(teamWrites);

  const playerWrites = playersSnap.docs.map((d) => {
    const data = d.data() as Player;
    const newTeamId = teamIdMap.get(data.teamId);
    if (!newTeamId) return null; // player's team wasn't carried over — skip rather than orphan it
    const newDivisionId = data.divisionId ? divisionIdMap.get(data.divisionId) ?? null : null;
    const newRef = doc(collection(db, 'players'));
    return (batch: ReturnType<typeof writeBatch>) => { batch.set(newRef, {
      leagueId, seasonId: toSeasonId, divisionId: newDivisionId, teamId: newTeamId, name: data.name,
      claimedByUserId: data.claimedByUserId, claimedAt: data.claimedAt ?? null,
      createdByUserId: data.createdByUserId, designatedRole: data.designatedRole ?? null,
      createdAt: serverTimestamp(),
    }); };
  }).filter((w): w is (batch: ReturnType<typeof writeBatch>) => void => w !== null);
  await commitInChunks(playerWrites);

  return { divisionsCreated: divisionWrites.length, teamsCreated: teamWrites.length, playersCreated: playerWrites.length };
}
