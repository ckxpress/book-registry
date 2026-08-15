'use strict';

const { parseCsvRecords } = require('../lib/csv');
const { lookupOf, pick, pickList } = require('../lib/fields');
const { buildRecord } = require('../lib/record');

/**
 * "A Catalogue of Books Printed in Hong Kong" — the quarterly ISBN /
 * book-registration catalogue from the Books Registration Office (LCSD),
 * published on DATA.GOV.HK as one CSV per quarter per language.
 *
 * Column names drift between quarters (2025 Q3 ships "B: Author 1", "ISBN"
 * and a trailing blank column), so every field is matched by alias.
 */
const ALIASES = {
  serial: ['serial number', 'catalog serial number', '順序編號'],
  author: ['author', '著者'],
  title: ['title', '書刊名'],
  edition: ['edition', '版次'],
  frequency: ['frequency', '出版刊期'],
  place: ['place of publication', '出版地'],
  publisher: ['publisher', '出版者'],
  year: ['year', '出版年份'],
  series: ['series title', 'series', '叢書名'],
  physical: ['physical description', '著錄'],
  classification: ['classifications', 'classification', '類別'],
  notes: ['notes', '附註'],
  isbn: ['international standard book number', 'isbn', '國際標準書號'],
  issn: ['international standard serial number', 'issn', '國際標準期刊號'],
  forSale: ['for sale/not for sale', 'for sale / not for sale', '售賣品/非賣品'],
  price: ['price', '定價'],
  ref: ['reference number', 'bro number', '參考編號'],
};

function parse(ctx) {
  const { records } = parseCsvRecords(ctx.text);
  const language = ctx.source.language || guessLanguage(ctx.source.url || ctx.source.file || '');

  return records.map((row) => {
    const l = lookupOf(row);
    return buildRecord(
      {
        serial: pick(l, ALIASES.serial),
        authors: pickList(l, ALIASES.author, 10),
        title: pick(l, ALIASES.title),
        edition: pick(l, ALIASES.edition),
        frequency: pick(l, ALIASES.frequency),
        place: pick(l, ALIASES.place),
        publisher: pick(l, ALIASES.publisher),
        year: pick(l, ALIASES.year),
        series: pick(l, ALIASES.series),
        physical: pick(l, ALIASES.physical),
        classification: pick(l, ALIASES.classification),
        notes: pick(l, ALIASES.notes),
        isbn: pick(l, ALIASES.isbn),
        issn: pick(l, ALIASES.issn),
        forSale: pick(l, ALIASES.forSale),
        price: pick(l, ALIASES.price),
        ref: pick(l, ALIASES.ref),
        language: language,
      },
      ctx
    );
  });
}

/** Filenames end in ...Q1c.csv (Chinese) / ...Q1e.csv (English). */
function guessLanguage(name) {
  const m = String(name).match(/Q[1-4]([ce])\.csv$/i);
  if (!m) return '';
  return m[1].toLowerCase() === 'c' ? 'zh' : 'en';
}

module.exports = { parse, id: 'hkpl-bro', label: 'HKPL Books Registration Office catalogue (CSV)' };
