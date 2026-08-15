'use strict';

const N = require('./normalize');

/**
 * Assembles the canonical record every dataset is normalised into. Adapters
 * extract raw strings; this decides the final shape the site reads.
 */
function buildRecord(fields, ctx) {
  const titleParts = N.parseTitle(fields.title);
  const isbns = N.parseIsbns(fields.isbn);
  const primary = isbns.length ? isbns[0] : null;

  const authors = (fields.authors || [])
    .map((a) => N.clean(a))
    .filter(Boolean)
    .map((name) => {
      const display = N.displayName(name);
      return display === name ? { name: name } : { name: name, display: display };
    });

  const dateRaw = N.clean(fields.year);

  const rec = {
    id: '',
    dataset: ctx.datasetId,
    title: titleParts.title,
    titleFull: titleParts.titleFull !== titleParts.title ? titleParts.titleFull : '',
    subtitle: titleParts.subtitle || N.clean(fields.subtitle),
    parallelTitle: titleParts.parallelTitle,
    statementOfResponsibility: titleParts.statementOfResponsibility,
    authors: authors,
    publisher: N.trimEnd(fields.publisher),
    place: N.trimEnd(fields.place),
    year: parseYear(fields.year),
    dateRaw: '',
    edition: N.trimEnd(fields.edition),
    frequency: N.trimEnd(fields.frequency),
    series: N.parseSeries(fields.series),
    classification: N.trimEnd(fields.classification),
    notes: N.clean(fields.notes),
    physical: N.parsePhysical(fields.physical),
    isbn: primary ? primary.isbn13 || primary.isbn10 : '',
    isbns: isbns,
    issn: N.parseIssn(fields.issn),
    price: N.parsePrice(fields.price, fields.forSale, ctx.dataset && ctx.dataset.currency),
    language: fields.language || ctx.language || '',
    ref: N.clean(fields.ref),
    serial: N.clean(fields.serial),
    source: ctx.source,
  };

  if (fields.description) {
    rec.description = { text: N.clean(fields.description), source: 'dataset' };
  } else {
    rec.description = N.buildDescription(rec);
  }

  if (fields.copyright) {
    rec.copyright = { statement: N.clean(fields.copyright), source: 'dataset' };
  } else {
    rec.copyright = N.buildCopyright(rec);
  }

  // Keep the raw date string only when it says more than the parsed year
  // ("c2019", "2024-03", "民國114年").
  if (dateRaw && dateRaw !== String(rec.year)) rec.dateRaw = dateRaw;

  // A cover is stored only when the dataset supplies one. Otherwise the site
  // resolves it from the ISBN at render time (Open Library, with a generated
  // fallback) rather than baking ~10k URLs into the payload.
  const coverUrl = N.clean(fields.coverUrl);
  if (coverUrl) rec.cover = { url: coverUrl, source: 'dataset' };

  rec.id = makeId(ctx.datasetId, rec);
  return N.compact(rec);
}

function makeId(datasetId, rec) {
  const key =
    rec.ref ||
    rec.isbn ||
    rec.issn ||
    slug(rec.title) + (rec.year ? '-' + rec.year : '') ||
    'record';
  return datasetId + ':' + key;
}

function parseYear(value) {
  const m = String(value || '').match(/(1[5-9]\d{2}|20\d{2}|21\d{2})/);
  return m ? Number(m[1]) : null;
}

function slug(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

module.exports = { buildRecord, slug };
