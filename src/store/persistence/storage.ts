
import type { PersistStorage, StorageValue } from 'zustand/middleware';
import { indexedDBStorage } from '../../services/indexedDbStorage';
import { logger } from '../../services/logger';

const scheduleIdleTask = (callback: () => void): number => {
  if (typeof window === 'undefined') {
    return setTimeout(callback, 0) as unknown as number;
  }

  if ('requestIdleCallback' in window) {
    return window.requestIdleCallback(callback, { timeout: 3000 });
  }

  return globalThis.setTimeout(callback, 0) as unknown as number;
};

const cancelIdleTask = (id: number): void => {
  if (typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
    window.cancelIdleCallback(id);
    return;
  }

  clearTimeout(id);
};

let persistTimeoutId: ReturnType<typeof setTimeout> | null = null;
let persistIdleTaskId: number | null = null;
let latestPersistName: string | null = null;
let latestPersistValue: StorageValue<unknown> | null = null;
let persistWriteVersion = 0;
let persistFlushListenersRegistered = false;

const cancelPendingPersistTasks = (): void => {
  if (persistTimeoutId) {
    clearTimeout(persistTimeoutId);
    persistTimeoutId = null;
  }

  if (persistIdleTaskId !== null) {
    cancelIdleTask(persistIdleTaskId);
    persistIdleTaskId = null;
  }
};

const writePersistSnapshot = (
  name: string,
  value: StorageValue<unknown>,
  version: number,
  source: 'idle' | 'flush'
): void => {
  if (latestPersistValue === null || latestPersistName !== name || persistWriteVersion !== version) {
    return;
  }

  const startedAt = performance.now();
  try {
    const str = JSON.stringify(value);
    const stringifyMs = Math.round(performance.now() - startedAt);
    const writeStartedAt = performance.now();
    void Promise.resolve(indexedDBStorage.setItem(name, str))
      .then(() => {
        const writeMs = Math.round(performance.now() - writeStartedAt);
        if (writeMs > 50) {
          logger.warn('store.persist', 'Large state IndexedDB write completed', {
            source,
            writeMs,
            bytes: str.length,
          });
        }
      })
      .catch((error: unknown) => {
        const writeMs = Math.round(performance.now() - writeStartedAt);
        logger.errorFromError('store.persist', 'IndexedDB write failed', error, {
          source,
          writeMs,
          bytes: str.length,
        });
      });
    if (stringifyMs > 50) {
      logger.warn('store.persist', 'Large state stringify completed', {
        source,
        stringifyMs,
        bytes: str.length,
      });
    }
  } catch (e) {
    logger.errorFromError('store.persist', 'Failed to stringify state for persistence', e);
  }
};

const flushPendingPersistSnapshot = (): void => {
  if (latestPersistName === null || latestPersistValue === null) return;

  cancelPendingPersistTasks();
  writePersistSnapshot(latestPersistName, latestPersistValue, persistWriteVersion, 'flush');
};

const registerPersistFlushListeners = (): void => {
  if (persistFlushListenersRegistered || typeof window === 'undefined') return;
  persistFlushListenersRegistered = true;

  window.addEventListener('pagehide', flushPendingPersistSnapshot);
  window.addEventListener('beforeunload', flushPendingPersistSnapshot);

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        flushPendingPersistSnapshot();
      }
    });
  }
};

// Create a debounced storage to avoid frequent JSON.stringify calls on large state objects
// which causes V8 JIT assertion failures (EXC_BREAKPOINT) on macOS ARM64.
const debouncedPersistStorage: PersistStorage<unknown> = {
  getItem: async (name) => {
    const str = await indexedDBStorage.getItem(name);
    if (!str) return null;
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  },
  setItem: (name: string, value: StorageValue<unknown>) => {
    registerPersistFlushListeners();
    latestPersistName = name;
    latestPersistValue = value;
    persistWriteVersion++;
    const scheduledVersion = persistWriteVersion;

    cancelPendingPersistTasks();
    persistTimeoutId = setTimeout(() => {
      persistTimeoutId = null;
      persistIdleTaskId = scheduleIdleTask(() => {
        persistIdleTaskId = null;
        writePersistSnapshot(name, value, scheduledVersion, 'idle');
      });
    }, 1000);
  },
  removeItem: (name) => {
    latestPersistName = null;
    latestPersistValue = null;
    persistWriteVersion++;
    cancelPendingPersistTasks();
    void Promise.resolve(indexedDBStorage.removeItem(name)).catch((error: unknown) => {
      logger.errorFromError('store.persist', 'Failed to remove persisted state snapshot', error);
    });
  }
};

export { debouncedPersistStorage };
