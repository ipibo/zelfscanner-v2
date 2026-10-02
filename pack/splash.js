/**
 * Splash-scherm -- staat altijd vóór de eerste scene van de story.
 *
 * Gedrag (besloten 2026-09-17):
 * - Achtergrond = één afbeelding (manifest.splash.image), beeldvullend boven de
 *   slider. Geen afbeelding ingesteld = zwart.
 * - Onderin een "swipe to start"-slider: wit blok met pijl links, gekleurde
 *   baan met tekst rechts. Kleur en tekst komen uit manifest.splash
 *   (sliderColor, sliderText).
 * - Het blok sleep je naar rechts. Voorbij DONE_AT van de weg = gestart, anders
 *   veert het terug. Slepen mag overal op de slider beginnen, het blok volgt
 *   de vinger vanaf waar hij is.
 * - Terug naar dit scherm gaat alleen via de reset-barcode (zie runtime.js).
 * - `fullImage: true`: geen slider, de afbeelding vult het hele scherm (als
 *   de tekst al in het beeld staat). Starten kan dan alleen met de
 *   start-barcode (manifest.splash.startScan, zie runtime.js).
 *
 * Constraints als puzzle.js: Chromium 46, dus ES5, geen libraries, losse
 * touch/mouse-events in plaats van HTML5 drag-and-drop. Maten in vw, want de
 * pagina heeft geen viewport-meta (980 CSS-px breed op een 480 px scherm).
 *
 * API: ZSSplash.show(config, onStart, onLog) / ZSSplash.hide()
 */
