import { describe, expect, it } from 'vitest';
import { needsMonthly, rawFileName } from './monthly.ts';

describe('needsMonthly', () => {
  const now = new Date('2026-11-03T04:17:00Z');

  it('returns the UTC month when the index has no record for it', () => {
    expect(needsMonthly([{ month: '2026-10' }], now)).toBe('2026-11');
    expect(needsMonthly([], now)).toBe('2026-11');
  });

  it('returns undefined when the month is already indexed', () => {
    expect(needsMonthly([{ month: '2026-10' }, { month: '2026-11' }], now)).toBeUndefined();
  });

  it('uses UTC, not local time, at a month boundary', () => {
    expect(needsMonthly([], new Date('2026-10-31T23:59:59Z'))).toBe('2026-10');
    expect(needsMonthly([], new Date('2026-11-01T00:00:00Z'))).toBe('2026-11');
  });
});

describe('rawFileName', () => {
  it('names the raw file by UTC date', () => {
    expect(rawFileName(new Date('2026-11-03T23:59:00Z'))).toBe('consolidated-2026-11-03.json');
  });
});
