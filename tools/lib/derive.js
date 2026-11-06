'use strict';

/* The derivations live with the site so the browser and the build share one
   implementation: the page now computes the description and rights statement
   the database no longer carries, and the two must read identically. */
module.exports = require('../../site/derive.js');
