/* Book Registry — browse & search UI.
   No build step, no dependencies: reads site/data/manifest.json, loads the
   slim index shards for browsing, and pulls a full shard only when a book is
   opened. */
(function () {
  'use strict';

  var PAGE_SIZE = 60;
  var DATA = 'data/';

  var state = {
    q: '',
    filters: {},
    sort: 'relevance',
    view: localStorage.getItem('view') || 'grid',
    page: 1,
  };

  var manifest = null;
  var rows = [];
  var byId = new Map();
  var fullShards = new Map();
  var results = [];
  var totalBooks = 0;
  var totalResults = 0;
  var source = null; // JsonSource or SqliteSource, chosen by the manifest
  var renderToken = 0; // guards against out-of-order async renders
  var covers = localStorage.getItem('covers') !== 'off';
  var lastWritten = null; // the hash this app wrote, to skip echoing it back

  var el = {
    q: document.getElementById('q'),
    grid: document.getElementById('grid'),
    count: document.getElementById('count'),
    chips: document.getElementById('chips'),
    facets: document.getElementById('facets'),
    sort: document.getElementById('sort'),
    more: document.getElementById('more'),
    empty: document.getElementById('empty'),
    sidebar: document.getElementById('sidebar'),
    browse: document.getElementById('browse-view'),
    detail: document.getElementById('detail-view'),
    about: document.getElementById('about-view'),
    brandSub: document.getElementById('brand-sub'),
    footer: document.getElementById('footer-text'),
    filtersCount: document.getElementById('filters-count'),
    sentinel: document.getElementById('sentinel'),
  };

  /* ---------------- facet definitions ---------------- */

  var FACETS = [
    { key: 'dataset', label: 'Dataset', get: function (r) { return r._ds; }, name: datasetName, hideIfSingle: true },
    { key: 'language', label: 'Language', get: function (r) { return r.language; }, name: languageName },
    { key: 'classification', label: 'Category', get: function (r) { return r.classification; }, search: true, limit: 10 },
    { key: 'publisher', label: 'Publisher', get: function (r) { return r.publisher; }, search: true, limit: 8 },
    { key: 'year', label: 'Year of publication', get: function (r) { return r.year ? String(r.year) : ''; }, limit: 10, sort: 'key-desc' },
    { key: 'source', label: 'Release', get: function (r) { return r._ds + '#' + (r.src || 0); }, name: sourceName, limit: 10 },
    {
      key: 'availability',
      label: 'Availability',
      get: function (r) { return r.forSale === true ? 'sale' : r.forSale === false ? 'nosale' : ''; },
      name: function (v) { return v === 'sale' ? 'For sale' : 'Not for sale'; },
    },
    {
      key: 'identifier',
      label: 'Identifier',
      get: function (r) { return r.isbn ? 'isbn' : ''; },
      name: function () { return 'Has an ISBN'; },
    },
  ];

  /* ---------------- boot ---------------- */

  init();

  function init() {
    applyTheme(localStorage.getItem('theme'));
    el.sort.value = state.sort;
    setViewButtons();
    wireEvents();
    readRoute();
    load();
  }

  function load() {
    fetch(DATA + 'manifest.json', { cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('manifest.json not found');
        return res.json();
      })
      .then(function (data) {
        manifest = data;
        if (!manifest.datasets || !manifest.datasets.length) throw new Error('no datasets imported yet');
        updateChrome();
        // A built database is queried by range request; without one, the JSON
        // shards are loaded up front. Same UI either way.
        source = manifest.db ? SqliteSource : JsonSource;
        return source.prepare();
      })
      .then(function () {
        el.brandSub.textContent =
          fmt(totalBooks) + ' books · ' + manifest.datasets.length + ' dataset' + (manifest.datasets.length > 1 ? 's' : '');
        route();
      })
      .catch(function (err) {
        el.count.textContent = '';
        el.grid.innerHTML = '';
        el.empty.hidden = false;
        el.empty.innerHTML =
          '<h3>No data loaded</h3><p>' +
          escapeHtml(err.message) +
          '</p><p>Run <code>npm run import</code> in the project folder, then reload.</p>';
        el.brandSub.textContent = 'no data';
      });
  }

  function loadShards() {
    var jobs = [];
    manifest.datasets.forEach(function (ds) {
      var files = (ds.files && ds.files.index) || [];
      files.forEach(function (file, shard) {
        jobs.push(
          fetch(DATA + file)
            .then(function (res) { return res.json(); })
            .then(function (list) { return { ds: ds, shard: shard, list: list }; })
        );
      });
    });

    showSkeleton();

    return Promise.all(jobs).then(function (chunks) {
      chunks.sort(function (a, b) {
        return a.ds.id === b.ds.id ? a.shard - b.shard : a.ds.id.localeCompare(b.ds.id);
      });
      chunks.forEach(function (chunk) {
        chunk.list.forEach(function (row, offset) {
          row._ds = chunk.ds.id;
          row._shard = chunk.shard;
          row._off = offset;
          row._hay = haystack(row);
          rows.push(row);
          byId.set(row.id, row);
        });
      });
    });
  }

  function haystack(row) {
    return [
      row.title,
      row.subtitle,
      (row.authors || []).join(' '),
      row.publisher,
      row.series,
      row.classification,
      row.isbn,
      row.ref,
      row.year,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
  }

  /* ---------------- events ---------------- */

  function wireEvents() {
    var timer = null;
    el.q.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        state.q = el.q.value.trim();
        state.page = 1;
        pushRoute();
        render();
      }, 120);
    });

    document.getElementById('search-form').addEventListener('submit', function (e) {
      e.preventDefault();
      el.q.blur();
    });

    el.sort.addEventListener('change', function () {
      state.sort = el.sort.value;
      state.page = 1;
      pushRoute();
      render();
    });

    document.querySelectorAll('.viewtoggle button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.view = btn.dataset.view;
        localStorage.setItem('view', state.view);
        setViewButtons();
        render();
      });
    });

    el.more.addEventListener('click', loadMore);

    window.addEventListener('resize', maybeLoadMore);

    document.getElementById('clear-filters').addEventListener('click', function () {
      state.filters = {};
      state.q = '';
      el.q.value = '';
      state.page = 1;
      pushRoute();
      render();
    });

    document.getElementById('filters-toggle').addEventListener('click', function (e) {
      var open = el.sidebar.classList.toggle('open');
      e.currentTarget.setAttribute('aria-expanded', String(open));
    });

    document.getElementById('theme-toggle').addEventListener('click', function () {
      var current = document.documentElement.getAttribute('data-theme');
      var next = current === 'dark' ? 'light' : current === 'light' ? '' : prefersDark() ? 'light' : 'dark';
      localStorage.setItem('theme', next);
      applyTheme(next);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === '/' && document.activeElement !== el.q && !/input|textarea|select/i.test(document.activeElement.tagName)) {
        e.preventDefault();
        el.q.focus();
        el.q.select();
      } else if (e.key === 'Escape' && document.activeElement === el.q) {
        el.q.blur();
      }
    });

    window.addEventListener('hashchange', function () {
      if (location.hash === lastWritten) {
        lastWritten = null;
        return;
      }
      readRoute();
      route();
    });

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(
        function (entries) {
          if (entries[0].isIntersecting) maybeLoadMore();
        },
        { rootMargin: '600px' }
      ).observe(el.sentinel);
    }
  }

  /* ---------------- routing ---------------- */

  function readRoute() {
    var hash = location.hash.replace(/^#/, '');
    var qs = hash.indexOf('?') === -1 ? '' : hash.slice(hash.indexOf('?') + 1);
    var params = new URLSearchParams(qs);

    state.q = params.get('q') || '';
    state.sort = params.get('sort') || 'relevance';
    state.page = Math.max(1, Number(params.get('page') || 1));
    state.filters = {};

    FACETS.forEach(function (facet) {
      var raw = params.get(facet.key);
      if (raw) state.filters[facet.key] = new Set(raw.split('|'));
    });

    el.q.value = state.q;
    el.sort.value = state.sort;
  }

  function pushRoute() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.sort !== 'relevance') params.set('sort', state.sort);
    Object.keys(state.filters).forEach(function (key) {
      var set = state.filters[key];
      if (set && set.size) params.set(key, [...set].join('|'));
    });
    var qs = params.toString();
    var next = '#/' + (qs ? '?' + qs : '');
    lastWritten = next;
    if (location.hash !== next) location.hash = next;
  }

  function route() {
    if (!manifest) return;
    var hash = location.hash.replace(/^#/, '');
    var path = hash.split('?')[0];

    if (path.indexOf('/book/') === 0) {
      showView('detail');
      renderDetail(decodeURIComponent(path.slice(6)));
    } else if (path === '/about') {
      showView('about');
      renderAbout();
    } else {
      showView('browse');
      render();
    }
  }

  function showView(name) {
    el.browse.hidden = name !== 'browse';
    el.detail.hidden = name !== 'detail';
    el.about.hidden = name !== 'about';
    if (name !== 'browse') window.scrollTo(0, 0);
  }

  /* ---------------- filtering & search ---------------- */

  function matches(row, filters) {
    for (var i = 0; i < FACETS.length; i++) {
      var facet = FACETS[i];
      var set = filters[facet.key];
      if (!set || !set.size) continue;
      if (!set.has(facet.get(row) || '')) return false;
    }
    return true;
  }

  function searchTerms(q) {
    if (!q) return [];
    return q
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
  }

  function compute() {
    var terms = searchTerms(state.q);
    var digits = state.q.replace(/[^0-9Xx]/g, '');
    var isbnQuery = digits.length >= 10 ? digits.toUpperCase() : '';
    var out = [];

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!matches(row, state.filters)) continue;

      if (terms.length) {
        var hay = row._hay;
        var ok = true;
        for (var t = 0; t < terms.length; t++) {
          if (hay.indexOf(terms[t]) === -1) {
            ok = false;
            break;
          }
        }
        if (!ok) {
          if (!isbnQuery || row.isbn !== isbnQuery) continue;
        }
        row._score = score(row, terms, isbnQuery);
      } else {
        row._score = 0;
      }
      out.push(row);
    }

    sortRows(out);
    return out;
  }

  function score(row, terms, isbnQuery) {
    var value = 0;
    if (isbnQuery && row.isbn === isbnQuery) value += 500;
    var title = (row.title || '').toLowerCase();
    var authors = (row.authors || []).join(' ').toLowerCase();
    var publisher = (row.publisher || '').toLowerCase();

    terms.forEach(function (term) {
      if (title === term) value += 120;
      else if (title.indexOf(term) === 0) value += 60;
      else if (title.indexOf(term) !== -1) value += 34;
      if (authors.indexOf(term) !== -1) value += 20;
      if (publisher.indexOf(term) !== -1) value += 8;
    });
    if (row.year) value += Math.min(6, Math.max(0, row.year - 2015) * 0.4);
    return value;
  }

  function sortRows(list) {
    var collator = new Intl.Collator(['zh-Hant', 'en'], { numeric: true, sensitivity: 'base' });
    var mode = state.sort;

    list.sort(function (a, b) {
      switch (mode) {
        case 'title':
          return collator.compare(a.title || '', b.title || '');
        case 'title-desc':
          return collator.compare(b.title || '', a.title || '');
        case 'year':
          return (a.year || 9999) - (b.year || 9999) || collator.compare(a.title || '', b.title || '');
        case 'year-desc':
          return (b.year || 0) - (a.year || 0) || collator.compare(a.title || '', b.title || '');
        case 'publisher':
          return (
            collator.compare(a.publisher || 'zzz', b.publisher || 'zzz') ||
            collator.compare(a.title || '', b.title || '')
          );
        default:
          return (b._score || 0) - (a._score || 0) || collator.compare(a.title || '', b.title || '');
      }
    });
  }

  /* ---------------- data sources ---------------- */

  /**
   * Everything below the render layer goes through one of these. The JSON
   * source holds every record in memory, which is fast up to ~50k books; the
   * SQLite source queries a database file over HTTP range requests and does
   * not care how large the catalogue is.
   */
  var JsonSource = {
    id: 'json',
    prepare: function () {
      return loadShards().then(function () {
        totalBooks = rows.length;
      });
    },
    page: function (offset, limit) {
      var sig = querySignature();
      if (sig !== JsonSource._sig) {
        JsonSource._sig = sig;
        JsonSource._all = compute();
      }
      var all = JsonSource._all;
      return Promise.resolve({ rows: all.slice(offset, offset + limit), total: all.length });
    },
    facets: function () {
      var out = {};
      FACETS.forEach(function (facet) {
        out[facet.key] = countFacet(facet);
      });
      return Promise.resolve(out);
    },
    record: function (id) {
      var row = byId.get(id);
      if (!row) return Promise.resolve(null);
      return fetchFull(row);
    },
  };

  var SqliteSource = {
    id: 'sqlite',
    prepare: function () {
      var db = manifest.db;
      return loadScript('vendor/sqlite-httpvfs/index.js')
        .then(function () {
          if (typeof createDbWorker !== 'function') throw new Error('sqlite-httpvfs failed to load');
          // The worker resolves these against its own URL, not the page's, so
          // they have to be absolute.
          var abs = function (p) { return new URL(p, location.href).href; };
          return createDbWorker(
            [
              {
                from: 'inline',
                config: {
                  serverMode: 'full',
                  url: abs(DATA + db.file),
                  requestChunkSize: 4096, // several 1 KB pages per request
                  // (The library hardcodes its read-ahead growth, so queries
                  // are written to avoid large sequential scans instead.)
                },
              },
            ],
            abs('vendor/sqlite-httpvfs/sqlite.worker.js'),
            abs('vendor/sqlite-httpvfs/sql-wasm.wasm')
          );
        })
        .then(function (worker) {
          SqliteSource._worker = worker;
          // SQLite's default 2 MB page cache thrashes once a query touches
          // thousands of rows, and every evicted page costs another HTTP
          // request. Memory is far cheaper than round trips here.
          return worker.db.query('PRAGMA cache_size = -32000').then(function () { return worker; });
        })
        .then(function (worker) {
          // The manifest already knows the total; COUNT(*) would scan an
          // entire index over the network to learn the same number.
          totalBooks = manifest.totalBooks || 0;
        });
    },
    page: function (offset, limit) {
      var where = sqlWhere(null);
      var order = sqlOrder();
      var columns =
        'b.id, b.dataset, b.title, b.subtitle, b.authors, b.publisher, b.year, b.isbn,' +
        ' b.classification, b.language, b.series, b.ref, b.src, b.price, b.currency, b.forsale, b.cover';
      var sql;

      if (where.onlyQuery && order === 'bm25(books_fts)') {
        // Rank inside the FTS index and take the page there, then fetch only
        // those rows. Joining first would make SQLite walk a row for every
        // match — which, over range requests, drags most of the table across
        // the network to display sixty results.
        sql =
          'SELECT ' + columns + ' FROM (SELECT rowid FROM books_fts WHERE books_fts MATCH ?' +
          ' ORDER BY bm25(books_fts) LIMIT ? OFFSET ?) h JOIN books b ON b.rowid = h.rowid';
        return Promise.all([
          SqliteSource.query(sql, [where.match, limit, offset]),
          SqliteSource.query('SELECT COUNT(*) AS n FROM books_fts WHERE books_fts MATCH ?', [where.match]),
        ]).then(function (res) {
          return { rows: res[0].map(mapSqlRow), total: res[1][0].n };
        });
      }

      sql = 'SELECT ' + columns + ' FROM ' + where.from + where.sql + ' ORDER BY ' + order + ' LIMIT ? OFFSET ?';

      var counting;
      if (!where.params.length) {
        counting = Promise.resolve([{ n: totalBooks }]); // unfiltered: already known
      } else if (where.onlyQuery) {
        // Counting a plain search needs the FTS index alone — joining `books`
        // would pull a page per matching row across the network for nothing.
        counting = SqliteSource.query('SELECT COUNT(*) AS n FROM books_fts WHERE books_fts MATCH ?', [where.match]);
      } else {
        counting = SqliteSource.query('SELECT COUNT(*) AS n FROM ' + where.from + where.sql, where.params);
      }

      return Promise.all([SqliteSource.query(sql, where.params.concat([limit, offset])), counting]).then(function (res) {
        return { rows: res[0].map(mapSqlRow), total: res[1][0].n };
      });
    },
    facets: function () {
      var base = sqlWhere(null);

      // A plain search: every facet sees the same hit set, so all eight counts
      // come back from one query over one bounded pass, instead of eight
      // queries each re-walking the matches.
      if (base.onlyQuery) {
        var selects = FACETS.map(function (facet) {
          var expr = SQL_FACET[facet.key];
          return (
            "SELECT '" + facet.key + "' AS k, " + expr + ' AS v, COUNT(*) AS n' +
            ' FROM hits JOIN books b ON b.rowid = hits.rowid' +
            ' WHERE ' + expr + " <> '' GROUP BY v"
          );
        });
        var sql =
          'WITH hits AS MATERIALIZED (SELECT rowid FROM books_fts WHERE books_fts MATCH ? LIMIT ' + FACET_SCAN_CAP + ') ' +
          selects.join(' UNION ALL ');

        return SqliteSource.query(sql, [base.match]).then(function (list) {
          var out = {};
          FACETS.forEach(function (facet) { out[facet.key] = []; });
          list.forEach(function (r) {
            if (out[r.k]) out[r.k].push(toOption(r));
          });
          Object.keys(out).forEach(function (key) {
            out[key].sort(function (a, b) { return b.count - a.count || String(a.value).localeCompare(String(b.value)); });
            out[key] = out[key].slice(0, FACET_LIMIT);
          });
          return out;
        });
      }

      // Each facet is counted against the *other* active filters, so its
      // options stay meaningful — same rule as the in-memory path.
      var jobs = FACETS.map(function (facet) {
        var where = sqlWhere(facet.key);
        var expr = SQL_FACET[facet.key];

        // Nothing narrows this facet, so the answer is the build-time table —
        // a few indexed rows instead of aggregating the whole catalogue.
        if (!where.params.length) {
          return SqliteSource.query(
            'SELECT value AS v, n FROM facet_counts WHERE facet = ? ORDER BY n DESC, value LIMIT ?',
            [facet.key, FACET_LIMIT]
          ).then(function (list) {
            return { key: facet.key, list: list.map(toOption) };
          });
        }

        var sql =
          'SELECT ' + expr + ' AS v, COUNT(*) AS n FROM ' + where.from + where.sql +
          (where.sql ? ' AND ' : ' WHERE ') + expr + " <> '' GROUP BY v ORDER BY n DESC, v LIMIT " + FACET_LIMIT;
        return SqliteSource.query(sql, where.params).then(function (list) {
          return { key: facet.key, list: list.map(toOption) };
        });
      });

      return Promise.all(jobs).then(function (all) {
        var out = {};
        all.forEach(function (entry) {
          out[entry.key] = entry.list;
        });
        return out;
      });
    },
    record: function (id) {
      return SqliteSource.query(
        'SELECT d.doc AS doc FROM books b JOIN docs d ON d.rowid = b.rowid WHERE b.id = ? LIMIT 1',
        [id]
      ).then(function (res) {
        return res.length ? JSON.parse(res[0].doc) : null;
      });
    },
    query: function (sql, params) {
      return SqliteSource._worker.db.query(sql, params || []);
    },
  };

  /* SQL_FACET and FACET_LIMIT come from schema.js, shared with the builder. */

  function toOption(r) {
    return { value: String(r.v), count: r.n };
  }

  /** WHERE clause for the active filters and query, optionally skipping one facet. */
  function sqlWhere(skipFacet) {
    var clauses = [];
    var params = [];
    var from = 'books b';

    var match = matchExpression(state.q);
    if (match) {
      from = 'books_fts f JOIN books b ON b.rowid = f.rowid';
      clauses.push('f.books_fts MATCH ?');
      params.push(match);
    }

    FACETS.forEach(function (facet) {
      if (facet.key === skipFacet) return;
      var set = state.filters[facet.key];
      if (!set || !set.size) return;
      var values = [];
      set.forEach(function (value) {
        values.push('?');
        params.push(value);
      });
      clauses.push(SQL_FACET[facet.key] + ' IN (' + values.join(',') + ')');
    });

    return {
      from: from,
      sql: clauses.length ? ' WHERE ' + clauses.join(' AND ') : '',
      params: params,
      match: match,
      onlyQuery: !!match && clauses.length === 1,
    };
  }

  /* How many matches a search-time facet count will look at. Beyond this the
     counts are marked approximate rather than making the user wait while the
     whole result set is walked over the network. */
  var FACET_SCAN_CAP = 600;

  function sqlOrder() {
    switch (state.sort) {
      case 'title':
        return 'b.title';
      case 'title-desc':
        return 'b.title DESC';
      case 'year':
        return 'b.year IS NULL, b.year, b.title';
      case 'year-desc':
        return 'b.year IS NULL, b.year DESC, b.title';
      case 'publisher':
        return "b.publisher = '', b.publisher, b.title";
      default:
        return state.q ? 'bm25(books_fts)' : 'b.title';
    }
  }

  /** SQL row -> the same shape the card renderer gets from the JSON index. */
  function mapSqlRow(r) {
    var row = {
      id: r.id,
      _ds: r.dataset,
      title: r.title,
      subtitle: r.subtitle,
      authors: r.authors ? String(r.authors).split(', ') : [],
      publisher: r.publisher,
      year: r.year,
      isbn: r.isbn,
      classification: r.classification,
      language: r.language,
      series: r.series,
      ref: r.ref,
      src: r.src,
      cover: r.cover || '',
    };
    if (typeof r.price === 'number') {
      row.price = r.price;
      row.currency = r.currency;
    }
    if (r.forsale === 0 || r.forsale === 1) row.forSale = r.forsale === 1;
    return row;
  }

  function querySignature() {
    var parts = [state.q, state.sort];
    FACETS.forEach(function (facet) {
      var set = state.filters[facet.key];
      parts.push(facet.key + '=' + (set ? [...set].sort().join('|') : ''));
    });
    return parts.join(' ');
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var tag = document.createElement('script');
      tag.src = src;
      tag.onload = resolve;
      tag.onerror = function () { reject(new Error('could not load ' + src)); };
      document.head.appendChild(tag);
    });
  }

  /* ---------------- render: browse ---------------- */

  function render() {
    var token = ++renderToken;
    state.page = 1;

    return source
      .page(0, PAGE_SIZE)
      .then(function (res) {
        if (token !== renderToken) return null;
        results = res.rows;
        totalResults = res.total;
        renderCount();
        renderChips();
        renderGrid(false);
        return source.facets();
      })
      .then(function (counts) {
        if (token !== renderToken || !counts) return;
        renderFacets(counts);
        requestAnimationFrame(maybeLoadMore);
      })
      .catch(function (err) {
        if (token !== renderToken) return;
        el.grid.innerHTML = '';
        el.empty.hidden = false;
        el.empty.innerHTML = '<h3>Query failed</h3><p>' + escapeHtml(err.message) + '</p>';
      });
  }

  /** Fetches the next page and appends it, without re-running the facets. */
  function loadMore() {
    if (SqliteSource._busy) return;
    var token = renderToken;
    SqliteSource._busy = true;
    return source
      .page(results.length, PAGE_SIZE)
      .then(function (res) {
        SqliteSource._busy = false;
        if (token !== renderToken || !res.rows.length) return;
        var start = results.length;
        results = results.concat(res.rows);
        totalResults = res.total;
        renderGrid(true, start);
      })
      .catch(function () {
        SqliteSource._busy = false;
      });
  }

  function renderCount() {
    el.count.innerHTML =
      totalResults === totalBooks
        ? '<strong>' + fmt(totalBooks) + '</strong> books'
        : '<strong>' + fmt(totalResults) + '</strong> of ' + fmt(totalBooks) + ' books';
  }

  function renderGrid(append, from) {
    var start = append ? from || 0 : 0;
    var slice = results.slice(start);

    if (!append) {
      el.grid.innerHTML = '';
      el.grid.className = 'grid' + (state.view === 'list' ? ' list' : '');
    }

    var terms = searchTerms(state.q);
    var frag = document.createDocumentFragment();
    slice.forEach(function (row) {
      frag.appendChild(card(row, terms));
    });
    el.grid.appendChild(frag);

    el.more.hidden = results.length >= totalResults;
    el.empty.hidden = totalResults !== 0;
    if (!totalResults) {
      el.empty.innerHTML =
        '<h3>No books match</h3><p>Try fewer words, or <button class="linkish" id="empty-reset">reset the filters</button>.</p>';
      var reset = document.getElementById('empty-reset');
      if (reset) reset.addEventListener('click', function () { document.getElementById('clear-filters').click(); });
    }
  }

  /* Keeps filling while the end of the list is in reach: an observer only
     reports *changes* in intersection, so a sentinel that stays on screen
     after an append would never fire again. */
  function maybeLoadMore() {
    if (el.browse.hidden || el.more.hidden) return;
    if (el.sentinel.getBoundingClientRect().top > window.innerHeight + 600) return;
    var pending = loadMore();
    if (pending) pending.then(function () { requestAnimationFrame(maybeLoadMore); });
  }

  function card(row, terms) {
    var a = document.createElement('a');
    a.className = 'card';
    a.href = '#/book/' + encodeURIComponent(row.id);

    a.appendChild(coverEl(row));

    var body = document.createElement('div');
    body.className = 'card-body';

    var title = document.createElement('h3');
    title.className = 'card-title';
    title.innerHTML = highlight(row.title || 'Untitled', terms);
    body.appendChild(title);

    if (state.view === 'list' && row.subtitle) {
      var sub = document.createElement('p');
      sub.className = 'card-sub';
      sub.innerHTML = highlight(row.subtitle, terms);
      body.appendChild(sub);
    }

    var meta = document.createElement('p');
    meta.className = 'card-meta';
    var authors = (row.authors || []).join(', ');
    meta.innerHTML = [authors ? highlight(authors, terms) : '', joinMeta(row)].filter(Boolean).join('<br>');
    body.appendChild(meta);

    if (state.view === 'list') {
      var tags = document.createElement('div');
      tags.className = 'tagrow';
      if (row.classification) tags.appendChild(tag(row.classification));
      if (row.isbn) tags.appendChild(tag('ISBN ' + row.isbn));
      if (typeof row.price === 'number') tags.appendChild(tag(money(row.price, row.currency)));
      else if (row.forSale === false) tags.appendChild(tag('Not for sale'));
      body.appendChild(tags);
    }

    a.appendChild(body);
    return a;
  }

  function tag(text) {
    var span = document.createElement('span');
    span.className = 'tag';
    span.textContent = text;
    return span;
  }

  function joinMeta(row) {
    return [escapeHtml(row.publisher || ''), row.year ? String(row.year) : '']
      .filter(Boolean)
      .join(' · ');
  }

  /* Google Books answers a missing cover with a placeholder bitmap rather than
     a 404 — either "image not available" (PNG, 128×170) or a grey striped book
     (JPEG, 128×184). Both are fixed images, so at zoom=1 they are identifiable
     by size; every lookup is probed there before being upgraded to a larger
     rendering. A genuine cover of exactly those dimensions is rare and simply
     falls back to a generated one. */
  var GB_PLACEHOLDERS = { '128x170': 1, '128x184': 1 };

  function coverEl(row, large) {
    var wrap = document.createElement('div');
    wrap.className = 'cover';
    wrap.appendChild(fallbackCover(row));
    if (!covers) return wrap;

    var sources = coverSources(row, large);
    if (!sources.length) return wrap;

    var img = document.createElement('img');
    img.decoding = 'async';
    img.alt = '';
    img.referrerPolicy = 'no-referrer';

    var at = 0;
    var upgrading = false;

    function attempt() {
      if (at >= sources.length) {
        img.remove();
        return;
      }
      img.src = sources[at++];
    }

    function show() {
      img.classList.add('ready');
      var fb = wrap.querySelector('.cover-fallback');
      if (fb) fb.remove();
    }

    img.addEventListener('load', function () {
      if (upgrading) {
        show();
        return;
      }
      if (img.naturalWidth < 4 || GB_PLACEHOLDERS[img.naturalWidth + 'x' + img.naturalHeight]) {
        attempt();
        return;
      }
      show();
      // A real thumbnail means the book has a cover, so the detail view can
      // safely ask for the bigger rendering.
      if (large && row.isbn && img.src.indexOf('books.google.com') !== -1) {
        upgrading = true;
        img.src = googleCover(row.isbn, 2);
      }
    });
    img.addEventListener('error', function () {
      if (upgrading) return; // keep the thumbnail already on screen
      attempt();
    });

    wrap.appendChild(img);
    whenVisible(wrap, attempt);
    return wrap;
  }

  /* Deferred loading is done here rather than with loading="lazy": the native
     hint is unreliable for images that start out transparent or off-screen. */
  var coverQueue = null;
  var coverJobs = new WeakMap();

  function whenVisible(node, start) {
    if (!('IntersectionObserver' in window)) {
      start();
      return;
    }
    if (!coverQueue) {
      coverQueue = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            coverQueue.unobserve(entry.target);
            var job = coverJobs.get(entry.target);
            if (job) {
              coverJobs.delete(entry.target);
              job();
            }
          });
        },
        { rootMargin: '400px' }
      );
    }
    coverJobs.set(node, start);
    coverQueue.observe(node);
  }

  /* Covers are not in the source data; they are looked up by ISBN at render
     time, best source first, with a generated cover if nothing resolves. */
  function coverSources(row, large) {
    if (row.cover) return [row.cover];
    if (!row.isbn) return [];
    return [
      googleCover(row.isbn, 1),
      'https://covers.openlibrary.org/b/isbn/' + row.isbn + (large ? '-L' : '-M') + '.jpg?default=false',
    ];
  }

  function googleCover(isbn, zoom) {
    return 'https://books.google.com/books/content?vid=ISBN' + isbn + '&printsec=frontcover&img=1&zoom=' + zoom;
  }

  /* A generated cover so every book still reads as a book. */
  function fallbackCover(row) {
    var div = document.createElement('div');
    div.className = 'cover-fallback';
    var hue = hash(row.id || row.title || '') % 360;
    div.style.background =
      'linear-gradient(150deg, hsl(' + hue + ' 42% 42%), hsl(' + ((hue + 38) % 360) + ' 38% 28%))';

    var t = document.createElement('div');
    t.className = 'ft';
    t.textContent = row.title || 'Untitled';
    var a = document.createElement('div');
    a.className = 'fa';
    a.textContent = (row.authors && row.authors[0]) || row.publisher || '';
    div.appendChild(t);
    div.appendChild(a);
    return div;
  }

  /* ---------------- render: facets ---------------- */

  function renderFacets(allCounts) {
    if (allCounts) renderFacets._counts = allCounts;
    var counts = renderFacets._counts || {};
    var open = {};
    el.facets.querySelectorAll('details').forEach(function (d) { open[d.dataset.key] = d.open; });
    var searches = {};
    el.facets.querySelectorAll('.facet-search').forEach(function (i) { searches[i.dataset.key] = i.value; });

    el.facets.innerHTML = '';
    var active = 0;

    FACETS.forEach(function (facet) {
      var options = counts[facet.key] || [];
      var selected = state.filters[facet.key] || new Set();
      active += selected.size;

      if (!options.length) return;
      if (facet.hideIfSingle && options.length < 2 && !selected.size) return;

      var details = document.createElement('details');
      details.className = 'facet';
      details.dataset.key = facet.key;
      details.open = open[facet.key] !== undefined ? open[facet.key] : selected.size > 0 || facet.key === 'language' || facet.key === 'classification';

      var summary = document.createElement('summary');
      summary.textContent = facet.label;
      if (selected.size) {
        var badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = String(selected.size);
        summary.appendChild(badge);
      }
      details.appendChild(summary);

      var body = document.createElement('div');
      body.className = 'facet-body';

      var query = (searches[facet.key] || '').toLowerCase();
      if (facet.search) {
        var input = document.createElement('input');
        input.className = 'facet-search';
        input.type = 'search';
        input.dataset.key = facet.key;
        input.placeholder = 'Filter ' + facet.label.toLowerCase() + '…';
        input.value = searches[facet.key] || '';
        input.addEventListener('input', function () {
          searches[facet.key] = input.value;
          var focusKey = facet.key;
          renderFacets();
          var next = el.facets.querySelector('.facet-search[data-key="' + focusKey + '"]');
          if (next) { next.value = input.value; next.focus(); }
        });
        details.appendChild(input); // body is appended after this, keeping order
      }

      var visible = options.filter(function (entry) {
        if (!query) return true;
        return displayName(facet, entry.value).toLowerCase().indexOf(query) !== -1;
      });

      var limit = facet.limit || 999;
      var expanded = details.dataset.expanded === '1';
      var list = expanded || query ? visible : visible.slice(0, limit);

      list.forEach(function (entry) {
        body.appendChild(option(facet, entry, selected.has(entry.value)));
      });

      details.appendChild(body);

      if (!query && visible.length > list.length) {
        var more = document.createElement('button');
        more.className = 'linkish facet-more';
        more.type = 'button';
        more.textContent = 'Show ' + (visible.length - list.length) + ' more';
        more.addEventListener('click', function () {
          visible.slice(list.length).forEach(function (entry) {
            body.appendChild(option(facet, entry, selected.has(entry.value)));
          });
          more.remove();
        });
        details.appendChild(more);
      }

      el.facets.appendChild(details);
    });

    el.filtersCount.hidden = active === 0;
    el.filtersCount.textContent = String(active);
  }

  function option(facet, entry, checked) {
    var label = document.createElement('label');
    label.className = 'opt';

    var input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', function () {
      toggleFilter(facet.key, entry.value, input.checked);
    });

    var text = document.createElement('span');
    text.className = 'label';
    text.textContent = displayName(facet, entry.value);
    text.title = text.textContent;

    var n = document.createElement('span');
    n.className = 'n';
    n.textContent = fmt(entry.count);

    label.appendChild(input);
    label.appendChild(text);
    label.appendChild(n);
    return label;
  }

  function toggleFilter(key, value, on) {
    var set = state.filters[key] || new Set();
    if (on) set.add(value);
    else set.delete(value);
    if (set.size) state.filters[key] = set;
    else delete state.filters[key];
    state.page = 1;
    pushRoute();
    render();
  }

  /* Counts reflect the other facets' selections, so options stay meaningful. */
  function countFacet(facet) {
    var others = {};
    Object.keys(state.filters).forEach(function (key) {
      if (key !== facet.key) others[key] = state.filters[key];
    });

    var terms = searchTerms(state.q);
    var counts = new Map();

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!matches(row, others)) continue;
      if (terms.length) {
        var hay = row._hay;
        var ok = true;
        for (var t = 0; t < terms.length; t++) {
          if (hay.indexOf(terms[t]) === -1) { ok = false; break; }
        }
        if (!ok) continue;
      }
      var value = facet.get(row);
      if (!value) continue;
      counts.set(value, (counts.get(value) || 0) + 1);
    }

    var list = [];
    counts.forEach(function (count, value) { list.push({ value: value, count: count }); });

    if (facet.sort === 'key-desc') list.sort(function (a, b) { return b.value.localeCompare(a.value); });
    else list.sort(function (a, b) { return b.count - a.count || String(a.value).localeCompare(String(b.value)); });

    return list;
  }

  function renderChips() {
    el.chips.innerHTML = '';
    var any = false;

    FACETS.forEach(function (facet) {
      var set = state.filters[facet.key];
      if (!set) return;
      set.forEach(function (value) {
        any = true;
        var chip = document.createElement('span');
        chip.className = 'chip';
        chip.appendChild(document.createTextNode(facet.label + ': ' + displayName(facet, value)));
        var close = document.createElement('button');
        close.type = 'button';
        close.setAttribute('aria-label', 'Remove filter');
        close.textContent = '×';
        close.addEventListener('click', function () { toggleFilter(facet.key, value, false); });
        chip.appendChild(close);
        el.chips.appendChild(chip);
      });
    });

    el.chips.hidden = !any;
  }

  /* ---------------- render: detail ---------------- */

  function renderDetail(id) {
    var token = ++renderToken;

    el.detail.innerHTML = '<div class="detail"><a class="backlink" href="' + backHref() + '">← Back to results</a>' +
      '<div class="detail-head"><div class="cover skeleton"></div><div><div class="skeleton" style="height:30px;width:70%"></div>' +
      '<div class="skeleton" style="height:16px;width:40%;margin-top:12px"></div></div></div></div>';

    source.record(id).then(function (book) {
      if (token !== renderToken) return;
      if (!book) {
        el.detail.innerHTML =
          '<div class="detail"><a class="backlink" href="#/">← Back to all books</a>' +
          '<h1>Book not found</h1><p>Nothing in the loaded datasets has the id <code>' +
          escapeHtml(id) +
          '</code>.</p></div>';
        return;
      }
      el.detail.innerHTML = detailHtml(book, book);
      var host = el.detail.querySelector('.detail-cover');
      if (host) host.replaceWith(bigCover(book, book));
      document.title = (book.title || 'Book') + ' — Book Registry';
    });
  }

  function fetchFull(row) {
    var ds = datasetById(row._ds);
    var file = ds && ds.files && ds.files.full ? ds.files.full[row._shard] : null;
    if (!file) return Promise.resolve(row);

    if (!fullShards.has(file)) {
      fullShards.set(
        file,
        fetch(DATA + file)
          .then(function (res) { return res.json(); })
          .catch(function () { return null; })
      );
    }
    return fullShards.get(file).then(function (list) {
      if (!list) return row;
      var book = list[row._off];
      return book && book.id === row.id ? book : list.find(function (b) { return b.id === row.id; }) || row;
    });
  }

  function detailHtml(book, row) {
    var ds = datasetById(book.dataset || row._ds) || {};
    var authors = (book.authors || []).map(function (a) {
      var name = a.display || a.name;
      return '<a href="' + searchHref(a.name) + '">' + escapeHtml(name) + '</a>';
    });

    var out = [];
    out.push('<div class="detail">');
    out.push('<a class="backlink" href="' + backHref() + '">← Back to results</a>');
    out.push('<div class="detail-head"><div class="detail-cover"></div><div>');
    out.push('<h1>' + escapeHtml(book.title || 'Untitled') + '</h1>');
    if (book.subtitle) out.push('<p class="sub">' + escapeHtml(book.subtitle) + '</p>');
    if (book.parallelTitle) out.push('<p class="sub">' + escapeHtml(book.parallelTitle) + '</p>');
    if (authors.length) out.push('<p class="byline">' + authors.join(' · ') + '</p>');

    if (book.description && book.description.text) {
      out.push(
        '<p class="lede">' +
          escapeHtml(book.description.text) +
          (book.description.source === 'derived'
            ? '<span class="derived" title="Composed from the catalogue fields — the source dataset carries no abstract">derived</span>'
            : '') +
          '</p>'
      );
    }

    out.push('<div class="linkrow">');
    if (book.isbn) {
      out.push(link('https://openlibrary.org/isbn/' + book.isbn, 'Open Library'));
      out.push(link('https://www.google.com/search?q=' + encodeURIComponent('ISBN ' + book.isbn), 'Search the web'));
    }
    out.push(link('https://www.hkpl.gov.hk/en/search?q=' + encodeURIComponent(book.title || ''), 'Hong Kong Public Libraries'));
    out.push('</div>');
    out.push('</div></div>');

    /* --- bibliographic --- */
    out.push('<h2 class="section-title">Bibliographic record</h2>');
    out.push('<table class="meta-table"><tbody>');
    row2(out, 'Title', book.title);
    row2(out, 'Subtitle', book.subtitle);
    row2(out, 'Parallel title', book.parallelTitle);
    row2(out, 'Full title statement', book.titleFull);
    row2(out, 'Statement of responsibility', book.statementOfResponsibility);
    row2(
      out,
      'Author(s)',
      (book.authors || []).map(function (a) { return a.display || a.name; }).join(' · ')
    );
    row2(out, 'Edition', book.edition);
    row2(out, 'Series', book.series ? [book.series.title, book.series.number].filter(Boolean).join(' ; ') : '');
    row2(out, 'Frequency', book.frequency);
    out.push('</tbody></table>');

    /* --- publication --- */
    out.push('<h2 class="section-title">Publication</h2>');
    out.push('<table class="meta-table"><tbody>');
    row2(out, 'Publisher', book.publisher);
    row2(out, 'Place of publication', book.place);
    row2(out, 'Date', book.dateRaw || (book.year ? String(book.year) : ''));
    if (book.copyright) {
      row2(
        out,
        'Copyright',
        escapeHtml(book.copyright.statement) +
          (book.copyright.source === 'derived'
            ? '<span class="derived" title="Publisher and year of publication; the source dataset has no rights field">derived</span>'
            : ''),
        true
      );
    }
    row2(out, 'Language of catalogue', languageName(book.language));
    out.push('</tbody></table>');

    /* --- identifiers --- */
    out.push('<h2 class="section-title">Identifiers &amp; physical form</h2>');
    out.push('<table class="meta-table"><tbody>');
    if (book.isbns && book.isbns.length) {
      var isbnHtml = book.isbns
        .map(function (entry) {
          return (
            '<code>' + escapeHtml(entry.value) + '</code>' +
            (entry.qualifier ? ' <span class="tag">' + escapeHtml(entry.qualifier) + '</span>' : '')
          );
        })
        .join('<br>');
      row2(out, 'ISBN', isbnHtml, true);
      if (book.isbns[0] && book.isbns[0].isbn13) row2(out, 'ISBN-13 (normalised)', '<code>' + book.isbns[0].isbn13 + '</code>', true);
    }
    row2(out, 'ISSN', book.issn ? '<code>' + escapeHtml(book.issn) + '</code>' : '', true);
    row2(out, 'Physical description', book.physical ? book.physical.raw : '');
    row2(out, 'Pages', book.physical && book.physical.pages ? book.physical.pages + ' pages' : '');
    row2(out, 'Dimensions', book.physical ? book.physical.dimensions : '');
    row2(out, 'Category', book.classification);
    row2(out, 'Notes', book.notes);
    if (book.price) {
      var price =
        typeof book.price.amount === 'number'
          ? money(book.price.amount, book.price.currency)
          : escapeHtml(book.price.raw || '');
      row2(out, 'Price', price + (book.price.availability ? ' <span class="tag">' + escapeHtml(book.price.availability) + '</span>' : ''), true);
    }
    if (book.extra) {
      Object.keys(book.extra).forEach(function (key) { row2(out, titleCase(key), book.extra[key]); });
    }
    out.push('</tbody></table>');

    /* --- provenance --- */
    out.push('<h2 class="section-title">Record provenance</h2>');
    out.push('<table class="meta-table"><tbody>');
    row2(out, 'Dataset', '<a href="#/about">' + escapeHtml(ds.title || book.dataset || '') + '</a>', true);
    row2(out, 'Registration number', book.ref);
    row2(out, 'Catalogue serial number', book.serial);
    if (book.source) {
      row2(out, 'Release', book.source.label || book.source.quarter);
      if (book.source.url) row2(out, 'Source file', '<a href="' + escapeAttr(book.source.url) + '" rel="noreferrer">' + escapeHtml(fileName(book.source.url)) + '</a>', true);
      if (book.source.file) row2(out, 'Source file', '<code>' + escapeHtml(book.source.file) + '</code>', true);
    }
    row2(out, 'Record id', '<code>' + escapeHtml(book.id) + '</code>', true);
    out.push('</tbody></table>');
    out.push('</div>');

    return out.join('');
  }

  function bigCover(book) {
    return coverEl(
      {
        id: book.id,
        title: book.title,
        authors: (book.authors || []).map(function (a) { return a.display || a.name; }),
        publisher: book.publisher,
        isbn: book.isbn,
        cover: book.cover ? book.cover.url : '',
      },
      true
    );
  }

  function row2(out, label, value, isHtml) {
    if (value === undefined || value === null || value === '') return;
    out.push('<tr><th>' + escapeHtml(label) + '</th><td>' + (isHtml ? value : escapeHtml(String(value))) + '</td></tr>');
  }

  /* ---------------- render: about ---------------- */

  function renderAbout() {
    var out = [];
    out.push('<div class="about">');
    out.push('<a class="backlink" href="' + backHref() + '">← Back to results</a>');
    out.push('<h1>About this site</h1>');
    out.push(
      '<p>A static catalogue of book metadata: ' +
        fmt(rows.length) +
        ' titles, browsable and searchable entirely in the browser. Data is imported from open datasets by a small Node script; nothing is fetched at runtime except the data files themselves' +
        (covers ? ' and cover thumbnails looked up by ISBN' : '') +
        '.</p>'
    );

    out.push('<h2>Datasets</h2>');
    manifest.datasets.forEach(function (ds) {
      out.push('<div class="dscard">');
      out.push('<h3>' + escapeHtml(ds.title) + '</h3>');
      if (ds.description) out.push('<p>' + escapeHtml(ds.description) + '</p>');
      out.push('<ul class="stats">');
      out.push('<li><strong>' + fmt(ds.count) + '</strong>books</li>');
      if (ds.stats) {
        out.push('<li><strong>' + fmt(ds.stats.withIsbn) + '</strong>with an ISBN</li>');
        out.push('<li><strong>' + fmt(ds.stats.publishers) + '</strong>publishers</li>');
        out.push('<li><strong>' + fmt(ds.stats.classifications) + '</strong>categories</li>');
        if (ds.stats.yearRange) out.push('<li><strong>' + ds.stats.yearRange[0] + '–' + ds.stats.yearRange[1] + '</strong>years of publication</li>');
      }
      out.push('</ul>');
      out.push('<p style="margin-top:14px">');
      if (ds.provider) out.push('Provided by ' + escapeHtml(ds.provider) + '.<br>');
      if (ds.homepage) out.push('<a href="' + escapeAttr(ds.homepage) + '" rel="noreferrer">Dataset home</a> · ');
      if (ds.dataDictionary) out.push('<a href="' + escapeAttr(ds.dataDictionary) + '" rel="noreferrer">Data dictionary</a> · ');
      if (ds.licenseUrl) out.push('<a href="' + escapeAttr(ds.licenseUrl) + '" rel="noreferrer">' + escapeHtml(ds.license || 'Licence') + '</a>');
      else if (ds.license) out.push(escapeHtml(ds.license));
      out.push('</p>');
      out.push('<p style="font-size:12.5px">Imported ' + escapeHtml(String(ds.importedAt || '').slice(0, 10)) + ' · ' + ds.sources.length + ' source files · adapter <code>' + escapeHtml(ds.adapter) + '</code></p>');
      out.push('</div>');
    });

    out.push('<h2>Adding another dataset</h2>');
    out.push('<p>Datasets are declared in <code>datasets.json</code> and imported with:</p>');
    out.push(
      '<pre>npm run import                        # everything registered\n' +
        'npm run import -- --add-hkpl-year 2026  # next Hong Kong year\n' +
        'npm run import -- --file books.csv --id my-shelf --title "My shelf"\n' +
        'npm run import -- --url https://host/books.json --id x --title "X"</pre>'
    );
    out.push(
      '<p>CSV and JSON sources are auto-mapped by column name (title, author, publisher, ISBN, description, cover…), so most exports import without configuration. Each import writes slim browse shards plus full-record shards into <code>site/data/</code> and updates the manifest.</p>'
    );

    out.push('<h2>How the metadata is built</h2>');
    out.push(
      '<p>Catalogue records use ISBD punctuation, so <em>“Main title : subtitle = parallel title / statement of responsibility”</em> is split into separate fields. ISBNs, prices, page counts and dimensions are parsed out of free text. Two fields are marked <span class="derived">derived</span>: the description is composed from the catalogue fields (the source has no abstracts) and the copyright line is the publisher plus year of publication.</p>'
    );

    out.push('<h2>Cover images</h2>');
    out.push(
      '<label class="switch"><input type="checkbox" id="covers-toggle"' + (covers ? ' checked' : '') + '> Look up cover images by ISBN</label>'
    );
    out.push(
      '<p style="margin-top:8px">Covers are not part of the source dataset. When enabled, the browser asks <code>books.google.com</code> and then <code>covers.openlibrary.org</code> for a thumbnail matching the ISBN; roughly half of Hong Kong ISBNs resolve, and everything else gets a generated cover. Turn this off to keep the page entirely self-contained — no third-party requests at all.</p>'
    );
    out.push('</div>');

    el.about.innerHTML = out.join('');
    var toggle = document.getElementById('covers-toggle');
    toggle.addEventListener('change', function () {
      covers = toggle.checked;
      localStorage.setItem('covers', covers ? 'on' : 'off');
      renderAbout();
    });
    document.title = 'About the data — Book Registry';
  }

  /* ---------------- helpers ---------------- */

  function updateChrome() {
    var names = manifest.datasets.map(function (d) { return d.shortTitle || d.title; }).join(', ');
    el.footer.innerHTML =
      escapeHtml(names) +
      ' · ' +
      fmt(manifest.totalBooks || 0) +
      ' records · generated ' +
      escapeHtml(String(manifest.generatedAt || '').slice(0, 10)) +
      ' · <a href="#/about">about the data and how to add more</a>';
  }

  function datasetById(id) {
    return manifest.datasets.filter(function (d) { return d.id === id; })[0];
  }

  function datasetName(id) {
    var ds = datasetById(id);
    return ds ? ds.shortTitle || ds.title : id;
  }

  function sourceName(value) {
    var parts = String(value).split('#');
    var ds = datasetById(parts[0]);
    var source = ds && ds.sources ? ds.sources[Number(parts[1])] : null;
    return source ? source.label || source.quarter || parts[1] : value;
  }

  function languageName(code) {
    if (code === 'zh') return 'Chinese';
    if (code === 'en') return 'English';
    return code || '';
  }

  function displayName(facet, value) {
    return facet.name ? facet.name(value) : value;
  }

  function backHref() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.sort !== 'relevance') params.set('sort', state.sort);
    Object.keys(state.filters).forEach(function (key) {
      var set = state.filters[key];
      if (set && set.size) params.set(key, [...set].join('|'));
    });
    var qs = params.toString();
    return '#/' + (qs ? '?' + qs : '');
  }

  function searchHref(term) {
    return '#/?q=' + encodeURIComponent(term);
  }

  function link(href, text) {
    return '<a class="btn" href="' + escapeAttr(href) + '" target="_blank" rel="noreferrer">' + escapeHtml(text) + ' ↗</a>';
  }

  function money(amount, currency) {
    try {
      return new Intl.NumberFormat('en-HK', { style: 'currency', currency: currency || 'HKD' }).format(amount);
    } catch (err) {
      return (currency || '') + ' ' + amount;
    }
  }

  function fmt(n) {
    return Number(n || 0).toLocaleString('en-US');
  }

  function fileName(url) {
    return String(url).split('/').pop();
  }

  function titleCase(text) {
    return String(text).charAt(0).toUpperCase() + String(text).slice(1);
  }

  function highlight(text, terms) {
    var safe = escapeHtml(text);
    if (!terms || !terms.length) return safe;
    terms.forEach(function (term) {
      if (term.length < 1) return;
      var re = new RegExp('(' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
      safe = safe.replace(re, '<mark>$1</mark>');
    });
    return safe;
  }

  function escapeHtml(text) {
    return String(text === undefined || text === null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(text) {
    return escapeHtml(text).replace(/'/g, '&#39;');
  }

  function hash(text) {
    var h = 0;
    for (var i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
    return h;
  }

  function prefersDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function applyTheme(theme) {
    if (theme === 'dark' || theme === 'light') document.documentElement.setAttribute('data-theme', theme);
    else document.documentElement.removeAttribute('data-theme');
  }

  function setViewButtons() {
    document.querySelectorAll('.viewtoggle button').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.view === state.view);
    });
  }

  function showSkeleton() {
    var frag = document.createDocumentFragment();
    for (var i = 0; i < 18; i++) {
      var card = document.createElement('div');
      card.className = 'card';
      var cover = document.createElement('div');
      cover.className = 'cover skeleton';
      var line = document.createElement('div');
      line.className = 'skeleton';
      line.style.height = '13px';
      card.appendChild(cover);
      card.appendChild(line);
      frag.appendChild(card);
    }
    el.grid.appendChild(frag);
  }
})();
