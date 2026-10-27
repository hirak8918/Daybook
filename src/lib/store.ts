/**
 * Renderer store.
 *
 * Dispatch is optimistic: the reducer runs locally first so the interface never
 * waits on the IPC round-trip, then the same action is forwarded to the main
 * process, which is the authority. Remote updates are applied only once our own
 * in-flight actions have settled, so a slow echo can never undo a fresh edit.
 *
 * Data, timer and theme each have their own subscription list: the 1 Hz clock
 * tick repaints the timer, not the whole edition.
 */

import { createContext, useContext, useRef, useSyncExternalStore } from 'react';
import type { BootPayload, BridgeEvent, DaybookBridge, BridgeSignal, TimerSnapshot } from './ipc';
import { applyAction, type Action } from './reducer';
import { defaultData, type DaybookData } from './schema';
import { createMockBridge } from './mockBridge';

type Listener = () => void;

export class DaybookStore {
  private data: DaybookData;
  private bootPayload: BootPayload | null = null;
  private timerSnap: TimerSnapshot | null = null;
  private dark = false;
  private pending = 0;
  private deferred: DaybookData | null = null;

  readonly bridge: DaybookBridge;
  /** True when running outside Electron (browser preview). */
  readonly isPreview: boolean;

  private dataListeners = new Set<Listener>();
  private timerListeners = new Set<Listener>();
  private themeListeners = new Set<Listener>();
  private signalListeners = new Set<(s: BridgeSignal) => void>();
  private unsubscribers: Array<() => void> = [];

  constructor(bridge?: DaybookBridge) {
    const injected = bridge ?? window.daybook;
    this.isPreview = !injected;
    this.bridge = injected ?? createMockBridge();
    // Replaced wholesale by the boot payload; this keeps the first render sane.
    this.data = defaultData();
  }

  /* ------------------------------- lifecycle ------------------------------ */

  async init(): Promise<BootPayload> {
    const boot = await this.bridge.boot();
    this.bootPayload = boot;
    this.dark = boot.dark;
    this.replaceData(boot.data);

    this.unsubscribers.push(
      this.bridge.on('data' as BridgeEvent, (payload) => {
        const next = payload as DaybookData;
        if (this.pending > 0) {
          // Our own actions are still in flight; hold this for a moment.
          this.deferred = next;
          return;
        }
        this.replaceData(next);
      }),
      this.bridge.on('timer' as BridgeEvent, (payload) => {
        this.timerSnap = payload as TimerSnapshot;
        this.data = applyAction(this.data, { type: 'timer/set', patch: (payload as TimerSnapshot).timer });
        this.notify('timer');
        this.notify('data');
      }),
      this.bridge.on('theme' as BridgeEvent, (payload) => {
        const { dark } = payload as { dark: boolean };
        if (dark !== this.dark) {
          this.dark = dark;
          this.notify('theme');
        }
      }),
      this.bridge.on('signal' as BridgeEvent, (payload) => {
        for (const l of this.signalListeners) l(payload as BridgeSignal);
      }),
    );

    const snap = await this.bridge.timer.get();
    this.timerSnap = snap;
    this.data = applyAction(this.data, { type: 'timer/set', patch: snap.timer });
    return boot;
  }

  dispose(): void {
    for (const u of this.unsubscribers) u();
    this.unsubscribers = [];
  }

  private replaceData(next: DaybookData): void {
    this.data = next;
    this.notify('data');
  }

  private notify(kind: 'data' | 'timer' | 'theme'): void {
    if (kind === 'data') for (const l of this.dataListeners) l();
    else if (kind === 'timer') for (const l of this.timerListeners) l();
    else for (const l of this.themeListeners) l();
  }

  /* ---------------------------------- API -------------------------------- */

  getData = (): DaybookData => this.data;
  getBoot = (): BootPayload | null => this.bootPayload;
  getTimer = (): TimerSnapshot | null => this.timerSnap;
  getDark = (): boolean => this.dark;

  subscribeData = (l: Listener): (() => void) => {
    this.dataListeners.add(l);
    return () => {
      this.dataListeners.delete(l);
    };
  };

  subscribeTimer = (l: Listener): (() => void) => {
    this.timerListeners.add(l);
    return () => {
      this.timerListeners.delete(l);
    };
  };

  subscribeTheme = (l: Listener): (() => void) => {
    this.themeListeners.add(l);
    return () => {
      this.themeListeners.delete(l);
    };
  };

  subscribeSignal = (l: (s: BridgeSignal) => void): (() => void) => {
    this.signalListeners.add(l);
    return () => {
      this.signalListeners.delete(l);
    };
  };

  dispatch = (action: Action): void => {
    this.replaceData(applyAction(this.data, action));
    this.pending += 1;
    void this.bridge
      .dispatch(action)
      .catch((err: unknown) => console.error('[daybook] dispatch failed', err))
      .finally(() => {
        this.pending = Math.max(0, this.pending - 1);
        if (this.pending === 0 && this.deferred) {
          const next = this.deferred;
          this.deferred = null;
          this.replaceData(next);
        }
      });
  };

  /** Replace the whole document (import, or "clear all data"). */
  async replaceAll(next: DaybookData): Promise<void> {
    await this.bridge.replaceData(next);
    this.replaceData(next);
  }

  async clearAll(seed: boolean): Promise<void> {
    const res = await this.bridge.clearData({ seed });
    this.replaceData(res.data);
    await this.bridge.timer.send({ type: 'reset' });
  }

  async setTheme(mode: DaybookData['settings']['theme']): Promise<void> {
    const res = await this.bridge.theme.set(mode);
    this.dark = res.dark;
    this.notify('theme');
    this.dispatch({ type: 'settings/update', patch: { theme: mode } });
  }
}

/* ---------------------------------------------------------------------- *
 * React bindings
 * ---------------------------------------------------------------------- */

export const StoreContext = createContext<DaybookStore | null>(null);

export function useStoreApi(): DaybookStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('DaybookStore context is missing');
  return store;
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

/**
 * Subscribe to a slice of the edition. The selector result is cached against
 * the state object identity, so charts do not recompute on unrelated ticks.
 */
export function useSelect<T>(selector: (data: DaybookData) => T, isEqual: (a: T, b: T) => boolean = Object.is): T {
  const store = useStoreApi();
  const cache = useRef<{ state: DaybookData; value: T } | null>(null);

  const getSnapshot = (): T => {
    const state = store.getData();
    const cached = cache.current;
    if (cached && cached.state === state) return cached.value;
    const value = selector(state);
    if (cached && isEqual(cached.value, value)) {
      cache.current = { state, value: cached.value };
      return cached.value;
    }
    cache.current = { state, value };
    return value;
  };

  return useSyncExternalStore(store.subscribeData, getSnapshot, getSnapshot);
}

export function useData(): DaybookData {
  const store = useStoreApi();
  return useSyncExternalStore(store.subscribeData, store.getData, store.getData);
}

export function useTimerSnapshot(): TimerSnapshot | null {
  const store = useStoreApi();
  return useSyncExternalStore(store.subscribeTimer, store.getTimer, store.getTimer);
}

export function useDark(): boolean {
  const store = useStoreApi();
  return useSyncExternalStore(store.subscribeTheme, store.getDark, store.getDark);
}

export function useBoot(): BootPayload | null {
  const store = useStoreApi();
  return useSyncExternalStore(store.subscribeData, store.getBoot, store.getBoot);
}

export const useDispatch = (): DaybookStore['dispatch'] => useStoreApi().dispatch;

export { shallowEqual };
