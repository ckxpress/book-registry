'use strict';

const { lookupOf, pick, pickList } = require('../lib/fields');
const { buildRecord } = require('../lib/record');
const generic = require('./generic-csv');

/**
 * A JSON array of book objects (or { records: [...] } / { data: [...] }).
 * Keys are matched with the same aliases as the generic CSV adapter.
 */
function parse(ctx) {
  const data = JSON.parse(ctx.text);
  const rows = Array.isArray(data)
    ? data
    : data.records || data.data || data.results || data.items || data.books || [];

  if (!Array.isArray(rows)) throw new Error('JSON source did not contain an array of records');

  return rows.map((row) => {
    const flat = {};
    for (const key of Object.keys(row)) {
      const value = row[key];
      flat[key] = Array.isArray(value) ? value.join('; ') : value === null ? '' : String(value);
    }
    const l = lookupOf(flat);
    const A = generic.ALIASES;

    return buildRecord(
      {
        title: pick(l, A.title),
        subtitle: pick(l, A.subtitle),
        authors: pickList(l, A.author, 10),
        publisher: pick(l, A.publisher),
        place: pick(l, A.place),
        year: pick(l, A.year),
        edition: pick(l, A.edition),
        series: pick(l, A.series),
        physical: pick(l, A.physical),
        classification: pick(l, A.classification),
        notes: pick(l, A.notes),
        description: pick(l, A.description),
        isbn: pick(l, A.isbn),
        issn: pick(l, A.issn),
        price: pick(l, A.price),
        forSale: pick(l, A.forSale),
        language: pick(l, A.language) || ctx.source.language || '',
        ref: pick(l, A.ref),
        coverUrl: pick(l, A.coverUrl),
        copyright: pick(l, A.copyright),
      },
      ctx
    );
  });
}

module.exports = { parse, id: 'json', label: 'Generic book JSON (auto-mapped keys)' };
