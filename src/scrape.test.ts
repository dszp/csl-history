import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatOutputs, run } from './scrape.ts';

const SRC_A = 'Alpha Sanctions List (ASL) - Example Agency';
const SRC_B = 'Beta Control Roster (BCR) - Other Agency';
const SRC_C = 'Gamma Watch Notices';

type Entry = { id: string; name: string; source: string; remarks?: string };

function makeDoc(entries: Entry[], performedAt = '2026-11-03T04:00:00Z', updated = '2026-11-01') {
  const sources = [...new Set(entries.map((e) => e.source))];
  return {
    search_performed_at: performedAt,
    total: entries.length,
    sources_used: sources.map((source) => ({
      source,
      source_last_updated: updated,
      last_imported: performedAt,
      import_rate: 'Hourly',
    })),
    results: entries,
  };
}

const base: Entry[] = [
  { id: '1', name: 'Entity One', source: SRC_A },
  { id: '2', name: 'Entity Two', source: SRC_A },
  { id: '1', name: 'Entity Three', source: SRC_B },
];

function fetchOf(doc: unknown, init: { status?: number; type?: string } = {}) {
  return async () =>
    new Response(typeof doc === 'string' ? doc : JSON.stringify(doc), {
      status: init.status ?? 200,
      headers: { 'content-type': init.type ?? 'application/json' },
    });
}

let root: string;
const now = new Date('2026-11-03T04:17:00Z');

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'csl-history-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const read = (p: string) => readFile(join(root, p), 'utf8');
const exists = (p: string) => read(p).then(() => true, () => false);

