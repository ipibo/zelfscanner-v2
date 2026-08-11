package com.zelfscannerv2.imager;

import android.os.Handler;
import android.os.Looper;
import android.util.Base64;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;

import com.symbol.emdk.EMDKManager;
import com.symbol.emdk.EMDKResults;
import com.symbol.emdk.barcode.BarcodeManager;
import com.symbol.emdk.barcode.ScanDataCollection;
import com.symbol.emdk.barcode.Scanner;
import com.symbol.emdk.barcode.ScannerConfig;
import com.symbol.emdk.barcode.ScannerException;
import com.symbol.emdk.barcode.ScannerResults;
import com.symbol.emdk.barcode.StatusData;

import java.util.Collection;

/**
 * Experiment: pull a real image out of the PS20J's SE2100 imager.
 *
 * The SE2100 has no Android camera and EMDK exposes no free-form image/video
 * capture — the ONLY pixel-producing path in the Barcode API is Signature
 * Capture. We enable the SIGNATURE decoder and fire a read(); if the imager
 * sees a valid CapCode form it returns a monochrome bitmap via
 * ScanData.getRawData() under LabelType.SIGNATURE.
 *
 * Two useful outcomes:
 *   - enable()/setConfig() throws  -> SE2100 doesn't support signature capture.
 *   - capture succeeds             -> we see what the scanner sees (JPEG).
 */