window.ZSSplash = (function () {
  var DONE_AT = 0.6; // deel van de sleepweg dat telt als "gestart"
  var SETTLE_MS = 250; // duur van terugveren / doorschuiven
  var DEFAULT_COLOR = '#ffff5c';
  var DEFAULT_TEXT = 'Swipe to start';
  var CSS_ID = 'zs-splash-style';
  var MOUSE = -1; // drag.id voor een muis-sleep (desktop preview)

  // Verhoudingen uit het ontwerp (485 px breed): slider 100 hoog, blok 125
  // breed, lijn 3, tekst 30, pijl 50x34.
  var CSS = [
    '#zs-splash{position:absolute;top:0;left:0;right:0;bottom:0;z-index:30;display:none;background:#000;',
    'touch-action:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;}',
    '#zs-splash.zs-on{display:block;}',
    '#zs-splash.zs-full #zs-splash-bg{height:100%;}',
    '#zs-splash.zs-full #zs-slider{display:none;}',
    '#zs-splash-bg{position:absolute;top:0;left:0;width:100%;height:calc(100% - 21vw);object-fit:cover;display:none;}',
    '#zs-slider{position:absolute;left:0;right:0;bottom:0;height:21vw;box-sizing:border-box;',
    'border:.7vw solid #000;overflow:hidden;background:' + DEFAULT_COLOR + ';}',
    '#zs-slider-text{position:absolute;top:0;bottom:0;left:26vw;right:0;display:flex;align-items:center;',
    'justify-content:center;padding:0 3vw;box-sizing:border-box;text-align:center;color:#000;',
    'font:500 6.2vw/1.15 sans-serif;}',
    '#zs-thumb{position:absolute;top:0;bottom:0;left:-.7vw;width:26.7vw;box-sizing:border-box;',
    'background:#fff;border-left:.7vw solid #000;border-right:.7vw solid #000;',
    'display:flex;align-items:center;justify-content:center;',
    '-webkit-transform:translate3d(0,0,0);transform:translate3d(0,0,0);}',
    '#zs-thumb.zs-settle{-webkit-transition:-webkit-transform .25s ease-out;transition:transform .25s ease-out;}',
    '#zs-thumb svg{width:10.5vw;height:7.2vw;display:block;}'
  ].join('');

  var ARROW_SVG =
    '<svg viewBox="0 0 50 34" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M0 11.5h26V0l24 17-24 17V22.5H0z" fill="#000"/></svg>';

  var root = null;
  var bgEl = null;
  var sliderEl = null;
  var textEl = null;
  var thumbEl = null;
  var onStart = null;
  var onLog = null;
  var drag = null; // {id, startX, fromX, max}
  var offset = 0; // huidige verschuiving van het blok, in CSS-px
  var starting = false;
  var settleTimer = null;

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

  function log(msg) {
    if (onLog) {
      onLog(msg);
    }
  }

  function build() {
    injectCss();
    root = document.createElement('div');
    root.id = 'zs-splash';
    root.innerHTML =
      '<img id="zs-splash-bg" alt="">' +
      '<div id="zs-slider">' +
      '<div id="zs-slider-text"></div>' +
      '<div id="zs-thumb">' + ARROW_SVG + '</div>' +
      '</div>';
    document.body.appendChild(root);
    bgEl = document.getElementById('zs-splash-bg');
    sliderEl = document.getElementById('zs-slider');
    textEl = document.getElementById('zs-slider-text');
    thumbEl = document.getElementById('zs-thumb');
    bgEl.onerror = function () {
      if (bgEl.getAttribute('src')) {
        log('splash-afbeelding laadt niet: ' + bgEl.getAttribute('src'));
        bgEl.style.display = 'none';
      }
    };
  }

  // Het blok staat in rust met zijn linkerlijn over de rand van de slider
  // (offsetLeft = -lijndikte). Aan het eind net zo rechts, dus nooit een
  // dubbele lijn.
  function maxOffset() {
    return Math.max(0, sliderEl.clientWidth - 2 * thumbEl.offsetLeft - thumbEl.offsetWidth);
  }

  function moveTo(x, settle) {
    offset = x;
    thumbEl.className = settle ? 'zs-settle' : '';
    var t = 'translate3d(' + x + 'px,0,0)';
    thumbEl.style.webkitTransform = t;
    thumbEl.style.transform = t;
    var max = maxOffset();
    var progress = max > 0 ? x / max : 0;
    textEl.style.opacity = String(Math.max(0, 1 - progress * 1.6));
  }

  function pointX(ev) {
    if (!ev.changedTouches) {
      return drag.id === MOUSE ? ev.clientX : null;
    }
    for (var i = 0; i < ev.changedTouches.length; i++) {
      if (ev.changedTouches[i].identifier === drag.id) {
        return ev.changedTouches[i].clientX;
      }
    }
    return null; // een andere vinger
  }

  function onDown(ev) {
    if (drag || starting) {
      return;
    }
    ev.preventDefault();
    var t = ev.changedTouches ? ev.changedTouches[0] : ev;
    clearTimeout(settleTimer);
    drag = {
      id: ev.changedTouches ? t.identifier : MOUSE,
      startX: t.clientX,
      fromX: offset,
      max: maxOffset()
    };
    moveTo(offset, false);
  }

  function onMove(ev) {
    if (!drag) {
      return;
    }
    ev.preventDefault();
    var x = pointX(ev);
    if (x === null) {
      return;
    }
    moveTo(Math.min(drag.max, Math.max(0, drag.fromX + x - drag.startX)), false);
  }

  // touchcancel (systeem nam de aanraking over) veert altijd terug.
  function onUp(ev) {
    if (!drag || pointX(ev) === null) {
      return;
    }
    ev.preventDefault();
    var max = drag.max;
    drag = null;
    if (ev.type !== 'touchcancel' && max > 0 && offset >= max * DONE_AT) {
      starting = true;
      moveTo(max, true);
      settleTimer = setTimeout(function () {
        starting = false;
        if (onStart) {
          onStart();
        }
      }, SETTLE_MS);
    } else {
      moveTo(0, true);
    }
  }

  function bind(on) {
    var method = on ? 'addEventListener' : 'removeEventListener';
    sliderEl[method]('touchstart', onDown, false);
    sliderEl[method]('mousedown', onDown, false);
    document[method]('touchmove', onMove, false);
    document[method]('mousemove', onMove, false);
    document[method]('touchend', onUp, false);
    document[method]('touchcancel', onUp, false);
    document[method]('mouseup', onUp, false);
  }

  function show(config, startCb, logCb) {
    hide();
    if (!root) {
      build();
    }
    config = config || {};
    onStart = startCb || null;
    onLog = logCb || null;

    if (config.image) {
      bgEl.src = config.image;
      bgEl.style.display = 'block';
    } else {
      bgEl.removeAttribute('src');
      bgEl.style.display = 'none';
    }
    sliderEl.style.background = config.sliderColor || DEFAULT_COLOR;
    textEl.textContent = config.sliderText || DEFAULT_TEXT;

    root.className = config.fullImage ? 'zs-on zs-full' : 'zs-on';
    moveTo(0, false);
    if (!config.fullImage) {
      bind(true);
    }
  }

  function hide() {
    if (!root) {
      return;
    }
    bind(false);
    clearTimeout(settleTimer);
    drag = null;
    starting = false;
    root.className = '';
  }

  return {show: show, hide: hide};
})();
