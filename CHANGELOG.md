# Changelog

## Unreleased

- Hourly scrape of the US Consolidated Screening List into `lists/*.jsonl` and `meta.json`, committed only when the content hash changes.
- Monthly release `raw-YYYY-MM` holding the xz-compressed original download and its SHA-256.
- `snapshots/index.json` records one entry per month.
