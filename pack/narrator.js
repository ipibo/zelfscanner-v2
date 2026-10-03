/**
 * Verteller -- hint als figuurtje met een tekstballon (van de IDFA-speurtocht,
 * 2025, in zelfscanner-keynote/speurtocht).
 *
 * De hint `{"type": "narrator", "text": "…", "src": figuurtje, "background": …}`:
 * - `background`: beeldvullend achter alles. Leeg = lichtblauw vlak.
 * - `src`: het figuurtje, een beeldvullende PNG met transparantie (zoals de
 *   480x800 figuurtjes van de speurtocht). Komt binnen met de animatie van
 *   de hint (`animation`, zie fx.js); leeg = "slide", van onder omhoog.
 *   Geen figuurtje = alleen de ballon.
 * - `text`: het raadsel in de ballon. Enter = nieuwe regel. De ballon popt
 *   open zodra het figuurtje er bijna is.
 *
 * Verkeerde scan: de ballon wordt oranje met de foutmelding, met het raadsel
 * eronder (ZSNarrator.error). De hulp-knop komt van help.js.
 *
 * Maten in vw/% (geen viewport-meta), afgeleid van de speurtocht op een
 * 320 css-px breed scherm: ballon links, onderkant op 47% van de hoogte.
 * Past de tekst niet, dan wordt de letter kleiner (fitBalloon).
 *
 * ES5 / Chromium 46, zie puzzle.js.
 *
 * API: ZSNarrator.mount(hint, onLog) / ZSNarrator.error(text) /
 *      ZSNarrator.isMounted() / ZSNarrator.unmount()
 */
