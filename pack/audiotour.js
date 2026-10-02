/**
 * Audiotour-scherm -- de beloning na een juiste scan (zie runtime.js).
 *
 * Gedrag (besloten 2026-09-17, storyboard Sjef "3. Audiotour"):
 * - Beeldvullende achtergrond, één voor alle audiotours
 *   (manifest.audiotour.image). Die visual komt nog van de vormgever; leeg =
 *   groen.
 * - Onderin: 10 seconden terug, pauze/play (het icoon volgt de audio) en een
 *   verticale volumeschuif.
 * - Voortgang: een geel vlak schuift van links naar rechts over het beeld,
 *   zoals de rode balk onder een YouTube-video. Het kleurt het beeld eronder
 *   (mix-blend-mode hue) in plaats van het af te dekken, dus het oor blijft
 *   zichtbaar.
 * - Volume = volume van de audio zelf (0-1), niet het systeemvolume; dat
 *   staat op de scanners voluit. Blijft staan tussen stops, terug naar vol bij
 *   een reset.
 * - Audio klaar, of kapot: onDone. De runtime gaat dan door naar de volgende
 *   stop, dus een ontbrekend bestand laat de bezoeker nooit vastlopen.
 *
 * ES5 / Chromium 46, zie puzzle.js. Maten in vw (geen viewport-meta).
 *
 * API: ZSAudiotour.mount(config, src, onDone, onLog) -- scherm neerzetten,
 *        audio laden, nog niet spelen
 *      ZSAudiotour.start() / ZSAudiotour.unmount() / ZSAudiotour.resetVolume()
 */
