import type {
  RepositoryChatMessage,
  RepositoryChatSession,
  RepositoryChatToolEvent,
  ToolEvidence,
} from '../../../types/repositoryChat';

const DB_NAME = 'gsm-repository-chat-db';
const DB_VERSION = 1;
const FALLBACK_KEY = 'gsm-repository-chat-fallback-v1';
const FALLBACK_MODE_KEY = 'gsm-repository-chat-use-fallback-v1';
const STORE_NAMES = ['sessions', 'messages', 'toolEvents', 'evidence'] as const;
type StoreName = typeof STORE_NAMES[number];

type FallbackSnapshot = {
  sessions: RepositoryChatSession[];
  messages: RepositoryChatMessage[];
  toolEvents: RepositoryChatToolEvent[];
  evidence: ToolEvidence[];
};

const emptySnapshot = (): FallbackSnapshot => ({ sessions: [], messages: [], toolEvents: [], evidence: [] });

const canUseIndexedDb = () => typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
const persistedFallbackMode = () => {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(FALLBACK_MODE_KEY) === '1';
  } catch {
    return false;
  }
};
let useFallbackStorage = !canUseIndexedDb() || persistedFallbackMode();
const enableFallbackStorage = (): boolean => {
  if (typeof window === 'undefined') {
    useFallbackStorage = true;
    return true;
  }
  try {
    window.localStorage.setItem(FALLBACK_MODE_KEY, '1');
    useFallbackStorage = true;
    return true;
  } catch {
    return false;
  }
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs = 2000): Promise<T> => {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => window.setTimeout(() => reject(new Error('Repository chat IndexedDB timeout')), timeoutMs)),
  ]);
};

const readFallback = (): FallbackSnapshot => {
  if (typeof window === 'undefined') return emptySnapshot();
  try {
    const raw = window.localStorage.getItem(FALLBACK_KEY);
    if (!raw) return emptySnapshot();
    const value = JSON.parse(raw) as Partial<FallbackSnapshot>;
    return {
      sessions: Array.isArray(value.sessions) ? value.sessions : [],
      messages: Array.isArray(value.messages) ? value.messages : [],
      toolEvents: Array.isArray(value.toolEvents) ? value.toolEvents : [],
      evidence: Array.isArray(value.evidence) ? value.evidence : [],
    };
  } catch {
    return emptySnapshot();
  }
};

const writeFallback = (snapshot: FallbackSnapshot): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(FALLBACK_KEY, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
};

const openDb = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = window.indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains('sessions')) {
      const store = db.createObjectStore('sessions', { keyPath: 'id' });
      store.createIndex('repoId', 'repoId', { unique: false });
      store.createIndex('updatedAt', 'updatedAt', { unique: false });
    }
    if (!db.objectStoreNames.contains('messages')) {
      const store = db.createObjectStore('messages', { keyPath: 'id' });
      store.createIndex('sessionId', 'sessionId', { unique: false });
    }
    if (!db.objectStoreNames.contains('toolEvents')) {
      const store = db.createObjectStore('toolEvents', { keyPath: 'id' });
      store.createIndex('sessionId', 'sessionId', { unique: false });
      store.createIndex('messageId', 'messageId', { unique: false });
    }
    if (!db.objectStoreNames.contains('evidence')) {
      const store = db.createObjectStore('evidence', { keyPath: 'id' });
      store.createIndex('repoFullName', 'repoFullName', { unique: false });
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('Unable to open repository chat IndexedDB'));
});

const requestValue = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
});

const runTransaction = async <T>(storeNames: StoreName | StoreName[], mode: IDBTransactionMode, operation: (stores: Record<StoreName, IDBObjectStore>) => Promise<T>): Promise<T> => {
  const db = await openDb();
  try {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    const transaction = db.transaction(names, mode);
    const stores = Object.fromEntries(STORE_NAMES.map((name) => [name, transaction.objectStoreNames.contains(name) ? transaction.objectStore(name) : undefined])) as Record<StoreName, IDBObjectStore>;
    const value = await operation(stores);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Repository chat transaction failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Repository chat transaction aborted'));
    });
    return value;
  } finally {
    db.close();
  }
};

