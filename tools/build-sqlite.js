#!/usr/bin/env node
'use strict';

/**
 * Builds site/data/books.db from the imported records, so the browser can
 * query the catalogue over HTTP range requests instead of downloading every
 * record up front. Run after `npm run import`:
 *
 *   npm run build:db
 *
 * Needs the sqlite3 CLI (ships with macOS; `apt install sqlite3` elsewhere)
 * with FTS5 — checked before anything is written.
 *
 * The database is too big to serve from GitHub Pages, which compresses it and
 * then applies byte ranges to the *compressed* stream. Point the site at
 * object storage instead, once:
 *
 *   npm run build:db -- --db-url https://db.example.com/
 *
 * A URL ending in "/" is treated as a base, and each build appends the
 * database's own content hash — books-8b4c50cb.db — so a rebuilt database never
 * reuses a name, and no stale CDN cache entry can shadow it. Pass a full URL
 * instead to pin one exact name.
 *
 * The URL is remembered in the manifest, so later rebuilds need no flag.
 * `--db-url ""` clears it and goes back to serving books.db beside the site.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const crypto = require('crypto');

const { indexTokens } = require('./lib/tokenize');
const { SQL_FACET, FACET_LIMIT } = require('../site/schema.js');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const DB = path.join(DATA_DIR, 'books.db');

// The page size decides how deep the B-trees are and how many rows share a
// page, and over range requests both land on the serial request count — the
// thing that actually costs time, because SQLite cannot ask for a page until
// it has read the page pointing at it. 1 KiB pages put ~3 books on a page, so
// sixty scattered rows meant sixty round trips; 4 KiB puts ~13 on a page and
// shortens every descent.
const PAGE_SIZE = 4096;

// How much the browser fetches per request. Larger than a page, so one request
// covers several: round trips cost far more than the extra bytes, so this is
// tuned for the fewest requests that does not start wasting whole megabytes.
// Measured on a search for 香港, at 4 KiB pages:
//
//    8 KiB chunk → 103 requests, 3.02 MB
//   16 KiB chunk →  85 requests, 3.46 MB
//   32 KiB chunk →  69 requests, 4.11 MB   ← here
//   64 KiB chunk →  60 requests, 5.93 MB
//
// Past 32 KiB the request count barely moves while the bytes climb steeply.
const CHUNK_SIZE = PAGE_SIZE * 8;

// Matches PAGE_SIZE in site/app.js — the first screenful the browser renders.
const FIRST_PAGE_ROWS = 60;

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

main();

function main() {
  requireSqlite();

  const args = process.argv.slice(2);
  const at = args.indexOf('--db-url');
  if (at !== -1 && at === args.length - 1) {
    throw new Error('--db-url needs a value (use --db-url "" to serve books.db from the site itself).');
  }
  const dbUrlArg = at === -1 ? undefined : args[at + 1];

  const manifest = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'manifest.json'), 'utf8'));
  if (!manifest.datasets || !manifest.datasets.length) throw new Error('No datasets imported yet — run `npm run import` first.');

  const sqlFile = path.join(DATA_DIR, '.build.sql');
  const fd = fs.openSync(sqlFile, 'w');

  fs.writeSync(fd, schema());

  let rowid = 0;
  let total = 0;

  for (const ds of manifest.datasets) {
    let count = 0;
    let batch = '';
    for (const file of ds.files.full) {
      const records = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
      for (const rec of records) {
        rowid++;
        count++;
        batch += insertBook(rowid, rec, ds);
        if (batch.length > 1 << 20) {
          fs.writeSync(fd, batch);
          batch = '';
        }
      }
    }
    if (batch) fs.writeSync(fd, batch);
    total += count;
    console.log('  ' + pad(ds.id, 20) + String(count).padStart(8) + ' rows');
  }

  fs.writeSync(fd, finalise());
  fs.closeSync(fd);

  if (fs.existsSync(DB)) fs.unlinkSync(DB);
  console.log('\nBuilding ' + path.relative(ROOT, DB) + ' …');

  const res = spawnSync('sqlite3', [DB], { input: fs.readFileSync(sqlFile), stdio: ['pipe', 'inherit', 'inherit'] });
  fs.unlinkSync(sqlFile);
  if (res.status !== 0) throw new Error('sqlite3 exited with code ' + res.status);

  const size = fs.statSync(DB).size;
  const pages = execFileSync('sqlite3', [DB, 'PRAGMA page_count;']).toString().trim();

  // The manifest tells the site to use the database instead of JSON shards.
  // A known value the browser re-reads on startup to prove the transport is
  // sound. Some hosts (GitHub Pages) compress the file and then apply byte
  // ranges to the *compressed* stream, which yields a readable-looking
  // database that answers queries wrongly. Better to detect that than to
  // show a visitor silently incorrect results.
  const probeId = execFileSync('sqlite3', [DB, 'SELECT id FROM books WHERE rowid = 1;']).toString().trim();

  // An existing url survives a rebuild: the database is uploaded separately
  // from the site, so re-running the build must not quietly point the app
  // back at a books.db that was never deployed.
  const previousUrl = manifest.db && manifest.db.url;
  const configured = dbUrlArg === undefined ? previousUrl : dbUrlArg || undefined;

  // The content hash goes in the object name. Two things make this worth the
  // trouble: the edge cache outlives the object (a Cache Rule holds a deleted
  // or replaced file for as long as its TTL, so reusing one name can serve old
  // bytes under a new manifest's byte length for weeks), and the site and the
  // database deploy separately, so the running site must keep reading the
  // object it was built against until the new one is live.
  //
  // A url ending in "/" is a base to append the hashed name to; a full url is
  // used exactly as given, so an existing setup keeps working.
  const digest = crypto.createHash('md5').update(fs.readFileSync(DB)).digest('hex');
  const url = configured && configured.endsWith('/')
    ? configured + 'books-' + digest.slice(0, 8) + '.db'
    : configured;

  manifest.db = {
    file: 'books.db',
    bytes: size,
    md5: digest,
    pageSize: PAGE_SIZE,
    chunkBytes: CHUNK_SIZE,
    pages: Number(pages),
    probe: { rowid: 1, id: probeId },
    builtAt: new Date().toISOString(),
  };
  if (url) manifest.db.url = url;

  // The landing view is the same for every first-time reader, and answering it
  // from the database costs scattered range requests that SQLite must issue one
  // after another — it cannot ask for a page until it has read the page that
  // points at it. Serial round trips, so the wait is latency times depth, and
  // no amount of edge caching removes it.
  //
  // So the landing view is answered here instead, at build time, into a file
  // the site serves and the service worker caches like any other asset. First
  // paint then needs the database not at all; it is opened in the background
  // for the first search or filter.
  manifest.firstPage = writeFirstPage();
  fs.writeFileSync(path.join(DATA_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log(
    '\n✓ ' + total.toLocaleString('en-US') + ' books → ' + (size / 1048576).toFixed(1) + ' MB, ' +
      Number(pages).toLocaleString('en-US') + ' pages of ' + PAGE_SIZE + ' bytes'
  );
  if (url) {
    console.log('  Served from ' + url);
    console.log(
      '  Upload site/data/books.db as "' + url.slice(url.lastIndexOf('/') + 1) +
        '", or the site keeps reading the old one.'
    );
    console.log('  md5 ' + digest + ' — R2 shows this as the object\'s etag.');
  } else {
    console.log('  Served from the site itself — note GitHub Pages cannot do this correctly.');
  }
  console.log('  The site queries it by range request; JSON shards remain as a fallback.');
}

function schema() {
  return [
    'PRAGMA journal_mode = delete;',
    'PRAGMA page_size = ' + PAGE_SIZE + ';',
    'BEGIN;',
    `CREATE TABLE books (
      rowid INTEGER PRIMARY KEY,
      id TEXT NOT NULL,
      dataset TEXT,
      title TEXT,
      parallel_title TEXT,
      title_display TEXT,
      zh_first INTEGER,
      subtitle TEXT,
      authors TEXT,
      publisher TEXT,
      year INTEGER,
      isbn TEXT,
      classification TEXT,
      language TEXT,
      series TEXT,
      ref TEXT,
      src INTEGER,
      price REAL,
      currency TEXT,
      forsale INTEGER,
      cover TEXT
    );`,
    // Full records live apart from the browse columns: a facet count or a
    // sort scans `books`, and dragging every record's JSON through those
    // pages would cost megabytes per query.
    'CREATE TABLE docs (rowid INTEGER PRIMARY KEY, doc TEXT NOT NULL);',
    // Contentless: the index holds tokens only, never a second copy of the text.
    `CREATE VIRTUAL TABLE books_fts USING fts5(
      search, content='', tokenize="unicode61 remove_diacritics 2"
    );`,
  ].join('\n');
}

function insertBook(rowid, rec, ds) {
  const authors = (rec.authors || []).map((a) => a.display || a.name).join(', ');
  const series = rec.series ? rec.series.title : '';
  const price = rec.price && typeof rec.price.amount === 'number' ? rec.price.amount : null;
  const forsale = rec.price && typeof rec.price.forSale === 'boolean' ? (rec.price.forSale ? 1 : 0) : null;

  const values = [
    rowid,
    str(rec.id),
    str(rec.dataset || ds.id),
    str(rec.title),
    str(rec.parallelTitle),
    str(displayTitleOf(rec)),
    hasCjk(displayTitleOf(rec)) ? 0 : 1,
    str(rec.subtitle),
    str(authors),
    str(rec.publisher),
    rec.year ? Number(rec.year) : 'NULL',
    str(rec.isbn),
    str(rec.classification),
    str(rec.language),
    str(series),
    str(rec.ref),
    Number(rec.sourceIndex || indexOfSource(rec, ds)),
    price === null ? 'NULL' : price,
    str(rec.price ? rec.price.currency : ''),
    forsale === null ? 'NULL' : forsale,
    str(rec.cover ? rec.cover.url : ''),
  ];

  const tokens = indexTokens(
    [rec.title, rec.subtitle, rec.parallelTitle, authors, rec.publisher, series, rec.classification, rec.isbn, rec.ref, rec.year]
      .filter(Boolean)
      .join(' ')
  ).join(' ');

  return (
    'INSERT INTO books VALUES (' + values.join(',') + ');\n' +
    'INSERT INTO docs VALUES (' + rowid + ',' + str(JSON.stringify(rec)) + ');\n' +
    'INSERT INTO books_fts(rowid, search) VALUES (' + rowid + ',' + str(tokens) + ');\n'
  );
}

function hasCjk(text) {
  return CJK.test(text || '');
}

/**
 * The catalogue is published as separate Chinese and English volumes, and an
 * English record often carries the Chinese title as its parallel title. This
 * is a Traditional Chinese site, so the Chinese form is what gets displayed
 * and sorted on. Mirrors displayTitle() in site/app.js.
 */
