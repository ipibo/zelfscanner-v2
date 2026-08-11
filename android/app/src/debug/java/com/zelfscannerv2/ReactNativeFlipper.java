/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * <p>This source code is licensed under the MIT license found in the LICENSE file in the root
 * directory of this source tree.
 */
package com.zelfscannerv2;

import android.content.Context;
import com.facebook.react.ReactInstanceManager;

/**
 * Flipper disabled. Its native lib (libflipper.so) fails to load on Android 5.1.1
 * (BoringSSL symbol BN_set_flags missing on API 22), which crashes the app on
 * launch. Made a no-op so the debug build runs on the Zebra MC18N0.
 */
public class ReactNativeFlipper {
  public static void initializeFlipper(Context context, ReactInstanceManager reactInstanceManager) {
    // Intentionally empty: Flipper is incompatible with Android 5.1.1.
  }
}
