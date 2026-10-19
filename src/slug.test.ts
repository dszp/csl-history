import { describe, expect, it } from 'vitest';
import { labelsFor, slugFor } from './slug.ts';

describe('slugFor', () => {
  it('uses the lowercased parenthesised abbreviation', () => {
    const m = slugFor(['Alpha Sanctions List (ASL) - Example Agency', 'Beta Control Roster (B.C.R) - Other Agency']);
    expect(m.get('Alpha Sanctions List (ASL) - Example Agency')).toBe('asl');
    expect(m.get('Beta Control Roster (B.C.R) - Other Agency')).toBe('b-c-r');
  });

  it('slugs the full name when there is no abbreviation', () => {
    const m = slugFor(['Gamma Watch Notices']);
    expect(m.get('Gamma Watch Notices')).toBe('gamma-watch-notices');
  });

  it('falls back to the full name for sources whose abbreviations collide', () => {
    const a = 'First Roster (XYZ) - Agency One';
    const b = 'Second Roster (XYZ) - Agency Two';
    const m = slugFor([a, b, 'Third (TRD) - Agency']);
    expect(m.get(a)).toBe('first-roster-xyz-agency-one');
    expect(m.get(b)).toBe('second-roster-xyz-agency-two');
    expect(m.get('Third (TRD) - Agency')).toBe('trd');
  });

  it('appends -2, -3 when full names still collide', () => {
    const m = slugFor(['Dup List!', 'Dup List?', 'Dup List.']);
    expect([...m.values()].sort()).toEqual(['dup-list', 'dup-list-2', 'dup-list-3']);
  });

  it('never gives one slug to two sources when a bare name equals another abbreviation', () => {
    const m = slugFor(['Omega (OMG) - Agency', 'OMG']);
    expect(new Set(m.values()).size).toBe(2);
  });

  it('is order-independent', () => {
    const src = ['Dup List!', 'Dup List?', 'A (X) - one', 'B (X) - two', 'Plain'];
    const forward = slugFor(src);
    const backward = slugFor([...src].reverse());
    expect([...forward.entries()].sort()).toEqual([...backward.entries()].sort());
  });

  it('never returns an empty slug', () => {
    expect(slugFor(['???']).get('???')).toBe('list');
  });
});

describe('labelsFor', () => {
  it('labels slugs that came from an abbreviation, and only those', () => {
    const a = 'First Roster (XYZ) - Agency One';
    const b = 'Second Roster (XYZ) - Agency Two';
    const c = 'Third (TRD) - Agency';
    const labels = labelsFor(slugFor([a, b, c, 'Plain Notices']));
    expect([...labels.entries()]).toEqual([['trd', 'TRD']]);
  });
});

describe('slugFor with existing assignments', () => {
  const el1 = 'Entity List (EL) - Agency One';
  const el2 = 'Entity Roster (EL) - Agency Two';

  it('keeps an existing source on its slug when a colliding abbreviation appears', () => {
    const m = slugFor([el1, el2], new Map([[el1, 'el']]));
    expect(m.get(el1)).toBe('el');
    expect(m.get(el2)).toBe('entity-roster-el-agency-two');
  });

  it('never gives a new source a slug already in use', () => {
    const m = slugFor(['Other (EL)', el1], new Map([[el1, 'el']]));
    expect(m.get(el1)).toBe('el');
    expect(m.get('Other (EL)')).toBe('other-el');
    const n = slugFor(['Dup List?', 'Dup List!'], new Map([['Dup List!', 'dup-list']]));
    expect(n.get('Dup List!')).toBe('dup-list');
    expect(n.get('Dup List?')).toBe('dup-list-2');
  });

  it('ignores existing assignments for sources that are gone', () => {
    const m = slugFor([el2], new Map([[el1, 'el']]));
    expect(m.get(el2)).toBe('el');
  });
});
