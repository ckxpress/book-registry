#!/usr/bin/env node
'use strict';

/** Zero-dependency static server for site/. Usage: npm start [-- --port 8080] */

const fs = require('fs');
const path = require('path');
const http = require('http');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..', 'site');
const PORT = Number(process.env.PORT || argValue('--port') || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (err) {
    res.writeHead(400).end('Bad request');
    return;
  }

  if (pathname.endsWith('/')) pathname += 'index.html';

  const file = path.join(ROOT, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found: ' + pathname);
      return;
    }

    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    // Dev server: never cache, so an edit is always the thing you reload.
    const headers = {
      'content-type': type,
      'cache-control': 'no-store, max-age=0',
      'last-modified': stat.mtime.toUTCString(),
    };
    const compressible = /json|text|javascript|svg/.test(type);
    const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');

    if (compressible && acceptsGzip) {
      headers['content-encoding'] = 'gzip';
      res.writeHead(200, headers);
      fs.createReadStream(file).pipe(zlib.createGzip()).pipe(res);
    } else {
      headers['content-length'] = stat.size;
      res.writeHead(200, headers);
      fs.createReadStream(file).pipe(res);
    }
  });
});

server.listen(PORT, () => {
  const manifest = path.join(ROOT, 'data', 'manifest.json');
  if (!fs.existsSync(manifest)) {
    console.log('! No data yet — run `npm run import` first.\n');
  }
  console.log('Book metadata site → http://localhost:' + PORT + '\n');
});

function argValue(name) {
  const at = process.argv.indexOf(name);
  return at === -1 ? null : process.argv[at + 1];
}
