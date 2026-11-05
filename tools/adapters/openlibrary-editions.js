'use strict';

const { buildRecord } = require('../lib/record');

/**
 * Open Library editions, as returned by its `query.json` API.
 *
 * This is the only source here that is not an official registry: it is
 * crowd-sourced and derived from donated MARC records, so it is imported as a
 * dataset of its own and never merged into the others. What it buys is the one
 * thing the registries cannot give — Hong Kong books published before the
 * registration catalogue begins in 2017.
 *
 * It had to be `query.json` rather than the modern search API. `search.json`
 * indexes *works*, so `publish_place:"Hong Kong"` matches any work with one
 * Hong Kong edition among many, and the edition it hands back is not
 * necessarily that one — the first result for Hong Kong was Dead Poets Society
 * as a Bantam Books paperback. `query.json` filters editions themselves.
 *
 * Expect thin records. Measured over 500 Hong Kong editions: titles, dates and
 * publishers are near-complete, but only about a quarter carry an ISBN and
 * almost none carry a cover, which is what books from the 1970s and 80s look
 * like. Author names often arrive romanised even for Chinese titles, because
 * that is how the underlying MARC was transliterated.
 */
function parse(ctx) {
  var rows;
  try {
    rows = JSON.parse(ctx.text);
  } catch (err) {
    throw new Error('expected a JSON array from query.json: ' + err.message);
  }
  if (!Array.isArray(rows)) throw new Error('expected a JSON array, got ' + typeof rows);

  const out = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;

    const year = parseYear(row.publish_date);
    // 2017 onwards is the registration catalogue's own territory, and it
    // records it better. Records with no readable year are kept: the pool is
    // overwhelmingly old, and "19uu" is a date, just not a precise one.
    if (year !== null && year >= FIRST_REGISTERED_YEAR) continue;

    const rec = buildRecord(
      {
        title: str(row.title),
        subtitle: str(row.subtitle),
        authors: splitByStatement(row.by_statement),
        publisher: first(row.publishers),
        place: hongKongSpelling(row.publish_places) || (ctx.source && ctx.source.place) || '',
        year: str(row.publish_date),
        edition: str(row.edition_name),
        series: first(row.series),
        isbn: first(row.isbn_13) || first(row.isbn_10),
        physical: physicalFrom(row),
        language: languageCode(row.languages),
        notes: notesFrom(row),
        coverUrl: coverUrl(row.covers),
        // The edition key is stable and unique, which is what makes importing
        // the same edition under two spellings of its place harmless.
        ref: keyOf(row.key),
      },
      ctx
    );
    // A handful of records are catalogued with a placeholder for a title — "."
    // or "()" from a government printer. Checked on the built record rather
    // than the raw field, because the shared title parser splits parallel and
    // sub titles off first: "() = Jian jie ji ben fa" has a letter in the raw
    // string but a placeholder for its actual title.
    //
    // Any letter or number in any script, because the scripts here are not only
    // Latin and Chinese — 현대조선말사전 is a real title a CJK-only test discards.
    if (!/[\p{L}\p{N}]/u.test(rec.title || '')) continue;

    out.push(rec);
  }
  return out;
}

/** The first year the Hong Kong registration catalogue covers. */
const FIRST_REGISTERED_YEAR = 2017;

function keyOf(key) {
  const m = /\/books\/(OL\d+M)/.exec(String(key || ''));
  return m ? m[1] : '';
}

function str(value) {
  return value === null || value === undefined ? '' : String(value);
}

function first(value) {
  if (Array.isArray(value)) return value.length ? str(value[0]) : '';
  return str(value);
}

/**
 * "Zhou Yingde, Li Zhenzhong, Dai Zhenhui bian" — the transcribed statement of
 * responsibility, with the role on the end. Split on commas and drop the
 * trailing role word, romanised or Chinese.
 */
const ROLE = /\s+(bian|zhu|zhu bian|yi|zhuan|ji|xuan|bian zhu|deng|zhubian|editor|editors|ed|eds|compiler|compiled|trans|translator)\.?$/i;
const ROLE_CJK = /(編著|編輯|主編|編譯|合著|編選|著|作|編|譯|撰|繪)$/;

function splitByStatement(raw) {
  const text = str(raw).trim();
  if (!text) return [];
  return text
    .split(/[,，、;；]| and /)
    .map(function (part) {
      const name = part.trim().replace(ROLE, '').replace(ROLE_CJK, '').trim();
      return name;
    })
    .filter(Boolean)
    .filter(function (name) {
      // A statement sometimes ends in a bare role with no name attached.
      return name.length > 1 && !/^(bian|zhu|yi|deng|ed|eds)$/i.test(name);
    });
}

/** Prefer whichever spelling of Hong Kong the record actually used. */
function hongKongSpelling(places) {
  const list = Array.isArray(places) ? places : [places];
  for (const place of list) {
    if (/hong\s*kong|kowloon|香港/i.test(str(place))) return str(place).trim();
  }
  return first(places);
}

/** "/languages/chi" -> zh, so the facet lines up with the other datasets. */
const LANGUAGES = {
  chi: 'zh', zho: 'zh', cmn: 'zh', yue: 'zh',
  eng: 'en', jpn: 'ja', kor: 'ko', fre: 'fr', fra: 'fr',
  ger: 'de', deu: 'de', spa: 'es', vie: 'vi', tha: 'th', ind: 'id',
};

function languageCode(languages) {
  const list = Array.isArray(languages) ? languages : [languages];
  for (const entry of list) {
    const key = entry && entry.key ? entry.key : entry;
    const m = /\/languages\/([a-z]{2,3})/.exec(str(key));
    if (m && LANGUAGES[m[1]]) return LANGUAGES[m[1]];
  }
  return '';
}

/**
 * `pagination` is the transcribed extent ("xii, 211 p."), `number_of_pages` the
 * parsed count. Prefer the transcription and fall back to the count, so the
 * shared parser sees something it can read a page count out of.
 */
function physicalFrom(row) {
  const pagination = str(row.pagination).trim();
  if (pagination) return pagination;
  const pages = row.number_of_pages;
  return typeof pages === 'number' && pages > 0 ? pages + ' p.' : '';
}

function notesFrom(row) {
  const subjects = (Array.isArray(row.subjects) ? row.subjects : [])
    .map(str)
    .map(function (s) { return s.trim(); })
    .filter(Boolean);
  if (!subjects.length) return '';
  return '主題：' + subjects.slice(0, 12).join('、');
}

function coverUrl(covers) {
  const list = Array.isArray(covers) ? covers : [covers];
  for (const id of list) {
    if (typeof id === 'number' && id > 0) {
      return 'https://covers.openlibrary.org/b/id/' + id + '-L.jpg';
    }
  }
  return '';
}

/** "1988", "19uu", "c1974", "民國六十三年" — take the first real four digits. */
function parseYear(raw) {
  const m = /(1[5-9]\d{2}|20\d{2})/.exec(str(raw));
  return m ? Number(m[1]) : null;
}

module.exports = {
  parse,
  id: 'openlibrary-editions',
  label: 'Open Library editions (query.json)',
};
