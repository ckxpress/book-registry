#!/usr/bin/env node
'use strict';

/**
 * Writes, to stdout, the manifest as the *published site* should carry it.
 *
 * The repository keeps the full JSON shards: `tools/build-sqlite.js` reads them
 * to build the database and `tools/resolve-covers.js` reads them to write cover
 * URLs back. The published site does not need them. In SQLite mode — which is
 * how the site runs — a full shard is never fetched; `fetchFull()` only reaches
 * for one in JSON-fallback mode, and already degrades to the index row when
 * there is none.
 *
 * Why it matters: those shards were 369 MB of the 462 MB published site, and
 * "GitHub Pages deployments will timeout if they take longer than 10 minutes."
 * On 6 Nov 2026 the 462 MB deploy failed at 10m14s, leaving the site on the
 * previous build while `deploy.sh` reported success. Dropping them takes the
 * published site to about 93 MB, and leaves room under the separate 1 GB
 * published-site limit as the catalogue grows.
 *
 * What is lost: in JSON-fallback mode a book's detail page shows the index
 * row's fields rather than the full record. Browsing, searching and faceting
 * all still work from the index shards.
 */
const fs = require('fs');
const path = require('path');

const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'site', 'data', 'manifest.json'), 'utf8')
);

for (const ds of manifest.datasets || []) {
  if (ds.files) delete ds.files.full;
}
manifest.publishedWithout = 'files.full';

process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
