/**
 * Zelfscanner content-pack runtime — dunne story-sequencer.
 *
 * Verloop (besloten 2026-09-17, storyboard Sjef):
 *   splash → luisterinstructie → intro-audio → hint stop 1 → juiste scan
 *   → beloning → hint stop 2 → … → beloning laatste stop → eindscherm
 *
 * De intro-audio (manifest.intro.src, toegevoegd 2026-10-01) speelt op het
 * audiotour-scherm, net als een audiotour-beloning. Leeg = geen intro: de
 * luisterinstructie ligt dan meteen over de eerste hint.
 *
 * Een stop (manifest.stops[i]) koppelt een product-barcode aan een hint
 * (afbeelding, puzzel of video) en een beloning (audiotour of video). Na een
 * audiotour-beloning komt eerst weer de luisterinstructie. De beloning hangt
 * aan de stop en dus aan de barcode, niet aan de positie in de lijst: de
 * volgorde kan later per bezoeker geschud worden (zie `order`).
 *
 * Scans: tijdens een hint gaat alleen de barcode van die stop door, de rest
 * geeft "verkeerd product". Tijdens intro, beloning en op splash/eindscherm doen
 * scans niets. De reset-barcode en terugzetten in de cradle werken altijd:
 * terug naar het splash-scherm, voortgang weg.
 *
 * Cradle: staat de scanner erin, dan opent de swipe op het splash-scherm ook
 * de cradle (App.tsx doet de unlock). Zit hij er na UNDOCK_WAIT_MS nog in,
 * dan terug naar splash, anders staat de volgende bezoeker voor een dichte
 * cradle zonder swipe.
 *
 * Geen framework, geen build-stap: dit bestand draait ongewijzigd vanaf het
 * filesystem in de WebView, dus wat je hier aanpast zie je na een adb push
 * direct op het device.
 */
