
/**
 * Search tokenisation shared by the database builder and the browser.
 *
 * Chinese has no spaces, so a word tokenizer indexes a whole title as one
 * token and "香港" matches nothing. FTS5's trigram tokenizer handles
 * substrings but needs three characters, which fails the very common
 * two-character query (香港, 文學, 漫畫).
 *
 * So CJK runs are indexed as overlapping bigrams — 中國文化 becomes
 * "中國 國文 文化" — and queries are tokenised identically. A two-character
 * query is then a single exact token, and a one-character query becomes a
 * prefix search (書* matches the bigrams 書籍, 書店, …). Latin text is
 * tokenised on word boundaries as usual.
 */

const CJK = /[㐀-䶿一-鿿豈-﫿぀-ヿ가-힯]/;

function isCjk(ch) {
  return CJK.test(ch);
}

/** Text -> the token string stored in the FTS index. */
function indexTokens(text) {
  const tokens = [];
  for (const run of runs(String(text || '').toLowerCase())) {
    if (run.cjk) {
      if (run.text.length === 1) tokens.push(run.text);
      for (let i = 0; i + 1 < run.text.length; i++) tokens.push(run.text.slice(i, i + 2));
    } else {
      for (const word of run.text.split(/[^a-z0-9]+/)) {
        if (word) tokens.push(word);
      }
    }
  }
  return tokens;
}

/**
 * Query -> an FTS5 MATCH expression. Terms are ANDed; the trailing Latin word
 * and any single CJK character get a prefix wildcard so partial typing works.
 */
function matchExpression(query) {
  const groups = [];
  const words = String(query || '').toLowerCase().trim().split(/\s+/).filter(Boolean);

  words.forEach((word, w) => {
    const isLast = w === words.length - 1;
    for (const run of runs(word)) {
      if (run.cjk) {
        if (run.text.length === 1) {
          groups.push(quote(run.text) + '*');
        } else {
          for (let i = 0; i + 1 < run.text.length; i++) groups.push(quote(run.text.slice(i, i + 2)));
        }
      } else {
        const parts = run.text.split(/[^a-z0-9]+/).filter(Boolean);
        parts.forEach((part, p) => {
          const last = isLast && p === parts.length - 1;
          groups.push(quote(part) + (last && part.length >= 2 ? '*' : ''));
        });
      }
    }
  });

  return groups.join(' AND ');
}

/** Split text into consecutive CJK / non-CJK runs. */
function runs(text) {
  const out = [];
  let current = null;
  for (const ch of text) {
    const cjk = isCjk(ch);
    if (!current || current.cjk !== cjk) {
      current = { cjk: cjk, text: '' };
      out.push(current);
    }
    current.text += ch;
  }
  return out;
}

function quote(token) {
  return '"' + token.replace(/"/g, '""') + '"';
}

if (typeof module !== 'undefined' && module.exports) module.exports = { indexTokens, matchExpression, isCjk };

/* Shared by the database builder (Node) and the browser: the query must be
   tokenised exactly as the index was, so this file has one implementation and
   two consumers. tools/lib/tokenize.js re-exports it. */
if (typeof window !== 'undefined') {
  window.indexTokens = indexTokens;
  window.matchExpression = matchExpression;
}
