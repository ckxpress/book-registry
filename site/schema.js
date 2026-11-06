/* SQL behind each facet, shared by the database builder and the browser so the
   precomputed counts and the live ones can never disagree.
   Loaded as a plain script in the browser and required in Node. */

var SQL_FACET = {
  dataset: 'b.dataset',
  language: 'b.language',
  classification: 'b.classification',
  publisher: 'b.publisher',
  year: "CASE WHEN b.year IS NULL THEN '' ELSE CAST(b.year AS TEXT) END",
  source: "(b.dataset || '#' || COALESCE(b.src, 0))",
  availability: "CASE b.forsale WHEN 1 THEN 'sale' WHEN 0 THEN 'nosale' ELSE '' END",
  identifier: "CASE WHEN b.isbn <> '' THEN 'isbn' ELSE '' END",
};

/* How many options a facet list ever needs; the UI shows far fewer. */
var FACET_LIMIT = 200;

/* Facets whose complete list of values is published as its own file, because
   the capped list is nowhere near all of them and these are the two with a
   search box. There are 38,053 publishers and 1,149 classifications against a
   FACET_LIMIT of 200, so searching the loaded options reached 0.5% of
   publishers — 天窗出版社有限公司, with 181 records, could not be found.
   The file is fetched only when someone types in that box. */
var FACET_FULL_LIST = ['publisher', 'classification'];

if (typeof window !== 'undefined') {
  window.SQL_FACET = SQL_FACET;
  window.FACET_LIMIT = FACET_LIMIT;
  window.FACET_FULL_LIST = FACET_FULL_LIST;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SQL_FACET: SQL_FACET, FACET_LIMIT: FACET_LIMIT, FACET_FULL_LIST: FACET_FULL_LIST };
}