window.ZSAudiotour = (function () {
  var BACK_SECONDS = 10;
  var DEFAULT_BG = '#6cb84e';
  var CSS_ID = 'zs-tour-style';
  var MOUSE = -1; // drag.id voor een muis-sleep (desktop preview)

  // Verhoudingen uit het storyboard (320 px breed): knoppen 50 px, midden 50 px
  // boven de onderrand; volumeschuif 80 px hoog, rechts op 81%.
  var CSS = [
    '#zs-tour{position:absolute;top:0;left:0;right:0;bottom:0;z-index:20;display:none;overflow:hidden;',
    'background:' + DEFAULT_BG + ';',
    'touch-action:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;}',
    '#zs-tour.zs-on{display:block;}',
    '#zs-tour-bg{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;display:none;}',
    '#zs-tour-fill{position:absolute;top:0;left:0;width:100%;height:100%;background:#ff0;mix-blend-mode:hue;',
    '-webkit-transform-origin:0 0;transform-origin:0 0;',
    '-webkit-transform:scaleX(0);transform:scaleX(0);',
    '-webkit-transition:-webkit-transform .25s linear;transition:transform .25s linear;}',
    '#zs-tour-fill.zs-flat{mix-blend-mode:normal;opacity:.45;}',
    '.zs-tour-btn{position:absolute;bottom:7.6vw;width:16vw;height:16vw;margin-left:-8vw;',
    'display:flex;align-items:center;justify-content:center;}',
    '.zs-tour-btn svg{width:15.6vw;height:15.6vw;display:block;}',
    '#zs-tour-back{left:20.6vw;}',
    '#zs-tour-play{left:50vw;}',
    '#zs-tour-vol{position:absolute;bottom:5.75vw;height:31vw;left:81.25vw;width:16vw;margin-left:-8vw;}',
    '#zs-tour-track{position:absolute;top:3vw;bottom:3vw;left:50%;width:1.25vw;margin-left:-.625vw;',
    'border-radius:.625vw;background:rgba(255,255,255,.45);}',
    '#zs-tour-level{position:absolute;left:0;right:0;bottom:0;border-radius:.625vw;background:#fff;}',
    '#zs-tour-knob{position:absolute;left:50%;width:6.25vw;height:6.25vw;margin:-3.125vw 0 0 -3.125vw;',
    'border-radius:50%;background:#fff;}'
  ].join('');

  var BACK_SVG =
    '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M24 8A18 18 0 1 1 8.41 17" fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round"/>' +
    '<path d="M13 8L25 1.5V14.5z" fill="#fff"/>' +
    '<text x="24" y="31.5" text-anchor="middle" fill="#fff" ' +
    'style="font:700 14px sans-serif">' + BACK_SECONDS + '</text></svg>';
  var PAUSE_SVG =
    '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="13" y="7" width="6.5" height="34" rx="3.25" fill="#fff"/>' +
    '<rect x="28.5" y="7" width="6.5" height="34" rx="3.25" fill="#fff"/></svg>';
  var PLAY_SVG =
    '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M15 7L41 24L15 41z" fill="#fff" stroke="#fff" stroke-width="3" stroke-linejoin="round"/></svg>';

  var root = null;
  var bgEl = null;
  var fillEl = null;
  var playEl = null;
  var volEl = null;
  var trackEl = null;
  var levelEl = null;
  var knobEl = null;
  var audio = null;
  var onDone = null;
  var onLog = null;
  var mounted = false;
  var finished = false;
  var volume = 1;
  var drag = null; // {id} tijdens een volume-sleep

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

  // Zie runtime.js: play() geeft op deze WebView nog geen Promise terug.
  function safePlay() {
    var result = audio.play();
    if (result && typeof result.catch === 'function') {
      result.catch(function (e) {
        log('audiotour — play mislukt: ' + e.message);
      });
    }
  }

  // Een knop reageert op het neerdrukken, niet pas bij loslaten: zonder
  // viewport-meta heeft click hier nog 300 ms vertraging.
  function onPress(el, fn) {
    function handler(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (mounted) {
        fn();
      }
    }
    el.addEventListener('touchstart', handler, false);
    el.addEventListener('mousedown', handler, false);
  }

  function build() {
    injectCss();
    root = document.createElement('div');
    root.id = 'zs-tour';
    root.innerHTML =
      '<img id="zs-tour-bg" alt="">' +
      '<div id="zs-tour-fill"></div>' +
      '<div id="zs-tour-back" class="zs-tour-btn">' + BACK_SVG + '</div>' +
      '<div id="zs-tour-play" class="zs-tour-btn"></div>' +
      '<div id="zs-tour-vol"><div id="zs-tour-track">' +
      '<div id="zs-tour-level"></div><div id="zs-tour-knob"></div>' +
      '</div></div>';
    document.body.appendChild(root);
    bgEl = document.getElementById('zs-tour-bg');
    fillEl = document.getElementById('zs-tour-fill');
    playEl = document.getElementById('zs-tour-play');
    volEl = document.getElementById('zs-tour-vol');
    trackEl = document.getElementById('zs-tour-track');
    levelEl = document.getElementById('zs-tour-level');
    knobEl = document.getElementById('zs-tour-knob');

    // Zonder blend-mode zou geel het oor helemaal afdekken: dan half
    // doorzichtig. (window.CSS, want CSS is hier de stylesheet-tekst.)
    var api = window.CSS;
    if (!(api && api.supports && api.supports('mix-blend-mode', 'hue'))) {
      fillEl.className = 'zs-flat';
    }

    bgEl.onerror = function () {
      if (bgEl.getAttribute('src')) {
        log('audiotour-achtergrond laadt niet: ' + bgEl.getAttribute('src'));
        bgEl.style.display = 'none';
      }
    };

    audio = document.createElement('audio');
    root.appendChild(audio);
    audio.addEventListener('play', function () {
      setPlaying(true);
    }, false);
    audio.addEventListener('pause', function () {
      setPlaying(false);
    }, false);
    audio.addEventListener('timeupdate', drawProgress, false);
    audio.addEventListener('seeked', drawProgress, false);
    audio.addEventListener('ended', finish, false);
    audio.addEventListener('error', function () {
      if (mounted && audio.getAttribute('src')) {
        log('audiotour laadt niet: ' + audio.getAttribute('src'));
        finish();
      }
    }, false);

    onPress(document.getElementById('zs-tour-back'), function () {
      if (audio.getAttribute('src')) {
        audio.currentTime = Math.max(0, audio.currentTime - BACK_SECONDS);
        drawProgress();
      }
    });
    onPress(playEl, function () {
      if (!audio.getAttribute('src')) {
        return;
      }
      if (audio.paused) {
        safePlay();
      } else {
        audio.pause();
      }
    });
    volEl.addEventListener('touchstart', onVolDown, false);
    volEl.addEventListener('mousedown', onVolDown, false);
  }

  function setPlaying(playing) {
    playEl.innerHTML = playing ? PAUSE_SVG : PLAY_SVG;
  }

  function drawProgress() {
    var d = audio.duration;
    var p = d > 0 && isFinite(d) ? Math.min(1, audio.currentTime / d) : 0;
    var t = 'scaleX(' + p + ')';
    fillEl.style.webkitTransform = t;
    fillEl.style.transform = t;
  }

  function drawVolume() {
    levelEl.style.height = volume * 100 + '%';
    knobEl.style.top = (1 - volume) * 100 + '%';
  }

  function setVolumeAt(clientY) {
    var rect = trackEl.getBoundingClientRect();
    if (!(rect.height > 0)) {
      return;
    }
    volume = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
    audio.volume = volume;
    drawVolume();
  }

  function pointY(ev) {
    if (!ev.changedTouches) {
      return drag.id === MOUSE ? ev.clientY : null;
    }
    for (var i = 0; i < ev.changedTouches.length; i++) {
      if (ev.changedTouches[i].identifier === drag.id) {
        return ev.changedTouches[i].clientY;
      }
    }
    return null; // een andere vinger
  }

  function onVolDown(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    if (!mounted || drag) {
      return;
    }
    var t = ev.changedTouches ? ev.changedTouches[0] : ev;
    drag = {id: ev.changedTouches ? t.identifier : MOUSE};
    setVolumeAt(t.clientY);
  }

  function onVolMove(ev) {
    if (!drag) {
      return;
    }
    ev.preventDefault();
    var y = pointY(ev);
    if (y !== null) {
      setVolumeAt(y);
    }
  }

  function onVolUp(ev) {
    if (drag && pointY(ev) !== null) {
      drag = null;
    }
  }

  function bind(on) {
    var method = on ? 'addEventListener' : 'removeEventListener';
    document[method]('touchmove', onVolMove, false);
    document[method]('mousemove', onVolMove, false);
    document[method]('touchend', onVolUp, false);
    document[method]('touchcancel', onVolUp, false);
    document[method]('mouseup', onVolUp, false);
  }

  function finish() {
    if (!mounted || finished) {
      return;
    }
    finished = true;
    var cb = onDone;
    onDone = null;
    if (cb) {
      cb();
    }
  }

  function mount(config, src, doneCb, logCb) {
    unmount();
    if (!root) {
      build();
    }
    config = config || {};
    onDone = doneCb || null;
    onLog = logCb || null;
    mounted = true;
    finished = false;

    if (config.image) {
      bgEl.src = config.image;
      bgEl.style.display = 'block';
    } else {
      bgEl.removeAttribute('src');
      bgEl.style.display = 'none';
    }

    audio.volume = volume;
    drawVolume();
    if (src) {
      audio.src = src;
      audio.load();
    } else {
      audio.removeAttribute('src');
    }
    setPlaying(false);
    drawProgress();
    root.className = 'zs-on';
    bind(true);
  }

  // Zonder audio (stop zonder bestand) meteen door, anders hangt de bezoeker.
  function start() {
    if (!mounted) {
      return;
    }
    if (audio.getAttribute('src')) {
      safePlay();
    } else {
      finish();
    }
  }

  function unmount() {
    if (!root) {
      return;
    }
    mounted = false; // eerst, zodat pause/error hieronder niets meer doen
    bind(false);
    drag = null;
    onDone = null;
    audio.pause();
    audio.removeAttribute('src');
    root.className = '';
  }

  function resetVolume() {
    volume = 1;
    if (audio) {
      audio.volume = volume;
    }
  }

  return {mount: mount, start: start, unmount: unmount, resetVolume: resetVolume};
})();
