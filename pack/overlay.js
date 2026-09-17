/**
 * Overlay-melding -- donkere laag met witte tekst bovenop wat er al staat.
 *
 * Eerste gebruik: de luisterinstructie direct na het swipen (zie runtime.js).
 * Fadet in over het vorige beeld, blijft `seconds` staan, fadet uit. Terwijl
 * hij helemaal dekt (onShown) kan de runtime eronder van beeld wisselen.
 *
 * De laag vangt alle aanrakingen af: niets eronder (slider, puzzel) reageert
 * zolang hij er staat. Scans gaan gewoon door, dat regelt runtime.js.
 *
 * ES5 / Chromium 46, zie puzzle.js. Maten in vw (geen viewport-meta).
 *
 * API: ZSOverlay.show(text, {seconds, hold, onShown, onDone}) / ZSOverlay.hide()
 *   hold: blijft staan zonder timer (editor-preview); een tweede show() met
 *   hold ververst dan alleen de tekst.
 */
window.ZSOverlay = (function () {
  var FADE_MS = 300;
  var CSS_ID = 'zs-overlay-style';

  // Verhoudingen uit het ontwerp (379 px breed): zwart op ~72%, tekst 24 px
  // halfvet, regels breken rond 64% van de breedte.
  var CSS = [
    '#zs-overlay{position:absolute;top:0;left:0;right:0;bottom:0;z-index:40;display:none;',
    'align-items:center;justify-content:center;padding:0 18vw;box-sizing:border-box;',
    'background:rgba(0,0,0,.72);opacity:0;',
    '-webkit-transition:opacity .3s ease-out;transition:opacity .3s ease-out;',
    'touch-action:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;}',
    '#zs-overlay.zs-on{display:flex;}',
    '#zs-overlay.zs-in{opacity:1;}',
    '#zs-overlay-text{color:#fff;font:600 6.5vw/1.25 sans-serif;text-align:center;white-space:pre-line;}'
  ].join('');

  var root = null;
  var textEl = null;
  var timers = [];
  var held = false;

  function injectCss() {
    if (document.getElementById(CSS_ID)) {
      return;
    }
    var style = document.createElement('style');
    style.id = CSS_ID;
    style.type = 'text/css';
    style.appendChild(document.createTextNode(CSS));
    document.getElementsByTagName('head')[0].appendChild(style);
  }

  function block(ev) {
    ev.preventDefault();
    ev.stopPropagation();
  }

  function build() {
    injectCss();
    root = document.createElement('div');
    root.id = 'zs-overlay';
    textEl = document.createElement('div');
    textEl.id = 'zs-overlay-text';
    root.appendChild(textEl);
    root.addEventListener('touchstart', block, false);
    root.addEventListener('mousedown', block, false);
    document.body.appendChild(root);
  }

  function later(fn, ms) {
    timers.push(setTimeout(fn, ms));
  }

  function show(text, opts) {
    opts = opts || {};
    if (!root) {
      build();
    }
    textEl.textContent = text;
    if (held && opts.hold) {
      return;
    }
    hide();
    held = !!opts.hold;

    root.className = 'zs-on';
    void root.offsetWidth; // reflow, anders slaat de fade-in over
    root.className = 'zs-on zs-in';

    later(function () {
      if (opts.onShown) {
        opts.onShown();
      }
    }, FADE_MS);
    if (held) {
      return;
    }
    later(function () {
      root.className = 'zs-on';
      later(function () {
        root.className = '';
        if (opts.onDone) {
          opts.onDone();
        }
      }, FADE_MS);
    }, FADE_MS + Math.round((opts.seconds || 0) * 1000));
  }

  // Direct weg, zonder fade en zonder callbacks.
  function hide() {
    for (var i = 0; i < timers.length; i++) {
      clearTimeout(timers[i]);
    }
    timers = [];
    held = false;
    if (root) {
      root.className = '';
    }
  }

  return {show: show, hide: hide};
})();
