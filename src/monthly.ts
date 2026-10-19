/** The UTC `YYYY-MM` when the index has no record for it, else undefined. */
export function needsMonthly(index: readonly { month: string }[], now: Date): string | undefined {
  const month = now.toISOString().slice(0, 7);
  return index.some((m) => m.month === month) ? undefined : month;
}

/** `consolidated-YYYY-MM-DD.json`, dated in UTC. */
export function rawFileName(now: Date): string {
  return `consolidated-${now.toISOString().slice(0, 10)}.json`;
}
