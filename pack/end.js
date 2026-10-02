/**
 * Eindscherm -- verschijnt na de beloning van de laatste stop.
 *
 * Gedrag (besloten 2026-09-17, storyboard Sjef "the end"):
 * - Beeld boven de balk: manifest.end.image. Leeg = groen vlak met "the end".
 * - Onderin een balk met tekst (manifest.end.barText, Enter = nieuwe regel)
 *   in manifest.end.barColor. Zelfde maten als de slider van het
 *   splash-scherm.
 * - `fullImage: true`: geen balk, de afbeelding vult het hele scherm (als de
 *   tekst al in het beeld staat).
 * - Blijft staan tot de reset-barcode of tot de scanner terug in de cradle
 *   gaat; beide brengen hem naar het splash-scherm (zie runtime.js). Andere
 *   scans en aanrakingen doen niets.
 *
 * ES5 / Chromium 46, zie puzzle.js. Maten in vw (geen viewport-meta).
 *
 * API: ZSEnd.show(config, onLog) / ZSEnd.hide()
 */
window.ZSEnd = (function () {
  var DEFAULT_COLOR = '#ffff5c';
  var DEFAULT_TEXT = 'Please gather at the self-checkout';
  var BG = '#66dd44';
  var CSS_ID = 'zs-end-style';

  var CSS = [
    '#zs-end{position:absolute;top:0;left:0;right:0;bottom:0;z-index:30;display:none;background:' + BG + ';',
    'touch-action:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;}',
    '#zs-end.zs-on{display:block;}',
    '#zs-end.zs-full #zs-end-bg{height:100%;}',
    '#zs-end.zs-full #zs-end-bar{display:none;}',
    '#zs-end-bg{position:absolute;top:0;left:0;width:100%;height:calc(100% - 21vw);object-fit:cover;display:none;}',
    // Tijdelijk beeld tot de visual van de vormgever er is.
    '#zs-end-title{position:absolute;top:0;left:0;right:0;bottom:21vw;display:flex;align-items:center;',
    'justify-content:center;text-align:center;color:#fff;font:900 30vw/.95 Georgia,serif;',
    '-webkit-text-stroke:.5vw #000;text-shadow:1.5vw 1.5vw 0 ' + DEFAULT_COLOR + ';}',
    '#zs-end-bar{position:absolute;left:0;right:0;bottom:0;min-height:21vw;box-sizing:border-box;',
    'border:.7vw solid #000;display:flex;align-items:center;justify-content:center;padding:2vw 5vw;',
    'text-align:center;color:#000;font:500 6.2vw/1.15 sans-serif;white-space:pre-line;',
    'background:' + DEFAULT_COLOR + ';}'
  ].join('');

  var root = null;
  var bgEl = null;
  var titleEl = null;
  var barEl = null;
  var onLog = null;

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

  function build() {
    injectCss();
    root = document.createElement('div');
    root.id = 'zs-end';
    root.innerHTML =
      '<img id="zs-end-bg" alt="">' +
      '<div id="zs-end-title">the<br>end</div>' +
      '<div id="zs-end-bar"></div>';
    document.body.appendChild(root);
    bgEl = document.getElementById('zs-end-bg');
    titleEl = document.getElementById('zs-end-title');
    barEl = document.getElementById('zs-end-bar');
    bgEl.onerror = function () {
      if (bgEl.getAttribute('src')) {
        if (onLog) {
          onLog('eindscherm-afbeelding laadt niet: ' + bgEl.getAttribute('src'));
        }
        bgEl.style.display = 'none';
        titleEl.style.display = '';
      }
    };
    // Aanraken doet niets, ook niet op wat eronder ligt.
    root.addEventListener('touchstart', function (ev) {
      ev.preventDefault();
    }, false);
  }

  function show(config, logCb) {
    if (!root) {
      build();
    }
    config = config || {};
    onLog = logCb || null;
    if (config.image) {
      bgEl.src = config.image;
      bgEl.style.display = 'block';
      titleEl.style.display = 'none';
    } else {
      bgEl.removeAttribute('src');
      bgEl.style.display = 'none';
      titleEl.style.display = '';
    }
    barEl.style.background = config.barColor || DEFAULT_COLOR;
    barEl.textContent = config.barText || DEFAULT_TEXT;
    root.className = config.fullImage && config.image ? 'zs-on zs-full' : 'zs-on';
  }

  function hide() {
    if (root) {
      root.className = '';
    }
  }

  return {show: show, hide: hide};
})();
