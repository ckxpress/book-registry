'use strict';

/* The tokenizer lives with the site so the browser and the build share one
   implementation — an index built with different rules than the query uses
   would fail silently, returning no matches. */
module.exports = require('../../site/tokenize.js');
