// Seeds a season/division/teams/venues/players scaffold with *no* fixtures —
// unlike seedTestLeague/seedMockSeason (which pre-generate matches/results to
// test the confirmation and stats pipeline), the point here is to leave the
// real "Generate Fixtures" UI in admin-fixtures.tsx untouched for the admin
// to actually exercise themselves. Deliberately includes a venue with more
// teams than boards, so hitting Generate immediately demonstrates the
// break-skip and venue-conflict-auto-resolve behavior in generateRoundRobinFixtures.
import { doc, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';

const SEASON_ID = 'blank-test-season';
const DIVISION_ID = 'blank-test-division';

const VENUE_TIGHT_ID = 'blank-test-venue-tight'; // 1 board, 3 teams -> deliberate conflict
const VENUE_ROOMY_ID = 'blank-test-venue-roomy'; // 2 boards, 2 teams -> fits exactly

const TEAM_NAMES = ['The Anchor', 'Kings Head', 'The Crown', 'White Hart', 'Ship Inn', 'The Feathers', 'Red Lion', 'The Bell'];
const TEAM_IDS = TEAM_NAMES.map((_, i) => `blank-test-team-${i + 1}`);
// First 3 teams share the tight venue, next 2 share the roomy one, the rest have no venue set.
const TEAM_VENUE_ID = [VENUE_TIGHT_ID, VENUE_TIGHT_ID, VENUE_TIGHT_ID, VENUE_ROOMY_ID, VENUE_ROOMY_ID, null, null, null];

const PLAYER_NAMES = [
  ['Alan Baker', 'Bev Carter', 'Colin Dean', 'Dawn Ellis', 'Eddie Fox'],
  ['Fiona Gray', 'Greg Hall', 'Harry Ivor', 'Ivy Jones', 'Jack King'],
  ['Karen Lyle', 'Leo Moss', 'Mia Nash', 'Noah Owen', 'Olive Pace'],
  ['Paul Quinn', 'Ruth Shaw', 'Sam Trent', 'Tara Voss', 'Uma West'],
  ['Vic Young', 'Wendy Zane', 'Alex Cole', 'Beth Dunn', 'Cory Finn'],
  ['Drew Gale', 'Edie Hart', 'Finn Iles', 'Gina Judd', 'Hugh Knox'],
  ['Iris Lane', 'Jude Marr', 'Kate Nolan', 'Liam Otto', 'Mona Price'],
  ['Nick Ross', 'Opal Stone', 'Pete Udall', 'Quinn Vale', 'Rosa Webb'],
];

const playerId = (teamIndex: number, playerIndex: number) => `blank-test-player-${teamIndex + 1}-${playerIndex + 1}`;

// A Monday roughly 6 weeks out — arbitrary but plausible as a season start;
// the admin overrides it per-division anyway when they actually generate.
const SEASON_START = new Date(2026, 8, 7); // 2026-09-07
const BREAK_START = new Date(2026, 11, 21); // 2026-12-21
const BREAK_END = new Date(2027, 0, 3); // 2027-01-03

export async function seedBlankSeason(leagueId: string): Promise<void> {
  await setDoc(doc(db, 'seasons', SEASON_ID), {
    leagueId,
    name: 'Blank Test Season',
    status: 'upcoming',
    startDate: Timestamp.fromDate(SEASON_START),
    breaks: [{ start: Timestamp.fromDate(BREAK_START), end: Timestamp.fromDate(BREAK_END), label: 'Christmas' }],
    createdAt: serverTimestamp(),
  }, { merge: true });

  await setDoc(doc(db, 'divisions', DIVISION_ID), {
    leagueId, seasonId: SEASON_ID, name: 'Blank Test Division', order: 997, createdAt: serverTimestamp(),
  }, { merge: true });

  await Promise.all([
    setDoc(doc(db, 'venues', VENUE_TIGHT_ID), {
      leagueId, name: 'The Anchor', address: null, venuePhone: null, boardCount: 1, createdAt: serverTimestamp(),
    }, { merge: true }),
    setDoc(doc(db, 'venues', VENUE_ROOMY_ID), {
      leagueId, name: 'Kings Head', address: null, venuePhone: null, boardCount: 2, createdAt: serverTimestamp(),
    }, { merge: true }),
  ]);

  await Promise.all(TEAM_IDS.map((teamId, i) => setDoc(doc(db, 'teams', teamId), {
    leagueId, seasonId: SEASON_ID, divisionId: DIVISION_ID, name: TEAM_NAMES[i],
    captainUserId: null, viceCaptainUserId: null, venueId: TEAM_VENUE_ID[i],
    createdAt: serverTimestamp(),
  }, { merge: true })));

  await Promise.all(TEAM_IDS.flatMap((teamId, ti) => PLAYER_NAMES[ti].map((name, pi) => setDoc(
    doc(db, 'players', playerId(ti, pi)),
    {
      leagueId, seasonId: SEASON_ID, divisionId: DIVISION_ID, teamId, name,
      claimedByUserId: null, claimedAt: null, createdByUserId: null, designatedRole: null, createdAt: serverTimestamp(),
    },
    { merge: true },
  ))));
}
