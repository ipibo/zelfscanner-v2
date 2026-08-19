package com.zelfscannerv2.kiosk;

import android.content.Context;
import android.util.Log;

import com.symbol.emdk.EMDKManager;
import com.symbol.emdk.EMDKResults;
import com.symbol.emdk.ProfileManager;

import org.w3c.dom.Document;
import org.xml.sax.InputSource;

import java.io.StringReader;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;

/**
 * Blocks HOME / recents / status bar via Zebra's own MX "UiMgr" CSP, pushed through EMDK's
 * ProfileManager. Exists because this device's stock AOSP DevicePolicyManager.setKeyguardDisabled
 * / ActivityManager.getLockTaskModeState / Activity.startLockTask are all missing or inert on
 * this Zebra MC18N0 firmware (confirmed by NoSuchMethodError crashes and a Recents screen that
 * opened despite Device Owner + startLockTask on mc1, 2026-08-19) -- MX goes through Zebra's own
 * admin channel instead of AOSP's, and doesn't need Device Owner at all.
 *
 * A no-op-on-failure: EMDK/MX absence or CSP mismatch downgrades to a logged status, never a
 * crash. Re-applying on every call is deliberate -- cheap, and self-heals if the profile ever
 * gets cleared by a factory data reset or MSP.
 */
public class UiLockManager implements EMDKManager.EMDKListener, ProfileManager.DataListener {
  private static final String TAG = "UiLockManager";

  // version="6.3": the widest-compatible UiMgr schema version documented across Zebra's public
  // samples for this MX generation (device runs MX 7.2.2). A newer schema version risks the
  // whole characteristic being rejected by an older MX framework -- unconfirmed for this exact
  // device, so start conservative and widen once verified via EMDKResults.getStatusString().
  //
  // processProfile has a String[] overload too, but that one is for flat
  // "emdkName.paramName=value" pairs (ProfileManager.CreateNameValuePair), NOT xml lines --
  // learned the hard way via extended_status code 6 "profile not found in extraData" on mc1,
  // 2026-08-19. A full MX characteristic profile like this one needs the Document overload,
  // AND (also learned the hard way, same error) the root element must be
  // <characteristic type="Profile"> with a ProfileName parm matching the profileName argument
  // below -- not the <wap-provisioningdoc> wrapper StageNow barcodes use. Each nested feature
  // characteristic also needs its own emdk_name parm per Zebra's Profile Manager guide.
  // This device's MX-OSx negotiates down to 7.1 regardless of the version attribute requested,
  // and at 7.1: HomeKeyUsage and NotificationPullDown validate clean, RecentAppButtonUsage needs
  // 7.2+ ("This feature is not supported below MX-OSx 7.2" -- confirmed via processProfile's
  // CHECK_XML per-parm errors on mc1, 2026-08-19), and StatusBarUsage errors as "Param type is
  // not supported" for reasons still unclear. Recents/multitask blocking still has no working
  // fix on this hardware.
  //
  // AccessMgr / SystemSettings=3 ("None") blocks the whole Settings app -- added because the
  // "swipe up -> black screen" fix (Settings > Security > Screen lock > None, done by hand on
  // mc1) is trivially undone by anyone who can still reach Settings: with Recents still open,
  // that's anyone with physical access. This closes that specific hole even though Recents
  // itself stays reachable. Recovery if this ever needs reversing: reinstall over adb with
  // SystemSettings=1 in this profile (or push a fresh profile) -- adb/EMDK access doesn't go
  // through the Settings app, so this can't lock out adb-based recovery.
  private static final String PROFILE_NAME = "KioskUiLock";
  private static final String LOCK_PROFILE_XML =
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
          + "<characteristic type=\"Profile\">"
          + "<parm name=\"ProfileName\" value=\"" + PROFILE_NAME + "\"/>"
          + "<characteristic type=\"UiMgr\" version=\"6.3\">"
          + "<parm name=\"emdk_name\" value=\"ui1\"/>"
          + "<parm name=\"HomeKeyUsage\" value=\"2\"/>"
          + "<parm name=\"NotificationPullDown\" value=\"2\"/>"
          + "</characteristic>"
          + "<characteristic type=\"AccessMgr\" version=\"4.4\">"
          + "<parm name=\"emdk_name\" value=\"access1\"/>"
          + "<parm name=\"SystemSettings\" value=\"2\"/>"
          + "</characteristic>"
          + "</characteristic>";

  private final Context context;
  private EMDKManager emdkManager;

  public UiLockManager(Context context) {
    this.context = context.getApplicationContext();
  }

  public void apply() {
    EMDKResults results = EMDKManager.getEMDKManager(context, this);
    if (results.statusCode != EMDKResults.STATUS_CODE.SUCCESS) {
      Log.w(TAG, "getEMDKManager failed: " + results.statusCode);
    }
  }

  @Override
  public void onOpened(EMDKManager manager) {
    emdkManager = manager;
    ProfileManager profileManager =
        (ProfileManager) manager.getInstance(EMDKManager.FEATURE_TYPE.PROFILE);
    if (profileManager == null) {
      Log.w(TAG, "PROFILE feature unavailable on this device");
      return;
    }
    profileManager.addDataListener(this);
    try {
      DocumentBuilder builder = DocumentBuilderFactory.newInstance().newDocumentBuilder();
      Document doc = builder.parse(new InputSource(new StringReader(LOCK_PROFILE_XML)));
      EMDKResults results =
          profileManager.processProfile(PROFILE_NAME, ProfileManager.PROFILE_FLAG.SET, doc);
      Log.i(
          TAG,
          "processProfile: " + results.statusCode + " (" + results.getStatusString() + ")");
    } catch (Exception e) {
      Log.w(TAG, "building/processing profile document failed: " + e);
    }
  }

  @Override
  public void onClosed() {
    emdkManager = null;
  }

  @Override
  public void onData(ProfileManager.ResultData resultData) {
    // Async per-feature status, if the device ever routes it here instead of the sync result.
  }
}
