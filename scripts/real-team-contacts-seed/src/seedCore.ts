import * as admin from 'firebase-admin';
import { LEAGUE_ID } from './constants';
import { TEAM_CONTACTS } from './contacts';
import { safeSet } from './firebaseAdmin';

export async function seedRealTeamContacts(
  db: admin.firestore.Firestore, log: (msg: string) => void,
): Promise<void> {
  for (const contact of TEAM_CONTACTS) {
    const teamSnap = await db.collection('teams').doc(contact.teamId).get();
    if (!teamSnap.exists) {
      throw new Error(
        `REFUSING TO CONTINUE: teams/${contact.teamId} does not exist — run `
        + 'scripts/real-season-import-staging first.',
      );
    }
    const team = teamSnap.data()!;
    if (team.leagueId !== LEAGUE_ID) {
      throw new Error(`REFUSING TO CONTINUE: teams/${contact.teamId}.leagueId is "${team.leagueId}", not "${LEAGUE_ID}".`);
    }
    if (team.name !== contact.teamName) {
      throw new Error(
        `REFUSING TO CONTINUE: teams/${contact.teamId}.name is "${team.name}", expected "${contact.teamName}" — `
        + 'a name mismatch here means this script\'s team-ID mapping may be wrong. Not writing anything for this team.',
      );
    }

    await safeSet(db, 'teams', contact.teamId, {
      address: contact.address,
      captainName: contact.captainName,
      captainPhone: contact.captainPhone,
      viceCaptainName: contact.viceCaptainName,
      viceCaptainPhone: contact.viceCaptainPhone,
    });
    log(`teams/${contact.teamId} (${contact.teamName}): contact/address info written.`);
  }
}