public class SignatureModule extends ReactContextBaseJavaModule
    implements EMDKManager.EMDKListener, Scanner.DataListener, Scanner.StatusListener {

  public static final String NAME = "Imager";

  private static final long CAPTURE_TIMEOUT_MS = 30000;

  private EMDKManager emdkManager;
  private BarcodeManager barcodeManager;
  private Scanner scanner;

  private Promise pending;
  private boolean configured;
  private int width = 640;
  private int height = 480;
  private final Handler main = new Handler(Looper.getMainLooper());
  private final Runnable timeoutRunnable =
      () -> finishReject("E_TIMEOUT", "no CapCode/signature form seen within "
          + (CAPTURE_TIMEOUT_MS / 1000) + "s");

  public SignatureModule(ReactApplicationContext context) {
    super(context);
  }

  @NonNull
  @Override
  public String getName() {
    return NAME;
  }

  /**
   * Save a base64 JPEG to the gallery (Pictures/Zelfscanner) via MediaStore.
   * No runtime permission needed on Android 10+ for the app's own inserts.
   */
  @ReactMethod
  public void save(String base64, Promise promise) {
    try {
      byte[] jpeg = Base64.decode(base64, Base64.DEFAULT);
      String name = "scanner-selfie-" + System.currentTimeMillis() + ".jpg";
      android.content.ContentResolver resolver = getReactApplicationContext().getContentResolver();
      android.content.ContentValues values = new android.content.ContentValues();
      values.put(android.provider.MediaStore.Images.Media.DISPLAY_NAME, name);
      values.put(android.provider.MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
      if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
        values.put(android.provider.MediaStore.Images.Media.RELATIVE_PATH,
            android.os.Environment.DIRECTORY_PICTURES + "/Zelfscanner");
      }
      android.net.Uri uri = resolver.insert(
          android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
      if (uri == null) {
        promise.reject("E_SAVE", "MediaStore insert returned null");
        return;
      }
      java.io.OutputStream os = resolver.openOutputStream(uri);
      os.write(jpeg);
      os.close();
      android.util.Log.i("ImagerExp", "saved " + jpeg.length + "B -> " + uri);
      promise.resolve(name);
    } catch (Exception e) {
      promise.reject("E_SAVE", "save failed: " + e.getMessage());
    }
  }

  /**
   * Capture one signature-capture frame. Resolves { base64, format, width,
   * height, bytes }. Rejects with a specific code if the engine refuses.
   */
  @ReactMethod
  public void capture(int w, int h, Promise promise) {
    synchronized (this) {
      if (pending != null) {
        promise.reject("E_BUSY", "a capture is already in progress");
        return;
      }
      pending = promise;
      configured = false;
      if (w > 0) width = w;
      if (h > 0) height = h;
    }

    // DataWedge holds the imager by default; release it so EMDK can drive the
    // scanner. Restored in cleanup().
    setDataWedgeScanner(false);

    try {
      if (emdkManager == null) {
        // Async: continues in onOpened().
        EMDKResults results = EMDKManager.getEMDKManager(getReactApplicationContext(), this);
        if (results.statusCode != EMDKResults.STATUS_CODE.SUCCESS) {
          finishReject("E_EMDK", "getEMDKManager failed: " + results.statusCode);
        }
      } else {
        startCapture();
      }
    } catch (Exception e) {
      finishReject("E_EMDK", "EMDK open threw: " + e.getMessage());
    }

    main.postDelayed(timeoutRunnable, CAPTURE_TIMEOUT_MS);
  }

  // ---- EMDKListener ----------------------------------------------------------

  @Override
  public void onOpened(EMDKManager manager) {
    emdkManager = manager;
    startCapture();
  }

  @Override
  public void onClosed() {
    emdkManager = null;
  }

  // ---- capture pipeline ------------------------------------------------------

  private void startCapture() {
    String stage = "init";
    try {
      stage = "getInstance";
      barcodeManager = (BarcodeManager) emdkManager.getInstance(EMDKManager.FEATURE_TYPE.BARCODE);
      stage = "getDevice";
      scanner = barcodeManager.getDevice(BarcodeManager.DeviceIdentifier.DEFAULT);
      if (scanner == null) {
        finishReject("E_NO_SCANNER", "no default scanner device");
        return;
      }
      scanner.addDataListener(this);
      scanner.addStatusListener(this);
      // HARD: the physical scan trigger fires the imager (illumination on) and
      // performs the capture. The soft trigger doesn't light this engine, so we
      // arm here and let the user pull the hardware trigger. Set before enable().
      scanner.triggerType = Scanner.TriggerType.HARD;
      stage = "enable";
      if (!scanner.isEnabled()) {
        scanner.enable();
      }
      // Clear any session a prior attempt left pending, so setConfig is legal.
      if (scanner.isReadPending()) {
        scanner.cancelRead();
      }

      try {
        com.symbol.emdk.barcode.ScannerInfo info = scanner.getScannerInfo();
        android.util.Log.i("ImagerExp", "scanner="
            + (info != null ? info.getFriendlyName() + " / model=" + info.getModelNumber()
                + " / decoder=" + info.getDecoderType() : "null"));
      } catch (Exception ignore) {
      }
      // Config + read are deferred to onStatus's first IDLE — enable() is async,
      // and setConfig mid-transition throws ALREADY_SCANNING.
      android.util.Log.i("ImagerExp", "enabled; waiting for IDLE to configure");
    } catch (ScannerException e) {
      android.util.Log.e("ImagerExp", "ScannerException at stage=" + stage
          + " result=" + e.getResult() + " msg=" + e.getMessage(), e);
      finishReject("E_SCANNER", "failed at " + stage + " (" + e.getResult() + "): " + e.getMessage());
    } catch (Exception e) {
      android.util.Log.e("ImagerExp", "Exception at stage=" + stage, e);
      finishReject("E_SETUP", "failed at " + stage + ": " + e.getMessage());
    }
  }

  // ---- Scanner.StatusListener ------------------------------------------------

  @Override
  public void onStatus(StatusData statusData) {
    StatusData.ScannerStates state = statusData.getState();
    android.util.Log.i("ImagerExp", "onStatus state=" + state + " configured=" + configured);
    if (state != StatusData.ScannerStates.IDLE || pending == null || scanner == null) {
      return;
    }
    String stage = "idle";
    try {
      if (!configured) {
        // Now that the engine is genuinely idle, enabling signature capture is legal.
        stage = "getConfig";
        ScannerConfig config = scanner.getConfig();
        config.decoderParams.signature.enabled = true;
        config.decoderParams.signature.format = ScannerConfig.SignatureImageFormat.JPEG;
        config.decoderParams.signature.jpegQuality = 90;
        config.decoderParams.signature.width = width;
        config.decoderParams.signature.height = height;
        stage = "setConfig";
        scanner.setConfig(config);
        configured = true;
        android.util.Log.i("ImagerExp", "signature configured; arming read");
      }
      stage = "read";
      if (!scanner.isReadPending()) {
        scanner.read();
      }
    } catch (ScannerException e) {
      android.util.Log.e("ImagerExp", "onStatus fail at " + stage
          + " result=" + e.getResult() + " msg=" + e.getMessage(), e);
      finishReject("E_SCANNER", "failed at " + stage + " (" + e.getResult() + "): " + e.getMessage());
    }
  }

  // ---- Scanner.DataListener --------------------------------------------------

  @Override
  public void onData(ScanDataCollection scanDataCollection) {
    if (scanDataCollection == null) {
      android.util.Log.i("ImagerExp", "onData null");
      return;
    }
    ScannerResults result = scanDataCollection.getResult();
    Collection<ScanDataCollection.ScanData> scans = scanDataCollection.getScanData();
    android.util.Log.i("ImagerExp", "onData result=" + result
        + " count=" + (scans == null ? -1 : scans.size()));
    if (result == ScannerResults.FEATURE_NOT_SUPPORTED
        || result == ScannerResults.SCAN_PARAM_NOT_SUPPORTED
        || result == ScannerResults.UNLICENSED_FEATURE) {
      finishReject("E_UNSUPPORTED", "engine rejected signature capture: " + result);
      return;
    }
    if (result != ScannerResults.SUCCESS || scans == null) {
      return; // transient (e.g. still WAITING); let timeout handle a stall
    }
    for (ScanDataCollection.ScanData data : scans) {
      byte[] raw = data.getRawData();
      String dataStr = data.getData();
      int len = raw == null ? 0 : raw.length;
      String magic = (raw != null && raw.length >= 4)
          ? String.format("%02X %02X %02X %02X", raw[0], raw[1], raw[2], raw[3]) : "n/a";
      android.util.Log.i("ImagerExp", "scanData label=" + data.getLabelType()
          + " rawLen=" + len + " magic=" + magic
          + " str=" + (dataStr == null ? "null" : (dataStr.length() + "ch")));
      if (data.getLabelType() == ScanDataCollection.LabelType.SIGNATURE) {
        if (raw == null || raw.length == 0) {
          finishReject("E_EMPTY", "SIGNATURE label but no image bytes");
          return;
        }
        // EMDK may prefix the JPEG with a header; strip to the JPEG SOI (FF D8).
        int off = jpegStart(raw);
        byte[] img = off > 0 ? java.util.Arrays.copyOfRange(raw, off, raw.length) : raw;
        WritableMap map = Arguments.createMap();
        map.putString("base64", Base64.encodeToString(img, Base64.NO_WRAP));
        map.putString("format", "jpeg");
        map.putInt("width", width);
        map.putInt("height", height);
        map.putInt("bytes", img.length);
        map.putInt("headerOffset", off);
        android.util.Log.i("ImagerExp", "SIGNATURE captured, jpegOffset=" + off
            + " jpegLen=" + img.length);
        finishResolve(map);
        return;
      }
    }
  }

  /** Find the JPEG start-of-image marker (FF D8) within the first 64 bytes. */
  private static int jpegStart(byte[] b) {
    int limit = Math.min(b.length - 1, 64);
    for (int i = 0; i <= limit; i++) {
      if ((b[i] & 0xFF) == 0xFF && (b[i + 1] & 0xFF) == 0xD8) return i;
    }
    return 0;
  }

  // ---- cleanup ---------------------------------------------------------------

  private void finishResolve(WritableMap map) {
    Promise p = takePending();
    cleanup();
    if (p != null) p.resolve(map);
  }

  private void finishReject(String code, String message) {
    Promise p = takePending();
    cleanup();
    if (p != null) p.reject(code, message);
  }

  private synchronized Promise takePending() {
    Promise p = pending;
    pending = null;
    return p;
  }

  private void cleanup() {
    main.removeCallbacks(timeoutRunnable);
    try {
      if (scanner != null) {
        scanner.removeDataListener(this);
        scanner.removeStatusListener(this);
        if (scanner.isReadPending()) scanner.cancelRead();
        scanner.disable();
        scanner.release();
      }
    } catch (Exception ignored) {
    } finally {
      scanner = null;
      // Hand the scanner back to DataWedge so normal barcode scanning resumes.
      setDataWedgeScanner(true);
    }
  }

  /** Toggle DataWedge's scanner input plugin so EMDK and DataWedge don't fight. */
  private void setDataWedgeScanner(boolean enable) {
    try {
      android.content.Intent i = new android.content.Intent();
      i.setAction("com.symbol.datawedge.api.ACTION");
      i.putExtra("com.symbol.datawedge.api.SCANNER_INPUT_PLUGIN",
          enable ? "ENABLE_PLUGIN" : "DISABLE_PLUGIN");
      getReactApplicationContext().sendBroadcast(i);
    } catch (Exception e) {
      android.util.Log.w("ImagerExp", "DataWedge toggle failed: " + e.getMessage());
    }
  }
}