describe('run', () => {
  it('first run: writes lists, meta.json without timestamps, and the raw file', async () => {
    const r = await run({ fetch: fetchOf(makeDoc(base)), root, now });
    expect(r.changed).toBe(true);
    expect(r.summary).toBe('initial import: 3 entries');
    expect(r.month).toBe('2026-11');
    expect(r.rawPath).toBe('raw/consolidated-2026-11-03.json');
    expect((await readdir(join(root, 'lists'))).sort()).toEqual(['asl.jsonl', 'bcr.jsonl']);
    expect((await read('lists/asl.jsonl')).split('\n')).toHaveLength(3); // 2 lines + trailing newline
    const meta = JSON.parse(await read('meta.json'));
    expect(Object.keys(meta).sort()).toEqual(['contentSha256', 'entryCount', 'lists']);
    expect(meta.entryCount).toBe(3);
    expect(meta.lists.asl).toEqual({ source: SRC_A, sourceLastUpdated: '2026-11-01', entries: 2 });
    const text = await read('meta.json');
    for (const banned of ['search_performed_at', 'searchPerformedAt', 'last_imported', 'lastImported', 'import_rate']) {
      expect(text).not.toContain(banned);
    }
    expect(await exists('raw/consolidated-2026-11-03.json')).toBe(true);
  });

  it('second run with only search_performed_at changed reports changed=false and writes nothing', async () => {
    await run({ fetch: fetchOf(makeDoc(base)), root, now });
    await mkdir(join(root, 'snapshots'), { recursive: true });
    await writeFile(join(root, 'snapshots/index.json'), '[{"month":"2026-11"}]');
    const before = await read('meta.json');
    const r = await run({
      fetch: fetchOf(makeDoc(base, '2026-11-03T05:00:00Z', '2026-11-03')),
      root,
      now: new Date('2026-11-03T05:17:00Z'),
    });
    expect(r.changed).toBe(false);
    expect(r.month).toBe('');
    expect(r.rawPath).toBe('');
    expect(await read('meta.json')).toBe(before);
  });

  it('still writes the raw file when the month is due but the content is unchanged', async () => {
    await run({ fetch: fetchOf(makeDoc(base)), root, now });
    const r = await run({ fetch: fetchOf(makeDoc(base)), root, now: new Date('2026-12-01T00:17:00Z') });
    expect(r.changed).toBe(false);
    expect(r.month).toBe('2026-12');
    expect(await exists('raw/consolidated-2026-12-01.json')).toBe(true);
  });

  it('changed content: commit summary counts added, removed, changed; contentSha256 moves', async () => {
    const first = await run({ fetch: fetchOf(makeDoc(base)), root, now });
    const next: Entry[] = [
      { id: '1', name: 'Entity One', source: SRC_A, remarks: 'edited' },
      { id: '3', name: 'Entity Four', source: SRC_A },
      { id: '1', name: 'Entity Three', source: SRC_B },
    ];
    const r = await run({ fetch: fetchOf(makeDoc(next)), root, now });
    expect(r.changed).toBe(true);
    expect(r.summary).toBe('ASL +1 −1 ~1');
    expect(r.contentSha256).not.toBe(first.contentSha256);
  });

  it('a new list appearing does not trip the source-drop check', async () => {
    await run({ fetch: fetchOf(makeDoc(base)), root, now });
    const next = [...base, { id: '7', name: 'Newcomer', source: SRC_C }];
    const r = await run({ fetch: fetchOf(makeDoc(next)), root, now });
    expect(r.changed).toBe(true);
    expect(r.summary).toBe('GAMMA-WATCH-NOTICES +1 (new list)');
    expect(await exists('lists/gamma-watch-notices.jsonl')).toBe(true);
  });

  it('fails closed and writes nothing when a whole list disappears', async () => {
    await run({ fetch: fetchOf(makeDoc(base)), root, now });
    const meta = await read('meta.json');
    const lists = await read('lists/asl.jsonl');
    await expect(
      run({ fetch: fetchOf(makeDoc(base.filter((e) => e.source !== SRC_B))), root, now }),
    ).rejects.toThrow(/source-drop|fell from/);
    expect(await read('meta.json')).toBe(meta);
    expect(await read('lists/asl.jsonl')).toBe(lists);
  });

  it('fails closed on a corrupt committed meta.json', async () => {
    await writeFile(join(root, 'meta.json'), '{not json');
    await expect(run({ fetch: fetchOf(makeDoc(base)), root, now })).rejects.toThrow(/meta\.json/);
    expect(await exists('lists/asl.jsonl')).toBe(false);
  });

  it('fails on HTTP errors and HTML bodies without writing', async () => {
    await expect(run({ fetch: fetchOf('nope', { status: 503 }), root, now })).rejects.toThrow(/HTTP 503/);
    await expect(run({ fetch: fetchOf('<html></html>', { type: 'text/html' }), root, now })).rejects.toThrow(/HTML/);
    expect(await exists('meta.json')).toBe(false);
  });

  it('fails when the total does not match the results', async () => {
    const doc = makeDoc(base);
    doc.total = 99;
    await expect(run({ fetch: fetchOf(doc), root, now })).rejects.toThrow(/total/);
    expect(await exists('meta.json')).toBe(false);
  });

  it('keeps an existing list on its file when a colliding abbreviation appears later', async () => {
    const el1 = 'Entity List (EL) - Agency One';
    const el2 = 'Entity Roster (EL) - Agency Two';
    const first = [{ id: '1', name: 'One', source: el1 }];
    await run({ fetch: fetchOf(makeDoc(first)), root, now });
    const r = await run({ fetch: fetchOf(makeDoc([...first, { id: '5', name: 'Five', source: el2 }])), root, now });
    expect(r.summary).toBe('ENTITY-ROSTER-EL-AGENCY-TWO +1 (new list)');
    expect((await readdir(join(root, 'lists'))).sort()).toEqual(['el.jsonl', 'entity-roster-el-agency-two.jsonl']);
    expect(JSON.parse(await read('meta.json')).lists.el.source).toBe(el1);
  });

  it('deletes the file of a list removed from meta.json by hand (the documented recovery)', async () => {
    await run({ fetch: fetchOf(makeDoc(base)), root, now });
    const meta = JSON.parse(await read('meta.json'));
    delete meta.lists.bcr;
    meta.entryCount = 2; // the recovery edit also resets the count the sharp-drop check reads
    await writeFile(join(root, 'meta.json'), JSON.stringify(meta));
    const r = await run({ fetch: fetchOf(makeDoc(base.filter((e) => e.source === SRC_A))), root, now });
    expect(r.changed).toBe(true);
    expect(await exists('lists/bcr.jsonl')).toBe(false);
    expect(await exists('lists/asl.jsonl')).toBe(true);
  });
});

describe('formatOutputs', () => {
  it('emits key=value lines and flattens newlines in the summary', () => {
    const out = formatOutputs({
      changed: true,
      summary: 'a\nb=c',
      month: '',
      rawPath: '',
      contentSha256: 'abc',
    });
    expect(out).toBe('changed=true\nsummary=a b=c\nmonth=\nraw_path=\ncontent_sha256=abc\n');
  });
});
