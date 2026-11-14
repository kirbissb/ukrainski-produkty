/* Trial report tracker (CEO 03.11.2026, events added the same day): tells the shop's worker what real people do on the site. Three things, all fire-and-forget:
   1. OPEN - "a real person opened the site", once per visitor per day per source (POST /api/open, unchanged).
   2. VIEW - one page view per page load, after the page has been VISIBLE for 1.5 s (POST /api/event {t:"v", p:<path>}).
   3. CLICK - a click on one of the main actions, by a small FIXED list of names: order, add_to_cart, cart_open, write, call, special (POST /api/event {t:"c", e:<name>, p:<path>}).
      The site's own buttons are found by their ids / classes (#barBtn = order, .btn.add and .cb-add = add_to_cart, #cartBtn = cart_open, #specialBtn = special), a link to t.me / wa.me /
      ig.me / instagram.com = write, a tel: link = call; any element may also carry data-track="<name>" with one of the six names.
   No cookie, no personal data, no third party. The browser keeps ONE random id in localStorage; the worker stores only a daily salted hash of it (a new value every day), so a "session" is
   a visitor-day. Counts only what real page JS sees: nothing is sent while the page is hidden, prefetched, prerendered or in a background tab. It never touches the site: every line is in
   try/catch, the requests are fire-and-forget (sendBeacon), nothing waits for them, and a click handler only READS the click (it never stops or changes it). Source = ?src=group|instagram|
   whatsapp|bot (the /go/<src> link adds it), else the Instagram / WhatsApp marker ?c=ig.|wa. the bot's own links carry, else the Telegram Mini App = bot, else other; kept for the tab.
   The owner's own browser: open the site once with ?notrack=1 and the tracker stays off there (?notrack=0 turns it back on).
   Placeholders (filled by the site build, like assets/engine.js): https://ukr-alanya-bot-test.bot-engine.workers.dev = the bot worker, ukr = the site's storage prefix. */
