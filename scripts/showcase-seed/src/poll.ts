// Generic "wait for an async Cloud Function trigger to finish" helper.
// Deliberately not a fixed sleep — onSubmissionWrite/onMatchConfirmed run
// asynchronously after this script's writes return, so the only correct way
// to know they've finished is to keep re-reading the expected state until
// it matches, up to a timeout, and fail loudly (not silently) if it never
// does.
export interface PollResult<T> {
  succeeded: boolean;
  value: T | null;
  elapsedMs: number;
  attempts: number;
}

export async function pollUntil<T>(
  description: string,
  check: () => Promise<T | null>,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<PollResult<T>> {
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const intervalMs = opts.intervalMs ?? 1_500;
  const start = Date.now();
  let attempts = 0;

  while (Date.now() - start < timeoutMs) {
    attempts += 1;
    const value = await check();
    if (value !== null) {
      return { succeeded: true, value, elapsedMs: Date.now() - start, attempts };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  console.warn(`  [poll timeout after ${timeoutMs}ms, ${attempts} attempts] ${description}`);
  return { succeeded: false, value: null, elapsedMs: Date.now() - start, attempts };
}
