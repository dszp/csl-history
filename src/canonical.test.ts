import { canonicalJson, sha256Hex } from '@dszp/csl-screen';
import { describe, expect, it } from 'vitest';
import { canonicalLists, verifyLists } from './canonical.ts';

const slugs = new Map([
  ['Alpha List (ALP)', 'alp'],
  ['Beta List (BET)', 'bet'],
]);

const doc = {
  results: [
    { id: '2', source: 'Alpha List (ALP)', name: 'Two' },
    { name: 'Bee', id: '1', source: 'Beta List (BET)' },
    { id: '10', source: 'Alpha List (ALP)', name: 'Ten' },
    { id: '1', source: 'Alpha List (ALP)', name: 'One' },
  ],
};

describe('canonicalLists', () => {
  it('groups by slug, sorts by source|id in byte order, ends each line with a newline', () => {
    const lists = canonicalLists(doc, slugs);
    expect([...lists.keys()].sort()).toEqual(['alp', 'bet']);
    const alp = lists.get('alp')!;
    expect(alp.endsWith('\n')).toBe(true);
    // "1" < "10" < "2" in byte order
    expect(alp.split('\n').slice(0, -1).map((l) => JSON.parse(l).id)).toEqual(['1', '10', '2']);
  });

  it('writes canonicalJson lines (sorted keys)', () => {
    const lists = canonicalLists(doc, slugs);
    expect(lists.get('bet')).toBe(`${canonicalJson({ name: 'Bee', id: '1', source: 'Beta List (BET)' })}\n`);
  });

  it('is independent of input order', () => {
    const reversed = { results: [...doc.results].reverse() };
    expect([...canonicalLists(reversed, slugs)]).toEqual([...canonicalLists(doc, slugs)]);
  });

  it('throws on a source with no slug', () => {
    expect(() => canonicalLists({ results: [{ id: '1', source: 'Unknown' }] }, slugs)).toThrow(/Unknown/);
  });
});

describe('verifyLists', () => {
  async function entriesFor(results: typeof doc.results) {
    return Promise.all(
      results.map(async (r) => ({ key: `${r.source}|${r.id}`, fingerprint: await sha256Hex(canonicalJson(r)) })),
    );
  }

  it('passes when every line hashes to its entry fingerprint', async () => {
    await expect(verifyLists(canonicalLists(doc, slugs), await entriesFor(doc.results))).resolves.toBeUndefined();
  });

  it('fails on a fingerprint mismatch', async () => {
    const entries = await entriesFor(doc.results);
    entries[0]!.fingerprint = '0'.repeat(64);
    await expect(verifyLists(canonicalLists(doc, slugs), entries)).rejects.toThrow(/fingerprint/);
  });

  it('fails when the line count differs from the entry count', async () => {
    const entries = (await entriesFor(doc.results)).slice(1);
    await expect(verifyLists(canonicalLists(doc, slugs), entries)).rejects.toThrow(/entries/);
  });
});
