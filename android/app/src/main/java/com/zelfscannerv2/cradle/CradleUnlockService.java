package com.zelfscannerv2.cradle;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.List;

/**
 * On-device unlock for devices where the unlock broadcast is a protected
 * (system-only) broadcast — e.g. the PS20 on Android 10. We can't send that
 * broadcast, but the user CAN tap "Unlock" in Zebra's CradleUtility, which runs
 * as system. This service reproduces that tap programmatically: it launches
 * CradleUtility, selects the CRADLE UNLOCK tab, types the duration, and clicks
 * UnlockButton — all through the accessibility API, no adb, no platform key.
 *
 * The user enables this service once in Settings → Accessibility.
 */
public class CradleUnlockService extends AccessibilityService {

  private static final String TAG = "CradleUnlockA11y";
  private static final String CU_PKG = "com.symbol.cradleutility";
  private static final String ID_UNLOCK_BTN = CU_PKG + ":id/UnlockButton";
  private static final String ID_TIME_BOX = CU_PKG + ":id/uTimeTB";
  private static final String TAB_TEXT = "CRADLE UNLOCK";

  private static final int MAX_TRIES = 25; // ~7.5 s at 300 ms
  private static final long STEP_MS = 300;

  private static volatile CradleUnlockService sInstance;

  private final Handler handler = new Handler(Looper.getMainLooper());
  private int pendingSeconds = -1;
  private int tries = 0;
  private boolean tabSelected = false;

  public static boolean isRunning() {
    return sInstance != null;
  }

  /** Returns false if the service isn't enabled; caller should send the user to Settings. */
  public static boolean requestUnlock(int seconds) {
    CradleUnlockService s = sInstance;
    if (s == null) return false;
    s.startUnlock(seconds);
    return true;
  }

  @Override
  protected void onServiceConnected() {
    super.onServiceConnected();
    sInstance = this;
    Log.i(TAG, "service connected");
  }

  @Override
  public void onDestroy() {
    if (sInstance == this) sInstance = null;
    super.onDestroy();
  }

  @Override
  public void onInterrupt() {}

  @Override
  public void onAccessibilityEvent(AccessibilityEvent event) {
    // We drive the flow from a polling runnable, not per-event, so nothing here.
  }

  private void startUnlock(int seconds) {
    handler.post(() -> {
      pendingSeconds = seconds;
      tries = 0;
      tabSelected = false;
      // Launch CradleUtility, then poll its window until we can tap Unlock.
      Intent i = new Intent();
      i.setClassName(CU_PKG, CU_PKG + ".MainActivity");
      i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
      try {
        startActivity(i);
      } catch (Exception e) {
        Log.e(TAG, "cannot launch CradleUtility: " + e.getMessage());
        pendingSeconds = -1;
        return;
      }
      handler.postDelayed(step, 800);
    });
  }

  private final Runnable step =
      new Runnable() {
        @Override
        public void run() {
          if (pendingSeconds < 0) return;
          if (tries++ > MAX_TRIES) {
            Log.e(TAG, "gave up after " + tries + " tries");
            pendingSeconds = -1;
            return;
          }
          AccessibilityNodeInfo root = getRootInActiveWindow();
          if (root == null || !CU_PKG.contentEquals(nullToEmpty(root.getPackageName()))) {
            handler.postDelayed(this, STEP_MS);
            return;
          }

          // Make sure the unlock page (with UnlockButton) is showing.
          List<AccessibilityNodeInfo> btns =
              root.findAccessibilityNodeInfosByViewId(ID_UNLOCK_BTN);
          if (btns == null || btns.isEmpty()) {
            if (!tabSelected) {
              if (clickByText(root, TAB_TEXT)) {
                tabSelected = true;
              }
            }
            handler.postDelayed(this, STEP_MS);
            return;
          }

          // Set the duration, then click Unlock.
          List<AccessibilityNodeInfo> boxes =
              root.findAccessibilityNodeInfosByViewId(ID_TIME_BOX);
          if (boxes != null && !boxes.isEmpty()) {
            Bundle args = new Bundle();
            args.putCharSequence(
                AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
                String.valueOf(pendingSeconds));
            boxes.get(0).performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
          }

          AccessibilityNodeInfo btn = btns.get(0);
          boolean clicked = performClick(btn);
          Log.i(TAG, "UnlockButton click=" + clicked + " seconds=" + pendingSeconds);
          pendingSeconds = -1;

          // Hand the screen back to our app.
          Intent back = new Intent();
          back.setClassName(getPackageName(), getPackageName() + ".MainActivity");
          back.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
          handler.postDelayed(
              () -> {
                try {
                  startActivity(back);
                } catch (Exception ignored) {
                }
              },
              700);
        }
      };

  /** Click a node matching text, walking up to a clickable ancestor if needed. */
  private boolean clickByText(AccessibilityNodeInfo root, String text) {
    List<AccessibilityNodeInfo> hits = root.findAccessibilityNodeInfosByText(text);
    if (hits == null) return false;
    for (AccessibilityNodeInfo n : hits) {
      if (performClick(n)) return true;
    }
    return false;
  }

  private boolean performClick(AccessibilityNodeInfo node) {
    AccessibilityNodeInfo n = node;
    for (int i = 0; i < 6 && n != null; i++) {
      if (n.isClickable() && n.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
        return true;
      }
      n = n.getParent();
    }
    // Fallback: click the original even if not flagged clickable.
    return node.performAction(AccessibilityNodeInfo.ACTION_CLICK);
  }

  private static CharSequence nullToEmpty(CharSequence c) {
    return c == null ? "" : c;
  }
}
