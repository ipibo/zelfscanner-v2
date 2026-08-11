/**
 * Zelfscanner content-pack runtime — dunne scene-sequencer.
 * Primitieven: playVideo (impliciet per scene), onScan, goto, post naar native.
 * Geen framework, geen build-stap: dit bestand draait ongewijzigd vanaf het
 * filesystem in de WebView, dus wat je hier aanpast zie je na een adb push
 * direct op het device.
 */
(function () {
  var video = document.getElementById('player');
  var narrator = document.getElementById('narrator');
  var errorEl = document.getElementById('error');
  var captionEl = document.getElementById('caption');
  var debugEl = document.getElementById('debug');

  var manifest = null;
  var scenesById = {};
  var sceneIndex = 0;
  var errorTimer = null;

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

  function loadScene(id) {
    var scene = scenesById[id];
    if (!scene) {
      log('onbekende scene: ' + id);
      return;
    }
    sceneIndex = manifest.scenes.indexOf(scene);
    hideError();

    if (scene.video) {
      video.style.display = '';
      video.src = scene.video;
      video.currentTime = 0;
      safePlay(video, 'scene ' + scene.id + ' video');
    } else {
      video.pause();
      video.removeAttribute('src');
      video.style.display = 'none';
    }

    if (scene.audio) {
      narrator.src = scene.audio;
      narrator.currentTime = 0;
      safePlay(narrator, 'scene ' + scene.id + ' audio');
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

  // Native (App.tsx) roept dit aan via injectJavaScript bij elke scan.
  window.onNativeScan = function (code) {
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
      loadScene(manifest.scenes[0].id);
    };
    xhr.onerror = function () {
      log('manifest.json laden MISLUKT');
    };
    xhr.send();
  }

  boot();
})();
