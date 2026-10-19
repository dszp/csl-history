import { canonicalJson, sha256Hex } from '@dszp/csl-screen';

const byteOrder = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Groups raw entries into one file per list: `canonicalJson(entry)` per line, sorted by `${source}|${id}` in byte
 * order, each line ending in a newline. Throws on a source with no slug.
 */
export function canonicalLists(
  doc: { results: Record<string, unknown>[] },
  slugs: ReadonlyMap<string, string>,
): Map<string, string> {
  const grouped = new Map<string, { key: string; line: string }[]>();
  for (const entry of doc.results) {
    const source = String(entry.source);
    const slug = slugs.get(source);
    if (slug === undefined) throw new Error(`no slug for source "${source}"`);
    let bucket = grouped.get(slug);
    if (!bucket) grouped.set(slug, (bucket = []));
    bucket.push({ key: `${source}|${String(entry.id)}`, line: canonicalJson(entry) });
  }
  const out = new Map<string, string>();
  for (const slug of [...grouped.keys()].sort(byteOrder)) {
    const lines = grouped.get(slug)!.sort((a, b) => byteOrder(a.key, b.key));
    out.set(slug, lines.map((l) => `${l.line}\n`).join(''));
  }
  return out;
}

/** Every canonical line must hash to the fingerprint the library computed for the same entry key. */
export async function verifyLists(
  lists: ReadonlyMap<string, string>,
  entries: readonly { key: string; fingerprint: string }[],
): Promise<void> {
  const expected = new Map(entries.map((e) => [e.key, e.fingerprint]));
  let lineCount = 0;
  for (const text of lists.values()) lineCount += text.split('\n').length - 1;
  if (lineCount !== entries.length) {
    throw new Error(`lists hold ${lineCount} entries but the snapshot has ${entries.length}`);
  }
  for (const [slug, text] of lists) {
    for (const line of text.split('\n').slice(0, -1)) {
      const parsed = JSON.parse(line) as { source: unknown; id: unknown };
      const key = `${String(parsed.source)}|${String(parsed.id)}`;
      if (expected.get(key) !== (await sha256Hex(line))) {
        throw new Error(`fingerprint mismatch for ${key} in lists/${slug}.jsonl`);
      }
    }
  }
}
