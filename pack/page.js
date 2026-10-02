/**
 * HTML-pagina als hint of beloning -- een eigen .html (met CSS-animaties,
 * inline JS) beeldvullend in een iframe.
 *
 *   "hint":   {"type": "page", "src": "assets/pages/raadsel.html", "animation": "fade"}
 *   "reward": {"type": "page", "src": "assets/pages/feest.html", "seconds": 10}
 *
 * - Als hint: blijft staan tot de juiste scan.
 * - Als beloning: `seconds` lang (leeg = 10), daarna de volgende stop. De
 *   pagina kan ook zelf eerder klaar zijn: `parent.zsDone()` of
 *   `parent.postMessage('zs:done', '*')`.
 *
 * Laden: <script src> en andere sub-resources van file:// zijn op deze
 * WebView geblokkeerd (zie index.html), XHR werkt wel. Dus: de pagina als
 * tekst ophalen en via `srcdoc` in de iframe zetten, met een <base> naar de
 * map van de pagina, zodat <img src="foto.jpg"> naast de pagina gewoon werkt.
 * Gevolg: alles moet IN de pagina staan (inline <style> en <script>); een
 * losse .css of .js naast de pagina laadt op het device niet. Afbeeldingen
 * en video wel. Mislukt de XHR, dan als gewone iframe-src (desktop).
 *
 * Scans gaan niet naar de pagina: die komen bij runtime.js binnen.
 *
 * ES5 / Chromium 46, zie puzzle.js.
 *
 * API: ZSPage.mount(src, {animation, reward, seconds, onDone}, onLog) / ZSPage.unmount()
 */
window.ZSPage = (function () {
  var CSS_ID = 'zs-page-style';
  var DEFAULT_REWARD_SECONDS = 10;

  var CSS = [
    '#zs-page{position:absolute;top:0;left:0;width:100%;height:100%;border:0;z-index:6;display:none;background:#000;}',
    '#zs-page.zs-on{display:block;}'
  ].join('');

  var frame = null;
  var token = 0; // elke mount een nieuw nummer; oude XHR's en timers tellen niet meer
  var timer = null;
  var onDone = null;

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
    frame = document.createElement('iframe');
    frame.id = 'zs-page';
    frame.setAttribute('scrolling', 'no');
    document.body.appendChild(frame);
  }

  function dirOf(src) {
    var i = src.lastIndexOf('/');
    return i === -1 ? '' : src.slice(0, i + 1);
  }

  // <base> vlak na <head>, of vooraan als de pagina geen <head> heeft.
  function withBase(html, src) {
    var base = '<base href="' + dirOf(src) + '">';
    var m = /<head[^>]*>/i.exec(html);
    if (m) {
      return html.slice(0, m.index + m[0].length) + base + html.slice(m.index + m[0].length);
    }
    return base + html;
  }

  function finish(myToken) {
    if (myToken !== token || !onDone) {
      return;
    }
    var cb = onDone;
    onDone = null;
    clearTimeout(timer);
    cb();
  }

  // De pagina roept parent.zsDone() aan als hij klaar is (alleen bij een
  // beloning; als hint doet het niets).
  window.zsDone = function () {
    finish(token);
  };
  window.addEventListener(
    'message',
    function (ev) {
      if (ev.data === 'zs:done') {
        finish(token);
      }
    },
    false
  );

  function mount(src, opts, onLog) {
    if (!frame) {
      build();
    }
    unmount();
    opts = opts || {};
    var myToken = token;
    onDone = opts.reward ? opts.onDone || null : null;

    function showSrc(useSrcdoc, html) {
      if (myToken !== token) {
        return;
      }
      if (useSrcdoc) {
        frame.removeAttribute('src');
        frame.srcdoc = withBase(html, src);
      } else {
        frame.removeAttribute('srcdoc');
        frame.src = src;
      }
      frame.className = 'zs-on';
      window.ZSFx.play(frame, opts.animation);
    }

    var xhr = new XMLHttpRequest();
    xhr.open('GET', src, true);
    xhr.overrideMimeType('text/html; charset=utf-8'); // zie index.html
    xhr.onload = function () {
      if ('srcdoc' in frame && xhr.responseText) {
        showSrc(true, xhr.responseText);
      } else if (xhr.responseText || xhr.status === 0) {
        showSrc(false);
      } else {
        if (onLog) {
          onLog('pagina laadt niet: ' + src + ' (status ' + xhr.status + ')');
        }
        finish(myToken);
      }
    };
    xhr.onerror = function () {
      showSrc(false);
    };
    xhr.send();

    if (opts.reward) {
      var seconds = typeof opts.seconds === 'number' && opts.seconds > 0 ? opts.seconds : DEFAULT_REWARD_SECONDS;
      timer = setTimeout(function () {
        finish(myToken);
      }, seconds * 1000);
    }
  }

  function unmount() {
    token++;
    onDone = null;
    clearTimeout(timer);
    if (!frame) {
      return;
    }
    frame.className = '';
    window.ZSFx.clear(frame);
    // leeg maken, anders loopt geluid of een animatie van de pagina door
    frame.removeAttribute('srcdoc');
    frame.src = 'about:blank';
  }

  return {mount: mount, unmount: unmount};
})();
