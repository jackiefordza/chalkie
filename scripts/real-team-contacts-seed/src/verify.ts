import * as admin from 'firebase-admin';
import { TEAM_CONTACTS } from './contacts';
import { auditLogIsEntirelyInScope } from './firebaseAdmin';

export interface VerificationCheck { label: string; pass: boolean; detail: string }
export interface VerificationReport { checks: VerificationCheck[]; overallPass: boolean }

export async function verifyRealTeamContacts(db: admin.firestore.Firestore): Promise<VerificationReport> {
  const checks: VerificationCheck[] = [];

  for (const contact of TEAM_CONTACTS) {
    const team = (await db.collection('teams').doc(contact.teamId).get()).data();
    checks.push({
      label: `${contact.teamId} (${contact.teamName}): address`,
      pass: team?.address === contact.address,
      detail: String(team?.address),
    });
    checks.push({
      label: `${contact.teamId}: captainName/captainPhone`,
      pass: team?.captainName === contact.captainName && team?.captainPhone === contact.captainPhone,
      detail: `${team?.captainName} / ${team?.captainPhone}`,
    });
    checks.push({
      label: `${contact.teamId}: viceCaptainName/viceCaptainPhone`,
      pass: team?.viceCaptainName === contact.viceCaptainName && team?.viceCaptainPhone === contact.viceCaptainPhone,
      detail: `${team?.viceCaptainName} / ${team?.viceCaptainPhone}`,
    });
  }

  checks.push({ label: `ALL WRITES IN SCOPE (exactly these ${TEAM_CONTACTS.length} team docs only)`, pass: auditLogIsEntirelyInScope(), detail: '' });

  return { checks, overallPass: checks.every((c) => c.pass) };
}

export function printVerificationReport(report: VerificationReport): void {
  console.log('');
  console.log('REAL TEAM CONTACTS SEED VERIFICATION');
  console.log('=====================================');
  for (const c of report.checks) {
    console.log(`${c.pass ? '✓' : '✗'} ${c.label}${c.detail ? `: ${c.detail}` : ''}`);
  }
  console.log('');
  console.log(report.overallPass ? 'REAL TEAM CONTACTS SEED — PASS' : 'REAL TEAM CONTACTS SEED — FAIL');
  console.log('');
}
