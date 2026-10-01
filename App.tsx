/**
 * Zelfscanner v2 — native shell.
 * WebView loads the content-pack (index.html + manifest.json + assets) from a
 * fixed filesystem path, pushed via adb — not require()'d, not in the APK.
 * That's the whole point: edit the pack, push again, no rebuild.
 *
 * Scanner input = DataWedge keystroke mode: DataWedge types the scanned barcode
 * into the focused (hidden) TextInput as a fast burst of keystrokes. The burst
 * may or may not end with an Enter, so we commit on a short idle debounce AND on
 * submit — whichever comes first. Each commit is forwarded into the WebView via
 * injectJavaScript(window.onNativeScan). Fullscreen (status + nav bar hidden) is
 * done natively in MainActivity via immersive-sticky.
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  BackHandler,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import WebView from 'react-native-webview';
import {BatteryInfo, Cradle} from './src/cradle';
import {startAgent} from './src/agent';

const UNLOCK_SECONDS = 10; // firmware-valid 10–30

// false = production/demo: pure content-pack flow, no HUD, no debug buttons.
const SHOW_DEBUG_INFO = false;

// Content-pack: lives on the filesystem, NOT in the APK. Pushed via adb.
// Not require()'d — that would bundle it into the build and defeat the point.
const PACK_URL = 'file:///sdcard/zelfscanner/pack/index.html';
const SCAN_IDLE_MS = 200; // commit once the scanner's keystroke burst goes quiet

function App(): React.JSX.Element {
  const inputRef = useRef<TextInput>(null);
  const bufferRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [buffer, setBuffer] = useState('');
  const [lastScan, setLastScan] = useState('— none yet —');
  const [count, setCount] = useState(0);
  const webviewRef = useRef<WebView>(null);
  const [packStatus, setPackStatus] = useState('loading…');
  const [agentStatus, setAgentStatus] = useState('starting…');
  const [docked, setDocked] = useState<boolean | null>(null);
  const [unlockMsg, setUnlockMsg] = useState('—');
  const [battery, setBattery] = useState<BatteryInfo | null>(null);

  // Report to the dashboard + accept remote unlock commands.
  useEffect(() => {
    const stop = startAgent((s, detail) =>
      setAgentStatus(detail ? `${s} (${detail})` : s),
    );
    const unsubDock = Cradle.onDock(e => setDocked(e.docked));
    Cradle.getDeviceInfo()
      .then(i => setDocked(i.docked))
      .catch(() => {});
    const unsubBattery = Cradle.onBattery(setBattery);
    Cradle.getBattery()
      .then(setBattery)
      .catch(() => {});
    return () => {
      stop();
      unsubDock();
      unsubBattery();
    };
  }, []);

  const unlockLocal = useCallback(() => {
    setUnlockMsg('unlocking…');
    Cradle.unlock(UNLOCK_SECONDS)
      .then(r => setUnlockMsg(`unlocked ${r.seconds}s (${r.method})`))
      .catch(e => {
        if (e?.code === 'E_A11Y_DISABLED') {
          setUnlockMsg('enable accessibility →');
          Cradle.openAccessibilitySettings();
        } else {
          setUnlockMsg('FAIL: ' + (e?.message ?? e));
        }
      });
  }, []);

  const focusInput = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  // Web (pack runtime.js) calls back via ReactNativeWebView.postMessage.
  const onWebMessage = useCallback(
    (e: {nativeEvent: {data: string}}) => {
      let msg: {type?: string; payload?: any} = {};
      try {
        msg = JSON.parse(e.nativeEvent.data);
      } catch {
        return;
      }
      if (msg.type === 'sceneEnd') {
        setPackStatus(`scene end: ${msg.payload?.id}`);
      } else if (msg.type === 'storyStart') {
        setPackStatus(`story start: ${msg.payload?.id}`);
      } else if (msg.type === 'reset') {
        setPackStatus(`reset from: ${msg.payload?.from}`);
      } else if (msg.type === 'puzzleSolved') {
        setPackStatus(`puzzle solved: ${msg.payload?.id}`);
      } else if (msg.type === 'wrongScan') {
        setPackStatus(`wrong scan: got ${msg.payload?.got}`);
      } else if (msg.type === 'unlockCradle') {
        unlockLocal();
      } else if (msg.type === 'exit') {
        BackHandler.exitApp();
      }
    },
    [unlockLocal],
  );

  const commit = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const code = bufferRef.current.replace(/[\r\n]+/g, '').trim();
    bufferRef.current = '';
    setBuffer('');
    // Uncontrolled input: clear the native field so the next scan starts fresh.
    inputRef.current?.clear();
    if (code.length === 0) {
      return;
    }
    setLastScan(code);
    setCount(c => c + 1);
    webviewRef.current?.injectJavaScript(
      `window.onNativeScan && window.onNativeScan(${JSON.stringify(
        code,
      )}); true;`,
    );
    requestAnimationFrame(focusInput);
  }, [focusInput]);

  const onChange = useCallback(
    (text: string) => {
      bufferRef.current = text;
      setBuffer(text);
      // Commit immediately if a terminator arrived; otherwise after an idle gap.
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      if (/[\r\n]/.test(text)) {
        commit();
      } else {
        timerRef.current = setTimeout(commit, SCAN_IDLE_MS);
      }
    },
    [commit],
  );

  // Tap anywhere refocuses the hidden scanner input -- via a plain bubbling
  // onTouchEnd, NOT a Touchable. A Touchable makes this View the JS responder,
  // and then RN's JSResponderHandler intercepts every following MOVE: the
  // WebView gets ACTION_CANCEL (touchcancel ~40ms in) and dragging in the pack
  // (puzzle) dies. Measured on the MC18N0 2026-09-17.
  return (
    <View style={styles.root} onTouchEnd={focusInput}>
      <StatusBar hidden />
      <WebView
        ref={webviewRef}
        source={{uri: PACK_URL}}
        style={StyleSheet.absoluteFill}
        originWhitelist={['*']}
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        javaScriptEnabled
        domStorageEnabled
        mediaPlaybackRequiresUserAction={false}
        onMessage={onWebMessage}
        onLoadEnd={() => setPackStatus('loaded')}
        onError={e => setPackStatus('error: ' + JSON.stringify(e?.nativeEvent))}
      />

      {/* Hidden input that DataWedge keystrokes land in. Off-screen, no UI. */}
      <TextInput
        ref={inputRef}
        autoFocus
        blurOnSubmit={false}
        showSoftInputOnFocus={false}
        caretHidden
        onChangeText={onChange}
        onSubmitEditing={commit}
        onBlur={() => requestAnimationFrame(focusInput)}
        style={styles.hiddenInput}
      />

      {/* Battery level, top right. Deliberately near-invisible: only meant for
          staff checking which scanners need charging, not for visitors. */}
      {battery && (
        <View style={styles.battery} pointerEvents="none">
          <Text style={styles.batteryText}>
            {battery.level}
            {battery.charging ? '+' : ''}
          </Text>
        </View>
      )}

      {/* Overlay HUD */}
      {SHOW_DEBUG_INFO && (
        <View style={styles.hud} pointerEvents="none">
          <Text style={styles.label}>PACK</Text>
          <Text style={styles.value}>{packStatus}</Text>
          <Text style={styles.label}>LAST BARCODE</Text>
          <Text style={styles.scan}>{lastScan}</Text>
          <Text style={styles.label}>SCANS</Text>
          <Text style={styles.value}>{count}</Text>
          <Text style={styles.label}>TYPING (live)</Text>
          <Text style={styles.typing}>{buffer || '—'}</Text>
          <Text style={styles.label}>DASHBOARD</Text>
          <Text style={styles.value}>{agentStatus}</Text>
          <Text style={styles.label}>CRADLE</Text>
          <Text style={styles.value}>
            {docked === null ? '—' : docked ? 'docked' : 'undocked'}
          </Text>
          <Text style={styles.label}>UNLOCK</Text>
          <Text style={styles.typing}>{unlockMsg}</Text>
        </View>
      )}

      {/* Manual local unlock — only meaningful while docked, so hide it otherwise. */}
      {docked === true && (
        <TouchableOpacity style={styles.unlockBtn} onPress={unlockLocal}>
          <Text style={styles.unlockBtnText}>UNLOCK CRADLE</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  hiddenInput: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    top: -100,
  },
  battery: {
    position: 'absolute',
    top: 2,
    right: 4,
  },
  batteryText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: {width: 0, height: 1},
    textShadowRadius: 2,
  },
  hud: {
    position: 'absolute',
    top: 16,
    left: 16,
    padding: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 8,
  },
  label: {
    color: '#9ad',
    fontSize: 11,
    letterSpacing: 1,
    marginTop: 8,
  },
  value: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  scan: {
    color: '#7CFC00',
    fontSize: 28,
    fontWeight: '700',
  },
  typing: {
    color: '#ffd166',
    fontSize: 14,
  },
  unlockBtn: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    paddingVertical: 14,
    paddingHorizontal: 32,
    backgroundColor: '#1e88e5',
    borderRadius: 10,
  },
  unlockBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 1,
  },
});

export default App;
