// The real Division 2/3 contact/venue data, exactly as supplied by the
// league — transcribed once here, nowhere else. Deliberately NOT derived
// from scripts/real-season-import-staging's team-name-as-venue placeholder
// (inferredVenueName) — these are the real addresses, replacing it.
//
// Rules applied while transcribing (per explicit instruction):
//  - No venue telephone numbers — only captain/VC mobile numbers.
//  - Numbers are reproduced byte-for-byte as supplied (only leading/
//    trailing/doubled whitespace trimmed — never reformatted, re-grouped,
//    or prefixed with a country code).
//  - A blank phone means no number was supplied (or, for Kings Arms Sandy's
//    VC, the supplied number was flagged as a duplicate of another
//    contact and intentionally left blank) — never fabricated.
//  - Burnaby Arms B: Dan Beddow is Captain, Jake Fordham is Vice Captain —
//    explicitly confirmed by the league, not assumed from name ordering.
//  - North End Club B's captain number (01234 211444) is a landline —
//    recorded as-is; nothing in this script or the invite flow assumes
//    SMS capability for any number.
export interface TeamContact {
  teamId: string;
  teamName: string; // sanity check only — must match the existing team doc
  address: string;
  captainName: string;
  captainPhone: string | null;
  viceCaptainName: string;
  viceCaptainPhone: string | null;
}

export const TEAM_CONTACTS: readonly TeamContact[] = [
  // ── Division 2 ──────────────────────────────────────────────────────────
  {
    teamId: 'bk-d2-team-1', teamName: 'Burnaby Arms C',
    address: '66 Stanley Street, Bedford, MK41 7RU',
    captainName: 'Geri Sampson', captainPhone: '07864 937735',
    viceCaptainName: 'Nick Young', viceCaptainPhone: '07816 821499',
  },
  {
    teamId: 'bk-d2-team-2', teamName: 'Oakley Sports Club',
    address: 'Church Lane, Oakley, MK43 7RJ',
    captainName: 'Did Thomas', captainPhone: '07775 777272',
    viceCaptainName: 'Jonny Umney', viceCaptainPhone: '07590 653435',
  },
  {
    teamId: 'bk-d2-team-3', teamName: 'North End Club A',
    address: '60 Roff Avenue, Bedford, MK41 7TW',
    captainName: 'Trish Colbeurt', captainPhone: '07813 562998',
    viceCaptainName: 'Dave Guy', viceCaptainPhone: '07771 931806',
  },
  {
    teamId: 'bk-d2-team-4', teamName: 'Constitutional Club B',
    address: '196A Bedford Road, Kempston, MK42 8BL',
    captainName: 'Daniel Detchon-Freeth', captainPhone: '07871 312617',
    viceCaptainName: 'Matt Pullinger', viceCaptainPhone: '07810 881902',
  },
  {
    teamId: 'bk-d2-team-5', teamName: 'The Swan',
    address: 'Bridge End, Bedford, MK43 8LS',
    captainName: 'Laurie Farmer', captainPhone: '07462 943847',
    viceCaptainName: 'Luke Farmer-Patel', viceCaptainPhone: '07544 221864',
  },
  {
    teamId: 'bk-d2-team-6', teamName: 'The Kings Arms Sandy',
    address: '27 London Road, Sandy, SG19 1HA',
    captainName: 'Angela Attew', captainPhone: '07800 723448',
    // Supplied VC number duplicated another contact — left blank per
    // explicit instruction (Captain takes precedence on a duplicate).
    viceCaptainName: 'Ash Jeewes', viceCaptainPhone: null,
  },
  {
    teamId: 'bk-d2-team-7', teamName: 'The Mulberry Bush Anchor',
    address: 'Springfield Centre, Kempston, MK42 7PR',
    captainName: 'Daniel Jones', captainPhone: '07494 450991',
    viceCaptainName: 'Aaron Wilson', viceCaptainPhone: '07546 717480',
  },
  {
    teamId: 'bk-d2-team-8', teamName: 'Fox & Hounds',
    address: '1 Milton Road, Bedford, MK41 6AP',
    captainName: 'Howard Tuffnail', captainPhone: '07470 291513',
    viceCaptainName: 'Richard Hemington', viceCaptainPhone: '07832 235830',
  },

  // ── Division 3 ──────────────────────────────────────────────────────────
  {
    teamId: 'bk-d3-team-1', teamName: 'The Grafton',
    address: '141 Midland Road, Bedford, MK40 1DN',
    captainName: 'Joe Berridge', captainPhone: '07434 047410',
    viceCaptainName: 'Owen Gray', viceCaptainPhone: '07903 022540',
  },
  {
    // Captain/VC confirmed explicitly by the league — see file header.
    teamId: 'bk-d3-team-2', teamName: 'Burnaby Arms B',
    address: '66 Stanley Street, Bedford, MK41 7RU',
    captainName: 'Dan Beddow', captainPhone: '07572 257398',
    viceCaptainName: 'Jake Fordham', viceCaptainPhone: '07376 210238',
  },
  {
    teamId: 'bk-d3-team-3', teamName: 'Cople Sports & Social',
    address: 'The Pavilion, Grange Lane, Cople, Bedford, MK44 3TU',
    captainName: 'George Gregory', captainPhone: '07707 007571',
    viceCaptainName: 'Joe Hendry Taylor', viceCaptainPhone: '07779 944495',
  },
  {
    teamId: 'bk-d3-team-4', teamName: 'Three Cups',
    address: '45 Nenham Street, Bedford, MK40 3JR',
    captainName: 'Kieran Carroll', captainPhone: '07711 177104',
    viceCaptainName: 'Kyle Atherton', viceCaptainPhone: '07474 389502',
  },
  {
    teamId: 'bk-d3-team-5', teamName: 'Marston Club B',
    address: 'Station Road, Marston Moretaine, MK43 0PW',
    captainName: 'Jackie Goodship', captainPhone: '07796 445819',
    viceCaptainName: 'Chloe Sherwood', viceCaptainPhone: '07956 597366',
  },
  {
    teamId: 'bk-d3-team-6', teamName: 'Five Bells "Bees"',
    address: '1 Northill Road, Cople, Bedford, MK44 3TU',
    captainName: 'JJ Grewal', captainPhone: '07714 462499',
    viceCaptainName: 'Joe Eldred', viceCaptainPhone: '07359 268502',
  },
  {
    // Captain phone is a landline — recorded as-is, see file header.
    teamId: 'bk-d3-team-7', teamName: 'North End Club B',
    address: '60 Roff Avenue, Bedford, MK41 7TW',
    captainName: 'Trevor Fordham', captainPhone: '01234 211444',
    viceCaptainName: 'Mick Pchowicz', viceCaptainPhone: '07530 481614',
  },
  {
    teamId: 'bk-d3-team-8', teamName: 'The Kings Arms Bedford',
    address: '24 St Marys Street, Bedford, MK42 0AS',
    captainName: 'Jessica Lane', captainPhone: '07565 566793',
    viceCaptainName: 'Tom Ward', viceCaptainPhone: '07514 714570',
  },
];
