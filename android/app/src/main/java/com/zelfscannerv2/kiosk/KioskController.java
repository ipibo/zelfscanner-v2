package com.zelfscannerv2.kiosk;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.AlertDialog;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.text.InputType;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.FrameLayout;

/**
 * Kiosk lock-in for Device Owner-provisioned devices, plus a hidden way back out.
 * A no-op when the app isn't Device Owner (e.g. during development), so it's safe
 * to call unconditionally from MainActivity.
 */
public class KioskController {
  // Change before handing devices to end users.
  private static final String EXIT_PIN = "159357";
  private static final long HOLD_MS = 3000;

  private final Activity activity;
  private final ComponentName admin;
  private final Runnable exitDialogRunnable;

  public KioskController(Activity activity) {
    this.activity = activity;
    this.admin = new ComponentName(activity, KioskAdminReceiver.class);
    this.exitDialogRunnable = this::showExitDialog;
    attachExitHatch();
  }

  private DevicePolicyManager dpm() {
    return (DevicePolicyManager) activity.getSystemService(Context.DEVICE_POLICY_SERVICE);
  }

  private boolean isDeviceOwner() {
    DevicePolicyManager dpm = dpm();
    return dpm != null && dpm.isDeviceOwnerApp(activity.getPackageName());
  }

  /** Call from onResume: enters lock task if provisioned as Device Owner, else no-op. */
  public void maybeEnterLockTask() {
    if (!isDeviceOwner()) {
      return;
    }
    // This Zebra MC18N0 firmware reports API 22 but its framework.jar is missing chunks of
    // the Lollipop enterprise/LockTask surface (confirmed on mc1 2026-08-19:
    // DevicePolicyManager.setKeyguardDisabled AND ActivityManager.getLockTaskModeState both
    // threw NoSuchMethodError, crash-looping onResume). Treat the whole block as
    // best-effort: catch Throwable per call so one missing method doesn't block the rest,
    // and never let this crash-loop the activity again.
    try {
      dpm().setKeyguardDisabled(admin, true);
    } catch (Throwable e) {
      // Keyguard stays; lock task pinning below still applies if available.
    }
    try {
      dpm().setLockTaskPackages(admin, new String[] {activity.getPackageName()});
      ActivityManager am = (ActivityManager) activity.getSystemService(Context.ACTIVITY_SERVICE);
      boolean alreadyLocked = am != null && am.getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_NONE;
      if (!alreadyLocked) {
        activity.startLockTask();
      }
    } catch (Throwable e) {
      // Lock task pinning unsupported on this firmware; app still runs, just not pinned.
    }
  }

  /** 3s hold in the top-left corner opens a PIN prompt; correct PIN exits kiosk mode. */
  private void attachExitHatch() {
    FrameLayout overlay = new FrameLayout(activity);
    int sizePx = (int) (64 * activity.getResources().getDisplayMetrics().density);
    FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(sizePx, sizePx);
    lp.gravity = Gravity.TOP | Gravity.START;
    overlay.setLayoutParams(lp);
    overlay.setOnTouchListener(
        (v, event) -> {
          switch (event.getAction()) {
            case MotionEvent.ACTION_DOWN:
              v.postDelayed(exitDialogRunnable, HOLD_MS);
              return true;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
              v.removeCallbacks(exitDialogRunnable);
              return true;
            default:
              return false;
          }
        });
    ((ViewGroup) activity.getWindow().getDecorView()).addView(overlay);
  }

  private void showExitDialog() {
    EditText input = new EditText(activity);
    input.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
    new AlertDialog.Builder(activity)
        .setTitle("Kiosk-modus verlaten")
        .setView(input)
        .setPositiveButton(
            "OK",
            (dialog, which) -> {
              if (EXIT_PIN.contentEquals(input.getText())) {
                exitKioskMode();
              }
            })
        .setNegativeButton("Annuleer", null)
        .show();
  }

  private void exitKioskMode() {
    if (!isDeviceOwner()) {
      return;
    }
    try {
      dpm().setKeyguardDisabled(admin, false);
    } catch (Throwable e) {
      // Never got disabled either; nothing to restore.
    }
    try {
      activity.stopLockTask();
    } catch (Throwable e) {
      // Never got pinned either; nothing to release.
    }
    dpm().clearDeviceOwnerApp(activity.getPackageName());
  }
}
