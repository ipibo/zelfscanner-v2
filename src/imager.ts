/**
 * JS wrapper over the native Imager module
 * (android/.../imager/SignatureModule.java).
 *
 * Experiment: the PS20J has no camera, and EMDK's only pixel-producing path is
 * Signature Capture. capture() enables the SIGNATURE decoder on the SE2100 and
 * fires a read(). If the imager sees a valid CapCode form it returns a JPEG of
 * what it saw — otherwise a specific error tells us why (E_UNSUPPORTED means the
 * engine refused signature capture at all).
 */
import {NativeModules} from 'react-native';

type ImagerNative = {
  capture(width: number, height: number): Promise<CaptureResult>;
  save(base64: string): Promise<string>;
};

export type CaptureResult = {
  base64: string;
  format: 'jpeg';
  width: number;
  height: number;
  bytes: number;
};

const native = NativeModules.Imager as ImagerNative | undefined;

export const ImagerAvailable = !!native;

export const Imager = {
  /** Capture one signature-capture frame as JPEG. Throws on failure. */
  capture(width = 640, height = 480): Promise<CaptureResult> {
    if (!native) {
      return Promise.reject(new Error('Imager native module not linked'));
    }
    return native.capture(width, height);
  },

  /** Save a base64 JPEG to the gallery. Resolves with the file name. */
  save(base64: string): Promise<string> {
    if (!native) {
      return Promise.reject(new Error('Imager native module not linked'));
    }
    return native.save(base64);
  },
};
