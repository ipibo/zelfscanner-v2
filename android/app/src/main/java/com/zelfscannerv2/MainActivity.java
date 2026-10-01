package com.zelfscannerv2;

import android.app.KeyguardManager;
import android.content.Context;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import com.facebook.react.ReactActivity;
import com.facebook.react.ReactActivityDelegate;
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint;
import com.facebook.react.defaults.DefaultReactActivityDelegate;
import com.zelfscannerv2.kiosk.KioskController;

public class MainActivity extends ReactActivity {

  private KioskController kioskController;
  // Held for the activity's lifetime: releasing it re-enables the keyguard.
  private KeyguardManager.KeyguardLock keyguardLock;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    // Scanner-only kiosk: never auto-show the soft keyboard. The hidden TextInput
    // that DataWedge keystrokes into must hold focus, but on Android 10 (PS20)
    // focusing it pops the IME unless the window forbids it.
    getWindow()
        .setSoftInputMode(
            WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN
                | WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING);
    // Kiosk devices have no PIN, but the swipe keyguard still covers the window
    // when BootReceiver starts us from the background. Surface over it and
    // dismiss it (safe: no secure credential is set on these devices).
    // The legacy window flags are ignored by this device's keyguard implementation
    // (mKeyguardOccluded stayed false), so use the API 27+ methods on API 27+
    // and keep the flags as a fallback for older devices.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true);
      setTurnScreenOn(true);
      KeyguardManager keyguardManager = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
      if (keyguardManager != null) {
        keyguardManager.requestDismissKeyguard(this, null);
      }
    } else {
      // MC18N0 (API 22): the swipe keyguard re-engages after a bottom-edge swipe and
      // renders as a black screen with nothing to swipe. Settings is blocked by the
      // MX AccessMgr profile, so "Screen lock: None" can't be set by hand; turn the
      // (non-secure) keyguard off from here instead.
      KeyguardManager keyguardManager = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
      if (keyguardManager != null) {
        keyguardLock = keyguardManager.newKeyguardLock("zelfscanner-kiosk");
        keyguardLock.disableKeyguard();
      }
    }
    getWindow()
        .addFlags(
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    kioskController = new KioskController(this);
    applyUiLock();
  }

  // Reflection here (not `new UiLockManager(this)`) for the same reason as ImagerPackage's
  // SignatureModule load: UiLockManager implements Zebra's EMDKManager.EMDKListener, and a
  // hard reference to it would fail class verification of MainActivity itself on a device
  // without EMDK (emulator, non-Zebra hardware), before this try/catch ever ran.
  private void applyUiLock() {
    try {
      Class<?> cls = Class.forName("com.zelfscannerv2.kiosk.UiLockManager");
      Object manager = cls.getConstructor(Context.class).newInstance(this);
      cls.getMethod("apply").invoke(manager);
    } catch (Throwable t) {
      android.util.Log.w("MainActivity", "UiLockManager unavailable (no EMDK on this device): " + t);
    }
  }

  @Override
  protected void onResume() {
    super.onResume();
    kioskController.maybeEnterLockTask();
  }

  /** Force the soft keyboard down if anything pulled it up. */
  private void hideKeyboard() {
    InputMethodManager imm =
        (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
    View focus = getCurrentFocus();
    if (imm != null && focus != null) {
      imm.hideSoftInputFromWindow(focus.getWindowToken(), 0);
    }
  }

  /** Hide status + navigation bars (immersive sticky). Works on API 19+. */
  private void enableImmersive() {
    getWindow()
        .getDecorView()
        .setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    // Re-assert immersive mode whenever we regain focus (e.g. after a swipe
    // pulls the bars back, or returning from another app).
    if (hasFocus) {
      enableImmersive();
      hideKeyboard();
    }
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  @Override
  protected String getMainComponentName() {
    return "ZelfscannerV2";
  }

  /**
   * Returns the instance of the {@link ReactActivityDelegate}. Here we use a util class {@link
   * DefaultReactActivityDelegate} which allows you to easily enable Fabric and Concurrent React
   * (aka React 18) with two boolean flags.
   */
  @Override
  protected ReactActivityDelegate createReactActivityDelegate() {
    return new DefaultReactActivityDelegate(
        this,
        getMainComponentName(),
        // If you opted-in for the New Architecture, we enable the Fabric Renderer.
        DefaultNewArchitectureEntryPoint.getFabricEnabled());
  }
}
