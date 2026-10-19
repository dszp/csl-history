function keysToLines(text: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of text.split('\n')) {
    if (line === '') continue;
    const e = JSON.parse(line) as { source: unknown; id: unknown };
    m.set(`${String(e.source)}|${String(e.id)}`, line);
  }
  return m;
}

const countLines = (text: string): number => text.split('\n').filter((l) => l !== '').length;

/**
 * Commit subject for a content change, e.g. `SDN +3 −1 ~2; EL ~1`. `~` is an entry with the same key and a different
 * line. Lists are compared by key and line text; unchanged lists are omitted; the biggest change leads. `slugToAbbrev` supplies labels; a slug
 * without one is shown uppercased.
 */
export function summarise(
  previous: ReadonlyMap<string, string> | undefined,
  next: ReadonlyMap<string, string>,
  slugToAbbrev: ReadonlyMap<string, string>,
): string {
  if (previous === undefined) {
    let total = 0;
    for (const text of next.values()) total += countLines(text);
    return `initial import: ${total} entries`;
  }
  const label = (slug: string): string => slugToAbbrev.get(slug) ?? slug.toUpperCase();
  const parts: { text: string; weight: number; label: string }[] = [];
  const slugs = new Set([...previous.keys(), ...next.keys()]);
  for (const slug of slugs) {
    const before = previous.get(slug);
    const after = next.get(slug);
    if (after === undefined) {
      parts.push({ text: `${label(slug)} removed`, weight: countLines(before ?? ''), label: label(slug) });
      continue;
    }
    if (before === undefined) {
      const n = countLines(after);
      parts.push({ text: `${label(slug)} +${n} (new list)`, weight: n, label: label(slug) });
      continue;
    }
    if (before === after) continue;
    const old = keysToLines(before);
    const cur = keysToLines(after);
    let added = 0;
    let removed = 0;
    let changed = 0;
    for (const [k, line] of cur) {
      const was = old.get(k);
      if (was === undefined) added++;
      else if (was !== line) changed++;
    }
    for (const k of old.keys()) if (!cur.has(k)) removed++;
    const counts = [added && `+${added}`, removed && `\u2212${removed}`, changed && `~${changed}`].filter(Boolean);
    parts.push({ text: `${label(slug)} ${counts.join(' ')}`, weight: added + removed + changed, label: label(slug) });
  }
  // Biggest change first, ties by label, so the subject leads with what moved most.
  parts.sort((x, y) => y.weight - x.weight || (x.label < y.label ? -1 : x.label > y.label ? 1 : 0));
  return parts.map((p) => p.text).join('; ') || 'content changed';
}
