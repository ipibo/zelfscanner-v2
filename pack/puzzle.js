/**
 * Puzzel-minigame -- eerste module uit Sjefs storyboard.
 *
 * Gedrag (besloten 2026-09-17):
 * - 3x3 raster van echte legpuzzelstukjes: nopjes en gaatjes, per puzzel
 *   willekeurig. Stukjes worden aangeboden in een balk onderin, in willekeurige
 *   volgorde, SLOTS tegelijk. Zodra er een ligt schuift het volgende aan.
 * - Een stukje klikt alleen vast op zijn eigen plek. Elders veert het terug
 *   naar de balk, zonder foutmelding.
 * - Geluid: goed gelegd = SOUND_PLACE, teruggeveerd naar de balk =
 *   SOUND_BACK. Loslaten op zijn eigen plek in de balk blijft stil.
 * - De puzzel is een hint, geen horde. De bezoeker mag altijd doorscannen naar
 *   het volgende artikel; elk goed gelegd stukje maakt de hint duidelijker.
 *   Af = lijnen weg, beeld heel, blijft staan tot de volgende scan.
 *
 * Tekenen gaat via <canvas>: CSS clip-path met curves bestaat nog niet in
 * Chromium 46, canvas-paden wel. Het bord is één canvas (lege plekken als
 * omtrek, gelegde stukjes erin getekend). Elk stukje in de balk is een eigen
 * canvas dat met transform beweegt, dus geen repaint per touchmove.
 *
 * Constraints: draait in de WebView van een Zebra MC18N0 (Android 5.1.1,
 * Chromium 46). Dus ES5 only, geen libraries, geen HTML5 drag-and-drop (doet
 * daar niets op touch) maar losse touch/mouse-events. Zie ook README.
 *
 * API: ZSPuzzle.mount(src, onSolve, onLog) / ZSPuzzle.unmount()
 */
