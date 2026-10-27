import type { DaybookBridge } from '../lib/ipc';

declare global {
  interface Window {
    /** Present only inside Electron. Absent when the UI runs in a plain browser. */
    daybook?: DaybookBridge;
    daybookMeta?: { platform: string };
  }
}

export {};