function displayTitleOf(rec) {
  if (!hasCjk(rec.title) && hasCjk(rec.parallelTitle)) return rec.parallelTitle;
  return rec.title || '';
}

/** Records carry a source label; map it back to the dataset's source list. */
function indexOfSource(rec, ds) {
  if (!rec.source || !ds.sources) return 0;
  const at = ds.sources.findIndex((s) => s.label === rec.source.label);
  return at === -1 ? 0 : at;
}

/**
 * Counts computed once here instead of by GROUP BY in the browser. The
 * opening view needs every facet at once, and aggregating over the whole
 * table by range request costs megabytes; reading it back from this table
 * costs a few kilobytes.
 *
 * Two scopes are stored. '' is the whole catalogue. The rest are one per
 * language, because the site opens with a language already selected, and a
 * filtered facet cannot use the '' rows — it would report counts for books
 * the reader has filtered out. Without the language scopes that opening view
 * falls back to live aggregation: eight facets, each doing a full row fetch
 * for every matching book, which measured 7.75 MB of range traffic on a
 * catalogue of 25,385.
 *
 * The per-language rows are generated by one statement per facet whatever
 * the languages turn out to be, with ROW_NUMBER to apply the cap within each
 * language rather than across all of them.
 */
function precomputedFacets() {
  const lines = [
    'CREATE TABLE facet_counts (scope TEXT, facet TEXT, value TEXT, n INTEGER);',
  ];

  for (const key of Object.keys(SQL_FACET)) {
    const expr = SQL_FACET[key].replace(/\bb\./g, '');
    lines.push(
      "INSERT INTO facet_counts(scope, facet, value, n) SELECT '', '" + key + "', " + expr +
        ', COUNT(*) FROM books WHERE ' + expr + " <> '' GROUP BY 3 ORDER BY 4 DESC LIMIT " + FACET_LIMIT + ';'
    );
  }

  for (const key of Object.keys(SQL_FACET)) {
    // The language facet is never narrowed by a language filter — the reader
    // has to be able to see the other languages to switch to one — so the
    // client only ever reads it from the '' scope.
    if (key === 'language') continue;
    const expr = SQL_FACET[key].replace(/\bb\./g, '');
    lines.push(
      'INSERT INTO facet_counts(scope, facet, value, n)\n' +
        'SELECT scope, facet, value, n FROM (\n' +
        "  SELECT language AS scope, '" + key + "' AS facet, " + expr + ' AS value, COUNT(*) AS n,\n' +
        '         ROW_NUMBER() OVER (PARTITION BY language ORDER BY COUNT(*) DESC) AS rk\n' +
        '  FROM books WHERE ' + expr + " <> '' AND language <> ''\n" +
        '  GROUP BY language, value\n' +
        ') WHERE rk <= ' + FACET_LIMIT + ';'
    );
  }

  lines.push('CREATE INDEX idx_facet ON facet_counts(scope, facet, n DESC);');
  return lines.join('\n');
}

