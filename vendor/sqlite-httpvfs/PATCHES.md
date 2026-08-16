# Local changes to the vendored build

Upstream: [sql.js-httpvfs](https://github.com/phiresky/sql.js-httpvfs) 0.8.12 (MIT).
`index.js`, `sqlite.worker.js` and `sql-wasm.wasm` are the published dist files.

## sqlite.worker.js — accept an explicit file length in `full` server mode

```diff
- fileLength:"chunked"===e.serverMode?e.databaseLengthBytes:void 0
+ fileLength:e.databaseLengthBytes
```

In `full` mode the library discovers the database size from the
`content-length` of a HEAD request. GitHub Pages answers HEAD over HTTP/2
without that header, so startup failed with "Length of the file not known"
on the deployed site while working locally.

The database size is already recorded in `site/data/manifest.json` when the
database is built, so the site passes it as `databaseLengthBytes`. Hosts that
do return `content-length` are unaffected — the value is simply used instead
of being rediscovered.

Re-apply this after any upgrade of the vendored files.