const mergeById = <T extends { id: string }>(fallbackValues: T[], indexedDbValues: T[]): T[] => {
  return [...new Map([...fallbackValues, ...indexedDbValues].map((value) => [value.id, value])).values()];
};

const migrateIndexedDbSnapshotToFallback = async (): Promise<boolean> => {
  if (!canUseIndexedDb()) return false;
  try {
    const indexedDbSnapshot = await withTimeout(runTransaction([...STORE_NAMES], 'readonly', async (stores) => ({
      sessions: await requestValue(stores.sessions.getAll()) as RepositoryChatSession[],
      messages: await requestValue(stores.messages.getAll()) as RepositoryChatMessage[],
      toolEvents: await requestValue(stores.toolEvents.getAll()) as RepositoryChatToolEvent[],
      evidence: await requestValue(stores.evidence.getAll()) as ToolEvidence[],
    })));
    const fallbackSnapshot = readFallback();
    return writeFallback({
      sessions: mergeById(fallbackSnapshot.sessions, indexedDbSnapshot.sessions),
      messages: mergeById(fallbackSnapshot.messages, indexedDbSnapshot.messages),
      toolEvents: mergeById(fallbackSnapshot.toolEvents, indexedDbSnapshot.toolEvents),
      evidence: mergeById(fallbackSnapshot.evidence, indexedDbSnapshot.evidence),
    });
  } catch (error) {
    console.warn('[repository-chat] unable to migrate IndexedDB snapshot before fallback', error);
    return false;
  }
};

const transitionToFallbackStorage = async (): Promise<boolean> => {
  if (useFallbackStorage) return true;
  if (!canUseIndexedDb()) return enableFallbackStorage();
  if (!await migrateIndexedDbSnapshotToFallback()) return false;
  return enableFallbackStorage();
};

const fallbackList = <T extends { sessionId?: string; repoId?: number }>(store: keyof FallbackSnapshot, filter: (value: T) => boolean): T[] => {
  return (readFallback()[store] as unknown as T[]).filter(filter);
};

const byCreatedAt = <T extends { createdAt: string }>(left: T, right: T) => left.createdAt.localeCompare(right.createdAt);
const byUpdatedAtDescending = <T extends { updatedAt: string }>(left: T, right: T) => right.updatedAt.localeCompare(left.updatedAt);

