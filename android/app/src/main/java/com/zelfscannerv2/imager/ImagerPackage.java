package com.zelfscannerv2.imager;

import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class ImagerPackage implements ReactPackage {
  @Override
  public List<NativeModule> createNativeModules(ReactApplicationContext context) {
    List<NativeModule> modules = new ArrayList<>();
    // Reflection here (instead of `new SignatureModule(context)`) keeps this
    // class's own verification from hard-referencing SignatureModule, which
    // implements Zebra's EMDKManager.EMDKListener. On a device without EMDK
    // (emulator, non-Zebra hardware) that reference would otherwise fail
    // class verification of ImagerPackage itself, before this try/catch ever
    // runs.
    try {
      Class<?> cls = Class.forName("com.zelfscannerv2.imager.SignatureModule");
      NativeModule module = (NativeModule) cls
          .getConstructor(ReactApplicationContext.class)
          .newInstance(context);
      modules.add(module);
    } catch (Throwable t) {
      android.util.Log.w("ImagerPackage", "SignatureModule unavailable (no EMDK on this device): " + t);
    }
    return modules;
  }

  @Override
  public List<ViewManager> createViewManagers(ReactApplicationContext context) {
    return Collections.emptyList();
  }
}
