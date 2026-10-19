/** First parenthesised group of a source name, e.g. "Entity List (EL) - Agency" -> "EL". */
export function abbreviationOf(source: string): string | undefined {
  return /\(([^()]+)\)/.exec(source)?.[1]?.trim() || undefined;
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'list';
}

/**
 * Maps each CSL source name to its list-file slug. The slug comes from the parenthesised abbreviation; a source
 * without one, or whose abbreviation another source shares, slugs from its full name. Remaining collisions get
 * -2, -3, ... Sources are sorted first, so the result does not depend on input order.
 *
 * `existing` holds source -> slug assignments from the committed meta.json. They are sticky: a source still present
 * keeps its slug (so its file keeps its git history), and the rules above apply only to new sources, which are never
 * given a slug already in use.
 */
export function slugFor(sources: readonly string[], existing?: ReadonlyMap<string, string>): Map<string, string> {
  const sorted = [...new Set(sources)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const out = new Map<string, string>();
  const taken = new Set<string>();
  for (const s of sorted) {
    const kept = existing?.get(s);
    if (kept !== undefined) {
      out.set(s, kept);
      taken.add(kept);
    }
  }
  const fresh = sorted.filter((s) => !out.has(s));
  const uses = new Map<string, number>();
  for (const s of fresh) {
    const c = slugify(abbreviationOf(s) ?? s);
    uses.set(c, (uses.get(c) ?? 0) + 1);
  }
  for (const s of fresh) {
    const abbr = abbreviationOf(s);
    let slug = slugify(abbr ?? s);
    if (abbr !== undefined && (uses.get(slug)! > 1 || taken.has(slug))) slug = slugify(s);
    let unique = slug;
    for (let n = 2; taken.has(unique); n++) unique = `${slug}-${n}`;
    taken.add(unique);
    out.set(s, unique);
  }
  return out;
}

/** Slug -> display label for commit subjects: the abbreviation when the slug came from it, else undefined. */
export function labelsFor(slugs: ReadonlyMap<string, string>): Map<string, string> {
  const labels = new Map<string, string>();
  for (const [source, slug] of slugs) {
    const abbr = abbreviationOf(source);
    if (abbr !== undefined && slugify(abbr) === slug) labels.set(slug, abbr.toUpperCase());
  }
  return labels;
}
