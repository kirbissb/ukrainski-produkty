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
  function priceLabel(item, lang) { return fmtMoney(item.price, item.currency) + unitLabel(item, lang); }
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
    var c = catalog || CATALOG, lines = [], subtotal = 0, usd = 0;
    cart.forEach(function (l) {
      var it = c.byId[l.id]; if (!it) return;
      var sum = lineSum(it, l.qty);
      if (it.currency === 'USD') usd += sum; else subtotal += sum;
      var st = itemState(it);
      lines.push({ id: it.id, name: it.name_ru, qty: l.qty, unit: it.unit, price: it.price, cur: it.currency, sum: sum, weight: fmtWeight(it, l.qty, 'ru'), pre: st === 'preorder' || (!!l.pre && (st === 'sold_out' || st === 'not_now')) });
    });
    var delivery = deliveryPrice(c.deliveryById[deliveryId], subtotal);
    var min = (c.rules && c.rules.min_order) || 0;
    var hasTry = lines.some(function (x) { return x.cur !== 'USD'; });
    return { lines: lines, subtotal: subtotal, usd: usd, delivery: delivery, total: subtotal + delivery, belowMin: hasTry && subtotal < min, minOrder: min, count: lines.length };
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
  /* what the B card says in its glass bar and pill, from real data only (no ratings, no delivery minutes) */
  function cardInfo(it, now) {
    var st = itemState(it, now);
    var info = st === 'sold_out' ? 'notify' : st === 'preorder' ? (it.day ? 'day' : 'next_batch') : st === 'not_now' ? 'not_now' : 'eta';
    return { state: st, info: info, buy: st !== 'not_now', pre: st === 'sold_out' || st === 'preorder', day: it.day || null };
  }

  return {
    KEYS: KEYS, THIN: THIN, STATE_ORDER: STATE_ORDER, DAYS: DAYS, NEW_BATCH_HOURS: NEW_BATCH_HOURS,
    setStore: function (s) { store = s; },
    fmtMoney: fmtMoney, fmtWeight: fmtWeight, fmtKg: fmtKg, priceLabel: priceLabel, unitLabel: unitLabel, fmtPair: fmtPair,
    parseCatalog: parseCatalog, applyOverrides: applyOverrides, setStock: setStock, setPrice: setPrice, setState: setState, setNextBatch: setNextBatch,
    itemState: itemState, sortItems: sortItems, dayKey: dayKey, addNewItem: addNewItem, resetOverrides: resetOverrides,
    catalog: function () { return CATALOG; },
    lineSum: lineSum, cartAdd: cartAdd, cartAddPre: cartAddPre, cartSet: cartSet, cartStep: cartStep, totals: totals,
    orderNo: orderNo, migrateOrders: migrateOrders, brandFor: brandFor, seedOrders: seedOrders, loadOrders: loadOrders, saveOrders: saveOrders, orderNumber: orderNumber, saveOrder: saveOrder,
    findOrder: findOrder, updateOrder: updateOrder, recalcOrder: recalcOrder, orderSummary: orderSummary, orderShortLine: orderShortLine,
    pickList: pickList, weekReport: weekReport, findItem: findItem, parseBotCommand: parseBotCommand, parseNewItem: parseNewItem,
    deliveryRule: deliveryRule, learnDelivery: learnDelivery,
    loadCustomer: loadCustomer, saveCustomer: saveCustomer, loadCart: loadCart, saveCart: saveCart, loadLang: loadLang, saveLang: saveLang,
    saveNotify: saveNotify, loadNotify: loadNotify,
    cardsVariant: cardsVariant, cardsIsB: cardsIsB, quickNavVisible: quickNavVisible, stepQty: stepQty, cardInfo: cardInfo, groupByCategory: groupByCategory, pluralIdx: pluralIdx,
    contactOk: contactOk, validateSpecial: validateSpecial, specialPayload: specialPayload, saveSpecial: saveSpecial, loadSpecial: loadSpecial
  };
});
