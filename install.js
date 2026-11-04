/* 神保町 jinbocho.app — "add to home screen / dock" encouragement.
 *
 * Two different worlds to serve:
 *   Chrome, Edge, Samsung, Brave  — fire `beforeinstallprompt`, so we can
 *     stash the event and open the real browser install dialog on a tap.
 *   Safari (iOS and macOS)        — no API at all, by Apple's choice. The only
 *     thing we can do is tell the visitor which menu to open, in words that
 *     match what they will actually see on screen.
 *
 * Politeness rules, because an install nag is the fastest way to lose someone:
 *   - never when already running installed
 *   - the banner waits for the second visit, and never returns once dismissed
 *   - the top-bar button is always there for anyone who wants it sooner
 */
(function () {
  'use strict';

  var KEY_VISITS = 'visits';
  var KEY_DISMISSED = 'install-dismissed';

  var deferred = null; // the stashed beforeinstallprompt event
  var btn = null;
  var nudge = null;

  /* ---------------- environment ---------------- */

  function standalone() {
    if (navigator.standalone === true) return true; // iOS
    if (!window.matchMedia) return false;
    return ['standalone', 'minimal-ui', 'fullscreen', 'window-controls-overlay'].some(function (m) {
      return window.matchMedia('(display-mode: ' + m + ')').matches;
    });
  }

  function platform() {
    var ua = navigator.userAgent;
    // iPadOS 13+ reports itself as a Mac; the touch points give it away.
    var iOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    if (iOS) return 'ios';
    if (/Firefox\//.test(ua)) return 'firefox';
    // Chrome, Edge and friends all carry "Safari" in the UA, so exclude them.
    if (/Safari\//.test(ua) && !/Chrome|Chromium|Edg\/|OPR\/|CriOS|FxiOS/.test(ua)) return 'mac-safari';
    return 'other';
  }

  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, value);
    } catch (e) {}
    return null;
  }

  /* ---------------- service worker ---------------- */

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function (err) {
        console.warn('service worker not registered:', err && err.message);
      });
    });
  }

  /* ---------------- the top-bar button ---------------- */

  function mountButton() {
    // The menu panel, not the action bar: on a wide screen it lays its
    // children out inline anyway, and on a narrow one this puts 安裝 inside
    // the ☰ with the rest.
    var actions = document.getElementById('menu-panel') || document.querySelector('.topbar-actions');
    if (!actions || document.getElementById('install-btn')) return;

    btn = document.createElement('button');
    btn.id = 'install-btn';
    btn.type = 'button';
    btn.className = 'btn ghost install-btn';
    btn.title = '安裝應用程式';
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<path d="M12 3v11"/><path d="M8 11l4 4 4-4"/><path d="M4 19h16"/></svg>' +
      '<span>安裝</span>';
    btn.setAttribute('aria-label', '安裝應用程式');
    btn.addEventListener('click', function () {
      install('button');
    });
    actions.insertBefore(btn, actions.firstChild);
  }

  function showButton() {
    mountButton();
    if (btn) btn.hidden = false;
  }

  function hideEverything() {
    if (btn) btn.hidden = true;
    closeNudge();
  }

  /* ---------------- installing ---------------- */

  function install(source) {
    if (deferred) {
      // Chromium: hand over to the browser's own dialog.
      deferred.prompt();
      deferred.userChoice
        .then(function (choice) {
          if (choice && choice.outcome === 'accepted') hideEverything();
        })
        .catch(function () {})
        .then(function () {
          deferred = null; // single use
        });
      if (source === 'nudge') closeNudge();
      return;
    }
    openSheet();
  }

  /* ---------------- the Safari / fallback instruction sheet ---------------- */

  var SHARE_ICON =
    '<svg class="is-glyph" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M12 3v12"/><path d="M8 7l4-4 4 4"/>' +
    '<path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/></svg>';

  var STEPS = {
    ios: {
      title: '加到主畫面',
      lead: '只需三步，神保町就會像一般應用程式一樣出現在主畫面。',
      steps: [
        '按瀏覽器下方（或右上角）的「分享」' + SHARE_ICON,
        '在選單中向下捲動，選「加入主畫面」',
        '按右上角的「加入」',
      ],
      note: '這一步必須在 Safari 完成；由其他 App 內開啟的網頁未必有此選項。',
    },
    'mac-safari': {
      title: '加入 Dock',
      lead: 'Safari 可以把神保町變成一個獨立視窗的應用程式。',
      steps: ['在選單列選「檔案」', '選「加入 Dock…」', '按「加入」'],
      note: '需要 macOS Sonoma（Safari 17）或以上。較舊版本可改用 Chrome 或 Edge 安裝。',
    },
    firefox: {
      title: '安裝應用程式',
      lead: '',
      steps: [
        'Android 版 Firefox：開啟右上角選單，選「安裝」',
        '桌面版 Firefox 暫未支援安裝網頁應用程式',
      ],
      note: '想在電腦上安裝，可用 Chrome、Edge 或 Safari 開啟 jinbocho.app。',
    },
    other: {
      title: '安裝應用程式',
      lead: '',
      steps: ['開啟瀏覽器選單', '選「安裝應用程式」或「加入主畫面」'],
      note: '',
    },
  };

  function openSheet() {
    var info = STEPS[platform()] || STEPS.other;

    var dlg = document.getElementById('install-sheet');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'install-sheet';
      dlg.className = 'install-sheet';
      document.body.appendChild(dlg);
    }

    var items = info.steps
      .map(function (s, i) {
        return '<li><b>' + (i + 1) + '</b><span>' + s + '</span></li>';
      })
      .join('');

    dlg.innerHTML =
      '<form method="dialog">' +
      '<div class="is-head">' +
      '<img src="icons/icon-192.png" width="52" height="52" alt="" />' +
      '<div><h3>' + info.title + '</h3>' +
      '<p class="is-lead">' + (info.lead || '安裝後可離線瀏覽，書架亦留在這部裝置上。') + '</p></div>' +
      '</div>' +
      '<ol class="is-steps">' + items + '</ol>' +
      (info.note ? '<p class="is-note">' + info.note + '</p>' : '') +
      '<menu><button value="ok" class="btn primary">知道了</button></menu>' +
      '</form>';

    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
    closeNudge();
  }

  /* ---------------- the second-visit banner ---------------- */

  function openNudge() {
    if (nudge || store(KEY_DISMISSED)) return;

    nudge = document.createElement('div');
    nudge.className = 'install-nudge';
    nudge.setAttribute('role', 'region');
    nudge.setAttribute('aria-label', '安裝應用程式');
    nudge.innerHTML =
      '<img src="icons/icon-192.png" width="44" height="44" alt="" />' +
      '<div class="in-text"><strong>把神保町加到' +
      (platform() === 'ios' ? '主畫面' : '桌面') +
      '</strong>' +
      '<span>一按即開，離線也可用。</span></div>' +
      '<button type="button" class="btn primary in-go">安裝</button>' +
      '<button type="button" class="btn ghost in-x" aria-label="不用了">✕</button>';

    nudge.querySelector('.in-go').addEventListener('click', function () {
      install('nudge');
    });
    nudge.querySelector('.in-x').addEventListener('click', function () {
      store(KEY_DISMISSED, '1');
      closeNudge();
    });

    document.body.appendChild(nudge);
    // Next frame, so the entrance transition actually runs.
    requestAnimationFrame(function () {
      if (nudge) nudge.classList.add('in');
    });
  }

  function closeNudge() {
    if (!nudge) return;
    var node = nudge;
    nudge = null;
    node.classList.remove('in');
    setTimeout(function () {
      if (node.parentNode) node.parentNode.removeChild(node);
    }, 250);
  }

  /* ---------------- wiring ---------------- */

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); // suppress Chrome's own mini-infobar; we ask in our own time
    deferred = e;
    showButton();
    maybeNudge();
  });

  window.addEventListener('appinstalled', function () {
    deferred = null;
    store(KEY_DISMISSED, '1');
    hideEverything();
  });

  function maybeNudge() {
    if (standalone() || store(KEY_DISMISSED)) return;
    var visits = Number(store(KEY_VISITS) || 0);
    if (visits < 2) return;
    setTimeout(openNudge, 2500); // let the books paint first
  }

  function start() {
    if (standalone()) return; // already installed — nothing to sell

    var visits = Number(store(KEY_VISITS) || 0) + 1;
    store(KEY_VISITS, String(visits));

    // Safari gets no event, so the button has to be offered outright.
    var p = platform();
    if (p === 'ios' || p === 'mac-safari') {
      showButton();
      maybeNudge();
    }
    // Chromium shows its button from the beforeinstallprompt handler above.
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
