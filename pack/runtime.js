/**
 * Zelfscanner content-pack runtime — dunne scene-sequencer.
 * Primitieven: playVideo (impliciet per scene), onScan, goto, post naar native.
 * Geen framework, geen build-stap: dit bestand draait ongewijzigd vanaf het
 * filesystem in de WebView, dus wat je hier aanpast zie je na een adb push
 * direct op het device.
 */
(function () {
  var video = document.getElementById('player');
  var photo = document.getElementById('photo');
  var narrator = document.getElementById('narrator');
  var errorEl = document.getElementById('error');
  var captionEl = document.getElementById('caption');
  var debugEl = document.getElementById('debug');

  var manifest = null;
  var scenesById = {};
  var sceneIndex = 0;
  var onSplash = false;
  var instructionHeld = false; // editor-preview: luisterinstructie blijft staan
  var errorTimer = null;

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
  function safePlay(el, label) {
    var playResult = el.play();
    if (playResult && typeof playResult.catch === 'function') {
      playResult.catch(function (e) {
        log(label + ' — play failed: ' + e.message);
      });
    }
  }

  // underOverlay: de scene wordt onder de luisterinstructie neergezet. Die
  // laag blijft dan staan en de narratie wacht tot hij weg is.
  function loadScene(id, underOverlay) {
    var scene = scenesById[id];
    if (!scene) {
      log('onbekende scene: ' + id);
      return;
    }
    sceneIndex = manifest.scenes.indexOf(scene);
    hideError();
    if (onSplash) {
      onSplash = false;
      window.ZSSplash.hide();
    }
    if (!underOverlay) {
      instructionHeld = false;
      window.ZSOverlay.hide();
    }

    // Elke scene begint zonder puzzel; een puzzel-scene zet hem zo weer neer.
    // Zo ruimt doorscannen midden in een puzzel zichzelf op.
    if (window.ZSPuzzle) {
      window.ZSPuzzle.unmount();
    }

    // video, image en puzzle sluiten elkaar uit per scene (afgedwongen bij het
    // schrijven door tools/build-manifest.js en tools/preview-server.js) --
    // bij een handmatig gesloopt manifest wint puzzle, dan video.
    if (scene.puzzle) {
      video.pause();
      video.removeAttribute('src');
      video.style.display = 'none';
      photo.style.display = 'none';
      photo.removeAttribute('src');
      if (window.ZSPuzzle) {
        // De puzzel is een hint, geen horde: scene.expectScan blijft gewoon
        // werken, dus de bezoeker kan altijd doorscannen zonder hem af te maken.
        window.ZSPuzzle.mount(
          scene.puzzle,
          function () {
            post('puzzleSolved', {id: scene.id});
          },
          log
        );
      } else {
        log('puzzle.js niet geladen — scene ' + scene.id);
      }
    } else if (scene.video) {
      photo.style.display = 'none';
      photo.removeAttribute('src');
      video.style.display = '';
      video.src = scene.video;
      // Old WebKit (Android 5.1 WebView) doesn't reliably pick up a new
      // src on an existing <video> without an explicit load() -- without
      // this the element can silently keep showing the previous scene's
      // video. Confirmed on-device 2026-08-19.
      video.load();
      safePlay(video, 'scene ' + scene.id + ' video');
    } else if (scene.image) {
      video.pause();
      video.removeAttribute('src');
      video.style.display = 'none';
      photo.src = scene.image;
      // 'block', niet '': index.html zet img#photo standaard op display:none,
      // dus leegmaken liet de foto onzichtbaar (sinds 408b566).
      photo.style.display = 'block';
    } else {
      video.pause();
      video.removeAttribute('src');
      video.style.display = 'none';
      photo.style.display = 'none';
      photo.removeAttribute('src');
    }

    if (scene.audio) {
      narrator.src = scene.audio;
      narrator.currentTime = 0;
      if (!underOverlay) {
        safePlay(narrator, 'scene ' + scene.id + ' audio');
      }
    } else {
      narrator.pause();
      narrator.removeAttribute('src');
    }

    if (scene.text) {
      captionEl.textContent = scene.text;
      captionEl.classList.add('show');
    } else {
      captionEl.classList.remove('show');
      captionEl.textContent = '';
    }

    log('scene ' + scene.id + (scene.expectScan ? ' — wacht op ' + scene.expectScan : ' — einde'));
    if (!scene.expectScan) {
      post('sceneEnd', {id: scene.id});
    }
  }

  // next scene on scan-match: explicit scene.next if set, else fall back to
  // array order (keeps old packs without "next" working unchanged).
  function nextSceneId(scene) {
    if (scene.next) {
      return scene.next;
    }
    var following = manifest.scenes[manifest.scenes.indexOf(scene) + 1];
    return following ? following.id : null;
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

  // Alles wat een scene op scherm of speaker heeft gezet weg: video, foto,
  // puzzel (met zijn voortgang), narratie, ondertitel, foutmelding.
  function clearStage() {
    clearTimeout(errorTimer);
    hideError();
    instructionHeld = false;
    window.ZSOverlay.hide();
    if (window.ZSPuzzle) {
      window.ZSPuzzle.unmount();
    }
    video.pause();
    video.removeAttribute('src');
    video.style.display = 'none';
    photo.style.display = 'none';
    photo.removeAttribute('src');
    narrator.pause();
    narrator.removeAttribute('src');
    captionEl.classList.remove('show');
    captionEl.textContent = '';
  }

  // Het splash-scherm staat altijd vóór de eerste scene: bij boot en na een
  // reset-scan. Swipen start de story bij manifest.scenes[0].
  function showSplash() {
    clearStage();
    onSplash = true;
    sceneIndex = 0;
    window.ZSSplash.show(manifest.splash, startStory, log);
    log('splash — swipe om te starten' + (manifest.resetScan ? ' (reset = ' + manifest.resetScan + ')' : ''));
  }

  function instructionText() {
    var instr = manifest.instruction || {};
    return instr.text || DEFAULT_INSTRUCTION_TEXT;
  }

  // Na het swipen: luisterinstructie fadet in over het splash-scherm, daaronder
  // wisselt het beeld naar de eerste scene, na `seconds` fadet hij weg en
  // start pas de narratie. seconds 0 = geen instructie. Wordt er intussen
  // gescand (of gereset), dan ruimt loadScene/showSplash de laag direct op en
  // komt onDone nooit.
  function startStory() {
    var first = manifest.scenes[0];
    post('storyStart', {id: first.id});
    var instr = manifest.instruction || {};
    var seconds = typeof instr.seconds === 'number' ? instr.seconds : DEFAULT_INSTRUCTION_SECONDS;
    if (!(seconds > 0)) {
      loadScene(first.id);
      return;
    }
    window.ZSOverlay.show(instructionText(), {
      seconds: seconds,
      onShown: function () {
        loadScene(first.id, true);
        log('luisterinstructie — ' + seconds + 's');
      },
      onDone: function () {
        log('scene ' + first.id + (first.expectScan ? ' — wacht op ' + first.expectScan : ' — einde'));
        if (narrator.getAttribute('src')) {
          safePlay(narrator, 'scene ' + first.id + ' audio');
        }
      }
    });
  }

  // Native (App.tsx) roept dit aan via injectJavaScript bij elke scan.
  window.onNativeScan = function (code) {
    if (!manifest) {
      return;
    }
    // De reset-barcode werkt altijd, in elke scene: voortgang weg, terug naar
    // het splash-scherm voor de volgende bezoeker.
    if (manifest.resetScan && code === manifest.resetScan) {
      post('reset', {from: onSplash ? 'splash' : manifest.scenes[sceneIndex].id});
      showSplash();
      return;
    }
    // Op het splash-scherm wordt nog niets verwacht: andere scans negeren,
    // ook zonder "verkeerd product".
    if (onSplash) {
      return;
    }
    var scene = manifest.scenes[sceneIndex];
    if (!scene || !scene.expectScan) {
      return;
    }
    if (code === scene.expectScan) {
      var nextId = nextSceneId(scene);
      if (nextId) {
        loadScene(nextId);
      }
    } else {
      showError();
      post('wrongScan', {expected: scene.expectScan, got: code});
    }
  };

  // Lets the desktop story editor (tools/editor.html) jump the live preview
  // to whichever scene is selected in its scene list, bypassing the normal
  // scan-match flow. Never called by the native app.
  window.__gotoScene = function (id) {
    if (manifest) loadScene(id);
  };

  // Idem voor het splash-scherm. De editor geeft zijn (nog niet opgeslagen)
  // splash-instellingen en reset-code mee, zodat de preview meteen meedoet.
  // Editor: luisterinstructie blijvend tonen boven de eerste scene, zodat je
  // de tekst live kunt aanpassen. Een tweede aanroep ververst alleen de tekst.
  window.__gotoInstruction = function (instruction) {
    if (!manifest || !manifest.scenes.length) return;
    if (instruction !== undefined) manifest.instruction = instruction;
    if (!instructionHeld) {
      loadScene(manifest.scenes[0].id, true);
      instructionHeld = true;
    }
    window.ZSOverlay.show(instructionText(), {hold: true});
  };

  window.__gotoSplash = function (splash, resetScan) {
    if (!manifest) return;
    if (splash !== undefined) manifest.splash = splash;
    if (resetScan !== undefined) manifest.resetScan = resetScan;
    showSplash();
  };

  function boot() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', 'manifest.json', true);
    xhr.overrideMimeType('application/json; charset=utf-8'); // see index.html for why
    xhr.onload = function () {
      manifest = JSON.parse(xhr.responseText);
      scenesById = {};
      for (var i = 0; i < manifest.scenes.length; i++) {
        scenesById[manifest.scenes[i].id] = manifest.scenes[i];
      }
      log('pack v' + manifest.version + ' — ' + manifest.scenes.length + ' scenes geladen');
      showSplash();
    };
    xhr.onerror = function () {
      log('manifest.json laden MISLUKT');
    };
    xhr.send();
  }

  boot();
})();
