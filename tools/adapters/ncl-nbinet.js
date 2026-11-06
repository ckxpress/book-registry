'use strict';

const { parseCsvRecords } = require('../lib/csv');
const { lookupOf, pick } = require('../lib/fields');
const { buildRecord } = require('../lib/record');
const { contributors } = require('../lib/marc-name');

/**
 * 全國圖書書目資訊網（NBINet）圖書聯合目錄 — the Taiwanese union catalogue,
 * published quarterly on data.gov.tw as dataset 7502 under the Open Government
 * Data License v1.0.
 *
 * This is the best Taiwanese bibliographic data the project has. Measured over
 * the 115年第3季 file, 18,519 records: 96% Taiwanese imprints and **99.1% of
 * titles in Chinese characters** — against 4% in the Open Library set, where a
 * CJK query cannot match a romanised title at all.
 *
 * Unlike 臺灣出版新書預告書訊, which records books *announced* via an ISBN
 * application before publication, these are catalogue records for books that
 * exist and sit on a shelf somewhere. 館藏地及索書號 names the library and its
 * call number, which no other dataset here supplies.
 *
 * The catch is depth. The dataset page offers only the current quarter and
 * overwrites it each time, so a single file is mostly recent: 71% of this one
 * is 2024 or later. The earlier quarters exist — the dataset has been listed
 * since 2013 — but are not served. docs/ncl-nbinet-followup.md asks for them.
 */
const ALIASES = {
  isbn: ['ISBN'],
  title: ['題名'],
  authors: ['編著者'],
  edition: ['版次'],
  place: ['出版地'],
  publisher: ['出版者'],
  physical: ['面頁數尺寸'],
  series: ['集叢'],
  year: ['出版年'],
  holdings: ['館藏地及索書號'],
};

function parse(ctx) {
  const { records } = parseCsvRecords(ctx.text);

  const out = [];
  for (const row of records) {
    const l = lookupOf(row);
    const title = pick(l, ALIASES.title);
    // A handful of rows carry a call number and nothing else.
    if (!title) continue;

    out.push(
      buildRecord(
        {
          title: title,
          // One contributor per row, never a list — see lib/marc-name.js.
          authors: contributors(pick(l, ALIASES.authors)),
          edition: pick(l, ALIASES.edition),
          // "臺北市 :" — ISBD punctuation the shared trimEnd takes off.
          place: pick(l, ALIASES.place),
          publisher: pick(l, ALIASES.publisher),
          // "730面 : 圖, 表 ; 24公分". The shared parser keeps the raw string
          // and reads the dimensions; it does not count 面 as pages, so the
          // page count stays unset rather than wrong.
          physical: pick(l, ALIASES.physical),
          series: pick(l, ALIASES.series),
          year: pick(l, ALIASES.year),
          // "9789861008486; 9861008489" — the 13 and 10 digit forms of one
          // ISBN, which the shared parser pairs up by itself.
          isbn: pick(l, ALIASES.isbn),
          language: languageOf(title),
          notes: holdingsNote(pick(l, ALIASES.holdings)),
        },
        ctx
      )
    );
  }
  return out;
}

/**
 * The file states no language, so it is read off the script of the title.
 *
 * Kana and hangul are decisive — Chinese never uses them — so those are
 * reported. Han characters alone mean Chinese here, in a catalogue that is 96%
 * Taiwanese imprints. A title in Latin script is left unset rather than
 * guessed at: it could be English, German or romanised Chinese, and an empty
 * language is honest where `en` would be a fabrication the facet then presents
 * as fact.
 */
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
 * "桃園市立圖書館;947.41 4403" — a holding library and its call number, and
 * sometimes several, separated by semicolons and newlines. Which libraries
 * hold a book is the one thing this dataset knows that the others do not, so
 * it is kept rather than dropped, but it has no home in the record shape and
 * goes into the notes.
 */
function holdingsNote(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';

  const parts = text
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const seen = [];
  for (const part of parts) {
    const at = part.indexOf(';');
    const library = (at === -1 ? part : part.slice(0, at)).trim();
    if (library && seen.indexOf(library) === -1) seen.push(library);
  }
  if (!seen.length) return '';

  const shown = seen.slice(0, 6).join('、');
  return '館藏：' + shown + (seen.length > 6 ? ` 等 ${seen.length} 館` : '');
}

module.exports = {
  parse,
  id: 'ncl-nbinet',
  label: '全國圖書書目資訊網 NBINet 圖書聯合目錄 (國家圖書館, CSV)',
};
