/**
 * JS wrapper over the native Cradle module (android/.../cradle/CradleModule.java).
 *
 * unlock() fires the cradle-unlock broadcast on THIS device — each MC18 can only
 * release its own slot, so the app must run on every device you want to unlock.
 */
import {NativeEventEmitter, NativeModules} from 'react-native';

type CradleNative = {
  unlock(seconds: number): Promise<number>;
  unlockViaUI(seconds: number): Promise<number>;
  isUiUnlockReady(): Promise<boolean>;
  openAccessibilitySettings(): void;
  getDeviceInfo(): Promise<DeviceInfo>;
  getBattery(): Promise<BatteryInfo>;
};

export type UnlockResult = {seconds: number; method: 'broadcast' | 'ui'};

export type DeviceInfo = {
  serial: string;
  model: string;
  device: string;
  docked: boolean;
};

export type BatteryInfo = {level: number; charging: boolean};

export type DockEvent = {docked: boolean; reason: string};

const native = NativeModules.Cradle as CradleNative | undefined;

export const CradleAvailable = !!native;

const emitter = native ? new NativeEventEmitter(NativeModules.Cradle) : null;

function clamp(seconds: number): number {
  return Math.max(10, Math.min(30, Math.round(seconds)));
}

export const Cradle = {
  /**
   * Unlock the local slot. Tries the direct broadcast first (works on the MC18).
   * If the firmware protects the broadcast (PS20 / Android 10 → E_PROTECTED),
   * falls back to driving CradleUtility via the accessibility service.
   */
  async unlock(seconds = 10): Promise<UnlockResult> {
    if (!native) {
      throw new Error('Cradle native module not linked');
    }
    const s = clamp(seconds);
    try {
      await native.unlock(s);
      return {seconds: s, method: 'broadcast'};
    } catch (e: any) {
      if (e?.code === 'E_PROTECTED') {
        await native.unlockViaUI(s); // throws E_A11Y_DISABLED if not enabled
        return {seconds: s, method: 'ui'};
      }
      throw e;
    }
  },

  /** Is the accessibility-based UI unlock available (service enabled)? */
  isUiUnlockReady(): Promise<boolean> {
    return native ? native.isUiUnlockReady() : Promise.resolve(false);
  },

  openAccessibilitySettings(): void {
    native?.openAccessibilitySettings();
  },

  getDeviceInfo(): Promise<DeviceInfo> {
    if (!native) {
      return Promise.reject(new Error('Cradle native module not linked'));
    }
    return native.getDeviceInfo();
  },

  /** Subscribe to dock in/out changes. Returns an unsubscribe fn. */
  onDock(cb: (e: DockEvent) => void): () => void {
    if (!emitter) {
      return () => {};
    }
    const sub = emitter.addListener('cradleDock', cb);
    return () => sub.remove();
  },

  getBattery(): Promise<BatteryInfo> {
    if (!native) {
      return Promise.reject(new Error('Cradle native module not linked'));
    }
    return native.getBattery();
  },

  /** Subscribe to battery level / charging changes. Returns an unsubscribe fn. */
  onBattery(cb: (e: BatteryInfo) => void): () => void {
    if (!emitter) {
      return () => {};
    }
    const sub = emitter.addListener('battery', cb);
    return () => sub.remove();
  },
};
