/* CEO 19.10: where this visit came from - the SAME site opened in three ways.
   1. Telegram Mini App (the bot's menu button «Магазин» or a web_app button): Telegram puts #tgWebAppData=<initData> into the URL.
      The initData is kept for this tab (sessionStorage) and sent with the checkout; the worker checks its signature (bot token HMAC)
      and puts the order straight into the customer's chat with the bot. The checkout does not ask the name / Telegram contact.
   2. Instagram / WhatsApp: the bot's link carries ?c=<signed chat marker>; it is kept 14 days (localStorage) and sent with the checkout,
      so the order lands back in that Instagram / WhatsApp conversation.
   3. Anything else: nothing changes. Never throws; storage may be blocked (private mode) - then only this page view knows. */
(function () {
  var INIT_KEY = 'ukr_tg_init', MARK_KEY = 'ukr_chat_marker', MARK_TTL = 14 * 24 * 3600 * 1000;
  var MARK_RE = /^(ig|wa)\.[A-Za-z0-9_-]{1,64}\.[0-9a-z]{1,10}\.[A-Za-z0-9_-]{22}$/;
  function sget(s, k) { try { return window[s].getItem(k); } catch (e) { return null; } }
  function sset(s, k, v) { try { window[s].setItem(k, v); } catch (e) { /* storage blocked */ } }
  var init = '', marker = '';
  /* 1. Telegram: the launch hash, else this tab's saved copy */
  try {
    var h = location.hash ? new URLSearchParams(location.hash.slice(1)) : null, d = h && h.get('tgWebAppData');
    if (d && /(?:^|&)hash=[0-9a-f]{64}(?:&|$)/.test(d)) { init = d; sset('sessionStorage', INIT_KEY, d); }
  } catch (e) { /* old browser */ }
  if (!init) init = sget('sessionStorage', INIT_KEY) || '';
  /* 2. Instagram / WhatsApp marker: the link's ?c=, else the saved one while fresh */
  try {
    var q = new URLSearchParams(location.search).get('c');
    if (q && MARK_RE.test(q)) { marker = q; sset('localStorage', MARK_KEY, JSON.stringify({ m: q, at: Date.now() })); }
  } catch (e) { /* old browser */ }
  if (!marker) { try { var s = JSON.parse(sget('localStorage', MARK_KEY) || 'null'); if (s && MARK_RE.test(s.m) && Date.now() - s.at < MARK_TTL) marker = s.m; } catch (e) { /* bad copy */ } }

  function webApp() { return (window.Telegram && window.Telegram.WebApp) || null; }
  function initData() { var w = webApp(); return (w && w.initData) || init; }
  /* the Telegram user from initData (display only: the worker trusts nothing it did not verify) */
  function tgUser() {
    var d = initData(); if (!d) return null;
    try { var u = JSON.parse(new URLSearchParams(d).get('user') || 'null'); return u && typeof u.id === 'number' ? u : null; } catch (e) { return null; }
  }
  var inTg = !!initData();
  if (inTg) {
    document.documentElement.classList.add('in-tg');
    /* the official script: ready / expand / close. Loaded only inside Telegram (no third-party request for other visitors) */
    var w0 = webApp();
    var setup = function () { var w = webApp(); if (!w) return; try { w.ready(); w.expand(); } catch (e) { /* older client */ } };
    if (w0) setup();
    else { var sc = document.createElement('script'); sc.src = 'https://telegram.org/js/telegram-web-app.js'; sc.async = true; sc.onload = setup; document.head.appendChild(sc); }
  }
  window.SHOP_CHANNEL = {
    inTelegram: function () { return !!initData(); },
    initData: initData,
    tgUser: tgUser,
    /* the name to show: first + last name, else @username */
    tgName: function () { var u = tgUser(); if (!u) return ''; var n = [u.first_name, u.last_name].filter(Boolean).join(' ').trim(); return n || (u.username ? '@' + u.username : ''); },
    marker: function () { return inTg ? '' : marker; },
    channel: function () { return inTg ? 'telegram' : marker ? (marker.charAt(0) === 'w' ? 'whatsapp' : 'instagram') : ''; },
    /* the order is in the chat: back to it (Telegram closes the Mini App) */
    close: function () { var w = webApp(); if (w && w.close) { try { w.close(); return true; } catch (e) { /* fall through */ } } return false; },
    /* a t.me link from inside the Mini App: Telegram opens it itself */
    openTg: function (url) { var w = webApp(); if (w && w.openTelegramLink && /^https:\/\/t\.me\//.test(url)) { try { w.openTelegramLink(url); return true; } catch (e) { /* fall through */ } } return false; },
    /* the checkout body gets the proof of where it came from */
    decorate: function (payload) {
      var d = initData(); if (d) payload.tg_init_data = d; else if (marker) payload.chat_marker = marker;
      return payload;
    }
  };
})();
