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
 */

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const { indexTokens } = require('./lib/tokenize');
const { SQL_FACET, FACET_LIMIT } = require('../site/schema.js');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const DB = path.join(DATA_DIR, 'books.db');

// Small pages keep each range request tight; the client asks for 4 KB chunks,
// so one request still covers several pages.
const PAGE_SIZE = 1024;

main();

function main() {
  requireSqlite();

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
  manifest.db = {
    file: 'books.db',
    bytes: size,
    pageSize: PAGE_SIZE,
    pages: Number(pages),
    builtAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(DATA_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log(
    '\n✓ ' + total.toLocaleString('en-US') + ' books → ' + (size / 1048576).toFixed(1) + ' MB, ' +
      Number(pages).toLocaleString('en-US') + ' pages of ' + PAGE_SIZE + ' bytes'
  );
  console.log('  The site now queries books.db by range request; JSON shards remain as a fallback.');
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

/** Records carry a source label; map it back to the dataset's source list. */
function indexOfSource(rec, ds) {
  if (!rec.source || !ds.sources) return 0;
  const at = ds.sources.findIndex((s) => s.label === rec.source.label);
  return at === -1 ? 0 : at;
}

/**
 * Counts for the unfiltered catalogue, computed once here instead of by
 * GROUP BY in the browser. The opening view of the site needs every facet at
 * once, and aggregating over the whole table by range request costs megabytes;
 * reading it back from this table costs a few kilobytes.
 */
function precomputedFacets() {
  const lines = [
    'CREATE TABLE facet_counts (facet TEXT, value TEXT, n INTEGER);',
  ];
  for (const key of Object.keys(SQL_FACET)) {
    const expr = SQL_FACET[key].replace(/\bb\./g, '');
    lines.push(
      "INSERT INTO facet_counts(facet, value, n) SELECT '" + key + "', " + expr +
        ', COUNT(*) FROM books WHERE ' + expr + " <> '' GROUP BY 2 ORDER BY 3 DESC LIMIT " + FACET_LIMIT + ';'
    );
  }
  lines.push('CREATE INDEX idx_facet ON facet_counts(facet, n DESC);');
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
    'CREATE INDEX idx_year_title ON books(year DESC, title);',
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
