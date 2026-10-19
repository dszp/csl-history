import { describe, expect, it } from 'vitest';
import { summarise } from './summary.ts';

const line = (id: string, v = 'a') => `{"id":"${id}","source":"S","v":"${v}"}\n`;
const lines = (...l: string[]) => l.join('');
const abbrev = new Map([
  ['sdn', 'SDN'],
  ['el', 'EL'],
  ['newlist', 'NEWLIST'],
]);

describe('summarise', () => {
  it('reports the first run as an initial import with the total entry count', () => {
    const next = new Map([
      ['sdn', lines(line('1'), line('2'))],
      ['el', line('9')],
    ]);
    expect(summarise(undefined, next, abbrev)).toBe('initial import: 3 entries');
  });

  it('counts added, removed and changed entries per list', () => {
    const prev = new Map([
      ['sdn', lines(line('1'), line('2'), line('3'), line('4'))],
      ['el', lines(line('1'), line('2'))],
    ]);
    const next = new Map([
      // 1 unchanged, 2 changed, 3 and 4 removed, 5 6 7 added -> +3 -2 ~1
      ['sdn', lines(line('1'), line('2', 'b'), line('5'), line('6'), line('7'))],
      ['el', lines(line('1', 'b'), line('2'))],
    ]);
    expect(summarise(prev, next, abbrev)).toBe('SDN +3 −2 ~1; EL ~1');
  });

  it('omits unchanged lists and zero counts', () => {
    const prev = new Map([['sdn', line('1')], ['el', line('1')]]);
    const next = new Map([['sdn', line('1')], ['el', lines(line('1'), line('2'))]]);
    expect(summarise(prev, next, abbrev)).toBe('EL +1');
  });

  it('reports a new list as (new list) with its entry count', () => {
    const prev = new Map([['sdn', line('1')]]);
    const next = new Map([['sdn', line('1')], ['newlist', lines(line('1'), line('2'))]]);
    expect(summarise(prev, next, abbrev)).toBe('NEWLIST +2 (new list)');
  });

  it('reports a vanished list as removed', () => {
    const prev = new Map([['sdn', line('1')], ['el', line('1')]]);
    const next = new Map([['sdn', line('1')]]);
    expect(summarise(prev, next, abbrev)).toBe('EL removed');
  });

  it('falls back to the uppercased slug when no abbreviation is known', () => {
    const prev = new Map([['odd-list', line('1')]]);
    const next = new Map([['odd-list', lines(line('1'), line('2'))]]);
    expect(summarise(prev, next, new Map())).toBe('ODD-LIST +1');
  });

  it('orders lists by size of change, then label', () => {
    const prev = new Map([['sdn', line('1')], ['el', line('1')]]);
    const next = new Map([['sdn', line('2')], ['el', line('2')]]);
    expect(summarise(prev, next, abbrev)).toBe('EL +1 −1; SDN +1 −1');
  });
});
