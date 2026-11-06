
/**
 * How the `docs` blob is encoded, shared by the database builder and the
 * browser the way tokenize.js and derive.js are.
 *
 * `docs` holds the fields of a record that the `books` table does not. It was
 * a JSON object per row, which meant storing the same seventeen key names
 * 446,090 times. Two changes, measured over 5,374 real rows:
 *
 *   as stored (JSON object)   393 B/row
 *   positional array          360 B/row
 *   deflate                   299 B/row
 *   both                      269 B/row
 *
 * Across the catalogue that is 183.8 MB down to about 125 MB, which is most of
 * what keeps the database under Cloudflare's 512 MB cacheable ceiling — past
 * which every range request is answered from origin, measured at 0.9 s versus
 * ~46 s for one search.
 *
 * The compression itself is not here: Node deflates with zlib, the browser
 * inflates with DecompressionStream, and neither can use the other's. What is
 * shared is the field order, because that is the part that would silently
 * corrupt every record if the two sides ever disagreed.
 */

/**
 * Fixed and append-only. A field's position *is* its name now, so reordering
 * or removing one would misread every row written before the change. New
 * fields go on the end.
 */
var DOC_FIELDS = [
  'place',
  'dateRaw',
  'edition',
  'notes',
  'physical',
  'isbns',
  'series',
  'authors',
  'price',
  'issn',
  'serial',
  'frequency',
  'statementOfResponsibility',
  'titleFull',
  'extra',
  'description',
  'copyright',
];

/** Record -> array. Trailing absent fields are dropped rather than stored. */
function encodeDoc(rec) {
  var out = [];
  for (var i = 0; i < DOC_FIELDS.length; i++) {
    var v = rec[DOC_FIELDS[i]];
    out.push(v === undefined ? null : v);
  }
  while (out.length && out[out.length - 1] === null) out.pop();
  return out;
}

/**
 * Array -> record. Also accepts an object, so a database built before this
 * encoding still reads: the two are told apart by shape, not by a version
 * number that could go missing.
 */
function decodeDoc(value) {
  if (!value) return {};
  if (!Array.isArray(value)) return value;

  var out = {};
  for (var i = 0; i < value.length && i < DOC_FIELDS.length; i++) {
    if (value[i] !== null && value[i] !== undefined) out[DOC_FIELDS[i]] = value[i];
  }
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DOC_FIELDS: DOC_FIELDS, encodeDoc: encodeDoc, decodeDoc: decodeDoc };
}

if (typeof window !== 'undefined') {
  window.decodeDoc = decodeDoc;
}
