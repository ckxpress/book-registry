'use strict';

const { parseCsvRecords } = require('../lib/csv');
const { lookupOf, pick } = require('../lib/fields');
const { buildRecord } = require('../lib/record');
const { contributors, isThesis } = require('../lib/marc-name');

/**
 * 國家圖書館館藏書目資訊 — what the National Central Library accessioned in one
 * year, published on data.gov.tw as dataset 27311 under the Open Government
 * Data License v1.0.
 *
 * Why it matters here: of its 118,154 records, **62,891 were published between
 * 2017 and 2023** — precisely the stretch where this catalogue's Taiwanese
 * coverage begins only in 2024, because the ISBN feed's archive starts there.
 * A further 21,479 predate 2017, with imprint years running back to 1600.
 *
 * Two things to hold in mind about what this file is.
 *
 * It is an *accessions* list, not a catalogue: every row carries 年度 2024, the
 * year the library took the book in, while the publication year is whatever it
 * is. So it says what the NCL acquired, not what Taiwan published.
 *
 * And 45% of it is not Taiwanese. A national library collects widely, so
 * Duke University Press and Cadogan appear alongside 崧博出版. That is kept
 * rather than filtered: a national library's holdings are a reasonable thing
 * to catalogue, and the place facet already separates them.
 */
const ALIASES = {
  accessionYear: ['年度'],
  ref: ['系統號'],
  title: ['題名'],
  authors: ['作者'],
  isbn: ['ISBN'],
  imprint: ['出版項'],
  year: ['出版年'],
};

function parse(ctx) {
  const { records } = parseCsvRecords(ctx.text);

  const out = [];
  for (const row of records) {
    const l = lookupOf(row);
    const title = pick(l, ALIASES.title);
    if (!title) continue;

    const imprint = splitImprint(pick(l, ALIASES.imprint));
    const rawAuthor = pick(l, ALIASES.authors);

    out.push(
      buildRecord(
        {
          title: title,
          authors: contributors(rawAuthor),
          place: imprint.place,
          publisher: imprint.publisher,
          year: pick(l, ALIASES.year) || imprint.year,
          // "(平裝)" is a binding note with no number in it, and the shared
          // parser returns nothing for it rather than inventing an ISBN.
          isbn: pick(l, ALIASES.isbn),
          language: languageOf(title),
          // The catalogue's own record number, which makes a row traceable
          // back to the library.
          ref: pick(l, ALIASES.ref),
          classification: isThesis(rawAuthor) ? '學位論文' : '',
          notes: notesFrom(pick(l, ALIASES.accessionYear), imprint.raw),
        },
        ctx
      )
    );
  }
  return out;
}

/**
 * 出版項 is the whole imprint in one string, in ISBD order:
 *
 *   "Durham : Duke University Press, 2019."
 *   "[長沙市] : 商務印書館, 民28.12[1939.12]"
 *   "民112.07[2023.07]"            — date only, no place or publisher
 *   "民112.06[.]"                  — a date whose Western form was never filled in
 *
 * Place and publisher are split on " : ", and the trailing date is dropped
 * because 出版年 already carries the parsed year. A string with no " : " is a
 * bare date and yields neither.
 */
function splitImprint(raw) {
  const text = String(raw || '').trim();
  const out = { place: '', publisher: '', year: '', raw: text };
  if (!text) return out;

  const at = text.indexOf(' : ');
  if (at === -1) {
    // No place/publisher, just a date — "民112.07[2023.07]".
    const m = /(1[5-9]\d{2}|20\d{2})/.exec(text);
    if (m) out.year = m[1];
    return out;
  }

  out.place = text.slice(0, at).trim();

  let rest = text.slice(at + 3).trim();
  // ", 2019." or ", 民113.06[.]" — the date, on the end after the last comma.
  const comma = rest.lastIndexOf(',');
  if (comma !== -1) {
    const tail = rest.slice(comma + 1);
    if (/\d/.test(tail)) {
      const m = /(1[5-9]\d{2}|20\d{2})/.exec(tail);
      if (m) out.year = m[1];
      rest = rest.slice(0, comma);
    }
  }
  out.publisher = rest.replace(/[.,;:\s]+$/, '').trim();
  return out;
}

/** Same reasoning as the NBINet adapter: read the script, never guess Latin. */
const KANA = /[぀-ヿ]/;
const HANGUL = /[가-힯ᄀ-ᇿ]/;
const HAN = /[㐀-䶿一-鿿豈-﫿]/;

function languageOf(title) {
  const t = String(title || '');
  if (KANA.test(t)) return 'ja';
  if (HANGUL.test(t)) return 'ko';
  if (HAN.test(t)) return 'zh';
  return '';
}

/**
 * The accession year is worth keeping — it is the one thing that says what
 * this file is a list of — and the raw imprint is kept when it holds a ROC
 * date the parsed year does not show ("民28.12[1939.12]").
 */
function notesFrom(accessionYear, imprint) {
  const parts = [];
  const year = String(accessionYear || '').trim();
  if (year) parts.push('國圖入藏年度：' + year);
  if (/民\s*\d/.test(imprint || '')) parts.push('出版項：' + imprint.trim());
  return parts.join('；');
}

module.exports = {
  parse,
  id: 'ncl-holdings',
  label: '國家圖書館館藏書目資訊 (國家圖書館, CSV)',
};
