// Shared YYYY-MM-DD text-input parsing/formatting for admin date fields
// (fixture generation, season schedule) — kept in one place so every screen
// agrees on the same format and local-time parsing (avoids the classic
// `new Date('2026-01-01')` UTC-midnight-off-by-one-day bug).

export function parseDateInput(text: string): Date | null {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

// Inverse of parseDateInput — populates an editable YYYY-MM-DD text field.
export function formatDateInput(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Human-readable display, not for round-tripping back into an input.
export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
