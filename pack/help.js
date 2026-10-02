/**
 * Hulp-knop -- na een verkeerde scan verschijnt onderin een knop ("I need a
 * hint"); die opent een kaart met een (vervaagde) foto en een tip. Uit de
 * IDFA-speurtocht (2025).
 *
 *   stop.help:          {"image": "assets/images/…", "text": "…"}
 *   manifest.wrongScan: {"buttonText": "I need a hint", …}
 *
 * - De knop komt pas na de eerste verkeerde scan bij een stop, en alleen als
 *   die stop `help` heeft. Bij de volgende stop is hij weer weg.
 * - × sluit de kaart, de knop blijft staan.
 * - `image` wordt licht vervaagd getoond (het is een hint, geen antwoord).
 *   Leeg = alleen tekst.
 *
 * Scans werken gewoon door terwijl de kaart open is (runtime.js).
 *
 * ES5 / Chromium 46, zie puzzle.js. Maten in vw.
 *
 * API: ZSHelp.offer(help, buttonText) / ZSHelp.open() / ZSHelp.hide()
 */
window.ZSHelp = (function () {
  var CSS_ID = 'zs-help-style';
  var DEFAULT_BUTTON_TEXT = 'I need a hint';
  var BLUE = '#199ed9';

  var CSS = [
    '#zs-help-btn{position:absolute;left:50%;bottom:5vw;z-index:35;display:none;',
    '-webkit-transform:translateX(-50%);transform:translateX(-50%);min-width:62vw;max-width:90vw;',
    'box-sizing:border-box;padding:4.5vw 8vw;border:0;border-radius:15vw;background:#fff;color:' + BLUE + ';',
    'font:700 7vw/1.1 Arial,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
    'box-shadow:0 1vw 3vw rgba(0,0,0,.25);-webkit-tap-highlight-color:transparent;outline:0;}',
    '#zs-help-btn.zs-on{display:block;}',
    '#zs-help-btn:active{-webkit-transform:translateX(-50%) scale(.95);transform:translateX(-50%) scale(.95);}',
    '#zs-help{position:absolute;top:0;left:0;right:0;bottom:0;z-index:45;display:none;align-items:center;',
    'justify-content:center;padding:20vw 8vw;box-sizing:border-box;background:rgba(0,0,0,.5);',
    '-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;}',
    '#zs-help.zs-on{display:flex;}',
    '#zs-help-card{position:relative;width:100%;max-height:100%;background:#fff;border-radius:6vw;',
    'display:flex;flex-direction:column;}',
    '#zs-help-content{overflow-y:auto;overflow-x:hidden;min-height:0;padding:12vw 6vw 9vw;box-sizing:border-box;',
    'display:flex;flex-direction:column;}',
    '#zs-help-img{display:block;max-width:100%;max-height:60vh;margin:0 auto;-webkit-flex-shrink:0;flex-shrink:0;',
    '-webkit-filter:blur(1.5vw);filter:blur(1.5vw);}',
    '#zs-help-sep{height:1px;background:#ccc;margin:6vw 3vw;-webkit-flex-shrink:0;flex-shrink:0;}',
    '#zs-help-text{color:' + BLUE + ';font:700 6.2vw/1.15 Arial,sans-serif;padding:0 3vw;white-space:pre-line;}',
    '#zs-help-close{position:absolute;top:-5vw;left:-5vw;width:12vw;height:12vw;border-radius:50%;border:0;',
    'background:' + BLUE + ';color:#fff;font:700 8vw/12vw Arial,sans-serif;text-align:center;padding:0;outline:0;}'
  ].join('');

  var btn = null;
  var modal = null;
  var imgEl = null;
  var sepEl = null;
  var textEl = null;
  var current = null;

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

  // touchend + click: de knop moet op het device (touch) en in de
  // desktop-preview (muis) werken, maar niet twee keer afgaan.
  function onTap(el, fn) {
    var touched = false;
    el.addEventListener(
      'touchend',
      function (ev) {
        ev.preventDefault();
        touched = true;
        fn();
      },
      false
    );
    el.addEventListener(
      'click',
      function () {
        if (!touched) {
          fn();
        }
        touched = false;
      },
      false
    );
  }

  function build() {
    injectCss();
    btn = document.createElement('button');
    btn.id = 'zs-help-btn';
    btn.type = 'button';
    onTap(btn, open);
    document.body.appendChild(btn);

    modal = document.createElement('div');
    modal.id = 'zs-help';
    modal.innerHTML =
      '<div id="zs-help-card">' +
      '<button id="zs-help-close" type="button">×</button>' +
      '<div id="zs-help-content">' +
      '<img id="zs-help-img" alt="">' +
      '<div id="zs-help-sep"></div>' +
      '<div id="zs-help-text"></div>' +
      '</div></div>';
    document.body.appendChild(modal);
    imgEl = document.getElementById('zs-help-img');
    sepEl = document.getElementById('zs-help-sep');
    textEl = document.getElementById('zs-help-text');
    onTap(document.getElementById('zs-help-close'), close);
  }

  function hasHelp(help) {
    return !!help && !!(help.image || help.text);
  }

  // Knop tonen (na een verkeerde scan). Zonder help bij deze stop: niets.
  function offer(help, buttonText) {
    if (!hasHelp(help)) {
      return false;
    }
    if (!btn) {
      build();
    }
    current = help;
    btn.textContent = buttonText || DEFAULT_BUTTON_TEXT;
    if (modal.className !== 'zs-on') {
      btn.className = 'zs-on';
    }
    return true;
  }

  function open() {
    if (!current) {
      return;
    }
    if (current.image) {
      imgEl.src = current.image;
      imgEl.style.display = 'block';
    } else {
      imgEl.removeAttribute('src');
      imgEl.style.display = 'none';
    }
    textEl.textContent = current.text || '';
    sepEl.style.display = current.image && current.text ? 'block' : 'none';
    btn.className = '';
    modal.className = 'zs-on';
  }

  function close() {
    modal.className = '';
    if (current) {
      btn.className = 'zs-on';
    }
  }

  function hide() {
    current = null;
    if (btn) {
      btn.className = '';
      modal.className = '';
    }
  }

  return {offer: offer, open: open, hide: hide};
})();