function finalise() {
  return [
    '',
    precomputedFacets(),
    // Facet counting is GROUP BY, so every facet column needs an index.
    'CREATE INDEX idx_dataset ON books(dataset);',
    'CREATE INDEX idx_language ON books(language);',
    'CREATE INDEX idx_class ON books(classification);',
    'CREATE INDEX idx_publisher ON books(publisher);',
    'CREATE INDEX idx_year ON books(year);',
    'CREATE INDEX idx_src ON books(dataset, src);',
    'CREATE INDEX idx_forsale ON books(forsale);',
    'CREATE INDEX idx_isbn ON books(isbn);',
    'CREATE UNIQUE INDEX idx_id ON books(id);',
    // Browse order without a query: keeps the default listing off a full sort.
    'CREATE INDEX idx_title ON books(title);',
    // Default browse order: Chinese titles first, alphabetical within each group.
    'CREATE INDEX idx_zh_title ON books(zh_first, title_display);',
    'CREATE INDEX idx_year_title ON books(year DESC, title);',

    // The default browse order, indexed as the expression the query actually
    // sorts by. Without these SQLite answers the opening page with SCAN +
    // TEMP B-TREE over every row, and over a range-request transport that
    // means dragging the whole table down the wire — 8.3 MB to show sixty
    // books. With them both plans are covering index walks that stop at the
    // LIMIT. The second one carries `language` because the site opens with
    // that facet applied.
    "CREATE INDEX idx_browse ON books(cover = '', zh_first, title_display);",
    "CREATE INDEX idx_browse_lang ON books(language, cover = '', zh_first, title_display);",

    // Every facet column in one index, so counting a facet against the other
    // active filters never has to fetch a row. The precomputed table only
    // answers the opening view; the moment a reader picks a publisher the
    // counts are aggregated live, and without this SQLite satisfies that by
    // reading thousands of scattered rows out of a 55 MB file — one click
    // measured 8.06 MB of range traffic, including a single 4 MB read.
    // Covered, the same work is a walk over a 2 MB index.
    'CREATE INDEX idx_facets_all ON books(language, publisher, year, classification, dataset, src, forsale, isbn);',
    'COMMIT;',
    'VACUUM;',
    'PRAGMA optimize;',
    '',
  ].join('\n');
}

