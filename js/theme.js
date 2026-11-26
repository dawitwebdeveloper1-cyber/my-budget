// Appearance, applied before the page draws (loaded as a plain script in <head>), so the app never
// flashes the wrong colours on open. Mode: system / light / dark. Palette: forest / charcoal / navy / plum.
// The choice is a display preference, not your money data, so it lives in this browser's small settings store.
(function () {
  var KEY = 'mybudget.appearance';
  var PALETTES = ['forest', 'charcoal', 'navy', 'plum'];
  var MODES = ['system', 'light', 'dark'];
  // The background of each palette (light, dark): the phone's status-bar area blends into it.
  var BG = { forest: ['#F4F2EC', '#151A17'], charcoal: ['#F4F0EA', '#1B1917'], navy: ['#F6F3EE', '#16181F'], plum: ['#F6F2F0', '#1A1619'] };
  var root = document.documentElement;
  var dark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function read() {
    var a = { mode: 'system', palette: 'forest' };
    try {
      var saved = JSON.parse(localStorage.getItem(KEY) || '{}');
      if (MODES.indexOf(saved.mode) >= 0) a.mode = saved.mode;
      if (PALETTES.indexOf(saved.palette) >= 0) a.palette = saved.palette;
    } catch (e) { /* private browsing or blocked storage: use the defaults */ }
    return a;
  }

  function apply(a) {
    var isDark = a.mode === 'dark' || (a.mode === 'system' && !!(dark && dark.matches));
    root.setAttribute('data-theme', isDark ? 'dark' : 'light');
    root.setAttribute('data-palette', a.palette);
    root.setAttribute('data-mode', a.mode);
    var bg = BG[a.palette][isDark ? 1 : 0];
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    if (metas.length) { for (var i = 0; i < metas.length; i++) { metas[i].setAttribute('content', bg); metas[i].removeAttribute('media'); } }
    else { var m = document.createElement('meta'); m.name = 'theme-color'; m.content = bg; document.head.appendChild(m); }
  }

  var current = read();
  apply(current);
  // "System" follows the phone when it switches between light and dark.
  if (dark) {
    var onChange = function () { if (current.mode === 'system') fade(function () { apply(current); }); };
    if (dark.addEventListener) dark.addEventListener('change', onChange); else if (dark.addListener) dark.addListener(onChange);
  }

  // A short, smooth fade between colour sets (none if Reduce Motion is on).
  function fade(fn) {
    var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!still) root.classList.add('theme-fade');
    fn();
    setTimeout(function () { root.classList.remove('theme-fade'); }, 350);
  }

  window.myBudgetAppearance = {
    PALETTES: PALETTES,
    MODES: MODES,
    get: function () { return { mode: current.mode, palette: current.palette }; },
    set: function (change) {
      var next = { mode: change.mode || current.mode, palette: change.palette || current.palette };
      if (MODES.indexOf(next.mode) < 0 || PALETTES.indexOf(next.palette) < 0) return;
      current = next;
      try { localStorage.setItem(KEY, JSON.stringify(current)); } catch (e) { /* still applies for now */ }
      fade(function () { apply(current); });
    },
  };
})();
