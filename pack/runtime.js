/**
 * Zelfscanner content-pack runtime — dunne scene-sequencer.
 * Primitieven: playVideo (impliciet per scene), onScan, goto, post naar native.
 * Geen framework, geen build-stap: dit bestand draait ongewijzigd vanaf het
 * filesystem in de WebView, dus wat je hier aanpast zie je na een adb push
 * direct op het device.
 */
(function () {
  var video = document.getElementById('player');
  var errorEl = document.getElementById('error');
  var debugEl = document.getElementById('debug');

  var manifest = null;
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

  function loadScene(i) {
    var scene = manifest.scenes[i];
    if (!scene) {
      return;
    }
    sceneIndex = i;
    hideError();
    video.src = scene.video;
    video.currentTime = 0;
    // This old WebView's play() doesn't return a Promise (pre-2016 Chromium),
    // so guard before chaining .catch() -- calling .catch on undefined throws
    // and silently aborts the rest of this function.
    var playResult = video.play();
    if (playResult && typeof playResult.catch === 'function') {
      playResult.catch(function (e) {
        log('scene ' + scene.id + ' — play failed: ' + e.message);
      });
    }
    log('scene ' + scene.id + (scene.expectScan ? ' — wacht op ' + scene.expectScan : ' — einde'));
    if (!scene.expectScan) {
      post('sceneEnd', {id: scene.id});
    }
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
      loadScene(sceneIndex + 1);
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
      log('pack v' + manifest.version + ' — ' + manifest.scenes.length + ' scenes geladen');
      loadScene(0);
    };
    xhr.onerror = function () {
      log('manifest.json laden MISLUKT');
    };
    xhr.send();
  }

  boot();
})();
