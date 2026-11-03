#!/usr/bin/env node
'use strict';

/**
 * Resolves cover images once, at build time, instead of letting every visitor
 * probe for them.
 *
 *   npm run covers            resolve anything not already cached
 *   npm run covers -- --recheck   re-probe misses as well
 *   npm run covers -- --limit 200  stop after N lookups (for trying it out)
 *
 * Covers are not in the source catalogue. Google Books is the only source that
 * returns Hong Kong covers at all — Open Library has effectively none, Amazon
 * almost none, and the bookshops that do carry these titles block automated
 * requests, which this will not work around. Expect a low hit rate: most of
 * this catalogue is annual reports, textbooks and government publications that
 * were never scanned.
 *
 * Results are cached in cache/covers.json, so re-runs only probe what is new.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const CACHE = path.join(ROOT, 'cache', 'covers.json');

const CONCURRENCY = 6;      // polite: this is someone else's service
const TIMEOUT_MS = 20000;

// Google answers a miss with a fixed bitmap rather than a 404.
const PLACEHOLDERS = new Set(['128x170', '128x184']);

const args = process.argv.slice(2);
const RECHECK = args.includes('--recheck');
const LIMIT = Number((args[args.indexOf('--limit') + 1] || 0)) || Infinity;

main().catch((err) => {
  console.error('\n✗ ' + err.message);
  process.exit(1);
});

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'manifest.json'), 'utf8'));
  const cache = loadCache();

  // Every ISBN on every record: a title registered in paperback and hardback
  // may only have one of them scanned.
  const records = [];
  for (const ds of manifest.datasets) {
    for (const file of ds.files.full) {
      for (const rec of JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'))) {
        records.push(rec);
      }
    }
  }

  const wanted = [];
  for (const rec of records) {
    for (const isbn of isbnsOf(rec)) {
      if (!RECHECK && Object.prototype.hasOwnProperty.call(cache, isbn)) continue;
      if (!wanted.includes(isbn)) wanted.push(isbn);
    }
  }

  const todo = wanted.slice(0, LIMIT === Infinity ? wanted.length : LIMIT);
  console.log(
    records.length.toLocaleString('en-US') + ' records · ' +
      Object.keys(cache).length.toLocaleString('en-US') + ' ISBNs already cached · ' +
      todo.length.toLocaleString('en-US') + ' to look up\n'
  );

  let done = 0;
  let found = 0;
  await pool(todo, CONCURRENCY, async (isbn) => {
    const url = await probe(isbn);
    cache[isbn] = url;
    done++;
    if (url) found++;
    if (done % 100 === 0 || done === todo.length) {
      saveCache(cache);
      process.stdout.write('\r  looked up ' + done + '/' + todo.length + ' — ' + found + ' covers found   ');
    }
  });
  if (todo.length) process.stdout.write('\n');
  saveCache(cache);

  applyToShards(manifest, cache);
}

function isbnsOf(rec) {
  const out = [];
  for (const entry of rec.isbns || []) {
    for (const v of [entry.isbn13, entry.isbn10]) if (v && !out.includes(v)) out.push(v);
  }
  if (rec.isbn && !out.includes(rec.isbn)) out.unshift(rec.isbn);
  return out;
}

function coverUrl(isbn) {
  return 'https://books.google.com/books/content?vid=ISBN' + isbn + '&printsec=frontcover&img=1&zoom=1';
}

/** Returns the cover URL if Google has a real image, otherwise null. */
function probe(isbn) {
  return new Promise((resolve) => {
    const url = coverUrl(isbn);
    const req = https.get(url, { headers: { 'user-agent': 'hk-book-metadata/1.0 (cover resolver)' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve(null);
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        chunks.push(c);
        size += c.length;
        if (size > 2 << 20) req.destroy();
      });
      res.on('end', () => {
        const dim = dimensions(Buffer.concat(chunks));
        if (!dim || dim.w < 5 || PLACEHOLDERS.has(dim.w + 'x' + dim.h)) resolve(null);
        else resolve(url);
      });
      res.on('error', () => resolve(null));
    });
    req.setTimeout(TIMEOUT_MS, () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

/** Reads width/height straight out of the PNG or JPEG header. */
function dimensions(buf) {
  if (buf.length > 24 && buf.toString('latin1', 1, 4) === 'PNG') {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xc3) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

/** Writes the resolved covers into both shard tiers. */
function applyToShards(manifest, cache) {
  let withCover = 0;
  let total = 0;

  for (const ds of manifest.datasets) {
    for (let s = 0; s < ds.files.full.length; s++) {
      const fullPath = path.join(DATA_DIR, ds.files.full[s]);
      const idxPath = path.join(DATA_DIR, ds.files.index[s]);
      const full = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      const idx = JSON.parse(fs.readFileSync(idxPath, 'utf8'));

      for (let i = 0; i < full.length; i++) {
        const rec = full[i];
        total++;
        let hit = null;
        for (const isbn of isbnsOf(rec)) {
          if (cache[isbn]) { hit = cache[isbn]; break; }
        }
        if (hit) {
          withCover++;
          rec.cover = { url: hit, source: 'googlebooks' };
          if (idx[i]) idx[i].cover = hit;
        } else {
          if (rec.cover && rec.cover.source === 'googlebooks') delete rec.cover;
          if (idx[i] && idx[i].cover && /books\.google/.test(idx[i].cover)) delete idx[i].cover;
        }
      }

      fs.writeFileSync(fullPath, JSON.stringify(full));
      fs.writeFileSync(idxPath, JSON.stringify(idx));
    }
  }

  // Tells the site the lookups are already done, so it stops probing per visit.
  manifest.coversResolvedAt = new Date().toISOString();
  manifest.coversFound = withCover;
  fs.writeFileSync(path.join(DATA_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log(
    '\n✓ ' + withCover.toLocaleString('en-US') + ' of ' + total.toLocaleString('en-US') +
      ' records have a real cover (' + Math.round((100 * withCover) / total) + '%)'
  );
  console.log('  The rest get a generated cover, with no lookup at page load.');
}

async function pool(items, size, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await worker(items[next++]);
  });
  await Promise.all(runners);
}

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  } catch (err) {
    return {};
  }
}

function saveCache(cache) {
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify(cache));
}
