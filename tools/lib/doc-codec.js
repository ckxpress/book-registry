'use strict';

/* The docs encoding lives with the site so the browser and the build share one
   field order. A disagreement there would misread every record silently. */
module.exports = require('../../site/doc-codec.js');
