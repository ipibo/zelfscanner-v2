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

  // version="7.1": "6.3" (previous value) isn't a documented UiMgr schema version at all --
  // Zebra's real version list is 4.2/4.3/5.0/5.1/5.2/6.0/6.1/7.1/8.0/8.1/8.2/9.0/9.1. "7.1" is
  // the highest of those this device actually negotiates to (confirmed via processProfile
  // status on mc1), and is also the version NavigationBarUsage/RecentAppButtonUsage were
  // introduced in per Zebra's UI Manager CSP docs (techdocs.zebra.com/stagenow/3-3/csp/ui/).
  //
  // processProfile has a String[] overload too, but that one is for flat
  // "emdkName.paramName=value" pairs (ProfileManager.CreateNameValuePair), NOT xml lines --
  // learned the hard way via extended_status code 6 "profile not found in extraData" on mc1,
  // 2026-08-19. A full MX characteristic profile like this one needs the Document overload,
  // AND (also learned the hard way, same error) the root element must be
  // <characteristic type="Profile"> with a ProfileName parm matching the profileName argument
  // below -- not the <wap-provisioningdoc> wrapper StageNow barcodes use. Each nested feature
  // characteristic also needs its own emdk_name parm per Zebra's Profile Manager guide.
  //
  // This device's MX-OSx negotiates down to 7.1 regardless of the version attribute requested.
  // At 7.1: HomeKeyUsage and NotificationPullDown validate clean. RecentAppButtonUsage needs
  // OSX 7.2+ and NavigationBarUsage needs OSX 6.2+ -- both rejected live on mc1 with "not
  // supported below MX-OSx <required>", confirming this device's separate *OSX* version (which
  // tracks the Android major version per Zebra's docs -- this device is Android 5.1.1) sits
  // below both floors even though its MX/CSP-engine version (7.1) clears them. That OSX number
  // is a firmware property, not something any provisioning path (StageNow included) changes --
  // not worth retrying. StatusBarUsage errors "Param type is not supported" because it's
  // documented SDM660-chipset-only (OSX 8.1+/MX 8.4+); MC18N0 isn't that chipset, permanent.
  //
  // Tried and reverted, 2026-08-19: AppMgr/ClearRecentApps (MX 4.2+, technically within reach)
  // wipes the Recent Apps list including this app's own entry. With HomeKeyUsage=2 also making
  // the HOME key fully inert, that combination left mc1 stuck on an empty "Your recent screens
  // appear here" with no on-device way back -- Home did nothing, Back didn't return to the app
  // either. Confirmed by live adb test; only recovered via `adb shell am start`. Do not re-add
  // without also protecting this app's own package from the clear (AppMgr's
  // ProtectedListAction/ProtectedListPackage, untested) so there's always at least one card to
  // snap back to.
  //
  // AccessMgr / SystemSettings=2 blocks the whole Settings app -- added because the
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
          + "<characteristic type=\"UiMgr\" version=\"7.1\">"
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
