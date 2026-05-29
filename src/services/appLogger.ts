import type { AppLogEntry, AppLogLevel, AppLogSource } from '../types';
import { DB_NAME } from './indexedDbStorage';

const LOG_STORAGE_KEY = 'github-stars-manager-diagnostic-logs';
const STORE_NAME = 'app_state';
const MAX_LOG_ENTRIES = 1000;
const SENSITIVE_KEYS = [
  'authorization',
  'api-key',
  'apikey',
  'api_key',
  'access_token',
  'token',
  'password',
  'secret',
  'client_secret',
  'key',
];

type LogDetails = AppLogEntry['details'];

const isSensitiveKey = (key: string): boolean => {
  const normalized = key.toLowerCase();
  return SENSITIVE_KEYS.some((sensitive) => normalized.includes(sensitive));
};

const sanitizeDetails = (details?: LogDetails): LogDetails | undefined => {
  if (!details) return undefined;

  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [
      key,
      isSensitiveKey(key) ? '[redacted]' : value,
    ])
  ) as LogDetails;
};

const sanitizeUrl = (rawUrl: string): string => {
  try {
    const url = new URL(rawUrl, window.location.origin);
    for (const key of Array.from(url.searchParams.keys())) {
      if (isSensitiveKey(key)) {
        url.searchParams.set(key, '[redacted]');
      }
    }

    if (url.origin === window.location.origin) {
      return `${url.pathname}${url.search}${url.hash}`;
    }

    return url.toString();
  } catch {
    return rawUrl;
  }
};

const serializeError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error);
};

const canUseIndexedDB = (): boolean => typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';

const withTimeout = async <T>(promise: Promise<T>, timeoutMs = 2000): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('IndexedDB timeout')), timeoutMs)),
  ]);
};

const openDb = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const idbGet = async (key: string): Promise<string | null> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(key);

    req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
};

const idbSet = async (key: string, value: string): Promise<void> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
};

const idbDelete = async (key: string): Promise<void> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
};

const readStoredLogs = async (): Promise<AppLogEntry[]> => {
  if (!canUseIndexedDB()) return [];

  try {
    const raw = await withTimeout(idbGet(LOG_STORAGE_KEY));
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as AppLogEntry[] : [];
  } catch (error) {
    console.warn('[diagnostic-log] failed to read logs:', error);
    return [];
  }
};

let writeQueue = Promise.resolve();

const enqueueWrite = (entry: AppLogEntry): void => {
  writeQueue = writeQueue
    .then(async () => {
      const logs = await readStoredLogs();
      const nextLogs = [entry, ...logs].slice(0, MAX_LOG_ENTRIES);
      if (canUseIndexedDB()) {
        await withTimeout(idbSet(LOG_STORAGE_KEY, JSON.stringify(nextLogs)));
      }
      window.dispatchEvent(new CustomEvent('gsm:diagnostic-log-added', { detail: entry }));
    })
    .catch((error) => {
      console.warn('[diagnostic-log] failed to write log entry:', error);
    });
};

const createEntry = (
  level: AppLogLevel,
  source: AppLogSource,
  operation: string,
  message: string,
  options: Omit<Partial<AppLogEntry>, 'id' | 'timestamp' | 'level' | 'source' | 'operation' | 'message'> = {}
): AppLogEntry => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  timestamp: new Date().toISOString(),
  level,
  source,
  operation,
  message,
  ...options,
  details: sanitizeDetails(options.details),
});

export const appLogger = {
  info(source: AppLogSource, operation: string, message: string, options?: Parameters<typeof createEntry>[4]): void {
    if (typeof window === 'undefined') return;
    enqueueWrite(createEntry('info', source, operation, message, options));
  },

  warn(source: AppLogSource, operation: string, message: string, options?: Parameters<typeof createEntry>[4]): void {
    if (typeof window === 'undefined') return;
    enqueueWrite(createEntry('warn', source, operation, message, options));
  },

  error(source: AppLogSource, operation: string, message: string, options?: Parameters<typeof createEntry>[4]): void {
    if (typeof window === 'undefined') return;
    enqueueWrite(createEntry('error', source, operation, message, options));
  },

  async getLogs(): Promise<AppLogEntry[]> {
    if (typeof window === 'undefined') return [];
    await writeQueue;
    return readStoredLogs();
  },

  async clearLogs(): Promise<void> {
    if (typeof window === 'undefined') return;
    if (canUseIndexedDB()) {
      await withTimeout(idbDelete(LOG_STORAGE_KEY));
    }
    window.dispatchEvent(new CustomEvent('gsm:diagnostic-logs-cleared'));
  },

  exportLogs(logs: AppLogEntry[]): void {
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `github-stars-manager-logs-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },

  sanitizeUrl,
  serializeError,
  maxEntries: MAX_LOG_ENTRIES,
};
