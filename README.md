# Book Registry

A static site for browsing and searching book metadata, seeded with every book
and periodical registered with the Hong Kong ISBN agency in 2025 — **10,912
titles**.

No framework, no npm dependencies, no server. A Node script imports datasets and
the browser does the rest — reading plain JSON, or querying a SQLite database by
byte range once the catalogue outgrows memory (see
[Two query backends](#two-query-backends)).

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
and registration number. Chinese queries work without spaces (`香港` → ~1,600
hits) and so do partial words. All terms must match; matches are highlighted.
Pasting a full ISBN finds that book directly.

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

## Two query backends

The site reads its data one of two ways, chosen automatically by what's in
`site/data/manifest.json`. The UI, the record shape and the importer are
identical either way.

| | **JSON shards** (default) | **SQLite over HTTP** |
| --- | --- | --- |
| How | every record loaded into memory | `books.db` queried by byte range |
| Built by | `npm run import` | `npm run build:db` |
| Good for | up to ~50k books | millions |
| First load | grows with the catalogue | ~100 KB regardless of size |
| Search | in-memory scan | FTS5 index |

```bash
npm run build
```

That runs the import and then the database build. `npm run build:db` alone
rebuilds only the database. It needs the `sqlite3` CLI with FTS5 — macOS ships
with it, `apt install sqlite3` elsewhere — and it checks before writing
anything. Delete `books.db` and remove the `db` key from the manifest to go
back to the JSON path.

Measured on the 10,912-record catalogue:

| | JSON shards | SQLite |
| --- | --- | --- |
| Opening the site | 491 KB, 4 files | **104 KB, 17 range requests** |
| A search | 43 ms | 92–151 ms |
| Opening a book | one 365 KB shard | one indexed lookup |
| Hosted size | 16 MB | 21 MB |

At this size the JSON path is simply better — it is smaller and faster, and
this is what the repo ships with. SQLite wins only once the catalogue no longer
fits in a browser's memory, which is the point of having both.

### Chinese search

Chinese has no spaces, so an ordinary tokenizer indexes a whole title as a
single token and `香港` matches nothing. FTS5's `trigram` tokenizer handles
substrings but needs three characters, which fails the most common query length
of two.

So CJK text is indexed as overlapping **bigrams** — 中國文化 becomes
`中國 國文 文化` — and queries are tokenised by the same code, in
[`site/tokenize.js`](site/tokenize.js). A two-character query is then one exact
token, and a single character becomes a prefix search. Latin text tokenises on
word boundaries as usual. The builder and the browser share that one file
deliberately: an index built by different rules than the query uses would return
nothing, silently.

### What makes it fast, and what to watch

Range requests punish two things: touching many scattered rows, and issuing many
dependent round trips. Four choices follow from that, and each was worth
megabytes when measured:

- **Full records live in a separate `docs` table.** They are 70% of the file but
  are only read when a book is opened. Left inline, every facet count and sort
  dragged them across the network.
- **Unfiltered facet counts are precomputed at build time.** The opening view
  needs all eight at once; aggregating them live cost 4.1 MB, reading them back
  costs a few KB.
- **Searches rank inside the FTS index, then fetch only the page's rows.**
  Joining first made SQLite walk a row per match to show sixty results.
- **A 32 MB page cache** (`PRAGMA cache_size`), because an evicted page is
  another HTTP request, not a memory read.

Search-time facet counts are capped at `FACET_SCAN_CAP` matches and are
approximate beyond it. A search still transfers ~2.7 MB at this size; the next
optimisation, if it's needed, is a narrow dictionary-encoded facet table so
counting stops touching full rows.

### Hosting a large database

The database is read by HTTP range request, so the host must support them
(GitHub Pages, Cloudflare Pages, S3, R2 and nginx all do; `tools/serve.js`
implements them for local work).

Per-file size limits are the real constraint as the catalogue grows: **GitHub
rejects files over 100 MB**, and **Cloudflare Pages over 25 MB**. Roughly 2 KB
per record here, so those ceilings arrive at about 50k and 12k books
respectively. Past them, either split the database into chunks
(`serverMode: "chunked"`, which the client library supports) or host the single
file on object storage such as R2 or S3 and keep the site on Pages.

## How it fits together

```
datasets.json          what to import, and with which adapter
tools/import.js        CLI: fetch → parse → normalise → shard → manifest
tools/build-sqlite.js  builds books.db (FTS5 + precomputed facet counts)
tools/serve.js         static dev server (gzip, no-store, byte ranges)
tools/adapters/        one module per source format
tools/lib/             CSV parser, downloader/cache, field matching,
                       ISBD/ISBN/price parsing, record assembly
site/                  index.html + styles.css + app.js, no framework
site/tokenize.js       search tokenizer, shared with the build
site/schema.js         facet SQL, shared with the build
site/vendor/           sql.js-httpvfs (MIT), vendored — no CDN at runtime
site/data/             generated: manifest.json + shards + books.db (git-tracked)
cache/                 downloaded source files (git-ignored)
```

Each import writes two tiers of shards, in the same order:

- `<id>.index.<n>.json` — slim rows for browsing, searching and filtering
- `<id>.full.<n>.json` — the complete record, fetched only when a book is opened

The browser loads the index tier up front (3.4 MB for 10,912 books, ~1 MB
gzipped) and pulls one full shard on demand, so opening a book never means
downloading the whole catalogue. A record's position in the index gives its
position in the full data, so no id→shard lookup table is needed.
