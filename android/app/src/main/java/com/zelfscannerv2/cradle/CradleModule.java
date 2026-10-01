package com.zelfscannerv2.cradle;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.BatteryManager;
import android.os.Build;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

/**
 * Bridges the Zebra MC18 cradle to JS.
 *
 * Unlock path = the exported, unguarded broadcast receiver
 * com.symbol.cradleunlockapp/.CradleReceiver (action
 * "com.android.actions.unlock.cradle", extra "UnlockPeriod" 10-30 s).
 * A normal sideloaded app may fire it — no system signature needed.
 *
 * Dock presence comes from the system CRADLEIN/CRADLEOUT broadcasts plus
 * power connect/disconnect, surfaced to JS as a "cradleDock" event.
 */
public class CradleModule extends ReactContextBaseJavaModule {

  public static final String NAME = "Cradle";

  private static final String UNLOCK_ACTION = "com.android.actions.unlock.cradle";
  private static final String CRADLE_IN = "com.symbol.intent.CRADLEIN";
  private static final String CRADLE_OUT = "com.symbol.intent.CRADLEOUT";

  private static final int MIN_SECONDS = 10;
  private static final int MAX_SECONDS = 30;

  private boolean docked = false;
  private final BroadcastReceiver dockReceiver =
      new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
          String action = intent.getAction();
          if (action == null) return;
          switch (action) {
            case CRADLE_IN:
            case Intent.ACTION_POWER_CONNECTED:
              setDocked(true, action);
              break;
            case CRADLE_OUT:
            case Intent.ACTION_POWER_DISCONNECTED:
              setDocked(false, action);
              break;
            case Intent.ACTION_BATTERY_CHANGED:
              emitBattery(intent);
              break;
            default:
              break;
          }
        }
      };

  public CradleModule(ReactApplicationContext context) {
    super(context);
    IntentFilter filter = new IntentFilter();
    filter.addAction(CRADLE_IN);
    filter.addAction(CRADLE_OUT);
    filter.addAction(Intent.ACTION_POWER_CONNECTED);
    filter.addAction(Intent.ACTION_POWER_DISCONNECTED);
    filter.addAction(Intent.ACTION_BATTERY_CHANGED);
    context.registerReceiver(dockReceiver, filter);
    docked = readPluggedFromSticky(context);
  }

  @NonNull
  @Override
  public String getName() {
    return NAME;
  }

  /** Fire the cradle-unlock broadcast for THIS device's own slot. */
  @ReactMethod
  public void unlock(int seconds, Promise promise) {
    if (seconds < MIN_SECONDS || seconds > MAX_SECONDS) {
      promise.reject(
          "E_RANGE", "UnlockPeriod must be " + MIN_SECONDS + "-" + MAX_SECONDS + " s, got " + seconds);
      return;
    }
    try {
      Intent intent = new Intent(UNLOCK_ACTION);
      intent.putExtra("UnlockPeriod", seconds);
      getReactApplicationContext().sendBroadcast(intent);
      promise.resolve(seconds);
    } catch (SecurityException e) {
      // Some firmware marks the action as a protected broadcast.
      promise.reject("E_PROTECTED", "broadcast blocked by firmware: " + e.getMessage(), e);
    } catch (Exception e) {
      promise.reject("E_UNLOCK", e.getMessage(), e);
    }
  }

  /**
   * Unlock by driving CradleUtility's UI via the accessibility service.
   * Use on devices where the broadcast is protected (PS20 / Android 10).
   * Rejects E_A11Y_DISABLED if the service isn't enabled yet.
   */
  @ReactMethod
  public void unlockViaUI(int seconds, Promise promise) {
    if (seconds < MIN_SECONDS || seconds > MAX_SECONDS) {
      promise.reject("E_RANGE", "UnlockPeriod must be " + MIN_SECONDS + "-" + MAX_SECONDS + " s");
      return;
    }
    if (!CradleUnlockService.requestUnlock(seconds)) {
      promise.reject("E_A11Y_DISABLED", "accessibility service not enabled");
      return;
    }
    promise.resolve(seconds);
  }

  /** Is the CradleUtility-driving accessibility service enabled? */
  @ReactMethod
  public void isUiUnlockReady(Promise promise) {
    promise.resolve(CradleUnlockService.isRunning());
  }

  /** Open Settings → Accessibility so the user can enable the service. */
  @ReactMethod
  public void openAccessibilitySettings() {
    Intent intent = new Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS);
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    getReactApplicationContext().startActivity(intent);
  }

  /** Serial, model, and current dock state — used to register with the dashboard. */
  @ReactMethod
  public void getDeviceInfo(Promise promise) {
    WritableMap map = Arguments.createMap();
    map.putString("serial", safeSerial());
    map.putString("model", Build.MODEL);
    map.putString("device", Build.DEVICE);
    map.putBoolean("docked", docked);
    promise.resolve(map);
  }

  /** Battery level (0-100) and whether it is charging — for the tiny corner indicator. */
  @ReactMethod
  public void getBattery(Promise promise) {
    Intent battery =
        getReactApplicationContext()
            .registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
    if (battery == null) {
      promise.reject("E_BATTERY", "no battery status");
      return;
    }
    promise.resolve(batteryMap(battery));
  }

  // ACTION_BATTERY_CHANGED fires on every small change (voltage, temperature);
  // only forward it when the shown level or charging state actually changes.
  private int lastLevel = -1;
  private boolean lastCharging = false;

  private void emitBattery(Intent intent) {
    WritableMap map = batteryMap(intent);
    int level = map.getInt("level");
    boolean charging = map.getBoolean("charging");
    if (level == lastLevel && charging == lastCharging) return;
    lastLevel = level;
    lastCharging = charging;
    emit("battery", map);
  }

  private static WritableMap batteryMap(Intent intent) {
    int level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
    int scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
    int status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
    WritableMap map = Arguments.createMap();
    map.putInt("level", scale > 0 ? Math.round(level * 100f / scale) : level);
    map.putBoolean(
        "charging",
        status == BatteryManager.BATTERY_STATUS_CHARGING
            || status == BatteryManager.BATTERY_STATUS_FULL);
    return map;
  }

  private void setDocked(boolean value, String reason) {
    docked = value;
    WritableMap map = Arguments.createMap();
    map.putBoolean("docked", value);
    map.putString("reason", reason);
    emit("cradleDock", map);
  }

  private void emit(String event, WritableMap params) {
    ReactApplicationContext ctx = getReactApplicationContext();
    if (ctx.hasActiveCatalystInstance()) {
      ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit(event, params);
    }
  }

  private boolean readPluggedFromSticky(Context context) {
    try {
      Intent battery = context.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
      if (battery == null) return false;
      int plugged = battery.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0);
      return plugged != 0;
    } catch (Exception e) {
      return false;
    }
  }

  @SuppressWarnings("deprecation")
  private String safeSerial() {
    // Build.SERIAL works on the MC18 (API 22). On newer Android (PS20) it is
    // restricted and returns "unknown" without READ_PHONE_STATE, so fall back
    // to a stable per-device ANDROID_ID for dashboard identity.
    try {
      String s = Build.SERIAL;
      if (s != null && !s.isEmpty() && !"unknown".equalsIgnoreCase(s)) {
        return s;
      }
    } catch (Exception ignored) {
    }
    try {
      String aid =
          android.provider.Settings.Secure.getString(
              getReactApplicationContext().getContentResolver(),
              android.provider.Settings.Secure.ANDROID_ID);
      if (aid != null && !aid.isEmpty()) {
        return "aid:" + aid;
      }
    } catch (Exception ignored) {
    }
    return "unknown";
  }
}
