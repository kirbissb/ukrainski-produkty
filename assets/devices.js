/* Accent DEVICES (CEO 06.11 TG 1831: «интересные акцентные решения», red stays the colour). Optional, switched by ONE class on <html>:
   dev-stitch | dev-tag | dev-word | dev-star (the seal was dropped, CEO TG 1836) (or ?dev=<name> on the URL for a preview). Default: none - this file then does
   nothing. The look lives in site.css («ACCENT DEVICES»); this file only adds the few elements CSS cannot draw by itself:
   - dev-word: wraps the last word of the H1 in <span class="kw"> so the brush stroke sits under it. */
(function () {
  var root = document.documentElement, DEVS = ['stitch', 'tag', 'word', 'star'];
  var q = /[?&]dev=([a-z]+)(?:&|$)/.exec(location.search);
  if (q && DEVS.indexOf(q[1]) >= 0) root.classList.add('dev-' + q[1]);
  var on = function (d) { return root.classList.contains('dev-' + d); };
  if (!DEVS.some(on)) return;
  function decorate() {
    if (on('word')) {
      var h = document.querySelector('.hero h1');
      if (h && !h.querySelector('.kw')) { var t = h.textContent, i = t.lastIndexOf(' '); if (i > 0) { h.textContent = t.slice(0, i + 1); var k = document.createElement('span'); k.className = 'kw'; k.textContent = t.slice(i + 1); h.appendChild(k); } }
    }
  }
  var mo = new MutationObserver(function () { mo.disconnect(); decorate(); observe(); });
  function observe() { ['grid', 'reviewBox'].forEach(function (id) { var e = document.getElementById(id); if (e) mo.observe(e, { childList: true }); }); var h = document.querySelector('.hero h1'); if (h) mo.observe(h, { childList: true, characterData: true, subtree: true }); }
  decorate(); observe();
})();
