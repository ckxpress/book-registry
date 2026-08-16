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

if (typeof window !== 'undefined') {
  window.SQL_FACET = SQL_FACET;
  window.FACET_LIMIT = FACET_LIMIT;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SQL_FACET: SQL_FACET, FACET_LIMIT: FACET_LIMIT };
}
