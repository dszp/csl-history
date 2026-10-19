import { appendFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { canonicalJson, loadSnapshot } from '@dszp/csl-screen';
import { canonicalLists, verifyLists } from './canonical.ts';
import { needsMonthly, rawFileName } from './monthly.ts';
import { labelsFor, slugFor } from './slug.ts';
import { summarise } from './summary.ts';

export const CSL_URL = 'https://data.trade.gov/downloadable_consolidated_screening_list/v1/consolidated.json';

export interface Meta {
  contentSha256: string;
  entryCount: number;
  lists: Record<string, { source: string; sourceLastUpdated: string | null; entries: number }>;
}

export interface RunResult {
  changed: boolean;
  summary: string;
  /** UTC `YYYY-MM` when a monthly raw copy is due, else ''. */
  month: string;
  /** Path of the raw copy relative to the repo root, '' when none was written. */
  rawPath: string;
  contentSha256: string;
}

export interface RunOptions {
  fetch: (url: string) => Promise<Response>;
  root: string;
  now: Date;
}

async function download(fetchImpl: RunOptions['fetch']): Promise<Uint8Array> {
  const res = await fetchImpl(CSL_URL); // GET: the host answers HEAD with 404
  if (!res.ok) throw new Error(`CSL download failed: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const type = res.headers.get('content-type') ?? '';
  const head = new TextDecoder().decode(bytes.subarray(0, 64)).trimStart();
  if (/html/i.test(type) || head.startsWith('<')) throw new Error('CSL download returned HTML, not JSON');
  return bytes;
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
}

async function readMeta(root: string): Promise<Meta | undefined> {
  const text = await readOptional(join(root, 'meta.json'));
  if (text === undefined) return undefined;
  try {
    const m = JSON.parse(text) as Meta;
    if (typeof m.contentSha256 !== 'string' || typeof m.entryCount !== 'number' || typeof m.lists !== 'object') {
      throw new Error('missing contentSha256, entryCount or lists');
    }
    return m;
  } catch (e) {
    throw new Error(`cannot read committed meta.json: ${(e as Error).message}`);
  }
}

async function readIndex(root: string): Promise<{ month: string }[]> {
  const text = await readOptional(join(root, 'snapshots', 'index.json'));
  if (text === undefined) return [];
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error('snapshots/index.json is not an array');
  return parsed as { month: string }[];
}

async function readLists(root: string, slugs: Iterable<string>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const slug of slugs) {
    const text = await readOptional(join(root, 'lists', `${slug}.jsonl`));
    if (text === undefined) throw new Error(`meta.json names lists/${slug}.jsonl but the file is missing`);
    out.set(slug, text);
  }
  return out;
}

async function writeAtomic(path: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

/** Downloads, validates and, when the content changed, rewrites lists/ and meta.json. Makes no git calls. */
export async function run(opts: RunOptions): Promise<RunResult> {
  const { root, now } = opts;
  const bytes = await download(opts.fetch);
  const previousMeta = await readMeta(root);

  const snapshot = await loadSnapshot(bytes, {
    previousEntryCount: previousMeta?.entryCount,
    previousEntriesBySource: previousMeta
      ? Object.fromEntries(Object.values(previousMeta.lists).map((l) => [l.source, l.entries]))
      : undefined,
  });
  const doc = JSON.parse(new TextDecoder().decode(bytes)) as { results: Record<string, unknown>[] };

  const existingSlugs = new Map(Object.entries(previousMeta?.lists ?? {}).map(([slug, l]) => [l.source, slug]));
  const slugs = slugFor(Object.keys(snapshot.identity.entriesBySource), existingSlugs);
  const lists = canonicalLists(doc, slugs);
  await verifyLists(lists, snapshot.entries);

  const { contentSha256 } = snapshot.identity;
  const changed = previousMeta?.contentSha256 !== contentSha256;
  const index = await readIndex(root);
  const month = needsMonthly(index, now);
  let summary = '';

  if (changed) {
    const previousLists = previousMeta ? await readLists(root, Object.keys(previousMeta.lists)) : undefined;
    summary = summarise(previousLists, lists, labelsFor(slugs));

    const updated = new Map(snapshot.identity.sources.map((s) => [s.source, s.sourceLastUpdated]));
    const meta: Meta = {
      contentSha256,
      entryCount: snapshot.identity.entryCount,
      lists: {},
    };
    for (const [source, slug] of slugs) {
      meta.lists[slug] = {
        source,
        sourceLastUpdated: updated.get(source) ?? null,
        entries: snapshot.identity.entriesBySource[source] ?? 0,
      };
    }
    const metaText = `${JSON.stringify(JSON.parse(canonicalJson(meta)), null, 2)}\n`;

    for (const [slug, text] of lists) await writeAtomic(join(root, 'lists', `${slug}.jsonl`), text);
    for (const file of await readdir(join(root, 'lists'))) {
      if (file.endsWith('.jsonl') && !lists.has(file.slice(0, -'.jsonl'.length))) {
        await rm(join(root, 'lists', file));
      }
    }
    // meta.json last: a run that dies mid-write leaves the old hash, so the next run redoes the whole step.
    await writeAtomic(join(root, 'meta.json'), metaText);
  }

  let rawPath = '';
  if (month !== undefined) {
    rawPath = `raw/${rawFileName(now)}`;
    await writeAtomic(join(root, rawPath), bytes);
  }

  return { changed, summary, month: month ?? '', rawPath, contentSha256 };
}

/** `key=value` lines for $GITHUB_OUTPUT. Values are single-line. */
export function formatOutputs(r: RunResult): string {
  const one = (s: string): string => s.replace(/\s*[\r\n]+\s*/g, ' ');
  return [
    `changed=${r.changed}`,
    `summary=${one(r.summary)}`,
    `month=${r.month}`,
    `raw_path=${r.rawPath}`,
    `content_sha256=${r.contentSha256}`,
  ].join('\n') + '\n';
}

async function main(): Promise<void> {
  const result = await run({
    fetch: (url) => fetch(url, { signal: AbortSignal.timeout(120_000) }),
    root: process.cwd(),
    now: new Date(),
  });
  const out = formatOutputs(result);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, out);
  process.stdout.write(out);
}

if (import.meta.main) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
