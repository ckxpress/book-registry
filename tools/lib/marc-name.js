'use strict';

/**
 * Cleaning a contributor as the National Central Library's catalogues write
 * one. Shared by the NBINet and holdings adapters, which draw on the same
 * MARC records and so share every quirk.
 *
 * The important thing, and the thing that is easy to get wrong: **these fields
 * hold one contributor, not a list.** Measured across both files — 16,312 and
 * 74,086 non-empty values — not one uses a semicolon to separate people. The
 * commas are doing other work entirely:
 *
 *   三毛, 1943-1991                          a name and its dates
 *   河野史代, 1968- 文字作者,  藝術創作者        dates, then two relators
 *   莫斯里 (Moseley, John) 著                 a romanised form, inverted, in parens
 *   Tang, Yijie, author                     an inverted name, then a relator
 *
 * Splitting any of those on commas turns one person into three. The 80
 * semicolons that do appear are inside conference names — "(7th : 2023 :
 * Kitakyushu, Japan ; Online)" — so splitting on those is wrong as well.
 *
 * So nothing is split. The relators and dates come off the end, and whatever
 * remains is the name.
 */

/* Applied repeatedly, because a record may carry several: "文字作者, 藝術創作者". */
const RELATOR = new RegExp(
  '[,，]?\\s*(' +
    '文字作者|藝術創作者|插圖者|插畫者|繪圖者|攝影者|口述者|翻譯者|編輯者|校訂者|' +
    '編著者|編著|合著|主編|編選|編譯|編者|譯者|作者|撰文|著者|著|作|編|譯|繪|撰|註|注|' +
    'author|editor|translator|illustrator|photographer|compiler|contributor|' +
    'narrator|composer|interviewee|interviewer|writer of foreword' +
  ')s?\\.?\\s*$',
  'i'
);

/** "1943-1991", "1968-", "-1991", "approximately 1920-" on the end. */
const DATES = /[,，]?\s*(?:approximately\s*|約\s*)?\d{3,4}\??\s*-\s*(?:\d{3,4}\??)?\.?\s*$/;

const THESIS = /[（(]\s*(學位論文|碩士論文|博士論文)\s*[)）]/;

/** Whether the row is a dissertation, which the relator note sometimes says. */
function isThesis(raw) {
  return THESIS.test(String(raw || ''));
}

/**
 * Returns the contributor as a single name, or '' when the field holds only a
 * relator and no one to attach it to.
 */
function contributorName(raw) {
  let name = String(raw || '').replace(THESIS, '').trim();
  if (!name) return '';

  // Strip trailing relators and dates in whatever order they were written,
  // until neither matches. Bounded so a pathological value cannot spin.
  for (let i = 0; i < 8; i++) {
    const before = name;
    name = name.replace(RELATOR, '').trim();
    name = name.replace(DATES, '').trim();
    if (name === before) break;
  }

  name = name.replace(/[,，、;；.\s]+$/, '').trim();

  // "著" alone, or a stray initial, is not a person.
  return name.length > 1 ? name : '';
}

/** The record shape wants an array; these fields yield at most one name. */
function contributors(raw) {
  const name = contributorName(raw);
  return name ? [name] : [];
}

module.exports = { contributorName, contributors, isThesis };
