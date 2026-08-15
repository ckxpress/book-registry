'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const zlib = require('zlib');

const CACHE_DIR = path.join(__dirname, '..', '..', 'cache');

/**
 * Download a URL to the local cache and return its text. Uses only Node
 * built-ins so the importer runs with no npm install on any Node >= 12.
 */
function download(url, options) {
  const opts = options || {};
  const cacheFile = path.join(CACHE_DIR, cacheName(url));

  if (!opts.refresh && fs.existsSync(cacheFile)) {
    return Promise.resolve({ body: fs.readFileSync(cacheFile), cached: true, cacheFile });
  }

  return get(url, 0).then((buffer) => {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cacheFile, buffer);
    return { body: buffer, cached: false, cacheFile };
  });
}

function get(url, depth) {
  if (depth > 5) return Promise.reject(new Error('Too many redirects for ' + url));

  return new Promise((resolve, reject) => {
    const lib = url.startsWith('http://') ? http : https;
    const req = lib.get(
      url,
      {
        headers: {
          'user-agent': 'hk-book-metadata-importer/1.0 (+local static site build)',
          accept: '*/*',
          'accept-encoding': 'gzip, deflate',
        },
        timeout: 120000,
      },
      (res) => {
        const status = res.statusCode || 0;

        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          resolve(get(next, depth + 1));
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(new Error('HTTP ' + status + ' for ' + url));
          return;
        }

        const encoding = String(res.headers['content-encoding'] || '').toLowerCase();
        let stream = res;
        if (encoding === 'gzip') stream = res.pipe(zlib.createGunzip());
        else if (encoding === 'deflate') stream = res.pipe(zlib.createInflate());

        const chunks = [];
        stream.on('data', (c) => chunks.push(c));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
      }
    );

    req.on('timeout', () => req.destroy(new Error('Timed out fetching ' + url)));
    req.on('error', reject);
  });
}

/** Decode a downloaded buffer, sniffing the encodings this data actually ships in. */
function decode(buffer, hint) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.toString('utf16le').replace(/^﻿/, '');
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer);
    swapped.swap16();
    return swapped.toString('utf16le').replace(/^﻿/, '');
  }

  const utf8 = buffer.toString('utf8');
  if (!utf8.includes('�')) return utf8.replace(/^﻿/, '');

  // Invalid UTF-8: legacy Chinese CSVs are usually Big5, which Node cannot
  // decode without ICU. Say so plainly instead of writing mojibake.
  throw new Error(
    'Could not decode ' + (hint || 'file') + ' as UTF-8. Re-save the source as UTF-8 and import it with --file.'
  );
}

function cacheName(url) {
  const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 10);
  const base = decodeURIComponent(url.split('/').pop() || 'download').split('?')[0];
  const safe = base.replace(/[^A-Za-z0-9._-]/g, '_').slice(-60) || 'download';
  return hash + '-' + safe;
}

module.exports = { download, decode, CACHE_DIR };
