'use strict';

/**
 * Column-name matching that survives the upstream renames: headers are
 * compared with punctuation and whitespace stripped, so "ISBN",
 * "International Standard Book Number" and "國際標準書號" all resolve.
 */
function lookupOf(record) {
  const map = new Map();
  for (const key of Object.keys(record)) {
    if (key === '__raw') continue;
    map.set(squash(key), record[key]);
  }
  return map;
}

function squash(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[\s._\-/\\()[\]:;,'"?]+/g, '');
}

function pick(lookup, aliases) {
  for (const alias of aliases) {
    const value = lookup.get(squash(alias));
    if (value !== undefined && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

/** Collect numbered columns: author 1..10 / 著者1..10 / authors. */
function pickList(lookup, aliases, max) {
  const out = [];
  const limit = max || 10;
  for (const alias of aliases) {
    const single = lookup.get(squash(alias));
    if (single !== undefined && String(single).trim() !== '') {
      String(single)
        .split(/\s*[;|]\s*/)
        .forEach((part) => out.push(part));
    }
    for (let i = 1; i <= limit; i++) {
      const value = lookup.get(squash(alias + ' ' + i));
      if (value !== undefined && String(value).trim() !== '') out.push(String(value));
    }
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

module.exports = { lookupOf, pick, pickList, squash };
