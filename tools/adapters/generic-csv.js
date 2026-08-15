'use strict';

const { parseCsvRecords } = require('../lib/csv');
const { lookupOf, pick, pickList } = require('../lib/fields');
const { buildRecord } = require('../lib/record');

/**
 * Any CSV of books. Columns are matched by common aliases, so most exports
 * (Goodreads, Calibre, a library system, a spreadsheet) import as-is.
 * Unrecognised columns are kept verbatim under `extra` so nothing is lost.
 */
const ALIASES = {
  title: ['title', 'book title', 'name', '書名', '書刊名'],
  subtitle: ['subtitle', 'sub title', '副標題'],
  author: ['author', 'authors', 'creator', 'by', '作者', '著者'],
  publisher: ['publisher', 'imprint', '出版者', '出版社'],
  place: ['place of publication', 'place', 'city', '出版地'],
  year: ['year', 'date', 'publication date', 'published', 'date published', 'pubdate', '出版年份', '出版日期'],
  edition: ['edition', '版次'],
  frequency: ['frequency', '出版刊期'],
  series: ['series', 'series title', '叢書名'],
  physical: ['physical description', 'pages', 'page count', 'extent', '著錄', '頁數'],
  classification: ['classification', 'classifications', 'category', 'subject', 'genre', 'shelf', '類別'],
  notes: ['notes', 'note', 'comments', '附註'],
  description: ['description', 'summary', 'abstract', 'synopsis', 'blurb', '簡介', '內容簡介'],
  isbn: ['isbn', 'isbn13', 'isbn-13', 'isbn10', 'isbn-10', 'international standard book number', '國際標準書號'],
  issn: ['issn', 'international standard serial number', '國際標準期刊號'],
  price: ['price', 'list price', 'retail price', '定價'],
  forSale: ['for sale/not for sale', 'availability', 'for sale', '售賣品/非賣品'],
  language: ['language', 'lang', '語言'],
  ref: ['id', 'identifier', 'reference number', 'record id', '參考編號'],
  coverUrl: ['cover', 'cover url', 'cover image', 'image', 'image url', 'thumbnail', '封面'],
  copyright: ['copyright', 'copyright statement', 'rights', '版權'],
};

const KNOWN = new Set();
for (const key of Object.keys(ALIASES)) {
  for (const alias of ALIASES[key]) KNOWN.add(alias.toLowerCase());
  for (let i = 1; i <= 10; i++) {
    for (const alias of ALIASES[key]) KNOWN.add((alias + ' ' + i).toLowerCase());
  }
}

function parse(ctx) {
  const { records } = parseCsvRecords(ctx.text);

  return records.map((row) => {
    const l = lookupOf(row);
    const rec = buildRecord(
      {
        title: pick(l, ALIASES.title),
        subtitle: pick(l, ALIASES.subtitle),
        authors: pickList(l, ALIASES.author, 10),
        publisher: pick(l, ALIASES.publisher),
        place: pick(l, ALIASES.place),
        year: pick(l, ALIASES.year),
        edition: pick(l, ALIASES.edition),
        frequency: pick(l, ALIASES.frequency),
        series: pick(l, ALIASES.series),
        physical: pick(l, ALIASES.physical),
        classification: pick(l, ALIASES.classification),
        notes: pick(l, ALIASES.notes),
        description: pick(l, ALIASES.description),
        isbn: pick(l, ALIASES.isbn),
        issn: pick(l, ALIASES.issn),
        price: pick(l, ALIASES.price),
        forSale: pick(l, ALIASES.forSale),
        language: normLanguage(pick(l, ALIASES.language)) || ctx.source.language || '',
        ref: pick(l, ALIASES.ref),
        coverUrl: pick(l, ALIASES.coverUrl),
        copyright: pick(l, ALIASES.copyright),
      },
      ctx
    );

    const extra = {};
    for (const key of Object.keys(row)) {
      if (key === '__raw') continue;
      if (KNOWN.has(key)) continue;
      const value = String(row[key] || '').trim();
      if (value) extra[key] = value;
    }
    if (Object.keys(extra).length) rec.extra = extra;

    return rec;
  });
}

function normLanguage(value) {
  const v = String(value || '').toLowerCase();
  if (!v) return '';
  if (/^(zh|chi|chinese|中文|繁體|简体|簡體)/.test(v)) return 'zh';
  if (/^(en|eng|english|英文)/.test(v)) return 'en';
  return v.slice(0, 8);
}

module.exports = { parse, ALIASES, id: 'generic-csv', label: 'Generic book CSV (auto-mapped columns)' };
