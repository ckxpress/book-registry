/* 神保町 (jinbocho.app) — browse & search UI.
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
  var dbFallbackReason = ''; // set when the database was rejected and JSON took over

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
    shelf: document.getElementById('shelf-view'),
    shelfCount: document.getElementById('shelf-count'),
  };

  /* ---------------- facet definitions ---------------- */

  var FACETS = [
    { key: 'dataset', label: '資料集', get: function (r) { return r._ds; }, name: datasetName, hideIfSingle: true },
    { key: 'language', label: '語言', get: function (r) { return r.language; }, name: languageName },
    { key: 'classification', label: '類別', get: function (r) { return r.classification; }, search: true, limit: 10 },
    { key: 'publisher', label: '出版者', get: function (r) { return r.publisher; }, search: true, limit: 8 },
    { key: 'year', label: '出版年份', get: function (r) { return r.year ? String(r.year) : ''; }, limit: 10, sort: 'key-desc' },
    { key: 'source', label: '發佈季度', get: function (r) { return r._ds + '#' + (r.src || 0); }, name: sourceName, limit: 10 },
    {
      key: 'availability',
      label: '發售狀況',
      get: function (r) { return r.forSale === true ? 'sale' : r.forSale === false ? 'nosale' : ''; },
      name: function (v) { return v === 'sale' ? '售賣品' : '非賣品'; },
    },
    {
      key: 'identifier',
      label: '識別號',
      get: function (r) { return r.isbn ? 'isbn' : ''; },
      name: function () { return '設有 ISBN'; },
    },
  ];

  /* ---------------- boot ---------------- */

  function init() {
    applyTheme(localStorage.getItem('theme'));
    el.sort.value = state.sort;
    setViewButtons();
    wireEvents();
    updateShelfCount();
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
        return source.prepare().catch(function (err) {
          if (source === JsonSource) throw err;
          // Serving stale-but-correct data beats serving wrong data.
          console.warn('SQLite backend unavailable: ' + err.message + '. Falling back to JSON shards.');
          dbFallbackReason = err.message;
          source = JsonSource;
          rows = [];
          byId = new Map();
          return JsonSource.prepare();
        });
      })
      .then(function () {
        el.brandSub.textContent =
          fmt(totalBooks) + ' 本書刊 · ' + manifest.datasets.length + ' 個資料集';
        route();
      })
      .catch(function (err) {
        el.count.textContent = '';
        el.grid.innerHTML = '';
        el.empty.hidden = false;
        el.empty.innerHTML =
          '<h3>未能載入資料</h3><p>' +
          escapeHtml(err.message) +
          '</p><p>請在專案資料夾執行 <code>npm run import</code>，然後重新載入。</p>';
        el.brandSub.textContent = '沒有資料';
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

  /* The catalogue registers Chinese and English books separately, and an
     English record often carries the Chinese form of its title as the
     parallel title ("... = 葉智榮"). This is a Traditional Chinese site, so
     the Chinese form leads wherever a record has one; the other title is kept
     and shown underneath rather than dropped. */
  var CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

  function hasCjk(text) {
    return CJK.test(text || '');
  }

  function displayTitle(row) {
    if (!hasCjk(row.title) && hasCjk(row.parallelTitle)) return row.parallelTitle;
    return row.title || '';
  }

  function altTitle(row) {
    var shown = displayTitle(row);
    if (row.title && row.title !== shown) return row.title;
    if (row.parallelTitle && row.parallelTitle !== shown) return row.parallelTitle;
    return '';
  }

  function haystack(row) {
    return [
      row.title,
      row.parallelTitle,
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

    // A reader arriving with no address of their own gets the Chinese
    // catalogue. Once they touch anything the hash is written, so unticking
    // Chinese sticks rather than being reapplied on the next load.
    if (!hash) state.filters.language = new Set(['zh']);

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
    } else if (path === '/shelf') {
      showView('shelf');
      renderShelf();
    } else {
      showView('browse');
      render();
    }
  }

  function showView(name) {
    el.browse.hidden = name !== 'browse';
    el.detail.hidden = name !== 'detail';
    el.about.hidden = name !== 'about';
    el.shelf.hidden = name !== 'shelf';
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
    var title = ((row.title || '') + ' ' + (row.parallelTitle || '')).toLowerCase();
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

    // Latin sorts before CJK in every standard collation, which would bury
    // ~4,300 English titles ahead of the first Chinese one. Group by script
    // first so a Traditional Chinese catalogue reads as one.
    function script(row) {
      return hasCjk(displayTitle(row)) ? 0 : 1;
    }
    function byTitle(a, b) {
      return script(a) - script(b) || collator.compare(displayTitle(a), displayTitle(b));
    }

    list.sort(function (a, b) {
      switch (mode) {
        case 'title':
          return byTitle(a, b);
        case 'title-desc':
          return script(a) - script(b) || collator.compare(displayTitle(b), displayTitle(a));
        case 'year':
          return (a.year || 9999) - (b.year || 9999) || byTitle(a, b);
        case 'year-desc':
          return (b.year || 0) - (a.year || 0) || byTitle(a, b);
        case 'publisher':
          return collator.compare(a.publisher || 'zzz', b.publisher || 'zzz') || byTitle(a, b);
        default:
          return (b._score || 0) - (a._score || 0) || byTitle(a, b);
      }
    });
  }

  /* ---------------- the reader's shelf ---------------- */

  /**
   * Which books the reader owns.
   *
   * This lives in the browser, because the site is static files with no
   * server: there is nothing to authenticate against and nowhere to keep a
   * profile. That has real consequences the UI is honest about — the shelf is
   * per-device, and clearing site data loses it, so it can be exported and a
   * share link carries it to someone else.
   *
   * Everything above this object goes through its methods, so swapping in a
   * backed store (accounts, cross-device sync, live public profiles) means
   * replacing these four functions, not the interface.
   */
  var Shelf = {
    key: 'shelf.owned',
    _items: null, // id -> { p: asking price or null, at: when added }

    all: function () {
      if (Shelf._items) return Shelf._items;
      var items = {};
      try {
        var raw = JSON.parse(localStorage.getItem(Shelf.key) || 'null');
        if (Array.isArray(raw)) {
          // v1 kept a plain list of ids, before shelves carried a price.
          raw.forEach(function (id) { if (typeof id === 'string') items[id] = { p: null, at: null }; });
        } else if (raw && raw.items) {
          items = raw.items;
        }
      } catch (err) {
        items = {};
      }
      Shelf._items = items;
      return items;
    },

    has: function (id) {
      return Object.prototype.hasOwnProperty.call(Shelf.all(), id);
    },

    get: function (id) {
      return Shelf.all()[id] || null;
    },

    price: function (id) {
      var entry = Shelf.get(id);
      return entry && typeof entry.p === 'number' ? entry.p : null;
    },

    add: function (id, price) {
      Shelf.all()[id] = { p: typeof price === 'number' ? price : null, at: new Date().toISOString() };
      Shelf.save();
    },

    setPrice: function (id, price) {
      var entry = Shelf.get(id);
      if (!entry) return;
      entry.p = typeof price === 'number' ? price : null;
      Shelf.save();
    },

    remove: function (id) {
      delete Shelf.all()[id];
      Shelf.save();
    },

    ids: function () {
      return Object.keys(Shelf.all());
    },

    total: function () {
      return Shelf.ids().reduce(function (sum, id) {
        var p = Shelf.price(id);
        return sum + (p || 0);
      }, 0);
    },

    save: function () {
      try {
        localStorage.setItem(Shelf.key, JSON.stringify({ v: 2, items: Shelf.all() }));
      } catch (err) {
        // Private browsing, or storage full. Say so rather than pretending.
        alert('無法儲存書架：瀏覽器拒絕寫入本機儲存空間。');
      }
      updateShelfCount();
    },

    size: function () {
      return Shelf.ids().length;
    },
  };

  /**
   * Asks what the book should sell for, pre-filled with its catalogue price.
   * Returns the price, or undefined if the reader backed out — null means
   * they deliberately left it blank.
   */
  function askPrice(opts) {
    return new Promise(function (resolve) {
      var dlg = document.getElementById('price-dialog');
      if (!dlg) {
        dlg = document.createElement('dialog');
        dlg.id = 'price-dialog';
        dlg.className = 'price-dialog';
        document.body.appendChild(dlg);
      }

      var original = typeof opts.original === 'number' ? opts.original : null;
      var current = typeof opts.current === 'number' ? opts.current : null;
      var value = current !== null ? current : original;

      dlg.innerHTML =
        '<form method="dialog">' +
        '<h3>' + (opts.editing ? '修改售價' : '加入我的書架') + '</h3>' +
        '<p class="pd-book">' + escapeHtml(opts.title || '') + '</p>' +
        '<label class="pd-field"><span>二手售價</span>' +
        '<span class="pd-input"><i>HK$</i>' +
        '<input type="number" id="pd-price" min="0" step="1" inputmode="decimal" ' +
        'value="' + (value === null ? '' : value) + '" placeholder="未定價"></span></label>' +
        '<p class="pd-hint">' +
        (original !== null ? '原價 ' + money(original, opts.currency || 'HKD') + '，可自行調整。' : '目錄沒有記錄原價。') +
        '留空表示暫不標價。</p>' +
        '<menu>' +
        '<button value="cancel" class="btn">取消</button>' +
        '<button value="ok" class="btn primary">' + (opts.editing ? '儲存' : '加入書架') + '</button>' +
        '</menu></form>';

      var input = dlg.querySelector('#pd-price');
      var settled = false;

      function finish(ok) {
        if (settled) return;
        settled = true;
        dlg.removeEventListener('close', onClose);
        if (!ok) return resolve(undefined);
        var raw = input.value.trim();
        if (raw === '') return resolve(null);
        var n = Number(raw);
        resolve(isNaN(n) || n < 0 ? null : n);
      }

      function onClose() {
        // Esc, or the backdrop — treated as backing out.
        finish(dlg.returnValue === 'ok');
      }

      dlg.addEventListener('close', onClose);
      dlg.showModal();
      input.focus();
      input.select();
    });
  }

  function updateShelfCount() {
    var n = Shelf.size();
    el.shelfCount.hidden = n === 0;
    el.shelfCount.textContent = String(n);
  }

  /**
   * A shelf packed into a URL, since there is no server to host a profile.
   * Ids repeat their dataset, so that is written once and the registration
   * numbers follow.
   */
  function encodeShelf(ids) {
    if (!ids.length) return '';
    var byDataset = {};
    ids.forEach(function (id) {
      var at = id.indexOf(':');
      var ds = at === -1 ? '' : id.slice(0, at);
      var ref = at === -1 ? id : id.slice(at + 1);
      var price = Shelf.price(id);
      // "ref" on its own, or "ref:price" — a shared shelf is a sale list.
      (byDataset[ds] = byDataset[ds] || []).push(price === null ? ref : ref + ':' + price);
    });
    var parts = Object.keys(byDataset).map(function (ds) {
      return ds + '=' + byDataset[ds].join(',');
    });
    return base64url(unescape(encodeURIComponent('2|' + parts.join(';'))));
  }

  function decodeShelf(code) {
    var out = { ids: [], prices: {} };
    try {
      var text = decodeURIComponent(escape(unbase64url(code)));
      var version = text.slice(0, 2);
      if (version !== '1|' && version !== '2|') return out;
      text.slice(2).split(';').forEach(function (chunk) {
        var at = chunk.indexOf('=');
        if (at === -1) return;
        var ds = chunk.slice(0, at);
        chunk.slice(at + 1).split(',').forEach(function (part) {
          if (!part) return;
          // v2 appends ":price"; v1 links carry the reference alone.
          var bits = part.split(':');
          var ref = bits[0];
          var id = ds ? ds + ':' + ref : ref;
          out.ids.push(id);
          if (bits.length > 1 && bits[1] !== '') {
            var n = Number(bits[1]);
            if (!isNaN(n)) out.prices[id] = n;
          }
        });
      });
      return out;
    } catch (err) {
      return out;
    }
  }

  function base64url(raw) {
    return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function unbase64url(code) {
    var b = code.replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    return atob(b);
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
    byIds: function (ids) {
      return Promise.resolve(ids.map(function (id) { return byId.get(id); }).filter(Boolean));
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
                  // `db.url` points the database at another origin — object
                  // storage such as R2 or S3 — for hosts that will not serve
                  // byte ranges of a binary file untouched. It needs CORS.
                  url: db.url ? db.url : abs(DATA + db.file),
                  requestChunkSize: 4096, // several 1 KB pages per request
                  // Some static hosts (GitHub Pages among them) answer HEAD
                  // without content-length, leaving the library unable to
                  // discover the file size. The manifest records it exactly.
                  databaseLengthBytes: db.bytes,
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
          return SqliteSource.query('PRAGMA table_info(books)')
            .then(function (cols) {
              // Databases built before the Chinese-first change lack these.
              SqliteSource._zh = cols.some(function (c) { return c.name === 'zh_first'; });
            })
            .then(SqliteSource.verify);
        });
    },

    /**
     * Reads back a value recorded when the database was built. A host that
     * compresses the file and then applies byte ranges to the compressed
     * stream (GitHub Pages does exactly this) serves a database that opens
     * and answers queries — with wrong answers. Checking one known row costs
     * a single indexed lookup and turns silent corruption into a clean
     * fallback to the JSON shards.
     */
    verify: function () {
      var probe = manifest.db.probe;
      if (!probe) return Promise.resolve();
      return SqliteSource.query('SELECT id FROM books WHERE rowid = ?', [probe.rowid]).then(function (res) {
        if (!res.length || res[0].id !== probe.id) {
          throw new Error(
            'database read back wrong data (expected ' + probe.id + ', got ' +
              (res.length ? res[0].id : 'nothing') + ') — the host may be compressing it'
          );
        }
      });
    },
    page: function (offset, limit) {
      var where = sqlWhere(null);
      var order = sqlOrder();
      var columns =
        'b.id, b.dataset, b.title, b.subtitle, b.authors, b.publisher, b.year, b.isbn,' +
        ' b.classification, b.language, b.series, b.ref, b.src, b.price, b.currency, b.forsale, b.cover' +
        (SqliteSource._zh ? ', b.parallel_title' : '');
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
    byIds: function (ids) {
      if (!ids.length) return Promise.resolve([]);
      var columns =
        'b.id, b.dataset, b.title, b.subtitle, b.authors, b.publisher, b.year, b.isbn,' +
        ' b.classification, b.language, b.series, b.ref, b.src, b.price, b.currency, b.forsale, b.cover' +
        (SqliteSource._zh ? ', b.parallel_title' : '');
      var holes = ids.map(function () { return '?'; }).join(',');
      return SqliteSource.query('SELECT ' + columns + ' FROM books b WHERE b.id IN (' + holes + ')', ids).then(
        function (res) {
          var found = {};
          res.map(mapSqlRow).forEach(function (r) { found[r.id] = r; });
          return ids.map(function (id) { return found[id]; }).filter(Boolean);
        }
      );
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
    // With the Chinese-first columns present, every title ordering groups CJK
    // titles ahead of Latin ones — the same rule the in-memory path applies.
    var t = SqliteSource._zh ? 'b.zh_first, b.title_display' : 'b.title';
    var tDesc = SqliteSource._zh ? 'b.zh_first, b.title_display DESC' : 'b.title DESC';

    switch (state.sort) {
      case 'title':
        return t;
      case 'title-desc':
        return tDesc;
      case 'year':
        return 'b.year IS NULL, b.year, ' + t;
      case 'year-desc':
        return 'b.year IS NULL, b.year DESC, ' + t;
      case 'publisher':
        return "b.publisher = '', b.publisher, " + t;
      default:
        return state.q ? 'bm25(books_fts)' : t;
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
      parallelTitle: r.parallel_title || '',
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
        el.empty.innerHTML = '<h3>查詢失敗</h3><p>' + escapeHtml(err.message) + '</p>';
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
        ? '共 <strong>' + fmt(totalBooks) + '</strong> 本'
        : '<strong>' + fmt(totalResults) + '</strong> 本（全部 ' + fmt(totalBooks) + ' 本）';
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
      // A search for an English title finds nothing while the default Chinese
      // filter is on, so offer the way out rather than leaving a dead end.
      var langFilter = state.filters.language;
      el.empty.innerHTML =
        '<h3>沒有符合的書刊</h3><p>試試減少關鍵詞，或<button class="linkish" id="empty-reset">重設篩選</button>。</p>' +
        (langFilter && langFilter.size
          ? '<p><button class="linkish" id="empty-all-langs">搜尋全部語言的書刊</button></p>'
          : '');
      var reset = document.getElementById('empty-reset');
      if (reset) reset.addEventListener('click', function () { document.getElementById('clear-filters').click(); });
      var allLangs = document.getElementById('empty-all-langs');
      if (allLangs) {
        allLangs.addEventListener('click', function () {
          delete state.filters.language;
          state.page = 1;
          pushRoute();
          render();
        });
      }
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

  /**
   * A card is a container rather than one big link, so the author and
   * publisher can be real links to their own listings. The title link is
   * stretched over the whole card in CSS, which keeps "click anywhere" while
   * leaving the inner links clickable, focusable and openable in a new tab —
   * none of which works with anchors nested inside an anchor.
   */
  function card(row, terms) {
    var a = document.createElement('article');
    a.className = 'card';

    a.appendChild(coverEl(row));

    // One control per card: the grid gets it over the cover, the list gets the
    // labelled one beside the text, where the thumbnail is too small for it.
    // It hangs off the card rather than the cover, because the cover picks up
    // a transform on hover, and a transform traps z-index in its own stacking
    // context — which put the button under the card's click overlay.
    if (state.view !== 'list') a.appendChild(ownButton(row.id, 'icon', row));

    var body = document.createElement('div');
    body.className = 'card-body';

    var title = document.createElement('h3');
    title.className = 'card-title';
    var titleLink = document.createElement('a');
    titleLink.className = 'card-link';
    titleLink.href = '#/book/' + encodeURIComponent(row.id);
    titleLink.innerHTML = highlight(displayTitle(row) || '無題', terms);
    title.appendChild(titleLink);
    body.appendChild(title);

    var other = altTitle(row);
    if (other) {
      var alt = document.createElement('p');
      alt.className = 'card-alt';
      alt.innerHTML = highlight(other, terms);
      body.appendChild(alt);
    }

    if (state.view === 'list' && row.subtitle) {
      var sub = document.createElement('p');
      sub.className = 'card-sub';
      sub.innerHTML = highlight(row.subtitle, terms);
      body.appendChild(sub);
    }

    body.appendChild(metaLine(row, terms));

    if (state.view === 'list') {
      var tags = document.createElement('div');
      tags.className = 'tagrow';
      if (row.classification) tags.appendChild(tag(row.classification));
      if (row.isbn) tags.appendChild(tag('ISBN ' + row.isbn));
      if (typeof row.price === 'number') tags.appendChild(tag(money(row.price, row.currency)));
      else if (row.forSale === false) tags.appendChild(tag('非賣品'));
      body.appendChild(tags);
    }

    if (state.view === 'list') body.appendChild(ownButton(row.id, 'inline', row));

    a.appendChild(body);
    return a;
  }

  /**
   * The own/not-own control.
   *
   * `mode` is 'icon' on a cover in the grid, 'inline' beside a row in the
   * list, and 'long' on a book page. The grid gets it on the cover because
   * below the text it sat at the bottom of a card, after the publisher line,
   * where nobody found it.
   */
  function ownButton(id, mode, row) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'own own-' + mode + (Shelf.has(id) ? ' owned' : '');
    b.dataset.id = id;
    paintOwn(b, mode);
    b.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();

      if (Shelf.has(id)) {
        Shelf.remove(id);
        b.classList.remove('owned');
        paintOwn(b, mode);
        if (!el.shelf.hidden) renderShelf();
        return;
      }

      // Adding asks what it should sell for, starting from the catalogue price.
      askPrice({ title: displayTitle(row), original: row.price, currency: row.currency }).then(function (price) {
        if (price === undefined) return; // backed out
        Shelf.add(id, price);
        b.classList.add('owned');
        paintOwn(b, mode);
        if (!el.shelf.hidden) renderShelf();
      });
    });
    return b;
  }

  function paintOwn(b, mode) {
    var owned = b.classList.contains('owned');
    if (mode === 'icon') b.textContent = owned ? '✓' : '＋';
    else if (mode === 'long') b.textContent = owned ? '✓ 已在我的書架' : '＋ 加入我的書架';
    else b.textContent = owned ? '✓ 我有' : '＋ 我有';
    var label = owned ? '從我的書架移除' : '加入我的書架';
    b.setAttribute('aria-pressed', String(owned));
    b.setAttribute('aria-label', label);
    b.title = label;
  }

  /** Author and publisher as links to their own listings. */
  function metaLine(row, terms) {
    var meta = document.createElement('p');
    meta.className = 'card-meta';

    (row.authors || []).forEach(function (name, i) {
      if (i) meta.appendChild(document.createTextNode('、'));
      meta.appendChild(metaLink(name, searchHref(name), terms, '搜尋著者：' + name));
    });

    if ((row.authors || []).length) meta.appendChild(document.createElement('br'));

    if (row.publisher) {
      // The publisher is a facet, so this filters exactly rather than searching.
      meta.appendChild(
        metaLink(row.publisher, '#/?publisher=' + encodeURIComponent(row.publisher), terms, '瀏覽出版者：' + row.publisher)
      );
    }
    if (row.year) {
      if (row.publisher) meta.appendChild(document.createTextNode(' · '));
      meta.appendChild(document.createTextNode(String(row.year)));
    }
    return meta;
  }

  /** Same link, built as HTML for the book page's tables and byline. */
  function metaLinkHtml(text, href, label) {
    return (
      '<a class="meta-link" href="' + escapeAttr(href) + '" title="' + escapeAttr(label) + '">' +
      escapeHtml(text) +
      '</a>'
    );
  }

  function authorHref(author) {
    // Search the name as it is displayed and indexed: the catalogue stores it
    // inverted ("Luk, Ming Man Liza") but the index holds the natural form, so
    // searching the raw value finds nothing.
    return searchHref(author.display || author.name);
  }

  function metaLink(text, href, terms, label) {
    var link = document.createElement('a');
    link.className = 'meta-link';
    link.href = href;
    link.innerHTML = highlight(text, terms);
    link.title = label;
    return link;
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
    // When the build has already resolved covers, a record without one is
    // known not to have one. Probing again per visitor would mean two failed
    // requests for most of the catalogue, for nothing.
    if (manifest && manifest.coversResolvedAt) return [];
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
    t.textContent = displayTitle(row) || '無題';
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
        input.placeholder = '篩選' + facet.label + '…';
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
        more.textContent = '顯示其餘 ' + (visible.length - list.length) + ' 項';
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

    el.detail.innerHTML = '<div class="detail"><a class="backlink" href="' + backHref() + '">← 返回搜尋結果</a>' +
      '<div class="detail-head"><div class="cover skeleton"></div><div><div class="skeleton" style="height:30px;width:70%"></div>' +
      '<div class="skeleton" style="height:16px;width:40%;margin-top:12px"></div></div></div></div>';

    source.record(id).then(function (book) {
      if (token !== renderToken) return;
      if (!book) {
        el.detail.innerHTML =
          '<div class="detail"><a class="backlink" href="#/">← 返回全部書刊</a>' +
          '<h1>找不到此書刊</h1><p>已載入的資料集中沒有這個編號 <code>' +
          escapeHtml(id) +
          '</code>.</p></div>';
        return;
      }
      el.detail.innerHTML = detailHtml(book, book);
      var host = el.detail.querySelector('.detail-cover');
      if (host) host.replaceWith(bigCover(book, book));
      var ownHost = el.detail.querySelector('#detail-own');
      if (ownHost) {
        ownHost.replaceWith(
          ownButton(book.id, 'long', {
            id: book.id,
            title: book.title,
            parallelTitle: book.parallelTitle,
            price: book.price && typeof book.price.amount === 'number' ? book.price.amount : null,
            currency: book.price ? book.price.currency : 'HKD',
          })
        );
      }
      document.title = (displayTitle(book) || '書刊') + ' — 神保町';
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
      return metaLinkHtml(name, authorHref(a), '搜尋著者：' + name);
    });

    var out = [];
    out.push('<div class="detail">');
    out.push('<a class="backlink" href="' + backHref() + '">← 返回搜尋結果</a>');
    out.push('<div class="detail-head"><div class="detail-cover"></div><div>');
    out.push('<h1>' + escapeHtml(displayTitle(book) || '無題') + '</h1>');
    var otherTitle = altTitle(book);
    if (otherTitle) out.push('<p class="sub">' + escapeHtml(otherTitle) + '</p>');
    if (book.subtitle) out.push('<p class="sub">' + escapeHtml(book.subtitle) + '</p>');
    if (authors.length) out.push('<p class="byline">' + authors.join(' · ') + '</p>');

    if (book.description && book.description.text) {
      out.push(
        '<p class="lede">' +
          escapeHtml(book.description.text) +
          (book.description.source === 'derived'
            ? '<span class="derived" title="由目錄各欄位組成——原始資料集沒有內容簡介">推算</span>'
            : '') +
          '</p>'
      );
    }

    out.push('<div class="linkrow"><span id="detail-own"></span>');
    if (book.isbn) {
      out.push(link('https://openlibrary.org/isbn/' + book.isbn, 'Open Library'));
      out.push(link('https://www.google.com/search?q=' + encodeURIComponent('ISBN ' + book.isbn), '網上搜尋'));
    }
    out.push(link('https://www.hkpl.gov.hk/en/search?q=' + encodeURIComponent(book.title || ''), '香港公共圖書館'));
    out.push('</div>');
    out.push('</div></div>');

    /* --- bibliographic --- */
    out.push('<h2 class="section-title">書目紀錄</h2>');
    out.push('<table class="meta-table"><tbody>');
    row2(out, '書刊名', book.title);
    row2(out, '副題', book.subtitle);
    row2(out, '並列書名', book.parallelTitle);
    row2(out, '完整書名著錄', book.titleFull);
    row2(out, '責任者說明', book.statementOfResponsibility);
    row2(
      out,
      '著者',
      (book.authors || [])
        .map(function (a) {
          var name = a.display || a.name;
          return metaLinkHtml(name, authorHref(a), '搜尋著者：' + name);
        })
        .join(' · '),
      true
    );
    row2(out, '版次', book.edition);
    row2(out, '叢書', book.series ? [book.series.title, book.series.number].filter(Boolean).join(' ; ') : '');
    row2(out, '出版刊期', book.frequency);
    out.push('</tbody></table>');

    /* --- publication --- */
    out.push('<h2 class="section-title">出版資料</h2>');
    out.push('<table class="meta-table"><tbody>');
    row2(
      out,
      '出版者',
      book.publisher
        ? metaLinkHtml(book.publisher, '#/?publisher=' + encodeURIComponent(book.publisher), '瀏覽出版者：' + book.publisher)
        : '',
      true
    );
    row2(out, '出版地', book.place);
    row2(out, '出版年份', book.dateRaw || (book.year ? String(book.year) : ''));
    if (book.copyright) {
      row2(
        out,
        '版權',
        escapeHtml(book.copyright.statement) +
          (book.copyright.source === 'derived'
            ? '<span class="derived" title="出版者及出版年份；原始資料集沒有版權欄位">derived</span>'
            : ''),
        true
      );
    }
    row2(out, '目錄語言', languageName(book.language));
    out.push('</tbody></table>');

    /* --- identifiers --- */
    out.push('<h2 class="section-title">識別號及形態</h2>');
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
      row2(out, '國際標準書號', isbnHtml, true);
      if (book.isbns[0] && book.isbns[0].isbn13) row2(out, 'ISBN-13（標準化）', '<code>' + book.isbns[0].isbn13 + '</code>', true);
    }
    row2(out, '國際標準期刊號', book.issn ? '<code>' + escapeHtml(book.issn) + '</code>' : '', true);
    row2(out, '著錄', book.physical ? book.physical.raw : '');
    row2(out, '頁數', book.physical && book.physical.pages ? book.physical.pages + ' 頁' : '');
    row2(out, '尺寸', book.physical ? book.physical.dimensions : '');
    row2(out, '類別', book.classification);
    row2(out, '附註', book.notes);
    if (book.price) {
      var price =
        typeof book.price.amount === 'number'
          ? money(book.price.amount, book.price.currency)
          : escapeHtml(book.price.raw || '');
      row2(out, '定價', price + (book.price.availability ? ' <span class="tag">' + escapeHtml(book.price.availability) + '</span>' : ''), true);
    }
    if (book.extra) {
      Object.keys(book.extra).forEach(function (key) { row2(out, titleCase(key), book.extra[key]); });
    }
    out.push('</tbody></table>');

    /* --- provenance --- */
    out.push('<h2 class="section-title">紀錄來源</h2>');
    out.push('<table class="meta-table"><tbody>');
    row2(out, '資料集', '<a href="#/about">' + escapeHtml(ds.title || book.dataset || '') + '</a>', true);
    row2(out, '參考編號', book.ref);
    row2(out, '順序編號', book.serial);
    if (book.source) {
      row2(out, '發佈季度', book.source.label || book.source.quarter);
      if (book.source.url) row2(out, '來源檔案', '<a href="' + escapeAttr(book.source.url) + '" rel="noreferrer">' + escapeHtml(fileName(book.source.url)) + '</a>', true);
      if (book.source.file) row2(out, 'Source file', '<code>' + escapeHtml(book.source.file) + '</code>', true);
    }
    row2(out, '紀錄編號', '<code>' + escapeHtml(book.id) + '</code>', true);
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

  /* ---------------- render: bookshelf ---------------- */

  /**
   * Renders either the reader's own shelf, or one someone sent them — the
   * shared case is read-only and carries its books in the URL, because there
   * is no server holding profiles.
   */
  function renderShelf() {
    var params = new URLSearchParams((location.hash.split('?')[1] || ''));
    var shared = params.get('s');
    var decoded = shared ? decodeShelf(shared) : null;
    var ids = shared ? decoded.ids : Shelf.ids();
    var sharedPrices = shared ? decoded.prices : null;
    var mine = !shared;

    var out = [];
    out.push('<div class="shelf">');
    out.push('<a class="backlink" href="#/">← 返回全部書刊</a>');
    out.push('<h1>' + (mine ? '我的書架' : '分享的書架') + '</h1>');

    if (!ids.length) {
      out.push(
        mine
          ? '<p class="shelf-empty">書架還是空的。在任何書刊上按「＋ 我有」，就會收進這裡。</p>'
          : '<p class="shelf-empty">這個分享連結沒有包含任何書刊。</p>'
      );
      out.push('</div>');
      el.shelf.innerHTML = out.join('');
      document.title = (mine ? '我的書架' : '分享的書架') + ' — 神保町';
      return;
    }

    var priced = mine ? ids.filter(function (id) { return Shelf.price(id) !== null; }).length : sharedPrices ? Object.keys(sharedPrices).length : 0;
    var total = mine ? Shelf.total() : Object.keys(sharedPrices || {}).reduce(function (n, k) { return n + (sharedPrices[k] || 0); }, 0);
    out.push(
      '<p class="shelf-count">共 <strong>' + fmt(ids.length) + '</strong> 本' +
        (priced ? ' · 已標價 <strong>' + fmt(priced) + '</strong> 本，合計 <strong>' + money(total, 'HKD') + '</strong>' : '') +
        '</p>'
    );
    if (mine) {
      out.push(
        '<div class="shelf-actions">' +
          '<button class="btn" id="shelf-share">分享書架</button>' +
          '<button class="btn" id="shelf-export">匯出 JSON</button>' +
          '<label class="btn" for="shelf-import">匯入 JSON<input id="shelf-import" type="file" accept="application/json" hidden></label>' +
          '</div>' +
          '<p class="shelf-note">書架儲存在這部裝置的瀏覽器中，並未上載。清除瀏覽資料會一併清除書架，建議匯出備份。</p>'
      );
    } else {
      out.push('<p class="shelf-note">這是別人分享的書架，內容來自連結本身。</p>');
    }
    out.push('<div class="grid" id="shelf-grid"></div>');
    out.push('</div>');
    el.shelf.innerHTML = out.join('');
    document.title = (mine ? '我的書架' : '分享的書架') + ' — 神保町';

    var grid = document.getElementById('shelf-grid');
    grid.className = 'grid' + (state.view === 'list' ? ' list' : '');
    source.byIds(ids).then(function (rows) {
      if (!rows.length) {
        grid.outerHTML = '<p class="shelf-empty">找不到這些書刊，可能來自尚未載入的資料集。</p>';
        return;
      }
      var frag = document.createDocumentFragment();
      rows.forEach(function (row) {
        var el2 = card(row, []);
        el2.appendChild(priceTag(row, mine, sharedPrices));
        frag.appendChild(el2);
      });
      grid.appendChild(frag);
    });

    if (mine) wireShelfActions(ids);
  }

  /** The asking price under a book on the shelf — editable when it is yours. */
  function priceTag(row, mine, sharedPrices) {
    var price = mine ? Shelf.price(row.id) : sharedPrices && typeof sharedPrices[row.id] === 'number' ? sharedPrices[row.id] : null;
    var wrap = document.createElement('div');
    wrap.className = 'price-tag';

    var label = document.createElement('span');
    label.className = 'price-value' + (price === null ? ' unpriced' : '');
    label.textContent = price === null ? '未定價' : money(price, 'HKD');
    wrap.appendChild(label);

    if (!mine) return wrap;

    var edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'price-edit';
    edit.textContent = '改價';
    edit.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      askPrice({
        title: displayTitle(row),
        original: row.price,
        currency: row.currency,
        current: price,
        editing: true,
      }).then(function (next) {
        if (next === undefined) return;
        Shelf.setPrice(row.id, next);
        renderShelf();
      });
    });
    wrap.appendChild(edit);
    return wrap;
  }

  function wireShelfActions(ids) {
    var share = document.getElementById('shelf-share');
    share.addEventListener('click', function () {
      var url = location.origin + location.pathname + '#/shelf?s=' + encodeShelf(ids);
      copyText(url).then(function (ok) {
        share.textContent = ok ? '已複製連結 ✓' : '請手動複製';
        if (!ok) window.prompt('複製這個連結來分享書架：', url);
        setTimeout(function () { share.textContent = '分享書架'; }, 2500);
      });
    });

    document.getElementById('shelf-export').addEventListener('click', function () {
      var blob = new Blob(
        [
          JSON.stringify(
            {
              version: 2,
              owned: ids.map(function (id) { return { id: id, price: Shelf.price(id) }; }),
            },
            null,
            2
          ),
        ],
        { type: 'application/json' }
      );
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'my-bookshelf.json';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    });

    document.getElementById('shelf-import').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var data = JSON.parse(String(reader.result));
          var incoming = Array.isArray(data) ? data : data.owned;
          if (!Array.isArray(incoming)) throw new Error('格式不符');
          // Merge rather than replace: an import should not silently drop books.
          incoming.forEach(function (entry) {
            if (typeof entry === 'string') { if (!Shelf.has(entry)) Shelf.add(entry, null); }
            else if (entry && entry.id && !Shelf.has(entry.id)) Shelf.add(entry.id, entry.price);
          });
          renderShelf();
        } catch (err) {
          alert('無法匯入：' + err.message);
        }
      };
      reader.readAsText(file);
    });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return false; });
    }
    return Promise.resolve(false);
  }

  /* ---------------- render: about ---------------- */

  function renderAbout() {
    var out = [];
    out.push('<div class="about">');
    out.push('<a class="backlink" href="' + backHref() + '">← 返回搜尋結果</a>');
    out.push('<h1>關於本站</h1>');
    out.push(
      '<p><strong>神保町</strong>（jinbocho.app）是一個靜態書刊資料目錄，收錄 ' +
        fmt(rows.length) +
        ' 項書刊，全部瀏覽與搜尋均在瀏覽器內完成。資料由一個小型 Node 程式從公開資料集匯入；除資料檔案本身' +
        (covers ? '及以 ISBN 查詢的封面縮圖' : '') +
        '外，執行時不會向外抓取任何內容。</p>'
    );

    if (dbFallbackReason) {
      out.push(
        '<p class="lede">本站備有供大型目錄使用的 SQLite 資料庫，但在此無法使用：' +
          escapeHtml(dbFallbackReason) +
          '。現改用同一批紀錄的 JSON 版本，所見資料同樣正確。</p>'
      );
    }

    out.push('<h2>資料集</h2>');
    manifest.datasets.forEach(function (ds) {
      out.push('<div class="dscard">');
      out.push('<h3>' + escapeHtml(ds.title) + '</h3>');
      if (ds.description) out.push('<p>' + escapeHtml(ds.description) + '</p>');
      out.push('<ul class="stats">');
      out.push('<li><strong>' + fmt(ds.count) + '</strong>項書刊</li>');
      if (ds.stats) {
        out.push('<li><strong>' + fmt(ds.stats.withIsbn) + '</strong>設有 ISBN</li>');
        out.push('<li><strong>' + fmt(ds.stats.publishers) + '</strong>個出版者</li>');
        out.push('<li><strong>' + fmt(ds.stats.classifications) + '</strong>個類別</li>');
        if (ds.stats.yearRange) out.push('<li><strong>' + ds.stats.yearRange[0] + '–' + ds.stats.yearRange[1] + '</strong>出版年份跨度</li>');
      }
      out.push('</ul>');
      out.push('<p style="margin-top:14px">');
      if (ds.provider) out.push('資料提供：' + escapeHtml(ds.provider) + '<br>');
      if (ds.homepage) out.push('<a href="' + escapeAttr(ds.homepage) + '" rel="noreferrer">資料集首頁</a> · ');
      if (ds.dataDictionary) out.push('<a href="' + escapeAttr(ds.dataDictionary) + '" rel="noreferrer">資料字典</a> · ');
      if (ds.licenseUrl) out.push('<a href="' + escapeAttr(ds.licenseUrl) + '" rel="noreferrer">' + escapeHtml(ds.license || '使用條款') + '</a>');
      else if (ds.license) out.push(escapeHtml(ds.license));
      out.push('</p>');
      out.push('<p style="font-size:12.5px">匯入日期 ' + escapeHtml(String(ds.importedAt || '').slice(0, 10)) + ' · ' + ds.sources.length + ' 個來源檔案 · 轉換器 <code>' + escapeHtml(ds.adapter) + '</code></p>');
      out.push('</div>');
    });

    out.push('<h2>加入其他資料集</h2>');
    out.push('<p>資料集在 <code>datasets.json</code> 中宣告，並以下列指令匯入：</p>');
    out.push(
      '<pre>npm run import                        # 匯入全部已登記資料集\n' +
        'npm run import -- --add-hkpl-year 2026  # 下一年香港目錄\n' +
        'npm run import -- --file books.csv --id my-shelf --title "My shelf"\n' +
        'npm run import -- --url https://host/books.json --id x --title "X"</pre>'
    );
    out.push(
      '<p>CSV 與 JSON 來源會按欄位名稱自動對應（書名、著者、出版者、ISBN、簡介、封面…），因此大部分匯出檔無需設定即可匯入。每次匯入會在 <code>site/data/</code> 寫入精簡的瀏覽分片及完整紀錄分片，並更新 manifest。</p>'
    );

    out.push('<h2>資料如何整理</h2>');
    out.push(
      '<p>目錄紀錄採用 ISBD 標點，因此<em>「正書名 : 副題 = 並列書名 / 責任者說明」</em>會拆分為獨立欄位。ISBN、定價、頁數與尺寸皆從自由文本中解析。兩個欄位標示為<span class="derived">推算</span>：內容簡介由目錄欄位組成（原始資料沒有簡介），版權一行則為出版者加出版年份。</p><p>目錄分中英文兩冊出版，不少英文紀錄以並列書名記載中文書名。本站以中文書名為主，另一語言的書名顯示於其下。</p>'
    );

    out.push('<h2>封面圖片</h2>');
    out.push(
      '<label class="switch"><input type="checkbox" id="covers-toggle"' + (covers ? ' checked' : '') + '> 以 ISBN 查詢封面圖片</label>'
    );
    out.push(
      '<p style="margin-top:8px">原始資料集並不包含封面。封面已於製作資料時逐一以 ISBN 向 Google Books 查證' +
        (manifest.coversFound ? '，當中 ' + fmt(manifest.coversFound) + ' 項找到封面' : '') +
        '，其餘自動生成，瀏覽時不會再逐本查詢。香港出版的書刊大多未被掃描收錄：本目錄以上市公司年報、教科書及政府刊物為主，Open Library 幾乎沒有香港 ISBN，而有收錄的網上書店則拒絕程式存取。關閉此選項後，本頁不會向第三方發出任何請求。</p>'
    );
    out.push('</div>');

    el.about.innerHTML = out.join('');
    var toggle = document.getElementById('covers-toggle');
    toggle.addEventListener('change', function () {
      covers = toggle.checked;
      localStorage.setItem('covers', covers ? 'on' : 'off');
      renderAbout();
    });
    document.title = '資料說明 — 神保町';
  }

  /* ---------------- helpers ---------------- */

  function updateChrome() {
    var names = manifest.datasets.map(function (d) { return d.shortTitle || d.title; }).join(', ');
    el.footer.innerHTML =
      escapeHtml(names) +
      ' · ' +
      fmt(manifest.totalBooks || 0) +
      ' 項紀錄 · 製作於 ' +
      escapeHtml(String(manifest.generatedAt || '').slice(0, 10)) +
      ' · <a href="#/about">資料說明及新增資料集方法</a>';
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
    if (code === 'zh') return '中文';
    if (code === 'en') return '英文';
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
  // Started here, not above: the objects init() touches are assigned as it
  // reads down the file, so calling earlier finds them undefined.
  init();
})();