(function () {
  'use strict';
  try {
    var BASE = 'https://ukr-alanya-bot-test.bot-engine.workers.dev', K = 'ukr_trk', SHOW_MS = 1500, SRC = ['group', 'instagram', 'whatsapp', 'bot'], NAMES = ['order', 'add_to_cart', 'cart_open', 'write', 'call', 'special'];
    if (BASE.indexOf('{{') !== -1 || K.indexOf('{{') !== -1) return; /* the build did not fill the placeholders: stay silent */
    var OPEN_URL = BASE + '/api/open', EVENT_URL = BASE + '/api/event';
    function get(s, k) { try { return window[s].getItem(k); } catch (e) { return null; } }
    function set(s, k, v) { try { window[s].setItem(k, v); } catch (e) { /* storage blocked: this page view only */ } }
    var q = null; try { q = new URLSearchParams(location.search); } catch (e) { q = null; }
    if (q && q.get('notrack') === '1') set('localStorage', K + '_off', '1');
    if (q && q.get('notrack') === '0') { try { localStorage.removeItem(K + '_off'); } catch (e) { /* ignore */ } }
    if (get('localStorage', K + '_off') === '1') return;
    /* the visitor's random id (never sent anywhere but as the body of these requests) */
    var vid = get('localStorage', K + '_vid');
    if (!vid || !/^[A-Za-z0-9_-]{16,40}$/.test(vid)) {
      var a = []; try { var u = new Uint8Array(18); (window.crypto || window.msCrypto).getRandomValues(u); a = Array.prototype.slice.call(u); } catch (e) { for (var i = 0; i < 18; i++) a.push(Math.floor(Math.random() * 256)); }
      vid = btoa(String.fromCharCode.apply(null, a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); set('localStorage', K + '_vid', vid);
    }
    function send(url, obj) {
      var body = JSON.stringify(obj);
      try { if (navigator.sendBeacon && navigator.sendBeacon(url, body)) return; } catch (e) { /* fall through */ }
      try { fetch(url, { method: 'POST', body: body, keepalive: true, mode: 'cors', credentials: 'omit' }).catch(function () { /* nobody waits */ }); } catch (e) { /* nobody waits */ }
    }
    function path() { try { var p = location.pathname || '/'; return p.length > 120 ? '/' : p; } catch (e) { return '/'; } }
    function visible() { return document.visibilityState === 'visible' && !document.prerendering; }

    /* ---- what to run once the page has been visible for 1.5 s ---- */
    var onShown = [];
    onShown.push(function () { send(EVENT_URL, { v: vid, t: 'v', p: path() }); }); /* VIEW: every page load, once */

    /* ---- OPEN: source; once per day per source in this browser (the worker also ignores a repeat) ---- */
    var src = q && q.get('src'); src = src && SRC.indexOf(src) !== -1 ? src : '';
    if (src) set('sessionStorage', K + '_src', src); else src = get('sessionStorage', K + '_src') || '';
    if (!src) {
      var c = q && q.get('c'), h = location.hash || '';
      if (c && /^ig\./.test(c)) src = 'instagram'; else if (c && /^wa\./.test(c)) src = 'whatsapp';
      else if (/tgWebAppData=/.test(h) || (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData)) src = 'bot';
      else src = 'other';
      set('sessionStorage', K + '_src', src);
    }
    var d = new Date(), day = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(), seen = null;
    try { seen = JSON.parse(get('localStorage', K + '_seen') || 'null'); } catch (e) { seen = null; }
    if (!seen || seen.d !== day) seen = { d: day, s: [] };
    if (seen.s.indexOf(src) === -1) onShown.push(function () {
      if (seen.s.indexOf(src) !== -1) return;
      seen.s.push(src); set('localStorage', K + '_seen', JSON.stringify(seen));
      send(OPEN_URL, { v: vid, s: src });
    });

    var timer = 0, done = false;
    function fire() { if (done) return; done = true; for (var k = 0; k < onShown.length; k++) { try { onShown[k](); } catch (e) { /* one failing step never stops the next */ } } }
    function check() { clearTimeout(timer); if (!done && visible()) timer = setTimeout(function () { if (visible()) fire(); }, SHOW_MS); }
    document.addEventListener('visibilitychange', check);
    document.addEventListener('prerenderingchange', check);
    check();

    /* ---- CLICK: a read-only listener on the whole page; it never stops, changes or waits for the click ---- */
    var last = {}, sent = 0;
    function nameOf(el) {
      for (var n = 0; el && el.nodeType === 1 && n < 8; el = el.parentElement, n++) {
        var t = el.getAttribute && el.getAttribute('data-track'); if (t && NAMES.indexOf(t) !== -1) return t;
        var id = el.id, cl = ' ' + (el.className && el.className.baseVal === undefined ? el.className : '') + ' ', tag = el.tagName, href = tag === 'A' ? (el.getAttribute('href') || '') : '';
        if (id === 'barBtn') return 'order';
        if (id === 'cartBtn') return 'cart_open';
        if (id === 'specialBtn') return 'special';
        if (tag === 'BUTTON' && (cl.indexOf(' cb-add ') !== -1 || (cl.indexOf(' btn ') !== -1 && cl.indexOf(' add ') !== -1))) return 'add_to_cart';
        if (/^tel:/i.test(href)) return 'call';
        if (/^https?:\/\/(t\.me|telegram\.me|wa\.me|api\.whatsapp\.com|ig\.me|(www\.)?instagram\.com)\//i.test(href)) return 'write';
      }
      return '';
    }
    document.addEventListener('click', function (ev) {
      try {
        if (!visible() || sent >= 40) return;
        var name = nameOf(ev.target); if (!name) return;
        var now = Date.now(); if (last[name] && now - last[name] < 700) return; last[name] = now; sent++;
        send(EVENT_URL, { v: vid, t: 'c', e: name, p: path() });
      } catch (e) { /* the tracker must never break the click */ }
    }, true);
  } catch (e) { /* the tracker must never break the page */ }
})();
