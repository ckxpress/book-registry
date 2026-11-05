'use strict';

const { parseCsvRecords } = require('../lib/csv');
const { lookupOf, pick } = require('../lib/fields');
const { buildRecord } = require('../lib/record');

/**
 * 臺灣出版新書預告書訊 — the monthly feed of ISBN applications made to the
 * National Central Library's ISBN centre, published on data.gov.tw as one
 * UTF-8 CSV per month.
 *
 * Unlike the Hong Kong catalogue, which records books *printed*, this records
 * books *announced*: the row exists because a publisher applied for an ISBN
 * before publishing, and 預訂出版日 is an intended date. Roughly two fifths of
 * the rows are 數位平台電子書 rather than print, so the material type is kept
 * in the notes rather than silently presenting an ebook as a printed book.
 */
const ALIASES = {
  title: ['申請書名', '書名'],
  author: ['作者'],
  publisher: ['出版機構'],
  publisherType: ['出版機構類型'],
  edition: ['版次'],
  date: ['預訂出版日'],
  subject: ['標題'],
  deweyish: ['分類號'],
  isbn: ['ISBN', '國際標準書號'],
  format: ['開數'],
  pages: ['頁數'],
  awards: ['得獎紀錄'],
  materialType: ['資料類型'],
  shelf: ['建議上架分類'],
  language: ['作品語文'],
  languageOther: ['作品語文(其他)'],
  theme: ['圖書主題'],
  audience: ['適讀對象'],
  rating: ['分級註記'],
  price: ['定價'],
  binding: ['裝訂方式'],
  bindingOther: ['其他裝訂方式'],
  form: ['出版形式'],
  keywords: ['關鍵字'],
};

function parse(ctx) {
  const { records } = parseCsvRecords(ctx.text);

  return records.map((row) => {
    const l = lookupOf(row);
    const pages = pick(l, ALIASES.pages);
    const format = pick(l, ALIASES.format);

    const titleParts = splitTitle(pick(l, ALIASES.title));

    return buildRecord(
      {
        title: titleParts.title,
        subtitle: titleParts.subtitle,
        authors: splitAuthors(pick(l, ALIASES.author)),
        publisher: pick(l, ALIASES.publisher),
        // Not a column. An ISBN registered with the NCL is a Taiwanese
        // imprint, and the generated description reads as a sentence only
        // with a place in it, so it is stated rather than left blank.
        place: '臺灣',
        year: publicationDate(pick(l, ALIASES.date)),
        edition: pick(l, ALIASES.edition),
        // The shelving category, not 分類號. Its vocabulary (小說, 人文史地,
        // 藝術) is the same kind of thing as the Hong Kong catalogue's 類別,
        // so the two datasets share one facet instead of splitting it between
        // words and Dewey numbers. 分類號 is kept in the notes.
        classification: pick(l, ALIASES.shelf),
        // "144 頁" parses to a page count; "22開" is a paper format, not a
        // measurement, so it stays in the raw string and sets no dimensions.
        physical: [pages && pages + ' 頁', format && format + '開'].filter(Boolean).join('; '),
        isbn: pick(l, ALIASES.isbn),
        price: pick(l, ALIASES.price),
        language: languageCode(pick(l, ALIASES.language), pick(l, ALIASES.languageOther)),
        notes: notesFrom(l),
      },
      ctx
    );
  });
}

/**
 * 預訂出版日 is written "2026-01-00": the feed commits to a month, not a day,
 * and fills the day with zeroes. Shown as-is it reads like a broken date, so
 * the empty day is dropped and the month kept.
 */
function publicationDate(raw) {
  const text = String(raw || '').trim();
  const m = /^(\d{4})-(\d{2})-0{1,2}$/.exec(text);
  return m ? m[1] + '-' + m[2] : text;
}

/**
 * These titles separate the subtitle with a full-width colon or a bare "): ",
 * where the shared ISBD parser looks for " : " with spaces on both sides. Done
 * here rather than there because a lone colon inside a Hong Kong title is not
 * a subtitle marker, and that parser is shared.
 *
 * Requiring the space after a half-width colon keeps times and ratios ("3:10")
 * intact.
 */