function requireSqlite() {
  const version = spawnSync('sqlite3', ['--version'], { encoding: 'utf8' });
  if (version.status !== 0) {
    throw new Error('sqlite3 CLI not found. Install it (macOS ships with it; `apt install sqlite3` on Debian/Ubuntu).');
  }
  const fts = spawnSync('sqlite3', [':memory:', "CREATE VIRTUAL TABLE t USING fts5(x); SELECT 1;"], { encoding: 'utf8' });
  if (fts.status !== 0) {
    throw new Error('This sqlite3 build lacks FTS5, which the search index needs.');
  }
  console.log('sqlite3 ' + version.stdout.trim().split(' ')[0] + ' with FTS5\n');
}

function str(value) {
  if (value === undefined || value === null) return "''";
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function pad(text, width) {
  const s = String(text);
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

/**
 * Precomputes the rows, totals and facet counts for the views a reader can
 * land on without touching anything: the whole catalogue, and each single
 * language on its own (the site defaults to Chinese).
 *
 * Columns are emitted under their database names so the browser can hand them
 * to the same mapping function it uses for a real query result — one code path
 * for both, so a precomputed card cannot render differently from a queried one.
 */
function writeFirstPage() {
  const COLUMNS =
    'b.id, b.dataset, b.title, b.subtitle, b.authors, b.publisher, b.year, b.isbn,' +
    ' b.classification, b.language, b.series, b.ref, b.src, b.price, b.currency,' +
    ' b.forsale, b.cover, b.parallel_title';
  const ORDER = "b.cover = '', b.zh_first, b.title_display";

  const languages = json("SELECT value FROM facet_counts WHERE scope = '' AND facet = 'language' ORDER BY n DESC")
    .map((r) => r.value);

  const scopes = {};
  for (const scope of [''].concat(languages)) {
    const where = scope ? ' WHERE b.language = ' + quote(scope) : '';
    const rows = json(
      'SELECT ' + COLUMNS + ' FROM books b' + where + ' ORDER BY ' + ORDER + ' LIMIT ' + FIRST_PAGE_ROWS
    );
    // Each facet is counted against the *other* active filters, so its options
    // stay meaningful — the browser's own rule. Inside a single language that
    // means every facet is counted within it, except `language` itself, which
    // is counted across the whole catalogue so the other languages are still
    // offered and reachable.
    const within = (facet) => (facet === 'language' ? '' : scope);
    const counts = json(
      'SELECT scope, facet, value, n FROM facet_counts WHERE scope IN (' + quote(scope) + ", '')" +
        ' ORDER BY facet, n DESC, value'
    );

    const facets = {};
    for (const row of counts) {
      if (row.scope !== within(row.facet)) continue;
      if (!facets[row.facet]) facets[row.facet] = [];
      if (facets[row.facet].length < FACET_LIMIT) facets[row.facet].push({ v: row.value, n: row.n });
    }

    const total = scope
      ? json('SELECT n FROM facet_counts WHERE scope = \'\' AND facet = \'language\' AND value = ' + quote(scope))[0].n
      : json("SELECT SUM(n) AS n FROM facet_counts WHERE scope = '' AND facet = 'language'")[0].n;

    scopes[scope] = { total: total, rows: rows, facets: facets };
  }

  const out = { rows: FIRST_PAGE_ROWS, builtAt: new Date().toISOString(), scopes: scopes };
  const file = 'firstpage.json';
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(out) + '\n');

  const size = fs.statSync(path.join(DATA_DIR, file)).size;
  console.log(
    '  Landing view precomputed → ' + file + ', ' + (size / 1024).toFixed(0) + ' KB, ' +
      Object.keys(scopes).length + ' scopes (no range requests for first paint)'
  );
  return { file: file, rows: FIRST_PAGE_ROWS, scopes: Object.keys(scopes) };
}

/** Runs a query and parses sqlite3's own JSON output, so types survive. */
function json(sql) {
  const out = execFileSync('sqlite3', ['-json', DB, sql], { maxBuffer: 1 << 28 }).toString().trim();
  return out ? JSON.parse(out) : [];
}

function quote(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}