window.ZSNarrator = (function () {
  var CSS_ID = 'zs-narrator-style';
  var BALLOON_DELAY_MS = 900;
  var DEFAULT_ANIMATION = 'slide';
  var BALLOON_FONT_VW = 5;
  var BALLOON_MIN_FONT_VW = 3.4;

  var CSS = [
    '#zs-narrator{position:absolute;top:0;left:0;right:0;bottom:0;z-index:5;display:none;overflow:hidden;',
    'background:#bfe6ff;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;}',
    '#zs-narrator.zs-on{display:block;}',
    '#zs-narrator-bg,#zs-narrator-fig{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;display:none;}',
    '#zs-narrator-balloon{position:absolute;left:3vw;bottom:47%;max-width:62vw;',
    'box-sizing:border-box;padding:4.5vw 6vw;border-radius:6vw;color:#fff;',
    'font:400 5vw/1.2 "Helvetica Neue",Helvetica,Arial,sans-serif;white-space:pre-line;',
    'background:#ababab;background:radial-gradient(ellipse at top left,#c4c4c4,#ababab);',
    'opacity:0;-webkit-transform:scale(.8);transform:scale(.8);',
    '-webkit-transform-origin:80% 100%;transform-origin:80% 100%;',
    '-webkit-transition:opacity .5s ease-out,-webkit-transform .5s cubic-bezier(.3,1.5,.5,1);',
    'transition:opacity .5s ease-out,transform .5s cubic-bezier(.3,1.5,.5,1);}',
    // staartje rechtsonder, naar het figuurtje
    '#zs-narrator-balloon:after{content:"";position:absolute;bottom:-4.5vw;right:9vw;width:0;height:0;',
    'border-left:4.5vw solid transparent;border-right:4.5vw solid transparent;border-top:4.5vw solid #ababab;}',
    '#zs-narrator-balloon.zs-show{opacity:1;-webkit-transform:scale(1);transform:scale(1);}',
    '#zs-narrator-balloon.zs-error{background:#f95c38;background:radial-gradient(ellipse at top left,#ffa18a,#f95c38);}',
    '#zs-narrator-balloon.zs-error:after{border-top-color:#f95c38;}',
    // kort schudden bij een verkeerde scan
    '@-webkit-keyframes zs-narrator-shake{0%,100%{-webkit-transform:translateX(0)}20%,60%{-webkit-transform:translateX(-2vw)}',
    '40%,80%{-webkit-transform:translateX(2vw)}}',
    '@keyframes zs-narrator-shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-2vw)}',
    '40%,80%{transform:translateX(2vw)}}',
    '#zs-narrator-balloon.zs-shake{-webkit-animation:zs-narrator-shake .45s ease-in-out;animation:zs-narrator-shake .45s ease-in-out;}'
  ].join('');

  var root = null;
  var bgEl = null;
  var figEl = null;
  var balloonEl = null;
  var timer = null;
  var mounted = false;
  var riddle = '';

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
    root.id = 'zs-narrator';
    root.innerHTML =
      '<img id="zs-narrator-bg" alt="">' +
      '<img id="zs-narrator-fig" alt="">' +
      '<div id="zs-narrator-balloon"></div>';
    document.body.appendChild(root);
    bgEl = document.getElementById('zs-narrator-bg');
    figEl = document.getElementById('zs-narrator-fig');
    balloonEl = document.getElementById('zs-narrator-balloon');
  }

  function setImage(el, src, label, onLog) {
    if (src) {
      el.onerror = function () {
        el.style.display = 'none';
        if (onLog) {
          onLog('verteller: ' + label + ' laadt niet: ' + src);
        }
      };
      el.src = src;
      el.style.display = 'block';
    } else {
      el.removeAttribute('src');
      el.style.display = 'none';
    }
  }

  // De ballon groeit vanaf 47% omhoog; lange tekst (foutmelding + raadsel)
  // liep boven het scherm uit. Letter kleiner tot de bovenkant binnen
  // beeld valt. offsetTop negeert de pop-transform, dus dit kan meteen.
  function fitBalloon() {
    var margin = window.innerWidth * 0.03;
    var size = BALLOON_FONT_VW;
    balloonEl.style.fontSize = '';
    while (balloonEl.offsetTop < margin && size > BALLOON_MIN_FONT_VW) {
      size -= 0.2;
      balloonEl.style.fontSize = size + 'vw';
    }
  }

  function setBalloon(text, isError) {
    balloonEl.textContent = text;
    balloonEl.className = 'zs-show' + (isError ? ' zs-error' : '');
    fitBalloon();
  }

  function mount(hint, onLog) {
    if (!root) {
      build();
    }
    unmount();
    hint = hint || {};
    riddle = hint.text || '';
    setImage(bgEl, hint.background, 'achtergrond', onLog);
    setImage(figEl, hint.src, 'figuurtje', onLog);
    balloonEl.textContent = riddle;
    balloonEl.className = '';
    root.className = 'zs-on';
    mounted = true;

    var animation = hint.animation || DEFAULT_ANIMATION;
    if (hint.src) {
      window.ZSFx.play(figEl, animation);
    }
    var delay = hint.src && animation !== 'none' ? BALLOON_DELAY_MS : 50;
    timer = setTimeout(function () {
      if (mounted && riddle) {
        setBalloon(riddle, false);
      }
    }, delay);
  }

  // Foutmelding in de ballon, het raadsel eronder zodat de bezoeker niet
  // terug hoeft. De ballon blijft oranje tot de volgende stop.
  function error(text) {
    if (!mounted) {
      return;
    }
    clearTimeout(timer);
    setBalloon(riddle ? text + '\n\n' + riddle : text, true);
    void balloonEl.offsetWidth;
    balloonEl.className = 'zs-show zs-error zs-shake';
  }

  function isMounted() {
    return mounted;
  }

  function unmount() {
    clearTimeout(timer);
    mounted = false;
    if (!root) {
      return;
    }
    root.className = '';
    balloonEl.className = '';
    window.ZSFx.clear(figEl);
  }

  return {mount: mount, error: error, isMounted: isMounted, unmount: unmount};
})();
