'use strict';

/**
 * Minimal RFC 4180 CSV parser. Handles quoted fields, embedded newlines,
 * escaped quotes, CRLF/LF line endings and a UTF-8 BOM.
 */
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let sawAnyChar = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      sawAnyChar = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
      sawAnyChar = true;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      sawAnyChar = false;
    } else {
      field += ch;
      sawAnyChar = true;
    }
  }

  if (field !== '' || sawAnyChar || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/**
 * Parse into objects keyed by a *normalised* header name, so that column
 * renames between releases (e.g. "ISBN" vs "International Standard Book
 * Number", or the "B: Author 1" prefixes used in some quarters) still line up.
 */
function parseCsvRecords(text) {
  const rows = parseCsv(text);
  if (!rows.length) return { headers: [], records: [] };

  const start = headerRow(rows);
  const headers = rows[start].map(normaliseHeader);
  const records = [];

  for (let i = start + 1; i < rows.length; i++) {
    const cells = rows[i];
    if (!cells.length) continue;
    if (cells.every((c) => c.trim() === '')) continue;

    const rec = Object.create(null);
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue;
      const value = (cells[c] === undefined ? '' : cells[c]).trim();
      if (rec[key] === undefined || (rec[key] === '' && value !== '')) rec[key] = value;
    }
    rec.__raw = cells;
    records.push(rec);
  }

  return { headers, records, rawHeaders: rows[start] };
}

/**
 * Which row is the header.
 *
 * Usually the first. HKPL's older quarterly catalogues (2017 through 2019
 * Q1) open with a banner instead — a title line, a line naming the language
 * section, and a blank line — so taking row 0 produced a header of one
 * populated cell and every record was then dropped for having no title.
 *
 * Rather than hard-code three, look for the first row that carries several
 * populated columns. A banner line is one cell of text followed by empty
 * ones; a header is not.
 */
function headerRow(rows) {
  const limit = Math.min(rows.length, 20);
  for (let i = 0; i < limit; i++) {
    const filled = rows[i].filter((c) => String(c).trim() !== '').length;
    if (filled >= 3) return i;
  }
  return 0;
}

/**
 * "B: Author 1" -> "author 1";  "For sale/\nNot for sale" -> "for sale/not for sale"
 */
function normaliseHeader(name) {
  return String(name || '')
    .replace(/^\s*[A-Z]{1,2}\s*:\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

module.exports = { parseCsv, parseCsvRecords, normaliseHeader };
