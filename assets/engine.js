/* ukr.product.alanya - demo C engine (round 2). Plain JS: browser (window.Engine) and node (module.exports).
   Same function names as SPEC: parseCatalog, cartAdd/cartSet, totals, orderNumber, saveOrder, loadOrders, applyOverrides, pickList, parseBotCommand. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var THIN = ' '; // narrow no-break space for thousands
  /* orders live under a new key since 10.10 (numbers changed from UA-1043 to the real bot's №101 format); the old key is
     migrated once by migrateOrders() below */
  var KEYS = { orders: 'ukr-demo-orders-v2', ordersOld: 'ukr-demo-orders', customer: 'ukr-demo-customer', stock: 'ukr-demo-stock', prices: 'ukr-demo-prices', cart: 'ukr-demo-cart',
    lang: 'ukr-lang', notify: 'ukr-demo-notify', newitems: 'ukr-demo-newitems', delivery: 'ukr-demo-delivery', special: 'ukr-demo-special' };
  var HOUR = 3600000;
  var NEW_BATCH_HOURS = 48;
  var CATALOG = null;
  var store = null;

  function memoryStore() { var m = {}; return { get: function (k) { return m[k] === undefined ? null : m[k]; }, set: function (k, v) { m[k] = v; } }; }
  function pickStore() {
    if (store) return store;
    try {
      if (typeof localStorage !== 'undefined') {
        store = { get: function (k) { return localStorage.getItem(k); }, set: function (k, v) { localStorage.setItem(k, v); } };
        return store;
      }
    } catch (e) { /* sandbox or private mode */ }
    store = memoryStore();
    return store;
  }
  function readJSON(key, fallback) { try { var raw = pickStore().get(key); return raw ? JSON.parse(raw) : fallback; } catch (e) { return fallback; } }
  function writeJSON(key, value) { try { pickStore().set(key, JSON.stringify(value)); } catch (e) { /* ignore */ } }

  /* ---------- units, money, weight (3 languages) ---------- */
  var UNITS = {
    ru: { kg: 'кг', g: 'г', pc: 'шт', per100: '/100 г', perkg: '/кг', perpc: '/шт' },
    uk: { kg: 'кг', g: 'г', pc: 'шт', per100: '/100 г', perkg: '/кг', perpc: '/шт' },
    en: { kg: 'kg', g: 'g', pc: 'pc', per100: '/100 g', perkg: '/kg', perpc: '/pc' }
  };
  function U(lang) { return UNITS[lang] || UNITS.ru; }
  function groupDigits(n) {
    var s = String(Math.abs(Math.round(n))), out = '';
    while (s.length > 3) { out = THIN + s.slice(-3) + out; s = s.slice(0, -3); }
    return (n < 0 ? '-' : '') + s + out;
  }
  function fmtMoney(n, cur) { return groupDigits(n) + (cur === 'USD' ? THIN + '$' : ' ₺'); }
  function fmtWeight(item, qty, lang) {
    var u = U(lang);
    if (item.unit === 'pc') return qty + ' ' + u.pc;
    if (qty >= 1000) return (Math.round(qty / 10) / 100).toString().replace('.', ',') + ' ' + u.kg;
    return qty + ' ' + u.g;
  }
  function fmtKg(kg, lang) { return (Math.round(kg * 100) / 100).toString().replace('.', ',') + ' ' + U(lang).kg; }
  function unitLabel(item, lang) {
    var u = U(lang);
    if (item.unit === 'kg') return u.perkg;
    if (item.unit === '100g') return u.per100;
    return item.pack_g ? '/' + item.pack_g + ' ' + u.g : u.perpc;
  }
  /* live catalog (CEO 11.10): a price Margo has not named yet is null -> the card says so, the item can still be ordered */
  var PRICE_TBD = { ru: 'цена уточняется', uk: 'ціна уточнюється', en: 'price on request' };
  function priceTbd(lang) { return PRICE_TBD[lang] || PRICE_TBD.ru; }
  function hasPrice(item) { return item.price != null && isFinite(Number(item.price)); }
  function priceLabel(item, lang) { return hasPrice(item) ? fmtMoney(item.price, item.currency) + unitLabel(item, lang) : priceTbd(lang); }
  /* money in two currencies, never converted: "<TRY> ₺ + <USD> $" (dollar items are priced in $ by the seller) */
  function fmtPair(tryAmt, usdAmt) {
    if (usdAmt && !tryAmt) return fmtMoney(usdAmt, 'USD');
    if (usdAmt) return fmtMoney(tryAmt) + ' + ' + fmtMoney(usdAmt, 'USD');
    return fmtMoney(tryAmt || 0);
  }

  /* ---------- catalog ---------- */
  function parseCatalog(raw) {
    var c = JSON.parse(JSON.stringify(raw));
    c.byId = {}; c.catById = {}; c.deliveryById = {}; c.paymentById = {};
    var seedSince = Date.now() - 5 * HOUR;
    c.items.forEach(function (it, idx) { it.order = idx; c.byId[it.id] = it; if (it.state === 'new_batch' && !it.since) it.since = seedSince; });
    c.categories.forEach(function (cat) { c.catById[cat.id] = cat; });
    c.delivery.forEach(function (d) { c.deliveryById[d.id] = d; });
    c.payment.forEach(function (p) { c.paymentById[p.id] = p; });
    CATALOG = c;
    return c;
  }
  /* stock override shape (SPEC): { itemId: { state, day, qty, since } }; legacy booleans are accepted */
  function applyOverrides(catalog) {
    var c = catalog || CATALOG;
    var stock = readJSON(KEYS.stock, {});
    var prices = readJSON(KEYS.prices, {});
    var extra = readJSON(KEYS.newitems, []);
    extra.forEach(function (n) {
      if (!c.byId[n.id]) { n.order = c.items.length; c.items.push(n); c.byId[n.id] = n; }
    });
    c.items.forEach(function (it) {
      if (Object.prototype.hasOwnProperty.call(stock, it.id)) {
        var s = stock[it.id];
        if (typeof s === 'boolean') s = { state: s ? 'in_stock' : 'sold_out' };
        it.state = s.state || 'in_stock'; it.day = s.day || null; it.qty = s.qty || null; it.since = s.since || null;
      }
      if (Object.prototype.hasOwnProperty.call(prices, it.id)) it.price = Number(prices[it.id]);
    });
    return c;
  }
  function itemState(it, now) {
    var st = it.state || 'in_stock';
    if (st === 'new_batch' && it.since && (now || Date.now()) - it.since > NEW_BATCH_HOURS * HOUR) return 'in_stock';
    return st;
  }
  function setState(id, patch) {
    var s = readJSON(KEYS.stock, {});
    var cur = s[id] && typeof s[id] === 'object' ? s[id] : {};
    var next = { state: patch.state, day: patch.day || null, qty: patch.qty || null, since: patch.state === 'new_batch' ? (patch.since || Date.now()) : null };
    if (patch.keepDay && cur.day && !patch.day) next.day = cur.day;
    s[id] = next; writeJSON(KEYS.stock, s);
    return next;
  }
  function setStock(id, inStock) { return setState(id, { state: inStock ? 'in_stock' : 'sold_out' }); }
  function setPrice(id, price) { var p = readJSON(KEYS.prices, {}); p[id] = Math.round(price); writeJSON(KEYS.prices, p); }
  /* "следующая поставка четверг": the day lands on every item that is sold out right now */
  function setNextBatch(day, catalog) {
    var c = applyOverrides(catalog || CATALOG); var n = 0;
    c.items.forEach(function (it) { if (itemState(it) === 'sold_out') { setState(it.id, { state: 'sold_out', day: day }); n++; } });
    return n;
  }
  function addNewItem(item) { var list = readJSON(KEYS.newitems, []); list.push(item); writeJSON(KEYS.newitems, list); return item; }
  function resetOverrides() { writeJSON(KEYS.stock, {}); writeJSON(KEYS.prices, {}); writeJSON(KEYS.newitems, []); writeJSON(KEYS.delivery, {}); }

  /* ---------- live catalog (CEO 11.10, spec "Live catalog contract"): GET /api/catalog on the bot's worker ->
     { updated_at, min_order:{sum, currency}, items:[{id, price_per|null, currency, unit:"g"|"pcs", in_stock, state}],
       added:[{id, name, unit, price_per, currency, in_stock}] }; price_per is per kg for "g", per piece for "pcs".
     mergeLiveCatalog is pure: a NEW catalog = static + live (price, currency, unit, stock per id; cabinet goods in their own
     first category "Новинки", no photo; the order minimum). Anything malformed is skipped, never thrown. ---------- */
  var CATALOG_URL = 'https://ukr-alanya-bot-test.bot-engine.workers.dev/api/catalog';
  var SITE_STATES = { in_stock: 1, few_left: 1, sold_out: 1, preorder: 1, not_now: 1, new_batch: 1 };
  var NEW_CAT = { id: 'new', name_ru: 'Новинки', name_uk: 'Новинки', name_en: 'New in' };
  var WEIGHT_STEPS = [250, 500, 1000];
  function liveNum(v) { return v == null || v === '' || !isFinite(Number(v)) ? null : Number(v); }
  function livePrice(siteUnit, pricePer) {
    var p = liveNum(pricePer); if (p == null || p < 0) return null;
    return siteUnit === '100g' ? Math.round(p * 10) / 100 : p;   /* per kg -> per 100 g for items the site prices per 100 g */
  }
  function liveCur(cur, fallback) { return cur === 'USD' || cur === 'TRY' ? cur : fallback; }
  /* stock: the bot's state wins; in_stock:false can only be sold_out / preorder / not_now; the site's "new batch" badge stays
     on an item the bot reports in stock */
  function liveState(staticState, li) {
    var s = li.state;
    if (li.in_stock === false) return s === 'preorder' || s === 'not_now' ? s : 'sold_out';
    if (s === 'few_left' || s === 'preorder' || s === 'not_now') return s;
    if (li.in_stock === true || s === 'in_stock') return staticState === 'new_batch' ? 'new_batch' : 'in_stock';
    return SITE_STATES[s] ? s : staticState;
  }
  function indexCatalog(c) {
    c.byId = {}; c.catById = {}; c.deliveryById = {}; c.paymentById = {};
    c.items.forEach(function (it, idx) { it.order = idx; c.byId[it.id] = it; });
    c.categories.forEach(function (cat) { c.catById[cat.id] = cat; });
    (c.delivery || []).forEach(function (d) { c.deliveryById[d.id] = d; });
    (c.payment || []).forEach(function (p) { c.paymentById[p.id] = p; });
    return c;
  }
  function liveOk(live) { return !!(live && typeof live === 'object' && Array.isArray(live.items)); }
  function mergeLiveCatalog(catalog, live) {
    var src = catalog || CATALOG;
    var c = JSON.parse(JSON.stringify({ shop: src.shop, categories: src.categories, items: src.items, delivery: src.delivery, payment: src.payment, rules: src.rules || {}, reviews: src.reviews }));
    indexCatalog(c);
    if (!liveOk(live)) return c;
    live.items.forEach(function (li) {
      var it = li && c.byId[li.id]; if (!it) return;
      var u = li.unit === 'pcs' || li.unit === 'pc' ? 'pc' : li.unit === 'g' || li.unit === 'kg' ? 'w' : null;
      if (u === 'pc' && it.unit !== 'pc') { it.unit = 'pc'; it.steps_g = [1]; it.pack_g = null; }
      else if (u === 'w' && it.unit === 'pc') { it.unit = 'kg'; it.steps_g = WEIGHT_STEPS.slice(); it.pack_g = null; }
      if (Object.prototype.hasOwnProperty.call(li, 'price_per')) { it.price = livePrice(it.unit, li.price_per); it.demo = false; }
      it.currency = liveCur(li.currency, it.currency);
      var before = it.state || 'in_stock', st = liveState(before, li);
      if (st !== before) { it.state = st; it.qty = null; if (st !== 'sold_out' && st !== 'preorder') it.day = null; if (st !== 'new_batch') it.since = null; }
      if (li.next_day && (st === 'sold_out' || st === 'preorder')) it.day = li.next_day;
      it.live = true;
    });
    var added = (Array.isArray(live.added) ? live.added : []).filter(function (a) { return a && a.id && String(a.name || '').trim() && !c.byId[a.id]; });
    if (added.length) {
      if (!c.catById[NEW_CAT.id]) c.categories.unshift(JSON.parse(JSON.stringify(NEW_CAT)));
      added.forEach(function (a) {
        var pc = a.unit === 'pcs' || a.unit === 'pc', name = String(a.name).trim();
        c.items.push({ id: String(a.id), cat: NEW_CAT.id, name_ru: name, name_uk: String(a.name_uk || name).trim(), name_en: String(a.name_en || name).trim(),
          desc_ru: '', desc_uk: '', desc_en: '', unit: pc ? 'pc' : 'kg', price: livePrice(pc ? 'pc' : 'kg', a.price_per), currency: liveCur(a.currency, 'TRY'),
          steps_g: pc ? [1] : WEIGHT_STEPS.slice(), pack_g: null, demo: false, photo: typeof a.photo === 'string' && /^https:\/\//.test(a.photo) ? a.photo : null, keys: [name.toLowerCase().replace(/ё/g, 'е')],
          state: a.in_stock === false ? 'sold_out' : a.state === 'few_left' ? 'few_left' : 'in_stock', added: true, live: true });
      });
    }
    var mo = live.min_order;
    if (mo && liveNum(mo.sum) != null && (mo.currency == null || mo.currency === 'TRY')) c.rules.min_order = liveNum(mo.sum);
    /* CEO 24.10: the courier fee the owner set in her Cabinet (facts.courier_fee) is the price the cart counts */
    var cf = live.facts && live.facts.courier_fee, al = c.deliveryById && c.deliveryById.alanya;
    if (cf && al && (cf.currency == null || cf.currency === 'TRY')) { al.price = liveNum(cf.sum); if (cf.from && al.price > 0) al.price_from = true; else delete al.price_from; }
    c.live = { updated_at: live.updated_at || null, added: added.length };
    return indexCatalog(c);
  }
  /* -> Promise<live | null>; null on timeout (3 s), network error, non-200 or a malformed body. Never throws. */
  function fetchLiveCatalog(fetchFn, url, timeoutMs) {
    var f = fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) return Promise.resolve(null);
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null, timer = null;
    var timeout = new Promise(function (res) { timer = setTimeout(function () { if (ctl) try { ctl.abort(); } catch (e) { /* ignore */ } res(null); }, timeoutMs || 3000); });
    var req;
    try { req = Promise.resolve(f(url || CATALOG_URL, ctl ? { signal: ctl.signal, cache: 'no-cache' } : {})); } catch (e) { req = Promise.resolve(null); }
    req = req.then(function (r) {
      if (!r || !r.ok) return null;
      return r.json().then(function (j) { return liveOk(j) ? j : null; }, function () { return null; });
    }, function () { return null; });
    return Promise.race([req, timeout]).then(function (v) { clearTimeout(timer); return v; });
  }

  /* ---------- CEO 24.10: an open tab follows the owner's Cabinet ----------
     The page asks /api/catalog again every 60-120 s (random, so many open tabs do not ask together) and when the tab comes back
     (visibilitychange). The worker answers an unchanged catalog with an empty 304 (ETag); the page redraws only when liveSig changed. */
  var LIVE_POLL_MIN_MS = 60000, LIVE_POLL_MAX_MS = 120000;
  function livePollDelay(rnd) { var r = rnd == null ? Math.random() : rnd; return Math.round(LIVE_POLL_MIN_MS + r * (LIVE_POLL_MAX_MS - LIVE_POLL_MIN_MS)); }
  /* what the page shows from a live answer (updated_at moves with every chat turn of the bot, it is not shown) */
  function liveSig(live) {
    if (!liveOk(live)) return '';
    var o = {}; Object.keys(live).sort().forEach(function (k) { if (k !== 'updated_at') o[k] = live[k]; });
    return JSON.stringify(o);
  }
  /* the cart lines whose unit price changed between two catalogs -> [{id, was, now, cur}] (null = no price) */
  function cartPriceChanges(cart, before, after) {
    var out = [];
    (cart || []).forEach(function (l) {
      var a = before && before.byId && before.byId[l.id], b = after && after.byId && after.byId[l.id];
      if (!a || !b) return;
      var pa = hasPrice(a) ? Number(a.price) : null, pb = hasPrice(b) ? Number(b.price) : null;
      if (pa !== pb || a.currency !== b.currency || a.unit !== b.unit) { if (!out.some(function (x) { return x.id === l.id; })) out.push({ id: l.id, was: pa, now: pb, cur: b.currency }); }
    });
    return out;
  }
  /* the shop facts texts with the owner's live values over the generated ones (assets/shop-facts.js); the words are the same as
     bot-engine/scripts/gen-site-facts.ts (W) so a live fact reads exactly like a generated one. -> a NEW facts object, F untouched */
  var FW = {
    from: { ru: 'от {m}', uk: 'від {m}', en: 'from {m}' }, free: { ru: 'бесплатно', uk: 'безкоштовно', en: 'free' },
    priceTbd: { ru: 'цену уточним', uk: 'ціну уточнимо', en: 'price to be confirmed' },
    noMin: { ru: 'минимального заказа нет', uk: 'мінімального замовлення немає', en: 'no minimum order' },
    min: { ru: 'минимальный заказ - {m}', uk: 'мінімальне замовлення - {m}', en: 'minimum order {m}' },
    pickup: { ru: 'самовывоз', uk: 'самовивіз', en: 'pickup' }   /* a new address: the generated label named the old place */
  };
  /* CEO 24.10 point 11: facts.pickup_days = 0-6, Monday = 0 (absent = every day) -> a sorted list, or null when absent / malformed / all 7 */
  var DAY_SHORT = { ru: ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'], uk: ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд'], en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] };
  function pickupDays(fx) {
    var d = fx && Array.isArray(fx.pickup_days) ? fx.pickup_days.filter(function (x, i, a) { return x === Math.floor(x) && x >= 0 && x <= 6 && a.indexOf(x) === i; }) : null;
    return d && d.length && d.length < 7 ? d.slice().sort(function (a, b) { return a - b; }) : null;
  }
  /* the days as the bot says them (bot-engine src/site-live.ts daysText): runs of 3+ days as a range 'пн-пт', the rest one by one;
     the range hyphen is held by word joiners (U+2060), so a phone line never breaks 'пн-' / 'пт' */
  function daysText(days, lg) {
    var n = DAY_SHORT[lg] || DAY_SHORT.ru, out = [];
    for (var i = 0; i < days.length;) { var j = i; while (j + 1 < days.length && days[j + 1] === days[j] + 1) j++; out.push(j - i >= 2 ? n[days[i]] + '\u2060-\u2060' + n[days[j]] : days.slice(i, j + 1).map(function (x) { return n[x]; }).join(', ')); i = j + 1; }
    return out.join(', ');
  }
  function liveFacts(F, live) {
    var out = JSON.parse(JSON.stringify(F || { t: { ru: {}, uk: {}, en: {} }, delivery: [], payment: [], rules: {} }));
    if (!liveOk(live)) return out;
    var fx = live.facts || {}, L = ['ru', 'uk', 'en'];
    L.forEach(function (lg) {
      var x = out.t[lg] = out.t[lg] || {};
      var a = fx.pickup_address; if (a && typeof a.ru === 'string' && a.ru.trim()) { x.pickup_addr = String(a[lg] || a.ru).trim(); x.pickup = FW.pickup[lg]; }
      var h = fx.pickup_hours; if (h && /^\d\d:\d\d$/.test(h.open) && /^\d\d:\d\d$/.test(h.close)) x.pickup_hours = h.open + '-' + h.close;
      /* CEO 24.10 point 11: the pickup days (sent only when she does not hand out every day) next to the hours: '10:00-19:00, пн-пт' */
      var pd = pickupDays(fx); if (pd) x.pickup_hours = (x.pickup_hours ? x.pickup_hours + ', ' : '') + daysText(pd, lg);
      var cf = fx.courier_fee; if (cf && (cf.currency == null || cf.currency === 'TRY')) { var n = liveNum(cf.sum); x.courier_fees = n == null ? FW.priceTbd[lg] : n === 0 ? FW.free[lg] : cf.from ? FW.from[lg].replace('{m}', fmtMoney(n)) : fmtMoney(n); }
      var mo = live.min_order; if (mo && liveNum(mo.sum) != null && (mo.currency == null || mo.currency === 'TRY') && liveNum(mo.sum) !== ((F && F.rules && F.rules.min_order) || 0)) x.min = liveNum(mo.sum) > 0 ? FW.min[lg].replace('{m}', fmtMoney(liveNum(mo.sum))) : FW.noMin[lg];
    });
    var cf2 = fx.courier_fee; if (cf2) (out.delivery || []).forEach(function (d) { if (d.id === 'alanya') { d.price = liveNum(cf2.sum); if (cf2.from && d.price > 0) d.price_from = true; else delete d.price_from; } });
    if (live.min_order && liveNum(live.min_order.sum) != null) out.rules = Object.assign({}, out.rules, { min_order: liveNum(live.min_order.sum) });
    return out;
  }

  var STATE_ORDER = { new_batch: 0, in_stock: 1, preorder: 2, few_left: 3, sold_out: 4, not_now: 5 };
  /* front page order (SPEC item 5): new_batch, in_stock, preorder, few_left, sold_out; not_now hidden from "all" */
  function sortItems(items, cat, now) {
    var list = items.filter(function (it) { return (cat === 'all' || it.cat === cat) && (cat !== 'all' || itemState(it, now) !== 'not_now'); });
    return list.map(function (it) { return it; }).sort(function (a, b) {
      var d = STATE_ORDER[itemState(a, now)] - STATE_ORDER[itemState(b, now)];
      if (!d && itemState(a, now) === 'new_batch') { var ds = (b.since || 0) - (a.since || 0); if (ds) return ds; }
      return d || a.order - b.order;
    });
  }
  var DAYS = { mon: ['понедельник', 'понеділок'], tue: ['вторник', 'вівторок'], wed: ['среда', 'середа'], thu: ['четверг', 'четвер'], fri: ['пятница', 'п\'ятниця'], sat: ['суббота', 'субота'], sun: ['воскресенье', 'неділя'] };
  var DAY_FORMS = { mon: /^(понедельник|понеділок)$/, tue: /^(вторник|вівторок)$/, wed: /^(среду|среда|середу|середа)$/, thu: /^(четверг|четвер)$/, fri: /^(пятницу|пятница|п'ятницю|п'ятниця)$/, sat: /^(субботу|суббота|суботу|субота)$/, sun: /^(воскресенье|воскресение|неділю|неділя)$/ };
  function dayKey(text) {
    var t = norm(text);
    for (var k in DAY_FORMS) if (DAY_FORMS[k].test(t)) return k;
    return null;
  }

  /* ---------- cart ---------- */
  /* cart = [{id, qty}] ; qty in grams for kg/100g items, pieces for pc items */
  function lineSum(item, qty) {
    if (!hasPrice(item)) return null;
    var base = item.unit === 'kg' ? item.price * qty / 1000 : item.unit === '100g' ? item.price * qty / 100 : item.price * qty;
    return Math.round(base);
  }
  function cartAdd(cart, id, qty) {
    var next = cart.slice(), i = -1;
    next.forEach(function (l, idx) { if (l.id === id) i = idx; });
    if (i >= 0) { var o = { id: id, qty: next[i].qty + qty }; if (next[i].pre) o.pre = true; next[i] = o; } else next.push({ id: id, qty: qty });
    return next;
  }
  function cartSet(cart, id, qty) {
    var next = [], found = false;
    cart.forEach(function (l) { if (l.id === id) { found = true; if (qty > 0) next.push(l.pre ? { id: id, qty: qty, pre: true } : { id: id, qty: qty }); } else next.push(l); });
    if (!found && qty > 0) next.push({ id: id, qty: qty });
    return next;
  }
  function cartStep(item) { return item.unit === 'pc' ? 1 : (item.steps_g && item.steps_g[0]) || 100; }
  function deliveryPrice(d, subtotal) { if (!d) return 0; if (d.free_from && subtotal >= d.free_from) return 0; return d.price || 0; }
  /* pre-order: item in preorder state, or a sold-out item ordered "for the next delivery" (cart line flag pre:true) */
  function cartAddPre(cart, id, qty) {
    var next = cartAdd(cart, id, qty);
    return next.map(function (l) { return l.id === id ? { id: l.id, qty: l.qty, pre: true } : l; });
  }
  /* subtotal/delivery/total = TRY part only; usd = dollar part, kept separate (no rate). Minimum order applies to the TRY part only */
  function totals(cart, deliveryId, catalog) {
    var c = catalog || CATALOG, lines = [], subtotal = 0, usd = 0, unpriced = [];
    cart.forEach(function (l) {
      var it = c.byId[l.id]; if (!it) return;
      var sum = lineSum(it, l.qty);
      if (sum == null) unpriced.push(it.name_ru); else if (it.currency === 'USD') usd += sum; else subtotal += sum;
      var st = itemState(it);
      lines.push({ id: it.id, name: it.name_ru, qty: l.qty, unit: it.unit, price: it.price, cur: it.currency, sum: sum, weight: fmtWeight(it, l.qty, 'ru'), pre: st === 'preorder' || (!!l.pre && (st === 'sold_out' || st === 'not_now')) });
    });
    var delivery = deliveryPrice(c.deliveryById[deliveryId], subtotal);
    var min = (c.rules && c.rules.min_order) || 0;
    var hasTry = lines.some(function (x) { return x.cur !== 'USD'; });
    /* a lira line without a price yet (live catalog, price_per null) cannot be counted: the minimum is not enforced then -
       Margo names the price when she confirms the order */
    var tryUnpriced = lines.some(function (x) { return x.cur !== 'USD' && x.sum == null; });
    return { lines: lines, subtotal: subtotal, usd: usd, delivery: delivery, total: subtotal + delivery, belowMin: hasTry && !tryUnpriced && subtotal < min, minOrder: min, count: lines.length, unpriced: unpriced };
  }

  /* ---------- orders ---------- */
  /* order number as the real bot prints it (bot-engine store.ts orderNo): "№101", "№102"... - first order №101 */
  var ORDER_START = 100;
  function orderNo(n) { return '№' + n; }
  /* one-time migration of the old demo storage (orders numbered 1040, 1041, ... shown as "UA-1043"): renumbered in the same
     order to 101, 102, ... (old 1040 -> 101), so a buyer's earlier order keeps its place and the sequence has no gap.
     The old key is left untouched (harmless); the new key wins once written. */
  var OLD_FIRST = 1040;
  function migrateOrders() {
    if (readJSON(KEYS.orders, null)) return;
    var old = readJSON(KEYS.ordersOld, null);
    if (!old || !old.length) return;
    writeJSON(KEYS.orders, old.map(function (o) {
      var x = {}; for (var k in o) x[k] = o[k];
      if (typeof x.no === 'number' && x.no >= OLD_FIRST) x.no = x.no - OLD_FIRST + ORDER_START + 1;
      return x;
    }));
  }
  function seedOrders() {
    var c = CATALOG;
    migrateOrders();
    var existing = readJSON(KEYS.orders, null);
    if (existing && existing.length) return existing;
    var day = 86400000, now = Date.now();
    function mk(no, ts, cust, lines, deliveryId, paymentId, status, extra) {
      var cart = lines.map(function (l) { return { id: l[0], qty: l[1] }; });
      var t = totals(cart, deliveryId, c);
      var o = { no: no, ts: ts, customer: cust, delivery: deliveryId, payment: paymentId, comment: '', lines: t.lines, subtotal: t.subtotal, usd: t.usd, deliveryPrice: t.delivery, total: t.total, status: status, history: [] };
      for (var k in (extra || {})) o[k] = extra[k];
      return o;
    }
    var seeds = [
      mk(101, now - 3 * day, { name: 'Игорь', phone: '+90 532 000 00 01', city: 'Стамбул' }, [['makkabi', 500], ['kabanosy', 200], ['ikra-kety', 1]], 'cargo', 'card', 'shipped', { track: '1234567890' }),
      mk(102, now - 1 * day, { name: 'Мария', phone: '+90 532 000 00 02', city: 'Аланья' }, [['sardelky-sochni', 1000], ['domashnia', 500]], 'alanya', 'cash', 'paid'),
      mk(103, now - 2 * HOUR, { name: 'Елена', phone: '+90 532 000 00 03', city: 'Анталия' }, [['salo-solene', 500], ['doktorska', 1000]], 'cargo', 'card', 'new')
    ];
    writeJSON(KEYS.orders, seeds);
    return seeds;
  }
  function loadOrders() { migrateOrders(); return readJSON(KEYS.orders, []); }
  function saveOrders(list) { writeJSON(KEYS.orders, list); }
  function orderNumber(orders) { var list = orders || loadOrders(), max = ORDER_START; list.forEach(function (o) { if (o.no > max) max = o.no; }); return max + 1; }
  function saveOrder(order) {
    var list = loadOrders();
    if (!order.no) order.no = orderNumber(list);
    if (!order.ts) order.ts = Date.now();
    if (!order.status) order.status = 'new';
    list.push(order); saveOrders(list);
    return order;
  }
  function findOrder(no) { var list = loadOrders(); for (var i = 0; i < list.length; i++) if (String(list[i].no) === String(no)) return list[i]; return null; }
  function updateOrder(no, patch) {
    var list = loadOrders(), out = null;
    list.forEach(function (o) { if (String(o.no) === String(no)) { for (var k in patch) o[k] = patch[k]; out = o; } });
    saveOrders(list);
    return out;
  }
  function recalcOrder(order, catalog) {
    var c = catalog || CATALOG;
    var t = totals(order.lines.map(function (l) { return l.pre ? { id: l.id, qty: l.qty, pre: true } : { id: l.id, qty: l.qty }; }), order.delivery, c);
    t.lines.forEach(function (x, i) { if (order.lines[i] && order.lines[i].pre) x.pre = true; });
    order.lines = t.lines; order.subtotal = t.subtotal; order.usd = t.usd; order.deliveryPrice = t.delivery; order.total = t.total;
    return order;
  }
  function lc(s) { return String(s).toLowerCase(); }
  function orderSummary(order) { return order.lines.map(function (l) { return lc(l.name) + ' ' + l.weight + (l.pre ? ' (под заказ)' : ''); }).join(', '); }
  function orderShortLine(order) {
    var dShort = order.delivery === 'cargo' ? 'карго' : order.delivery === 'alanya' ? 'курьер' : 'самовывоз';
    var pShort = order.payment === 'cash' ? 'наличные' : 'карта';
    return 'Заказ ' + orderNo(order.no) + ': ' + orderSummary(order) + ' = ' + fmtPair(order.subtotal, order.usd) + ' · ' + order.customer.name + ', ' + order.customer.city + ', ' + dShort + ', ' + pShort;
  }

  /* ---------- owner helpers ---------- */
  var OPEN = { 'new': 1, confirmed: 1, paid: 1 };
  function pickList(orders, catalog) {
    var c = catalog || CATALOG;
    var open = orders.filter(function (o) { return OPEN[o.status]; });
    var byItem = {}, ship = { cargo: 0, alanya: 0, pickup: 0 };
    open.forEach(function (o) {
      ship[o.delivery] = (ship[o.delivery] || 0) + 1;
      o.lines.forEach(function (l) {
        var it = c.byId[l.id] || { name_ru: l.name, unit: l.unit };
        if (!byItem[l.id]) byItem[l.id] = { id: l.id, name: it.name_ru, unit: it.unit, qty: 0 };
        byItem[l.id].qty += l.qty;
      });
    });
    var items = Object.keys(byItem).map(function (k) {
      var x = byItem[k];
      x.label = x.unit === 'pc' ? x.qty + ' шт' : fmtKg(x.qty / 1000, 'ru');
      return x;
    }).sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); });
    return { count: open.length, items: items, shipping: ship };
  }
  function weekReport(orders) {
    var since = Date.now() - 7 * 86400000;
    var week = orders.filter(function (o) { return o.ts >= since && o.status !== 'oos'; });
    var sum = 0, usd = 0, byItem = {}, byPhone = {};
    week.forEach(function (o) {
      sum += o.total; usd += o.usd || 0; byPhone[o.customer.phone] = (byPhone[o.customer.phone] || 0) + 1;
      o.lines.forEach(function (l) { if (!byItem[l.name]) byItem[l.name] = { sum: 0, cur: l.cur }; byItem[l.name].sum += l.sum; });
    });
    var top = Object.keys(byItem).map(function (k) { return { name: k, sum: byItem[k].sum, cur: byItem[k].cur }; }).sort(function (a, b) { return b.sum - a.sum; }).slice(0, 3);
    var repeat = Object.keys(byPhone).filter(function (k) { return byPhone[k] > 1; }).length;
    return { count: week.length, sum: sum, usd: usd, top: top, repeat: repeat };
  }

  /* ---------- fuzzy item search (RU + UA words, any case) ---------- */
  function norm(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[`'’ʼ]/g, "'").replace(/[?!.,;:«»"]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function stem(word) {
    var w = norm(word).replace(/[^a-zа-яіїєґ0-9']/g, '');
    if (w.length > 4) return w.slice(0, w.length - 2);
    if (w.length > 3) return w.slice(0, w.length - 1);
    return w;
  }
  function phrases(it) {
    var out = [norm(it.name_ru), norm(it.name_uk), norm(it.name_en)];
    (it.keys || []).forEach(function (k) { out.push(norm(k)); });
    if (it.brand) out.push(norm(it.brand)); /* producer is searchable (CEO 10.10): "дмитрук" finds kabanosy */
    if (it.brand_ru) out.push(norm(it.brand_ru)); /* and in Russian spelling: "гощанские" finds doktorska */
    if (it.aliases) it.aliases.forEach(function (k) { out.push(norm(k)); });
    return out.filter(Boolean);
  }
  /* the producer as written for a reader of lang (bot-engine catalog.ts brandFor): RU brand_ru, UA brand, EN brand_en; '' = none */
  function brandFor(it, lang) { if (!it || !it.brand) return ''; return lang === 'ru' ? (it.brand_ru || it.brand) : lang === 'en' ? (it.brand_en || it.brand) : it.brand; }
  function findItem(query, items) {
    var pool = items || (CATALOG && CATALOG.items) || [];
    var q = norm(query);
    var words = q.split(' ').filter(Boolean);
    if (!words.length) return null;
    var i, exact = null;
    for (i = 0; i < pool.length && !exact; i++) { if (phrases(pool[i]).indexOf(q) >= 0) exact = pool[i]; }
    if (exact) return exact;
    var best = null, bestLen = 99;
    pool.forEach(function (it) {
      phrases(it).forEach(function (ph) {
        var tokens = ph.split(/[\s,()]+/).filter(Boolean);
        var ok = words.every(function (w) { var st = stem(w); return st && tokens.some(function (t) { return t.indexOf(st) === 0; }); });
        if (ok && tokens.length < bestLen) { best = it; bestLen = tokens.length; }
      });
    });
    return best;
  }

  /* ---------- site search (CEO 10.10: header magnifier, "сосиски" / "сало") ----------
     All matching items, not the single best one (findItem is the bot's). Both sides are folded the same way:
     case, ё/е, UA letters to RU (і ї -> и, є -> е, ґ -> г, ы -> и, э -> е), no ь/ъ/apostrophe, UA "ковбас" = RU "колбас";
     then a light ending strip (сосиски/сосиску/сосисок, сало/сала). A word matches a token when the stems are equal or a stem
     of 5+ letters starts the token; only if that finds nothing, a token that starts with what was typed (live typing "сос"). */
  function sFold(s) {
    return norm(s).replace(/[іїи]/g, 'и').replace(/ы/g, 'и').replace(/[єэ]/g, 'е').replace(/ґ/g, 'г').replace(/[ьъ']/g, '')
      .replace(/колбас/g, 'ковбас');
  }
  var S_END = ['ами', 'ями', 'ого', 'его', 'ому', 'ему', 'ими', 'ой', 'ей', 'ий', 'ая', 'яя', 'ое', 'ее', 'ие', 'ов', 'ев', 'ам', 'ям', 'ах', 'ях', 'ом', 'ем', 'ую', 'юю', 'а', 'я', 'о', 'е', 'и', 'у', 'ю'];
  function sStem(w) {
    if (/[^а-яй]/.test(w) || w.length < 4) return w;
    for (var i = 0; i < S_END.length; i++) {
      var e = S_END[i];
      if (w.length - e.length >= (e.length > 2 ? 4 : 3) && w.slice(-e.length) === e) { w = w.slice(0, -e.length); break; }
    }
    return w.replace(/([бвгджзклмнпрстфхцчшщ])[ое]к$/, '$1к');   /* fleeting vowel: сосисок -> сосиск, колбасок -> колбаск */
  }
  /* "с икрой" in a search key describes the item, it does not name it (CEO 11.10: «икра» must not find тарань «с икрой»);
     names keep every word, keys and aliases lose a with-phrase */
  var S_WITH = /(^|\s)(с|со|з|із|with)\s.*$/;
  /* "сырые" (raw) folds to the same stem as "сыр"/"сир" (cheese): CEO 11.10, «сыр» found «Колбаса домашняя» through its alias
     «колбаски домашние сырые». The raw forms become one token of their own, before folding, on both sides. */
  var S_RAW = /(^|\s)(сыр(ой|ая|ое|ые|ых|ым|ую|ыми)|сир(ий|а|е|ого|ої|ою|их|ими))(?=\s|$)/g;
  function sRaw(s) { return norm(s).replace(S_RAW, '$1rawsyr'); }
  /* section tags (CEO 11.10): the group words of the item's section ("сладкое", "молочное", "мясо"), from build-catalog.py */
  function sTokens(it) {
    var out = [], names = [norm(it.name_ru), norm(it.name_uk), norm(it.name_en)];
    phrases(it).concat([it.brand_en || ''], (it.tags || []).map(norm)).forEach(function (ph) {
      if (names.indexOf(ph) < 0) ph = ph.replace(S_WITH, '');
      sFold(sRaw(ph)).split(/[\s,()&/+-]+/).forEach(function (tk) { if (tk && out.indexOf(tk) < 0) out.push(tk); });
    });
    return out;
  }
  /* "сыр и молочное": a joining word is not something to find; dropped while other words remain */
  var S_JOIN = { 'и': 1, 'та': 1, 'й': 1, 'and': 1 };
  function sWords(q) {
    var w = sFold(sRaw(q)).split(/[\s,()&/+-]+/).filter(Boolean), keep = w.filter(function (x) { return !S_JOIN[x]; });
    return keep.length ? keep : w;
  }
  /* the section name typed in full ("икра и рыба", "сыр і молочне", "другое") = that whole section */
  function sSections(query, cats) {
    var q = sWords(query).join(' '), out = {};
    (cats || []).forEach(function (c) {
      [c.name_ru, c.name_uk, c.name_en].forEach(function (n) { if (n && sWords(n).join(' ') === q) out[c.id] = 1; });
    });
    return out;
  }
  function searchItems(query, items, cats) {
    var pool = items || (CATALOG && CATALOG.items) || [];
    if (cats === undefined && !items && CATALOG) cats = CATALOG.categories;
    var words = sWords(query);
    if (!words.length) return [];
    var sec = sSections(query, cats);
    if (Object.keys(sec).length) {
      var rest = searchItems(query, pool, null);
      return pool.filter(function (it) { return sec[it.cat] || rest.indexOf(it) >= 0; });
    }
    var stems = words.map(sStem), toks = pool.map(sTokens);
    function pass(loose) {
      return pool.filter(function (it, i) {
        return words.every(function (w, k) {
          var ws = stems[k];
          return toks[i].some(function (tk) { return sStem(tk) === ws || (ws.length >= 5 && tk.indexOf(ws) === 0) || (loose && tk.indexOf(w) === 0); });
        });
      });
    }
    /* whole words first ("сала" = salo, not "салат"); only when nothing matches, read the query as an unfinished word ("сос") */
    var hit = pass(false);
    if (!hit.length) hit = pass(true);
    /* "тарань с икрой" typed in full: the with-phrase is not a token any more, so read the query without it */
    if (!hit.length && S_WITH.test(sFold(query)) && sFold(query).replace(S_WITH, '').trim()) return searchItems(sFold(query).replace(S_WITH, ''), pool, null);
    return hit;
  }

  /* ---------- delivery rules (placeholders until agreed with the owners) ---------- */
  var ALANYA_AREA = ['аланья', 'алания', 'аланія', 'alanya', 'махмутлар', 'mahmutlar', 'оба', 'oba', 'кестель', 'kestel', 'авсаллар', 'avsallar', 'конаклы', 'konakli'];
  var ASK_OWNER = { 'белек': 'Белек', 'belek': 'Белек', 'анталия': 'Анталия', 'анталья': 'Анталия', 'антальйя': 'Анталия', 'анталія': 'Анталия', 'antalya': 'Анталия' };
  function cityKey(city) { return norm(city).replace(/[^a-zа-яіїєґ ]/g, '').trim(); }
  /* returns {city, mode: 'courier'|'cargo'|'ask', ...}; "ask" = the one fact the bot does not know (own trip of the owners) */
  function deliveryRule(city, catalog, learned) {
    var c = catalog || CATALOG, k = cityKey(city);
    var known = (learned || readJSON(KEYS.delivery, {}))[k];
    var cargo = c.deliveryById.cargo, courier = c.deliveryById.alanya;
    if (ALANYA_AREA.indexOf(k) >= 0) return { city: city, key: k, mode: 'courier', price: courier.price, freeFrom: courier.free_from };
    if (known) return { city: city, key: k, mode: known.courier ? 'courier-own' : 'cargo', day: known.day || null, price: cargo.price, freeFrom: cargo.free_from, eta: '2-3 дня', learned: true };
    if (ASK_OWNER[k]) return { city: ASK_OWNER[k], key: k, mode: 'ask', price: cargo.price, freeFrom: cargo.free_from, eta: '2-3 дня' };
    return { city: city, key: k, mode: 'cargo', price: cargo.price, freeFrom: cargo.free_from, eta: '2-3 дня' };
  }
  function learnDelivery(city, info) { var d = readJSON(KEYS.delivery, {}); d[cityKey(city)] = info; writeJSON(KEYS.delivery, d); }

  /* ---------- bot command parser (Russian, understands Ukrainian) ---------- */
  var RE_SOLD = '(?:закончил(?:ось|ся|ась|ись)|закінчил(?:ось|ося|ась|ись)|закончилос|продано|продан[оа]?|нет в наличии|немає в наявності|нет|немає|нема)';
  var RE_HAVE = '(?:есть|є|в наличии|в наявності)';
  var RE_DAY = '(понедельник|понеділок|вторник|вівторок|среду|среда|середу|середа|четверг|четвер|пятницу|пятница|п\'ятницю|п\'ятниця|субботу|суббота|суботу|субота|воскресенье|воскресение|неділю|неділя)';
  function parseBotCommand(text) {
    var t = String(text || '').trim(), tl = norm(t), m;
    if (!t) return { type: 'help' };
    if ((m = t.match(/^№?\s*(\d{2,5})\s+(?:оплачен[оа]|сплачено|оплата)$/i))) return { type: 'paid', no: Number(m[1]) };
    if ((m = t.match(/^№?\s*(\d{2,5})\s+(?:отправлен[оа]|відправлен[оа])\s*,?\s*(?:трек\s*)?(\S+)?$/i))) return { type: 'shipped', no: Number(m[1]), track: m[2] || '' };
    if ((m = t.match(/^№?\s*(\d{2,5})\s+(?:подтвердить|підтвердити)$/i))) return { type: 'confirm', no: Number(m[1]) };
    if ((m = t.match(/^№?\s*(\d{2,5})\s+(.+?)\s+(\d+(?:[.,]\d+)?)$/))) return { type: 'weight', no: Number(m[1]), query: m[2], kg: Number(m[3].replace(',', '.')) };
    if (/^(сегодня|сьогодні)$/.test(tl)) return { type: 'today' };
    if (/^(неделя|тиждень)$/.test(tl)) return { type: 'week' };
    if (/^(завоз|завіз)/.test(tl)) return { type: 'broadcast' };
    if (/^(плашки|плашка|плашки\??)$/.test(tl)) return { type: 'stamps' };
    if ((m = t.match(/^(?:доставка|доставляете|доставите|доставляєте|доставка)\s*(?:в|во|до|на)?\s+(.+?)[?!.\s]*$/i)) && !/^\d/.test(m[1])) return { type: 'delivery', city: m[1].trim() };
    if ((m = t.match(new RegExp('^(?:следующая|наступна)\\s+(?:поставка|завоз|завіз)\\s+(?:в\\s+|у\\s+)?' + RE_DAY + '$', 'i')))) return { type: 'nextbatch', day: dayKey(m[1]) };
    if ((m = t.match(new RegExp('^(?:новая|нова)\\s+(?:поставка|партия|партія)\\s+(.+)$', 'i')))) return { type: 'state', state: 'new_batch', query: m[1].trim() };
    if ((m = t.match(/^(.+?)\s+(?:новая|нова)\s+(?:поставка|партия|партія)$/i))) return { type: 'state', state: 'new_batch', query: m[1].trim() };
    if ((m = t.match(/^(.+?)\s+(?:пока нет|поки немає|поки нема)$/i))) return { type: 'state', state: 'not_now', query: m[1].trim() };
    if ((m = t.match(new RegExp('^(.+?)\\s+(?:на|у|в)\\s+' + RE_DAY + '$', 'i')))) return { type: 'state', state: 'preorder', query: m[1].trim(), day: dayKey(m[2]) };
    if ((m = t.match(/^(.+?)\s+(?:на заказ|під замовлення|под заказ)$/i))) return { type: 'state', state: 'preorder', query: m[1].trim(), day: null };
    if ((m = t.match(/^(.+?)\s+мало(?:\s+(\d+(?:[.,]\d+)?)\s*(?:кг|kg))?$/i))) return { type: 'state', state: 'few_left', query: m[1].trim(), qty: m[2] ? Number(m[2].replace(',', '.')) : null };
    if ((m = t.match(new RegExp('^(.+?)\\s+' + RE_SOLD + '$', 'i')))) return { type: 'state', state: 'sold_out', query: m[1].trim() };
    if ((m = t.match(new RegExp('^(.+?)\\s+' + RE_HAVE + '$', 'i')))) return { type: 'state', state: 'in_stock', query: m[1].trim() };
    if ((m = t.match(/^([^\d]+?)\s+(\d{2,5})$/))) return { type: 'price', query: m[1].trim(), price: Number(m[2]) };
    return { type: 'help' };
  }
  /* caption of a forwarded photo: "бастурма 850" -> {name, price} */
  function parseNewItem(caption) {
    var m = String(caption || '').trim().match(/^(.+?)\s+(\d{2,5})(?:\s*(?:лир|₺|лір|tl))?(?:\s*\/?\s*(кг|kg))?$/i);
    if (!m) return null;
    var name = m[1].trim(); name = name.charAt(0).toUpperCase() + name.slice(1);
    return { name: name, price: Number(m[2]) };
  }

  function loadCustomer() { return readJSON(KEYS.customer, null); }
  function saveCustomer(c) { writeJSON(KEYS.customer, c); }
  function loadCart() { return readJSON(KEYS.cart, []); }
  function saveCart(cart) { writeJSON(KEYS.cart, cart); }
  function loadLang() { var l = null; try { l = pickStore().get(KEYS.lang); } catch (e) { /* ignore */ } return l === 'uk' || l === 'en' || l === 'ru' ? l : 'ru'; }
  function saveLang(l) { try { pickStore().set(KEYS.lang, l); } catch (e) { /* ignore */ } }
  function saveNotify(entry) { var l = readJSON(KEYS.notify, []); l.push(entry); writeJSON(KEYS.notify, l); return l; }
  function loadNotify() { return readJSON(KEYS.notify, []); }
  /* 10.10: "special order" request - something from Ukraine that is not on the site. Required: what + contact.
     contact = Telegram @nick (5-32 letters, digits, _) or a phone / WhatsApp number (at least 9 digits). */
  function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function contactOk(c) {
    c = clean(c);
    if (/^@[A-Za-z0-9_]{5,32}$/.test(c)) return true;
    if (/^(https?:\/\/)?t\.me\/[A-Za-z0-9_]{5,32}$/.test(c)) return true;
    return /^[+()\d\s.-]+$/.test(c) && c.replace(/\D/g, '').length >= 9;
  }
  function validateSpecial(f) {
    var err = [];
    if (!clean(f && f.what)) err.push('what');
    if (!clean(f && f.contact)) err.push('contact'); else if (!contactOk(f.contact)) err.push('contact_bad');
    return err;
  }
  function specialPayload(f, lang, ts) {
    return { type: 'special_request', what: clean(f.what), qty: clean(f.qty), name: clean(f.name), contact: clean(f.contact), comment: clean(f.comment),
      lang: lang === 'uk' || lang === 'en' ? lang : 'ru', ts: ts || Date.now() };
  }
  function saveSpecial(payload) { var l = readJSON(KEYS.special, []); l.push(payload); writeJSON(KEYS.special, l); return payload; }
  function loadSpecial() { return readJSON(KEYS.special, []); }
  /* 10.10 card design comparison: "#cards-b" (plain token, the artifact viewer passes only simple anchors) turns on
     the B card design and its A/B switch; "#cards-a" shows the switch with the default cards. Anything else -> null */
  function cardsVariant(hash) {
    var m = String(hash || '').replace(/^#/, '').trim().toLowerCase().match(/^cards-(a|b)$/);
    return m ? m[1] : null;
  }
  /* B catalog navigation: the catalog grouped by category, in catalog order, only categories that have items.
     Each group is sorted like the category filter (not_now stays inside its own category, as with the chip) */
  function groupByCategory(catalog, now) {
    var c = catalog || CATALOG;
    return c.categories.map(function (cat) { return { cat: cat, items: sortItems(c.items, cat.id, now) }; }).filter(function (g) { return g.items.length; });
  }
  /* plural form index: ru/uk 0 = 1 товар, 1 = 2-4 товара, 2 = 5+ товаров; en 0 = 1 item, 1 = items */
  function pluralIdx(n, lang) {
    if (lang === 'en') return n === 1 ? 0 : 1;
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 0;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 1;
    return 2;
  }
  /* 10.10 CEO: design B is the default for every visitor; only "#cards-a" shows the old cards (for comparison) */
  function cardsIsB(hash) { return cardsVariant(hash) !== 'a'; }
  /* the floating "Разделы" button: only in B, not while the tiles are on screen, not over an open sheet / overlay / its own list */
  function quickNavVisible(o) { return !!(o && o.b && !o.tilesOnScreen && !o.locked && !o.open); }
  /* in-cart stepper (CEO 10.10): weight items move along their own steps_g (300 -> 500 -> 1000 g), past the last step by
     500 g (1 kg and more) or by the last step (smaller ladders), up to 5 kg; pieces by 1 up to 20. Returns the next
     quantity; 0 = remove from the cart. A quantity off the ladder (e.g. 800 g) snaps to the nearest step in that direction. */
  function stepQty(item, cur, dir) {
    cur = Number(cur) || 0;
    if (item.unit === 'pc') { var n = cur + (dir > 0 ? 1 : -1); return n <= 0 ? 0 : Math.min(n, 20); }
    var steps = (item.steps_g && item.steps_g.length ? item.steps_g : [100]).slice().sort(function (a, b) { return a - b; });
    var last = steps[steps.length - 1], inc = last >= 1000 ? 500 : last, MAX = 5000, i;
    if (dir > 0) {
      for (i = 0; i < steps.length; i++) if (steps[i] > cur) return steps[i];
      return Math.min(MAX, Math.max(cur, last + inc * Math.ceil((cur - last + 1) / inc)));
    }
    if (cur > last) return last + inc * (Math.ceil((cur - last) / inc) - 1);
    for (i = steps.length - 1; i >= 0; i--) if (steps[i] < cur) return steps[i];
    return 0;
  }
  /* ---------- real orders (CEO 10.10): the checkout goes to the test bot's worker, POST /site-order (bot-engine src/site-order.ts).
     The № on the done screen is the one the worker returns (the bot's own counter); nothing is numbered in the browser. ---------- */
  var ORDER_URL = 'https://ukr-alanya-bot-test.bot-engine.workers.dev/site-order';
  /* CEO live test 11.10: the checkout contact is a phone OR a Telegram nick (he never shows his phone in Telegram).
     -> the normalized contact ('@nick' / the phone as typed) or '' when it is neither. The worker accepts 9+ digits or
     @?[A-Za-z][A-Za-z0-9_]{4,31}; a t.me link and a nick without @ become '@nick'. */
  function orderContact(c) {
    c = clean(c);
    var m = c.match(/^(?:https?:\/\/)?t\.me\/@?([A-Za-z][A-Za-z0-9_]{4,31})\/?$/) || c.match(/^@?([A-Za-z][A-Za-z0-9_]{4,31})$/);
    if (m) return '@' + m[1];
    return /^[+()\d\s.\/-]+$/.test(c) && c.replace(/\D/g, '').length >= 9 ? c : '';
  }
  /* after EVERY site order the bot chat opens with /start o<nonce> (the bot binds the chat to the order by the checkout's nonce) */
  var BOT_LINK = 'https://t.me/uafoodsbot';
  function tgStartLink(nonce) { return /^[A-Za-z0-9_-]{8,63}$/.test(String(nonce || '')) ? BOT_LINK + '?start=o' + nonce : BOT_LINK; }
  function orderNonce() { var a = '', c = 'abcdefghijklmnopqrstuvwxyz0123456789'; for (var i = 0; i < 20; i++) a += c.charAt(Math.floor(Math.random() * c.length)); return a; }
  /* the request body: cart lines as {id, qty} (grams for weighed items, pieces for pc), the form as typed; website = honeypot (empty) */
  /* v5 (CEO 11.10): pickup / city courier carry a time window (window_id + window_date YYYY-MM-DD); cargo has none (null) */
  function sitePayload(cart, form, lang, nonce) {
    var kind = windowKind(form.delivery);
    var p = { items: cart.map(function (l) { return { id: l.id, qty: l.qty }; }), name: String(form.name || '').trim(), contact: orderContact(form.phone) || String(form.phone || '').trim(),
      delivery: form.delivery, city: form.other ? String(form.city || '').trim() : '', payment: form.payment, comment: String(form.comment || '').trim(),
      date: form.date || '', lang: lang === 'uk' || lang === 'en' ? lang : 'ru', nonce: nonce, website: String(form.website || ''),
      window_id: kind && form.windowId ? String(form.windowId) : null, window_date: kind && form.windowDate ? String(form.windowDate) : null };
    /* CEO 11.10: the city courier carries the street address (bot: optional string, max 200, asked in Telegram when missing);
       pickup and cargo send no address key at all, so their payload stays byte-identical to before */
    if (kind === 'courier') p.address = clean(form.address).slice(0, ADDRESS_MAX);
    return p;
  }
  /* courier address: 5-200 characters after trimming (район, улица, дом, квартира) */
  var ADDRESS_MIN = 5, ADDRESS_MAX = 200;
  function addressOk(a) { var n = clean(a).length; return n >= ADDRESS_MIN && n <= ADDRESS_MAX; }

  /* ---------- v5 time windows (pickup / city courier). Source: GET /api/catalog -> windows:{pickup:[{id,label}], courier:[{id,label}]}
     (label "HH:MM-HH:MM", same shape as the cabinet settings); until the bot sends them - the placeholders below (spec v3).
     "Today" is Alanya time (Europe/Istanbul, UTC+3 all year); a window is not offered today once it ends within CUTOFF_MIN. ---------- */
  var WINDOWS_DEFAULT = { pickup: [{ id: 'p1', label: '10:00-13:00' }, { id: 'p2', label: '13:00-16:00' }, { id: 'p3', label: '16:00-19:00' }],
    courier: [{ id: 'c1', label: '12:00-15:00' }, { id: 'c2', label: '17:00-20:00' }] };
  var WINDOW_CUTOFF_MIN = 60;
  function windowKind(delivery) { return delivery === 'pickup' ? 'pickup' : delivery === 'alanya' || delivery === 'courier' ? 'courier' : null; }
  function hm(s) { var m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim()); if (!m || +m[1] > 24 || +m[2] > 59) return null; return +m[1] * 60 + +m[2]; }
  function parseWindow(w) {
    if (!w || w.id == null || String(w.id).trim() === '') return null;
    var label = String(w.label || '').replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ''), parts = label.split('-');
    var from = parts.length === 2 ? hm(parts[0]) : null, to = parts.length === 2 ? hm(parts[1]) : null;
    if (from == null || to == null || to <= from) return null;
    return { id: String(w.id), label: label, from: from, to: to };
  }
  function siteWindows(live) {
    var src = live && live.windows && typeof live.windows === 'object' ? live.windows : null, out = {};
    ['pickup', 'courier'].forEach(function (k) {
      var list = src && Array.isArray(src[k]) ? src[k].map(parseWindow).filter(Boolean) : [];
      out[k] = list.length ? list : WINDOWS_DEFAULT[k].map(parseWindow);
    });
    var pd = pickupDays(live && live.facts); if (pd) out.pickup_days = pd;
    return out;
  }
  /* -> { date: 'YYYY-MM-DD', min: minutes since midnight } in Alanya */
  function alanyaClock(nowMs) {
    var d = new Date(nowMs == null ? Date.now() : nowMs);
    try {
      var p = {}; new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
      if (p.year && p.hour) return { date: p.year + '-' + p.month + '-' + p.day, min: (+p.hour % 24) * 60 + +p.minute };
    } catch (e) { /* no Intl time zones: fixed UTC+3 below */ }
    var t = new Date(d.getTime() + 3 * 3600000);
    return { date: t.toISOString().slice(0, 10), min: t.getUTCHours() * 60 + t.getUTCMinutes() };
  }
  function addDaysIso(iso, n) { var p = iso.split('-'); var t = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n)); return t.toISOString().slice(0, 10); }
  /* -> [{key:'today', date, wins}, {key:'tomorrow', date, wins}] ; today's list drops windows ending within the cut-off */
  function dowIso(iso) { var p = iso.split('-'); return (new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay() + 6) % 7; }
  /* CEO 24.10 point 11: windows.pickup_days (siteWindows / the page copy facts.pickup_days there) - a closed pickup day keeps its chip
     with no windows (closed:true, disabled), and when tomorrow is closed the next open day is added (key 'day'); absent = as before */
  function windowDays(windows, kind, nowMs) {
    var list = (windows && windows[kind]) || [], c = alanyaClock(nowMs);
    var days = [
      { key: 'today', date: c.date, wins: list.filter(function (w) { return w.to - c.min > WINDOW_CUTOFF_MIN; }) },
      { key: 'tomorrow', date: addDaysIso(c.date, 1), wins: list.slice() }
    ];
    var open = kind === 'pickup' ? pickupDays(windows) : null; if (!open) return days;
    days.forEach(function (d) { if (open.indexOf(dowIso(d.date)) < 0) { d.wins = []; d.closed = true; } });
    if (days[1].closed) for (var n = 2; n <= 7; n++) { var dt = addDaysIso(c.date, n); if (open.indexOf(dowIso(dt)) >= 0) { days.push({ key: 'day', date: dt, wins: list.slice() }); break; } }
    return days;
  }
  /* keeps a still-valid choice; otherwise the first day that still has windows and NO window (the buyer picks it); null for cargo */
  function pickWindow(windows, delivery, choice, nowMs) {
    var kind = windowKind(delivery); if (!kind) return null;
    var days = windowDays(windows, kind, nowMs), ch = choice || {};
    var day = days.filter(function (d) { return d.date === ch.date && d.wins.length; })[0] || days.filter(function (d) { return d.wins.length; })[0];
    if (!day) return null;
    var w = day.wins.filter(function (x) { return x.id === ch.id; })[0];
    return { date: day.date, id: w ? w.id : null };
  }
  function windowValid(windows, delivery, id, date, nowMs) {
    var kind = windowKind(delivery); if (!kind) return true;
    return windowDays(windows, kind, nowMs).some(function (d) { return d.date === date && d.wins.some(function (w) { return w.id === id; }); });
  }
  /* -> Promise<{ok:true, data}> | {ok:false, kind:'network'|'rejected', status, error}. Never throws; 'network' = no answer at all
     (the order may or may not exist: a retry with the SAME nonce returns the same order, never a second one) */
  function sendOrder(payload, fetchFn, url) {
    var f = fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) return Promise.resolve({ ok: false, kind: 'network', status: 0, error: 'no_fetch' });
    return f(url || ORDER_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.ok && j && j.ok && j.order_id) return { ok: true, data: j };
        return { ok: false, kind: r.status >= 500 ? 'network' : 'rejected', status: r.status, error: (j && j.error) || 'http_' + r.status };
      });
    }, function () { return { ok: false, kind: 'network', status: 0, error: 'network' }; });
  }

  /* what the B card says in its glass bar and pill, from real data only (no ratings, no delivery minutes) */
  function cardInfo(it, now) {
    var st = itemState(it, now);
    var info = st === 'sold_out' ? 'notify' : st === 'preorder' ? (it.day ? 'day' : 'next_batch') : st === 'not_now' ? 'not_now' : 'eta';
    return { state: st, info: info, buy: st !== 'not_now', pre: st === 'sold_out' || st === 'preorder', day: it.day || null };
  }

  return {
    KEYS: KEYS, THIN: THIN, STATE_ORDER: STATE_ORDER, DAYS: DAYS, NEW_BATCH_HOURS: NEW_BATCH_HOURS,
    setStore: function (s) { store = s; },
    CATALOG_URL: CATALOG_URL, mergeLiveCatalog: mergeLiveCatalog, fetchLiveCatalog: fetchLiveCatalog,
    LIVE_POLL_MIN_MS: LIVE_POLL_MIN_MS, LIVE_POLL_MAX_MS: LIVE_POLL_MAX_MS, livePollDelay: livePollDelay, liveSig: liveSig, cartPriceChanges: cartPriceChanges, liveFacts: liveFacts, livePrice: livePrice, priceTbd: priceTbd, hasPrice: hasPrice,
    fmtMoney: fmtMoney, fmtWeight: fmtWeight, fmtKg: fmtKg, priceLabel: priceLabel, unitLabel: unitLabel, fmtPair: fmtPair,
    parseCatalog: parseCatalog, applyOverrides: applyOverrides, setStock: setStock, setPrice: setPrice, setState: setState, setNextBatch: setNextBatch,
    itemState: itemState, sortItems: sortItems, dayKey: dayKey, addNewItem: addNewItem, resetOverrides: resetOverrides,
    catalog: function () { return CATALOG; },
    lineSum: lineSum, cartAdd: cartAdd, cartAddPre: cartAddPre, cartSet: cartSet, cartStep: cartStep, totals: totals,
    orderNo: orderNo, migrateOrders: migrateOrders, brandFor: brandFor, seedOrders: seedOrders, loadOrders: loadOrders, saveOrders: saveOrders, orderNumber: orderNumber, saveOrder: saveOrder,
    findOrder: findOrder, updateOrder: updateOrder, recalcOrder: recalcOrder, orderSummary: orderSummary, orderShortLine: orderShortLine,
    pickList: pickList, weekReport: weekReport, findItem: findItem, searchItems: searchItems, parseBotCommand: parseBotCommand, parseNewItem: parseNewItem,
    deliveryRule: deliveryRule, learnDelivery: learnDelivery,
    loadCustomer: loadCustomer, saveCustomer: saveCustomer, loadCart: loadCart, saveCart: saveCart, loadLang: loadLang, saveLang: saveLang,
    saveNotify: saveNotify, loadNotify: loadNotify,
    cardsVariant: cardsVariant, cardsIsB: cardsIsB, quickNavVisible: quickNavVisible, stepQty: stepQty, cardInfo: cardInfo, groupByCategory: groupByCategory, pluralIdx: pluralIdx,
    contactOk: contactOk, validateSpecial: validateSpecial, specialPayload: specialPayload, saveSpecial: saveSpecial, loadSpecial: loadSpecial,
    ORDER_URL: ORDER_URL, orderContact: orderContact, addressOk: addressOk, ADDRESS_MIN: ADDRESS_MIN, ADDRESS_MAX: ADDRESS_MAX, tgStartLink: tgStartLink, orderNonce: orderNonce, sitePayload: sitePayload, sendOrder: sendOrder,
    WINDOWS_DEFAULT: WINDOWS_DEFAULT, WINDOW_CUTOFF_MIN: WINDOW_CUTOFF_MIN, windowKind: windowKind, parseWindow: parseWindow, siteWindows: siteWindows, alanyaClock: alanyaClock, windowDays: windowDays, pickupDays: pickupDays, daysText: daysText, pickWindow: pickWindow, windowValid: windowValid
  };
});
