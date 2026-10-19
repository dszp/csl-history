# csl-history

An unofficial, content-addressed history of the US Consolidated Screening List (CSL). A GitHub Actions job downloads the list every hour and commits only when an entry is added, removed or changed. This project isn't affiliated with or endorsed by the US Department of Commerce or trade.gov.

trade.gov publishes the current list and keeps no history. This repository lets you prove which list content a screening run was checked against.

The CSL is public information published by the US government. The scrape source is `https://data.trade.gov/downloadable_consolidated_screening_list/v1/consolidated.json`.

## Files

| Path | Content |
|---|---|
| `lists/<slug>.jsonl` | One list per file. Each line is one entry as canonical JSON (keys sorted), and lines are sorted by `source\|id` in UTF-16 code-unit order (JavaScript `<`), identical to byte order for ASCII keys. |
| `meta.json` | `contentSha256`, `entryCount`, and for each list its full source name, `sourceLastUpdated` and entry count. It holds no download or import timestamps. The file is rewritten only when the content changes, so `sourceLastUpdated` is the value at the last content change, not at the latest download. |
| `snapshots/index.json` | One record per month: `month`, `rawSha256`, `tag`, `contentCommit`. |

The `<slug>` is the lowercased abbreviation in parentheses in the source name (`sdn` for "Specially Designated Nationals (SDN) …"). A source without an abbreviation, or whose abbreviation another source shares, uses its full name.

Each commit subject summarises the change per list, for example `SDN +3 −1 ~2; EL ~1`. `+` is an added entry, `−` a removed one, and `~` an entry with the same `source|id` and different content. Use `git log -p lists/sdn.jsonl` to read the changes.

## Content hash

`contentSha256` is the SHA-256 of the lines `<source>|<id>`, a tab, and the SHA-256 of the entry's canonical JSON, each followed by a newline, sorted by `source|id` in UTF-16 code-unit order (JavaScript `<`), identical to byte order for ASCII keys. It changes when an entry is added, removed or changed. It doesn't change when trade.gov only updates `search_performed_at` or a list's `last_imported`. The [`@dszp/csl-screen`](https://www.npmjs.com/package/@dszp/csl-screen) library computes it (`contentHashOf`), and this repository's scraper uses that library.

## Verify a run

By content: if you recorded a `contentSha256`, list the commits whose change added or removed it. Use a full clone, because a `--depth` clone is missing commits.

```sh
git log -S <contentSha256> --reverse --format='%H %cI %s' -- meta.json
```

The first line is the commit where that content first appeared. The next line, if there is one, is the commit that replaced it. The list had that content between the two commit dates, to within about an hour. If the output has more pairs, the content went away and later came back. No output means the hash was never the committed content.

By bytes: if you recorded the SHA-256 of the file you downloaded, compare it with `rawSha256` in `snapshots/index.json`. Then download the `.json.xz` and `.json.sha256` assets from that month's release (`raw-YYYY-MM`) and run:

```sh
xz -dk consolidated-YYYY-MM-DD.json.xz && sha256sum -c consolidated-YYYY-MM-DD.json.sha256
```

The `.sha256` asset holds the hash of the decompressed file. Only one download per month is kept, so a byte match is possible only for that file. Any other download is provable by content.

## Run it yourself

Node 24 and pnpm are required.

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm scrape   # writes lists/, meta.json and raw/ in the current directory
```

`pnpm scrape` makes no git calls. The workflow in `.github/workflows/scrape.yml` commits the results, creates the monthly release, and uses only the built-in `GITHUB_TOKEN`.

## Limits

- History starts when this repository was created. Earlier list states aren't recoverable.
- A scrape that fails a check (invalid JSON, mismatched total, a sharp drop in entries, a missing list) fails the job and commits nothing.
- A real change can trip those checks too, for example trade.gov renaming a source or delisting more than 10% of the entries. Every run then fails until you edit `meta.json` by hand: remove or rename the affected entry under `lists`, set `entryCount` to the new total, and commit. The next run sees the content changed, commits the new lists and deletes the orphaned file.
- GitHub can pause scheduled workflows in a repository with no recent activity. The monthly snapshot commit keeps this one active.

## License

MIT. See `LICENSE`.
