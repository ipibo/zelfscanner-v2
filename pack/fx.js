/**
 * Binnenkomst-animaties -- CSS keyframes voor hints en het figuurtje van de
 * verteller.
 *
 * Een hint kan `"animation": "fade" | "slide" | "drop" | "zoom" | "bounce"`
 * hebben (leeg of "none" = geen). De runtime roept ZSFx.play(el, naam) aan
 * op het element dat in beeld komt: de foto, de video, de HTML-pagina of het
 * figuurtje van de verteller.
 *
 * Chromium 46: @keyframes en animation bestaan daar al zonder prefix, maar
 * de -webkit- varianten staan er voor de zekerheid naast (zelfde reden als
 * de transitions in overlay.js). Alleen transform en opacity: die lopen op
 * de GPU, ook op de MC18N0.
 *
 * ES5 / Chromium 46, zie puzzle.js.
 *
 * API: ZSFx.play(el, name) / ZSFx.clear(el) / ZSFx.NAMES
 */
window.ZSFx = (function () {
  var CSS_ID = 'zs-fx-style';
  var NAMES = ['fade', 'slide', 'drop', 'zoom', 'bounce'];

  // naam -> [duur, easing, keyframes-body]
  var DEFS = {
    fade: ['.7s', 'ease-out', 'from{opacity:0}to{opacity:1}'],
    slide: ['1.4s', 'cubic-bezier(.2,.8,.3,1)', 'from{T(translateY(100%))}to{T(translateY(0))}'],
    drop: ['1s', 'cubic-bezier(.2,.8,.3,1)', 'from{T(translateY(-100%))}to{T(translateY(0))}'],
    zoom: [
      '.6s',
      'cubic-bezier(.3,1.4,.5,1)',
      'from{opacity:0;T(scale(.3))}to{opacity:1;T(scale(1))}'
    ],
    bounce: [
      '1.1s',
      'ease-out',
      '0%{T(translateY(100%))}55%{T(translateY(-7%))}75%{T(translateY(3%))}' +
        '90%{T(translateY(-1%))}100%{T(translateY(0))}'
    ]
  };

  function transform(body) {
    return body.replace(/T\(([^}]*?\))\)/g, '-webkit-transform:$1;transform:$1');
  }

  function buildCss() {
    var out = [];
    for (var i = 0; i < NAMES.length; i++) {
      var name = NAMES[i];
      var d = DEFS[name];
      var frames = transform(d[2]);
      out.push('@-webkit-keyframes zs-fx-' + name + '{' + frames + '}');
      out.push('@keyframes zs-fx-' + name + '{' + frames + '}');
      var anim = 'zs-fx-' + name + ' ' + d[0] + ' ' + d[1] + ' both';
      out.push('.zs-fx-' + name + '{-webkit-animation:' + anim + ';animation:' + anim + ';}');
    }
    return out.join('');
  }

  function injectCss() {
    if (document.getElementById(CSS_ID)) {
      return;
    }
    var style = document.createElement('style');
    style.id = CSS_ID;
    style.type = 'text/css';
    style.appendChild(document.createTextNode(buildCss()));
    document.getElementsByTagName('head')[0].appendChild(style);
  }

  function clear(el) {
    if (!el) {
      return;
    }
    for (var i = 0; i < NAMES.length; i++) {
      el.classList.remove('zs-fx-' + NAMES[i]);
    }
  }

  // Onbekende naam of "none" = alleen opruimen, dus geen animatie.
  function play(el, name) {
    if (!el) {
      return;
    }
    injectCss();
    clear(el);
    if (!DEFS.hasOwnProperty(name)) {
      return;
    }
    void el.offsetWidth; // reflow, anders start dezelfde animatie niet opnieuw
    el.classList.add('zs-fx-' + name);
  }

  return {play: play, clear: clear, NAMES: NAMES};
})();