function splitTitle(raw) {
  const text = String(raw || '').trim();
  const at = firstOf(text, ['：', ': ']);
  if (at === -1) return { title: text, subtitle: '' };

  const head = text.slice(0, at).trim();
  const tail = text.slice(text[at] === '：' ? at + 1 : at + 2).trim();
  if (!head || !tail) return { title: text, subtitle: '' };
  return { title: head, subtitle: tail };
}

function firstOf(text, needles) {
  let best = -1;
  for (const needle of needles) {
    const at = text.indexOf(needle);
    if (at !== -1 && (best === -1 || at < best)) best = at;
  }
  return best;
}

/**
 * "王永華, 王思凱著" / "鄭立德作" — names separated by commas or ideographic
 * commas, with the contribution written onto the last one. The role is not
 * part of the name, so it is removed; only a known set is stripped, so a name
 * that happens to end in one of these characters survives if it stands alone.
 */
const ROLE = /(編著作|編著|合著|改作|主編|編輯|編選|編譯|口述|繪圖|插畫|攝影|校注|譯者|作者|著|作|編|譯|繪|撰|註|注)$/;

function splitAuthors(raw) {
  return String(raw || '')
    .split(/[,，、;；]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((name) => {
      const stripped = name.replace(ROLE, '').trim();
      return stripped || name;
    })
    .filter(Boolean);
}

/**
 * 作品語文 is a fixed list, except for "其他 (請在右方欄位中填答)", where the
 * languages are spelled out in the next column.
 */
const LANGUAGES = [
  // "中英對照" / "中法對照" are bilingual parallel texts whose own language is
  // Chinese, and they carry no literal 中文 for the next rule to catch.
  [/中.?對照/, 'zh'],
  [/繁體中文|簡體中文|中文/, 'zh'],
  [/英文/, 'en'],
  [/日文/, 'ja'],
  [/韓文/, 'ko'],
  [/法文/, 'fr'],
  [/德文/, 'de'],
  [/西班牙文/, 'es'],
  [/越南文/, 'vi'],
  [/泰文/, 'th'],
  [/印尼文/, 'id'],
];

function languageCode(value, other) {
  const text = /其他/.test(value) ? other || '' : value || '';

  // Multilingual works list several ("繁體中文 英文", "英文 繁體中文"), and the
  // one named first is the work's own language. So take the earliest mention
  // rather than the first entry in this table, which would always prefer
  // Chinese.
  let best = -1;
  let code = '';
  for (const [pattern, value2] of LANGUAGES) {
    const m = pattern.exec(text);
    if (m && (best === -1 || m.index < best)) {
      best = m.index;
      code = value2;
    }
  }
  return code;
}

/**
 * The columns worth keeping that the record shape has no home for. Assembled
 * in a fixed order so the note reads the same way for every book.
 */
function notesFrom(l) {
  const parts = [];
  const materialType = pick(l, ALIASES.materialType);
  // 圖書 is the ordinary case and says nothing; an ebook or an audio edition
  // very much does.
  if (materialType && materialType !== '圖書') parts.push(materialType);

  const add = (label, value) => {
    if (value) parts.push(label + value);
  };
  add('適讀對象：', pick(l, ALIASES.audience));
  add('分級：', pick(l, ALIASES.rating));
  add('裝訂：', pick(l, ALIASES.binding) === '其他' ? pick(l, ALIASES.bindingOther) : pick(l, ALIASES.binding));
  add('出版形式：', pick(l, ALIASES.form));
  add('分類號：', pick(l, ALIASES.deweyish));
  add('主題：', pick(l, ALIASES.theme));
  add('標題：', tidySubjects(pick(l, ALIASES.subject)));
  add('關鍵字：', tidySubjects(pick(l, ALIASES.keywords)));
  add('得獎：', pick(l, ALIASES.awards));
  add('出版機構類型：', pick(l, ALIASES.publisherType));
  return parts.join('；');
}

/** "撒母耳記; 聖經研究; 聖經人物;;" — semicolon-separated, often with empties. */
function tidySubjects(raw) {
  return String(raw || '')
    .split(/[;；]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join('、');
}

module.exports = {
  parse,
  id: 'ncl-isbn',
  label: '臺灣出版新書預告書訊 (國家圖書館 ISBN 申請, CSV)',
};