(function () {
  var video = document.getElementById('player');
  var photo = document.getElementById('photo');
  var errorEl = document.getElementById('error');
  var debugEl = document.getElementById('debug');

  var manifest = null;
  var phase = 'boot'; // splash | intro | hint | reward | end | preview
  var order = []; // indexen in manifest.stops, in speelvolgorde
  var pos = 0; // positie in order
  var videoReward = null; // src van de video-beloning die nu speelt
  var instructionHeld = false; // editor-preview: luisterinstructie blijft staan
  var editorOwned = false; // editor-preview: manifest komt uit de editor
  var errorTimer = null;

  var docked = false; // scanner staat in de cradle (van App.tsx)
  var undockTimer = null;

  // App.tsx houdt de cradle UNLOCK_SECONDS (10 s) open, plus marge om hem
  // eruit te halen.
  var UNDOCK_WAIT_MS = 15000;
  var DEFAULT_INSTRUCTION_TEXT = 'Keep the scanner next to your ear';
  var DEFAULT_INSTRUCTION_SECONDS = 5;

  function log(msg) {
    debugEl.textContent = msg;
  }

  function post(type, payload) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({type: type, payload: payload || null}));
    }
  }

  // Old Android 5.1 WebView's play() doesn't return a Promise (pre-2016
  // Chromium) -- guard before chaining .catch(), calling .catch on undefined
  // throws and silently aborts the rest of the caller.
  function safePlay(el, label, onBlocked) {
    var playResult = el.play();
    if (playResult && typeof playResult.catch === 'function') {
      playResult.catch(function (e) {
        log(label + ' — play failed: ' + e.message);
        if (onBlocked) {
          onBlocked();
        }
      });
    }
  }

  function currentStop() {
    return manifest.stops[order[pos]] || null;
  }

  function instructionText() {
    var instr = manifest.instruction || {};
    return instr.text || DEFAULT_INSTRUCTION_TEXT;
  }

  function introSrc() {
    var intro = manifest.intro || {};
    return intro.src || null;
  }

  function instructionSeconds() {
    var instr = manifest.instruction || {};
    return typeof instr.seconds === 'number' ? instr.seconds : DEFAULT_INSTRUCTION_SECONDS;
  }

  // Nu de volgorde uit de lijst. Hier later per bezoeker schudden.
  function resetOrder() {
    order = [];
    for (var i = 0; i < manifest.stops.length; i++) {
      order.push(i);
    }
    pos = 0;
  }

  function showError() {
    errorEl.classList.add('show');
    errorEl.textContent = 'VERKEERD PRODUCT';
    clearTimeout(errorTimer);
    errorTimer = setTimeout(hideError, 1500);
  }

  function hideError() {
    errorEl.classList.remove('show');
  }

  function hideOverlay() {
    instructionHeld = false;
    window.ZSOverlay.hide();
  }

  // Alles wat een hint of beloning in beeld of op de speaker heeft gezet weg.
  function stopMedia() {
    videoReward = null;
    video.pause();
    video.removeAttribute('src');
    video.style.display = 'none';
    photo.style.display = 'none';
    photo.removeAttribute('src');
    if (window.ZSPuzzle) {
      window.ZSPuzzle.unmount();
    }
    window.ZSAudiotour.unmount();
  }

  function clearStage() {
    clearTimeout(errorTimer);
    hideError();
    hideOverlay();
    window.ZSSplash.hide();
    window.ZSEnd.hide();
    stopMedia();
  }

  // Hint-video: stil en in een lus tot de scan. Beloning-video: met geluid,
  // één keer, daarna door naar de volgende stop.
  function playVideo(src, asReward) {
    video.loop = !asReward;
    video.muted = !asReward;
    video.style.display = '';
    video.src = src;
    // Old WebKit (Android 5.1 WebView) doesn't reliably pick up a new
    // src on an existing <video> without an explicit load() -- without
    // this the element can silently keep showing the previous video.
    // Confirmed on-device 2026-08-19.
    video.load();
    videoReward = asReward ? src : null;
    safePlay(video, 'video ' + src, function () {
      // Desktop-preview: autoplay met geluid mag daar pas na een klik. Dan
      // stil verder, zodat het verloop niet blijft hangen. (Het device geeft
      // geen Promise terug en komt hier nooit.)
      if (asReward && !video.muted) {
        video.muted = true;
        safePlay(video, 'video ' + src + ' (stil)');
      }
    });
  }

  video.addEventListener('ended', function () {
    if (phase === 'reward' && videoReward) {
      nextStop();
    }
  }, false);
  video.addEventListener('error', function () {
    if (phase === 'reward' && videoReward && video.getAttribute('src') === videoReward) {
      log('beloning-video laadt niet: ' + videoReward);
      nextStop();
    }
  }, false);

  // keepOverlay: de luisterinstructie van de start ligt eroverheen en blijft
  // staan tot zijn eigen timer afloopt.
  function showHint(keepOverlay) {
    var stop = currentStop();
    if (!stop) {
      log('geen stop op positie ' + pos);
      return;
    }
    clearTimeout(errorTimer);
    hideError();
    if (!keepOverlay) {
      hideOverlay();
    }
    window.ZSSplash.hide();
    window.ZSEnd.hide();
    stopMedia();
    phase = 'hint';

    var hint = stop.hint || {};
    if (!hint.src) {
      log('stop ' + stop.id + ' heeft geen hint');
    } else if (hint.type === 'puzzle') {
      if (window.ZSPuzzle) {
        // De puzzel is een hint, geen horde: de scan werkt altijd, ook als
        // hij niet af is.
        window.ZSPuzzle.mount(
          hint.src,
          function () {
            post('puzzleSolved', {id: stop.id});
          },
          log
        );
      } else {
        log('puzzle.js niet geladen — stop ' + stop.id);
      }
    } else if (hint.type === 'video') {
      playVideo(hint.src, false);
    } else {
      photo.src = hint.src;
      // 'block', niet '': index.html zet img#photo standaard op display:none.
      photo.style.display = 'block';
    }
    logWaiting();
  }

  function logWaiting() {
    var stop = currentStop();
    if (stop && phase === 'hint') {
      log('stop ' + (pos + 1) + '/' + order.length + ' ' + stop.id + ' — wacht op ' + stop.scan);
    }
  }

  // Juiste scan. Audiotour: luisterinstructie over de hint, het
  // audiotour-scherm komt eronder als hij wegfadet en de audio start als hij
  // weg is. Video: meteen. skipInstruction: editor-preview.
  function startReward(skipInstruction) {
    var stop = currentStop();
    phase = 'reward';
    clearTimeout(errorTimer);
    hideError();
    post('found', {id: stop.id});

    var reward = stop.reward || {};
    if (!reward.src) {
      log('stop ' + stop.id + ' heeft geen beloning — door');
      nextStop();
      return;
    }
    if (reward.type === 'video') {
      hideOverlay();
      stopMedia();
      playVideo(reward.src, true);
      log('stop ' + stop.id + ' — beloning: video');
      return;
    }

    function mountTour() {
      stopMedia();
      window.ZSAudiotour.mount(manifest.audiotour, reward.src, nextStop, log);
    }
    function startTour() {
      window.ZSAudiotour.start();
      log('stop ' + stop.id + ' — audiotour');
    }
    var seconds = instructionSeconds();
    if (skipInstruction || !(seconds > 0)) {
      hideOverlay();
      mountTour();
      startTour();
      return;
    }
    hideOverlay();
    window.ZSOverlay.show(instructionText(), {seconds: seconds, onHide: mountTour, onDone: startTour});
    log('stop ' + stop.id + ' — luisterinstructie, dan audiotour');
  }

  function nextStop() {
    videoReward = null;
    pos++;
    if (pos < order.length) {
      showHint(false);
    } else {
      showEnd();
    }
  }

  // Blijft staan tot reset-scan of cradle.
  function showEnd() {
    clearStage();
    phase = 'end';
    window.ZSEnd.show(manifest.end, log);
    post('storyEnd', null);
    log('einde — reset-scan of cradle brengt je terug');
  }

  // Het splash-scherm staat altijd vóór de eerste stop: bij boot en na een
  // reset. Swipen start de story.
  function showSplash() {
    clearStage();
    clearTimeout(undockTimer);
    phase = 'splash';
    resetOrder();
    window.ZSAudiotour.resetVolume();
    window.ZSSplash.show(manifest.splash, startStory, log);
    log('splash — swipe om te starten' + (manifest.resetScan ? ' (reset = ' + manifest.resetScan + ')' : ''));
  }

  // Intro-audio op het audiotour-scherm; klaar (of kapot) = eerste hint.
  // skipInstruction: editor-preview, of er was geen instructie.
  function startIntro(skipInstruction) {
    var src = introSrc();
    phase = 'intro';

    function mountTour() {
      stopMedia();
      window.ZSSplash.hide();
      window.ZSAudiotour.mount(manifest.audiotour, src, function () {
        if (phase === 'intro') {
          showHint(false);
        }
      }, log);
    }
    function startTour() {
      window.ZSAudiotour.start();
      log('intro-audio');
    }
    var seconds = instructionSeconds();
    if (skipInstruction || !(seconds > 0)) {
      hideOverlay();
      mountTour();
      startTour();
      return;
    }
    hideOverlay();
    window.ZSOverlay.show(instructionText(), {seconds: seconds, onHide: mountTour, onDone: startTour});
    log('luisterinstructie, dan intro-audio');
  }

  // Na het swipen: luisterinstructie fadet in over het splash-scherm. Met
  // intro-audio komt daarna het audiotour-scherm (zie startIntro), zonder
  // wisselt het beeld eronder naar de eerste hint. Na `seconds` fadet hij
  // weg. seconds 0 = geen instructie. Wordt er intussen gescand (of
  // gereset), dan ruimt de runtime de laag direct op.
  function startStory() {
    resetOrder();
    if (!order.length) {
      log('manifest heeft geen stops');
      return;
    }
    post('storyStart', {id: currentStop().id});
    if (docked) {
      post('unlockCradle', null);
      clearTimeout(undockTimer);
      undockTimer = setTimeout(function () {
        if (docked && phase !== 'splash') {
          reset('niet uit cradle gehaald');
        }
      }, UNDOCK_WAIT_MS);
    }
    if (introSrc()) {
      startIntro(false);
      return;
    }
    var seconds = instructionSeconds();
    if (!(seconds > 0)) {
      showHint(false);
      return;
    }
    window.ZSOverlay.show(instructionText(), {
      seconds: seconds,
      onShown: function () {
        showHint(true);
        log('luisterinstructie — ' + seconds + 's');
      },
      onDone: logWaiting
    });
  }

  function reset(by) {
    var stop = phase === 'hint' || phase === 'reward' ? currentStop() : null;
    post('reset', {from: stop ? phase + ':' + stop.id : phase, by: by});
    showSplash();
  }

  // Native (App.tsx) roept dit aan via injectJavaScript bij elke scan.
  window.onNativeScan = function (code) {
    if (!manifest) {
      return;
    }
    if (manifest.resetScan && code === manifest.resetScan) {
      reset('scan');
      return;
    }
    if (phase !== 'hint') {
      return;
    }
    var stop = currentStop();
    if (!stop) {
      return;
    }
    if (code === stop.scan) {
      startReward(false);
    } else {
      showError();
      post('wrongScan', {expected: stop.scan, got: code});
    }
  };

  // Native (App.tsx): scanner staat in de cradle (true) of is eruit (false).
  // Ook bij het laden van de pagina, met de huidige stand. Erin zetten =
  // bezoeker klaar, terug naar splash. Zonder argument telt als erin.
  window.onNativeDock = function (isDocked) {
    docked = isDocked !== false;
    if (!docked) {
      clearTimeout(undockTimer);
      return;
    }
    if (manifest && phase !== 'splash' && phase !== 'boot') {
      reset('cradle');
    }
  };

  function setManifest(m) {
    manifest = m;
    manifest.stops = manifest.stops || [];
  }

  // Alleen voor de story editor (tools/editor.html), nooit door de native
  // app: zet de preview op één onderdeel, met het nog niet opgeslagen
  // manifest uit de editor (m; weglaten = huidige houden).
  //   target.kind: splash | instruction | intro | audiotour | hint | reward | end
  //   target.index: stop-index bij hint en reward
  //   target null: alleen het manifest bijwerken, beeld blijft staan
  window.__editorPreview = function (m, target) {
    if (m) {
      editorOwned = true;
      setManifest(m);
    }
    if (!manifest || !target) {
      return;
    }
    var kind = target.kind;

    if (kind === 'instruction') {
      // Blijft staan zolang je de tekst aanpast; een volgende aanroep
      // ververst alleen de tekst.
      if (!instructionHeld) {
        clearStage();
        resetOrder();
        if (order.length) {
          showHint(true);
        }
        instructionHeld = true;
      }
      window.ZSOverlay.show(instructionText(), {hold: true});
      return;
    }
    if (kind === 'intro') {
      clearStage();
      resetOrder();
      if (introSrc()) {
        startIntro(true);
      } else if (order.length) {
        showHint(false);
      }
      return;
    }
    if (kind === 'audiotour') {
      clearStage();
      phase = 'preview';
      window.ZSAudiotour.mount(manifest.audiotour, null, null, log);
      log('audiotour-scherm (zonder audio)');
      return;
    }
    if (kind === 'end') {
      showEnd();
      return;
    }
    if ((kind === 'hint' || kind === 'reward') && manifest.stops[target.index]) {
      resetOrder();
      pos = target.index;
      showHint(false);
      if (kind === 'reward') {
        startReward(true);
      }
      return;
    }
    showSplash();
  };

  function boot() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', 'manifest.json', true);
    xhr.overrideMimeType('application/json; charset=utf-8'); // see index.html for why
    xhr.onload = function () {
      if (editorOwned) {
        return; // de editor was sneller en heeft zijn eigen manifest gezet
      }
      setManifest(JSON.parse(xhr.responseText));
      log('pack v' + manifest.version + ' — ' + manifest.stops.length + ' stops geladen');
      showSplash();
    };
    xhr.onerror = function () {
      log('manifest.json laden MISLUKT');
    };
    xhr.send();
  }

  boot();
})();
