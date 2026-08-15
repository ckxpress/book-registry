# Book Registry

A static site for browsing and searching book metadata, seeded with every book
and periodical registered with the Hong Kong ISBN agency in 2025 — **10,912
titles**.

No build step, no dependencies, no database. A Node script imports datasets into
JSON; the browser does the rest.

```bash
npm run import   # fetch + normalise the datasets in datasets.json
npm start        # serve site/ at http://localhost:8080
```

Node 12+ (works on the system Node 14 here). Both scripts use only Node
built-ins.

---

## What you get

**Browse** a cover grid or a detail list, sorted by relevance, title, year or
publisher.

**Search** across title, subtitle, authors, publisher, series, category, ISBN
and registration number. Substring matching, so Chinese queries work without
tokenisation (`香港` → 1,522 hits) and so do partial words. All terms must match;
matches are highlighted. Pasting a full ISBN finds that book directly.

**Filter** by dataset, language, category, publisher, year, quarterly release,
availability and whether a record carries an ISBN. Counts update against the
other active filters, so options never lead to zero results.

**Every view is a URL.** Searches, filters and sort live in the address bar, and
each book has a permalink — both are shareable and survive a reload.

Also: light/dark themes, `/` to focus search, keyboard and screen-reader
friendly, works down to phone width.

## The metadata

| Field | Source |
| --- | --- |
| Title, subtitle, parallel title, statement of responsibility | Split from the catalogue's ISBD title string |
| Authors (up to 10) | Source columns, with inverted names shown naturally (`Cheung, Ysabelle` → Ysabelle Cheung) |
| Publisher, place, year, edition, series, frequency | Source columns |
| ISBN / ISSN | Parsed from free text; every ISBN on a record is kept with its qualifier (pbk., 精裝, 全12冊), plus normalised ISBN-13 and ISBN-10 |
| Physical description | Raw string plus parsed page count and dimensions |
| Category, notes | Source columns |
| Price, availability | Parsed amount + currency; "Unpriced"/非賣品 recorded as not for sale |
| Registration number, catalogue serial, source file, release | Provenance for every record |
| **Description** | *Derived* — composed from the catalogue fields, in the record's own language |
| **Copyright** | *Derived* — publisher plus year of publication |
| **Cover** | *Not in the dataset* — resolved by ISBN at render time |

The two derived fields are labelled **derived** in the UI wherever they appear.
The source is a registration catalogue: it has no abstracts and no rights
statement, so these are composed rather than reported. Everything else is
verbatim from the dataset.

### Covers

Roughly half of Hong Kong ISBNs resolve to a real cover. The browser tries
Google Books, then Open Library, then falls back to a generated cover built from
the title and a colour seeded by the record id — so every book has a cover, and
nothing renders as a broken image.

Google answers a missing cover with a placeholder bitmap instead of a 404, so
each lookup is probed at `zoom=1`, where the two placeholder variants are
identifiable by their fixed dimensions (128×170 and 128×184), and only then
upgraded to a larger image. Cover lookups can be switched off entirely on the
**About the data** page — the site then makes no third-party requests at all.

## Adding more datasets

Datasets are declared in [`datasets.json`](datasets.json) and imported by
[`tools/import.js`](tools/import.js).

```bash
npm run import                                   # everything registered
npm run import -- hkpl-2025                      # one dataset
npm run import -- --add-hkpl-year 2026           # next year of the HK catalogue
npm run import -- --file examples/sample-books.csv --id my-shelf --title "My shelf"
npm run import -- --url https://host/books.json --id x --title "X"
npm run import -- --list                         # what is registered / imported
npm run import -- --remove my-shelf              # drop a dataset and its files
npm run import -- --refresh                      # ignore the download cache
```

`--file` / `--url` imports are written back into `datasets.json`, so
`npm run import` re-imports them later. Add `--no-save` for a one-off.
Other options: `--adapter --description --provider --homepage --license
--region --language --label --currency`.

Try it with the four-book sample:

```bash
npm run import -- --file examples/sample-books.csv --id sample-shelf --title "Sample shelf"
```

The site picks up new datasets on reload — nothing to rebuild. Multiple datasets
coexist, and a **Dataset** filter appears once there is more than one.

### Adapters

| Adapter | For |
| --- | --- |
| `hkpl-bro` | The Hong Kong quarterly catalogue CSVs (the default for `--add-hkpl-year`) |
| `generic-csv` | Any book CSV — columns auto-mapped by name |
| `json` | A JSON array of book objects — keys auto-mapped the same way |

`generic-csv` and `json` recognise the usual names for title, subtitle, author,
publisher, year, ISBN, description, category, price, cover and more, in English
or Chinese, so most exports import with no configuration. Columns that aren't
recognised are preserved per-record and shown in the detail view, so nothing is
silently dropped.

Column names drift between releases upstream — 2025 Q3 renamed nearly every
header (`ISBN` for `International Standard Book Number`, prefixes like
`B: Author 1`) — so every field is matched by alias, not by position.

To support a genuinely different format, add a module to `tools/adapters/`
exporting `parse(ctx)` that returns records built by `tools/lib/record.js`, and
register it in the `ADAPTERS` map in `tools/import.js`.

## Data source

[A Catalogue of Books Printed in Hong Kong](https://data.gov.hk/en-data/dataset/hk-lcsd-lib-lib-bro)
— Books Registration Office, Hong Kong Public Libraries (Leisure and Cultural
Services Department), published quarterly on DATA.GOV.HK as one CSV per quarter
per language, under the
[DATA.GOV.HK terms of use](https://data.gov.hk/en/terms-and-conditions).
Field definitions are in the
[data dictionary](https://www.hkpl.gov.hk/en/common/attachments/about-us/services/book-registration/catalogueHK_datadic_en.pdf).

## How it fits together

```
datasets.json          what to import, and with which adapter
tools/import.js        CLI: fetch → parse → normalise → shard → manifest
tools/serve.js         static dev server (gzip, no-store)
tools/adapters/        one module per source format
tools/lib/             CSV parser, downloader/cache, field matching,
                       ISBD/ISBN/price parsing, record assembly
site/                  index.html + styles.css + app.js, no framework
site/data/             generated: manifest.json + shards (git-tracked)
cache/                 downloaded source files (git-ignored)
```

Each import writes two tiers of shards, in the same order:

- `<id>.index.<n>.json` — slim rows for browsing, searching and filtering
- `<id>.full.<n>.json` — the complete record, fetched only when a book is opened

The browser loads the index tier up front (3.4 MB for 10,912 books, ~1 MB
gzipped) and pulls one full shard on demand, so opening a book never means
downloading the whole catalogue. A record's position in the index gives its
position in the full data, so no id→shard lookup table is needed.