export const repositoryChatSessionRepository = {
  async listSessionsByRepository(repoId: number): Promise<RepositoryChatSession[]> {
    const fallback = () => fallbackList<RepositoryChatSession>('sessions', (session) => session.repoId === repoId && !session.deletedAt).sort(byUpdatedAtDescending);
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    try {
      return await withTimeout(runTransaction('sessions', 'readonly', async (stores) => {
        const records = await requestValue(stores.sessions.index('repoId').getAll(repoId));
        return (records as RepositoryChatSession[]).filter((session) => !session.deletedAt).sort(byUpdatedAtDescending);
      }));
    } catch (error) {
      console.warn('[repository-chat] session list fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      return fallback();
    }
  },

  async getSession(sessionId: string): Promise<RepositoryChatSession | null> {
    const fallback = () => readFallback().sessions.find((session) => session.id === sessionId) ?? null;
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    try {
      return await withTimeout(runTransaction('sessions', 'readonly', async (stores) => {
        return (await requestValue(stores.sessions.get(sessionId)) as RepositoryChatSession | undefined) ?? null;
      }));
    } catch (error) {
      console.warn('[repository-chat] session read fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      return fallback();
    }
  },

  async saveSession(session: RepositoryChatSession): Promise<void> {
    const fallback = () => {
      const snapshot = readFallback();
      const index = snapshot.sessions.findIndex((item) => item.id === session.id);
      if (index >= 0) snapshot.sessions[index] = session;
      else snapshot.sessions.push(session);
      writeFallback(snapshot);
    };
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    try {
      await withTimeout(runTransaction('sessions', 'readwrite', async (stores) => {
        await requestValue(stores.sessions.put(session));
      }));
    } catch (error) {
      console.warn('[repository-chat] session write fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      fallback();
    }
  },

  async purgeExpiredSessions(repoId: number, retainSessionDays: number): Promise<void> {
    const cutoff = Date.now() - Math.max(1, retainSessionDays) * 24 * 60 * 60 * 1000;
    const sessions = await this.listSessionsByRepository(repoId);
    await Promise.all(sessions
      .filter((session) => Date.parse(session.updatedAt) < cutoff)
      .map((session) => this.permanentlyDeleteSession(session.id)));
  },

  async softDeleteSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) return;
    await this.saveSession({ ...session, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  },

  async permanentlyDeleteSession(sessionId: string): Promise<void> {
    const fallback = () => {
      const snapshot = readFallback();
      snapshot.sessions = snapshot.sessions.filter((item) => item.id !== sessionId);
      const removedToolEvents = snapshot.toolEvents.filter((item) => item.sessionId === sessionId);
      const evidenceIds = new Set([
        ...snapshot.messages.filter((item) => item.sessionId === sessionId).flatMap((item) => item.evidenceIds),
        ...removedToolEvents.flatMap((event) => event.evidenceId ? [event.evidenceId] : []),
      ]);
      snapshot.messages = snapshot.messages.filter((item) => item.sessionId !== sessionId);
      snapshot.toolEvents = snapshot.toolEvents.filter((item) => item.sessionId !== sessionId);
      snapshot.evidence = snapshot.evidence.filter((item) => !evidenceIds.has(item.id));
      writeFallback(snapshot);
    };
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    try {
      await withTimeout(runTransaction(['sessions', 'messages', 'toolEvents', 'evidence'], 'readwrite', async (stores) => {
        const messages = await requestValue(stores.messages.index('sessionId').getAll(sessionId)) as RepositoryChatMessage[];
        await requestValue(stores.sessions.delete(sessionId));
        await Promise.all(messages.map((message) => requestValue(stores.messages.delete(message.id))));
        const toolEvents = await requestValue(stores.toolEvents.index('sessionId').getAll(sessionId)) as RepositoryChatToolEvent[];
        await Promise.all(toolEvents.map((event) => requestValue(stores.toolEvents.delete(event.id))));
        const evidenceIds = new Set([
          ...messages.flatMap((message) => message.evidenceIds),
          ...toolEvents.flatMap((event) => event.evidenceId ? [event.evidenceId] : []),
        ]);
        await Promise.all([...evidenceIds].map((id) => requestValue(stores.evidence.delete(id))));
      }));
    } catch (error) {
      console.warn('[repository-chat] permanent deletion fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      fallback();
    }
  },

  async listMessages(sessionId: string): Promise<RepositoryChatMessage[]> {
    const fallback = () => fallbackList<RepositoryChatMessage>('messages', (message) => message.sessionId === sessionId).sort(byCreatedAt);
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    try {
      return await withTimeout(runTransaction('messages', 'readonly', async (stores) => {
        return (await requestValue(stores.messages.index('sessionId').getAll(sessionId)) as RepositoryChatMessage[]).sort(byCreatedAt);
      }));
    } catch (error) {
      console.warn('[repository-chat] message list fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      return fallback();
    }
  },

  async saveMessage(message: RepositoryChatMessage): Promise<void> {
    const fallback = () => {
      const snapshot = readFallback();
      const index = snapshot.messages.findIndex((item) => item.id === message.id);
      if (index >= 0) snapshot.messages[index] = message;
      else snapshot.messages.push(message);
      writeFallback(snapshot);
    };
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    try {
      await withTimeout(runTransaction('messages', 'readwrite', async (stores) => {
        await requestValue(stores.messages.put(message));
      }));
    } catch (error) {
      console.warn('[repository-chat] message write fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      fallback();
    }
  },

  async permanentlyDeleteMessages(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;
    const messageIdSet = new Set(messageIds);
    const fallback = () => {
      const snapshot = readFallback();
      const removedToolEvents = snapshot.toolEvents.filter((event) => messageIdSet.has(event.messageId));
      const evidenceIds = new Set([
        ...snapshot.messages.filter((message) => messageIdSet.has(message.id)).flatMap((message) => message.evidenceIds),
        ...removedToolEvents.flatMap((event) => event.evidenceId ? [event.evidenceId] : []),
      ]);
      snapshot.messages = snapshot.messages.filter((message) => !messageIdSet.has(message.id));
      snapshot.toolEvents = snapshot.toolEvents.filter((event) => !messageIdSet.has(event.messageId));
      snapshot.evidence = snapshot.evidence.filter((evidence) => !evidenceIds.has(evidence.id));
      writeFallback(snapshot);
    };
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    try {
      await withTimeout(runTransaction(['messages', 'toolEvents', 'evidence'], 'readwrite', async (stores) => {
        const messages = (await Promise.all(messageIds.map(async (id) => await requestValue(stores.messages.get(id)) as RepositoryChatMessage | undefined))).filter((message): message is RepositoryChatMessage => Boolean(message));
        await Promise.all(messageIds.map((id) => requestValue(stores.messages.delete(id))));
        const toolEvents = (await Promise.all(messageIds.map(async (id) => await requestValue(stores.toolEvents.index('messageId').getAll(id)) as RepositoryChatToolEvent[]))).flat();
        await Promise.all(toolEvents.map((event) => requestValue(stores.toolEvents.delete(event.id))));
        const evidenceIds = new Set([
          ...messages.flatMap((message) => message.evidenceIds),
          ...toolEvents.flatMap((event) => event.evidenceId ? [event.evidenceId] : []),
        ]);
        await Promise.all([...evidenceIds].map((id) => requestValue(stores.evidence.delete(id))));
      }));
    } catch (error) {
      console.warn('[repository-chat] message deletion fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      fallback();
    }
  },

  async listToolEvents(sessionId: string): Promise<RepositoryChatToolEvent[]> {
    const fallback = () => fallbackList<RepositoryChatToolEvent>('toolEvents', (event) => event.sessionId === sessionId).sort(byCreatedAt);
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    try {
      return await withTimeout(runTransaction('toolEvents', 'readonly', async (stores) => {
        return (await requestValue(stores.toolEvents.index('sessionId').getAll(sessionId)) as RepositoryChatToolEvent[]).sort(byCreatedAt);
      }));
    } catch (error) {
      console.warn('[repository-chat] tool event list fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      return fallback();
    }
  },

  async saveToolEvent(event: RepositoryChatToolEvent): Promise<void> {
    const fallback = () => {
      const snapshot = readFallback();
      const index = snapshot.toolEvents.findIndex((item) => item.id === event.id);
      if (index >= 0) snapshot.toolEvents[index] = event;
      else snapshot.toolEvents.push(event);
      writeFallback(snapshot);
    };
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    try {
      await withTimeout(runTransaction('toolEvents', 'readwrite', async (stores) => {
        await requestValue(stores.toolEvents.put(event));
      }));
    } catch (error) {
      console.warn('[repository-chat] tool event write fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      fallback();
    }
  },

  async saveEvidence(evidence: ToolEvidence): Promise<void> {
    const fallback = () => {
      const snapshot = readFallback();
      const index = snapshot.evidence.findIndex((item) => item.id === evidence.id);
      if (index >= 0) snapshot.evidence[index] = evidence;
      else snapshot.evidence.push(evidence);
      writeFallback(snapshot);
    };
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    try {
      await withTimeout(runTransaction('evidence', 'readwrite', async (stores) => {
        await requestValue(stores.evidence.put(evidence));
      }));
    } catch (error) {
      console.warn('[repository-chat] evidence write fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      fallback();
    }
  },

  async listEvidence(ids: string[]): Promise<ToolEvidence[]> {
    const idSet = new Set(ids);
    const fallback = () => readFallback().evidence.filter((evidence) => idSet.has(evidence.id));
    if (ids.length === 0 || useFallbackStorage || !canUseIndexedDb()) {
      if (!canUseIndexedDb()) enableFallbackStorage();
      return fallback();
    }
    try {
      return await withTimeout(runTransaction('evidence', 'readonly', async (stores) => {
        const values = await Promise.all(ids.map(async (id) => await requestValue(stores.evidence.get(id)) as ToolEvidence | undefined));
        return values.filter((value): value is ToolEvidence => Boolean(value));
      }));
    } catch (error) {
      console.warn('[repository-chat] evidence list fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      return fallback();
    }
  },
};