window.ZSPuzzle = (function () {
  var GRID = 3; // 3x3
  var SLOTS = 4; // stukjes tegelijk in de balk
  var CSS_ID = 'zp-style';
  var MOUSE = -1; // drag.id voor een muis-sleep (desktop preview)

  // Vorm van een nop, in celbreedtes: een ellips (halve breedte KNOB_A, halve
  // hoogte KNOB_B) met het middelpunt KNOB_LIFT boven de rand. De kop is zo
  // breder dan de hals, zoals bij een echt stukje. Steekt 0.19 cel uit.
  var KNOB_A = 0.2;
  var KNOB_B = 0.13;
  var KNOB_LIFT = 0.06;
  var KNOB_OUT = KNOB_LIFT + KNOB_B;
  var KNOB_STEPS = 18; // lijnstukjes per nop
  var PAD = 0.28; // ruimte rond een stukje in zijn eigen canvas: nop + schaduw
  var LINE = 0.014; // lijndikte op het bord, in celbreedtes
  // Relatief aan de pack-pagina, net als de foto's in het manifest. Media staat
  // niet in git: zsdeploy push zet pack/assets/ op de devices.
  var SOUND_PLACE = 'assets/audio/puzzle-right-place.mp3';
  var SOUND_BACK = 'assets/audio/puzzle-swoosh.mp3';

  // Punten van één nop op een rand van (0,0) naar (1,0): [langs, naar buiten].
  var KNOB_PTS = (function () {
    var cut = Math.asin(KNOB_LIFT / KNOB_B); // hoek waarop de ellips de rand snijdt
    var from = Math.PI + cut;
    var to = -cut;
    var pts = [];
    for (var i = 0; i <= KNOB_STEPS; i++) {
      var a = from + (to - from) * i / KNOB_STEPS;
      pts.push([0.5 + KNOB_A * Math.cos(a), KNOB_LIFT + KNOB_B * Math.sin(a)]);
    }
    return pts;
  })();

  var root = null;
  var boardEl = null;
  var img = null;
  var edgesH = []; // edgesH[r][c], r >= 1: rand boven cel (r,c). +1 = nop van de cel erboven, wijst omlaag
  var edgesV = []; // edgesV[r][c], c >= 1: rand links van cel (r,c). +1 = nop van de cel links, wijst naar rechts
  var filled = []; // 9 booleans
  var solved = false;
  var stack = []; // nog niet aangeboden stuk-indices, geschud
  var slotPieces = []; // wat er nu in de balk ligt (null = leeg slot)
  var drag = null;
  var geom = null;
  var pendingSrc = null;
  var onSolve = null;
  var onLog = null;
  var resizeTimer = null;
  var sounds = null; // {place, back}: <audio>, één keer per mount voorgeladen

  // touch-action:none -- de pagina heeft geen viewport-meta en de WebView staat
  // zoom toe, dus zonder dit mag Chromium pan/pinch/dubbeltik-zoom starten
  // zodra een vinger op de puzzel komt. Zet ook de touch-ack-timeout uit.
  var CSS = [
    '#zp-root{position:absolute;top:0;left:0;right:0;bottom:0;display:none;background:#000;z-index:2;',
    'touch-action:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;}',
    '#zp-root.zp-on{display:block;}',
    '#zp-board{position:absolute;-webkit-transition:top .45s ease-out;transition:top .45s ease-out;}',
    '.zp-piece{position:absolute;left:0;top:0;z-index:5;-webkit-transform-origin:0 0;transform-origin:0 0;}',
    '.zp-piece.zp-back{-webkit-transition:-webkit-transform .18s ease-out;transition:transform .18s ease-out;}',
    '.zp-piece.zp-drag{z-index:9;}',
    '#zp-root.zp-solved .zp-piece{display:none;}',
    'body.zp-active #caption{top:0;bottom:auto;z-index:10;padding:4vw 4vw 8vw;',
    'background:linear-gradient(to bottom,rgba(0,0,0,0.75),rgba(0,0,0,0));}',
    'body.zp-active #debug{z-index:10;}'
  ].join('');

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

  function loadSound(src) {
    var el = new Audio(src);
    el.preload = 'auto';
    el.onerror = function () {
      log('puzzel-geluid laadt niet: ' + src);
    };
    el.load();
    return el;
  }

  // Terug naar het begin en spelen, zodat snel achter elkaar leggen elke keer
  // klinkt. currentTime zetten kan gooien zolang de metadata er nog niet is.
  // play() geeft op deze WebView nog geen Promise terug, zie runtime.js.
  function playSound(el) {
    if (!el) {
      return;
    }
    try {
      el.currentTime = 0;
    } catch (e) {
      // nog niet geladen: speelt dan gewoon vanaf het begin
    }
    var result = el.play();
    if (result && typeof result.catch === 'function') {
      result.catch(function (e) {
        log('puzzel-geluid — play mislukt: ' + e.message);
      });
    }
  }

  function make(tag, cls) {
    var node = document.createElement(tag);
    if (cls) {
      node.className = cls;
    }
    return node;
  }

  function shuffle(list) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    return list;
  }

  function randomEdges() {
    edgesH = [];
    edgesV = [];
    for (var r = 0; r < GRID; r++) {
      edgesH.push([]);
      edgesV.push([]);
      for (var c = 0; c < GRID; c++) {
        edgesH[r].push(Math.random() < 0.5 ? 1 : -1);
        edgesV[r].push(Math.random() < 0.5 ? 1 : -1);
      }
    }
  }

  // Canvas-pixels per CSS-pixel. De pack-pagina heeft geen viewport-meta, dus
  // de WebView toont 980 CSS-px uitgezoomd op een 480 px scherm: dan is ~0.5
  // al scherp en scheelt het geheugen. Desktop-preview: tot 2 (retina).
  function resolution() {
    var screenW = (window.screen && window.screen.width) || window.innerWidth;
    var r = screenW * (window.devicePixelRatio || 1) / (window.innerWidth || 1);
    return Math.max(0.5, Math.min(2, r));
  }

  // Meet het scherm op en leg bord, celgrootte en balk vast. De foto wordt
  // cover-gecropt op een vierkant bord; alle tekenmaten zijn in cellen.
  function measure(natW, natH) {
    var W = root.clientWidth || window.innerWidth;
    var H = root.clientHeight || window.innerHeight;
    var pad = Math.round(Math.min(W, H) * 0.045);
    var maxBoard = Math.min(W - pad * 2, Math.round(H * 0.66));
    var cell = Math.max(24, Math.floor(maxBoard / GRID));
    var board = cell * GRID;
    var trayTop = pad + board + pad;
    var trayH = Math.max(28, H - trayTop - pad);
    // Nopjes van buren mogen in de balk net over elkaar vallen: aanpakken gaat
    // op het vierkant van het stukje (pieceAt), niet op het canvas eromheen.
    var gap = 0.3; // ruimte tussen twee stukjes, in stukbreedtes
    var byWidth = Math.floor((W - pad * 2) / (SLOTS + (SLOTS - 1) * gap));
    var byHeight = Math.floor(trayH / (1 + 2 * KNOB_OUT));
    var slot = Math.max(24, Math.min(cell, byHeight, byWidth));
    var step = Math.round(slot * (1 + gap));
    var rowW = slot + (SLOTS - 1) * step;
    var scale = Math.max(GRID / natW, GRID / natH);

    return {
      W: W,
      H: H,
      res: resolution(),
      cell: cell,
      board: board,
      boardLeft: Math.round((W - board) / 2),
      boardTop: pad,
      margin: Math.ceil(LINE * cell) + 2,
      natW: natW,
      natH: natH,
      imgW: natW * scale,
      imgH: natH * scale,
      imgX: (GRID - natW * scale) / 2,
      imgY: (GRID - natH * scale) / 2,
      slot: slot,
      slotTop: trayTop + Math.round((trayH - slot) / 2),
      slotStart: Math.round((W - rowW) / 2),
      slotStep: step
    };
  }

  // Verklein de foto één keer naar bordformaat. In stappen van de helft, want
  // in één keer van 3000 naar 400 px geeft in deze Chromium kartels.
  function prescale(image, w, h) {
    var cur = image;
    var cw = geom.natW;
    var ch = geom.natH;
    while (cw / 2 >= w && ch / 2 >= h) {
      cw = Math.round(cw / 2);
      ch = Math.round(ch / 2);
      var half = document.createElement('canvas');
      half.width = cw;
      half.height = ch;
      half.getContext('2d').drawImage(cur, 0, 0, cw, ch);
      cur = half;
    }
    var out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    out.getContext('2d').drawImage(cur, 0, 0, w, h);
    return out;
  }

  function slotLeft(i) {
    return geom.slotStart + i * geom.slotStep;
  }

  function sizeCanvas(cv, css) {
    var px = Math.ceil(css * geom.res);
    if (cv.width !== px) {
      cv.width = px;
      cv.height = px;
    }
    cv.style.width = css + 'px';
    cv.style.height = css + 'px';
  }

  // Rand van (x0,y0) naar (x1,y1), lengte 1 cel. (nx,ny) = normaal naar
  // buiten; dir +1 = nop naar buiten, -1 = gaatje, 0 = rechte buitenrand.
  function edge(ctx, x0, y0, x1, y1, nx, ny, dir) {
    if (dir) {
      for (var i = 0; i < KNOB_PTS.length; i++) {
        var t = KNOB_PTS[i][0];
        var h = KNOB_PTS[i][1] * dir;
        ctx.lineTo(x0 + (x1 - x0) * t + nx * h, y0 + (y1 - y0) * t + ny * h);
      }
    }
    ctx.lineTo(x1, y1);
  }

  // Omtrek van stuk `index`, in bordcoördinaten (1 = één cel).
  function piecePath(ctx, index) {
    var r = Math.floor(index / GRID);
    var c = index % GRID;
    ctx.beginPath();
    ctx.moveTo(c, r);
    edge(ctx, c, r, c + 1, r, 0, -1, r > 0 ? -edgesH[r][c] : 0);
    edge(ctx, c + 1, r, c + 1, r + 1, 1, 0, c < GRID - 1 ? edgesV[r][c + 1] : 0);
    edge(ctx, c + 1, r + 1, c, r + 1, 0, 1, r < GRID - 1 ? edgesH[r + 1][c] : 0);
    edge(ctx, c, r + 1, c, r, -1, 0, c > 0 ? -edgesV[r][c] : 0);
    ctx.closePath();
  }

  function drawPhoto(ctx) {
    ctx.drawImage(geom.source, geom.imgX, geom.imgY, geom.imgW, geom.imgH);
  }

  function drawBoard() {
    var ctx = boardEl.getContext('2d');
    var k = boardEl.width / (geom.board + 2 * geom.margin);
    var u = k * geom.cell;
    var i;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, boardEl.width, boardEl.height);
    ctx.setTransform(u, 0, 0, u, k * geom.margin, k * geom.margin);
    ctx.lineJoin = 'round';

    if (solved) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, GRID, GRID);
      ctx.clip();
      drawPhoto(ctx);
      ctx.restore();
      return;
    }

    ctx.fillStyle = '#151515';
    ctx.fillRect(0, 0, GRID, GRID);
    for (i = 0; i < filled.length; i++) {
      if (filled[i]) {
        ctx.save();
        piecePath(ctx, i);
        ctx.clip();
        drawPhoto(ctx);
        ctx.restore();
      }
    }
    // naden tussen gelegde stukjes: dun en donker, zodat het beeld heel oogt
    ctx.lineWidth = LINE * 0.6;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    for (i = 0; i < filled.length; i++) {
      if (filled[i]) {
        piecePath(ctx, i);
        ctx.stroke();
      }
    }
    // lege plekken als laatste, zodat een rand tussen gelegd en leeg licht blijft
    ctx.lineWidth = LINE;
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    for (i = 0; i < filled.length; i++) {
      if (!filled[i]) {
        piecePath(ctx, i);
        ctx.stroke();
      }
    }
  }

  function placeBoard() {
    var top = solved ? Math.round((geom.H - geom.board) / 2) : geom.boardTop;
    sizeCanvas(boardEl, geom.board + 2 * geom.margin);
    boardEl.style.left = geom.boardLeft - geom.margin + 'px';
    boardEl.style.top = top - geom.margin + 'px';
    drawBoard();
  }

  // Tekent het stukje op celgrootte in zijn eigen canvas; kleiner in de balk
  // gaat via scale(). lifted = met schaduw, tijdens het slepen.
  function renderPiece(piece, lifted) {
    var cv = piece.node;
    var css = geom.cell * (1 + 2 * PAD);
    sizeCanvas(cv, css);
    var ctx = cv.getContext('2d');
    var u = cv.width / css * geom.cell;
    var r = Math.floor(piece.index / GRID);
    var c = piece.index % GRID;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(u, 0, 0, u, u * (PAD - c), u * (PAD - r));
    ctx.lineJoin = 'round';
    piecePath(ctx, piece.index);
    if (lifted) {
      // schaduw vóór de clip, anders knipt die hem mee weg. Schaduwmaten zijn
      // in canvas-pixels, de transform geldt er niet voor.
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 0.07 * u;
      ctx.shadowOffsetY = 0.03 * u;
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.restore();
    }
    ctx.save();
    ctx.clip();
    drawPhoto(ctx);
    ctx.restore();
    ctx.lineWidth = LINE * 0.6;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.stroke();
  }

  // Zet het vierkant van een stukje (zonder nop-ruimte) linksboven op (x, y),
  // `size` CSS-px breed.
  function put(piece, x, y, size) {
    var off = PAD * size;
    var t = 'translate3d(' + Math.round(x - off) + 'px,' + Math.round(y - off) + 'px,0) ' +
      'scale(' + size / geom.cell + ')';
    piece.node.style.webkitTransform = t;
    piece.node.style.transform = t;
  }

  function toSlot(piece) {
    put(piece, slotLeft(piece.slot), geom.slotTop, geom.slot);
  }

  function makePiece(index, slotIdx) {
    var piece = {index: index, node: make('canvas', 'zp-piece'), slot: slotIdx, timer: null};
    renderPiece(piece, false);
    toSlot(piece);
    root.appendChild(piece.node);
    return piece;
  }

  function refill() {
    for (var i = 0; i < SLOTS; i++) {
      if (!slotPieces[i] && stack.length) {
        slotPieces[i] = makePiece(stack.pop(), i);
      }
    }
  }

  // Welk stukje in de balk ligt onder dit punt. Op het vierkant plus wat
  // speling, niet op het canvas: dat is groter en overlapt de buren.
  function pieceAt(p) {
    var tol = geom.slot * 0.12;
    if (p.y < geom.slotTop - tol || p.y > geom.slotTop + geom.slot + tol) {
      return null;
    }
    for (var i = 0; i < SLOTS; i++) {
      var x = slotLeft(i);
      if (slotPieces[i] && p.x >= x - tol && p.x <= x + geom.slot + tol) {
        return slotPieces[i];
      }
    }
    return null;
  }

  // Punt van de vinger die sleept, of null als dit event over een andere
  // vinger gaat. Een tweede vinger of een duim op de rand mag het stuk niet
  // overnemen of laten vallen.
  function pointOf(ev) {
    var list = ev.changedTouches;
    if (!list) {
      return drag.id === MOUSE ? {x: ev.clientX, y: ev.clientY} : null;
    }
    for (var i = 0; i < list.length; i++) {
      if (list[i].identifier === drag.id) {
        return {x: list[i].clientX, y: list[i].clientY};
      }
    }
    return null;
  }

  // Tijdens het slepen op celgrootte, gecentreerd onder de vinger.
  function follow(p) {
    put(drag.piece, p.x - geom.cell / 2, p.y - geom.cell / 2, geom.cell);
  }

  // Welke cel ligt onder dit punt. Randen krijgen wat speling, want vingers op
  // een 2.8 inch scherm zijn niet precies.
  function cellAt(p) {
    var x = p.x - geom.boardLeft;
    var y = p.y - geom.boardTop;
    var tol = geom.cell * 0.3;
    if (x < -tol || y < -tol || x > geom.board + tol || y > geom.board + tol) {
      return -1;
    }
    var col = Math.min(GRID - 1, Math.max(0, Math.floor(x / geom.cell)));
    var row = Math.min(GRID - 1, Math.max(0, Math.floor(y / geom.cell)));
    return row * GRID + col;
  }

  function placePiece(piece) {
    filled[piece.index] = true;
    playSound(sounds && sounds.place);
    if (piece.node.parentNode) {
      piece.node.parentNode.removeChild(piece.node);
    }
    slotPieces[piece.slot] = null;
    refill();

    var done = 0;
    for (var i = 0; i < filled.length; i++) {
      if (filled[i]) {
        done++;
      }
    }
    log('puzzel ' + done + '/' + filled.length);
    if (done === filled.length) {
      solve();
    } else {
      drawBoard();
    }
  }

  function returnToSlot(piece) {
    var node = piece.node;
    renderPiece(piece, false);
    node.className = 'zp-piece zp-back';
    toSlot(piece);
    clearTimeout(piece.timer);
    piece.timer = setTimeout(function () {
      // alweer opgepakt tijdens het terugveren? dan sleep-stijl laten staan
      if (!(drag && drag.piece === piece)) {
        node.className = 'zp-piece';
      }
    }, 220);
  }

  function solve() {
    solved = true;
    root.className = 'zp-on zp-solved';
    placeBoard();
    log('puzzel af');
    if (onSolve) {
      onSolve();
    }
  }

  function onDown(ev) {
    if (!geom || drag || solved) {
      return;
    }
    var t = ev.changedTouches ? ev.changedTouches[0] : ev;
    var p = {x: t.clientX, y: t.clientY};
    var piece = pieceAt(p);
    if (!piece) {
      return;
    }
    ev.preventDefault();
    drag = {piece: piece, id: ev.changedTouches ? t.identifier : MOUSE};
    clearTimeout(piece.timer);
    piece.node.className = 'zp-piece zp-drag';
    renderPiece(piece, true);
    follow(p);
  }

  function onMove(ev) {
    if (!drag) {
      return;
    }
    ev.preventDefault();
    var p = pointOf(ev);
    if (p) {
      follow(p);
    }
  }

  // touchend/mouseup legt neer; touchcancel (systeem nam de aanraking over)
  // veert altijd terug, ook als de vinger toevallig boven de goede cel was.
  function onUp(ev) {
    if (!drag) {
      return;
    }
    var p = pointOf(ev);
    if (!p) {
      return;
    }
    ev.preventDefault();
    var piece = drag.piece;
    drag = null;
    piece.node.className = 'zp-piece';
    if (ev.type !== 'touchcancel' && cellAt(p) === piece.index && !filled[piece.index]) {
      placePiece(piece);
    } else {
      if (pieceAt(p) !== piece) {
        playSound(sounds && sounds.back);
      }
      returnToSlot(piece);
    }
  }

  // (Her)bereken alle maten en teken alles opnieuw. Bij opbouw en na resize.
  function layout() {
    geom = measure(img.naturalWidth || img.width || 1, img.naturalHeight || img.height || 1);
    var px = geom.cell * geom.res;
    geom.source = prescale(img, Math.max(1, Math.round(geom.imgW * px)), Math.max(1, Math.round(geom.imgH * px)));
    placeBoard();
    for (var i = 0; i < SLOTS; i++) {
      var piece = slotPieces[i];
      if (!piece) {
        continue;
      }
      var lifted = drag && drag.piece === piece;
      renderPiece(piece, lifted);
      if (!lifted) {
        toSlot(piece);
      }
    }
  }

  function onResize() {
    if (!geom || !pendingSrc) {
      return;
    }
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (geom) {
        layout();
      }
    }, 150);
  }

  function bind(on) {
    var method = on ? 'addEventListener' : 'removeEventListener';
    root[method]('touchstart', onDown, false);
    root[method]('mousedown', onDown, false);
    document[method]('touchmove', onMove, false);
    document[method]('mousemove', onMove, false);
    document[method]('touchend', onUp, false);
    document[method]('touchcancel', onUp, false);
    document[method]('mouseup', onUp, false);
    window[method]('resize', onResize, false);
  }

  function build(image) {
    injectCss();
    root = document.getElementById('zp-root');
    if (!root) {
      root = make('div');
      root.id = 'zp-root';
      document.body.appendChild(root);
    }
    root.innerHTML = '';
    root.className = 'zp-on';
    document.body.className = 'zp-active';

    img = image;
    solved = false;
    if (!sounds) {
      sounds = {place: loadSound(SOUND_PLACE), back: loadSound(SOUND_BACK)};
    }
    randomEdges();
    boardEl = make('canvas');
    boardEl.id = 'zp-board';
    root.appendChild(boardEl);

    filled = [];
    stack = [];
    for (var i = 0; i < GRID * GRID; i++) {
      filled.push(false);
      stack.push(i);
    }
    shuffle(stack);
    slotPieces = [];
    for (var k = 0; k < SLOTS; k++) {
      slotPieces.push(null);
    }
    layout();
    refill();
    bind(true);
    log('puzzel 0/' + filled.length);
  }

  function mount(src, solveCb, logCb) {
    unmount();
    onSolve = solveCb || null;
    onLog = logCb || null;
    pendingSrc = src;
    var probe = new Image();
    probe.onload = function () {
      if (pendingSrc !== src) {
        return; // scene is intussen verder gescand
      }
      build(probe);
    };
    probe.onerror = function () {
      log('puzzel-afbeelding laadt niet: ' + src);
    };
    probe.src = src;
  }

  function unmount() {
    if (root) {
      bind(false);
      root.innerHTML = '';
      root.className = '';
    }
    if (document.body.className === 'zp-active') {
      document.body.className = '';
    }
    for (var i = 0; i < slotPieces.length; i++) {
      if (slotPieces[i]) {
        clearTimeout(slotPieces[i].timer);
      }
    }
    clearTimeout(resizeTimer);
    if (sounds) {
      sounds.place.pause();
      sounds.back.pause();
      sounds = null;
    }
    drag = null;
    geom = null;
    img = null;
    boardEl = null;
    solved = false;
    filled = [];
    stack = [];
    slotPieces = [];
    pendingSrc = null;
  }

  return {mount: mount, unmount: unmount};
})();
