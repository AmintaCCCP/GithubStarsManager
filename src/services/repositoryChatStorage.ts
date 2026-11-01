import type {
  RepositoryChatAccountScope,
  RepositoryChatFeedback,
  RepositoryChatMessage,
  RepositoryChatSession,
  RepositoryChatToolEvent,
  ToolEvidence,
} from '../types/repositoryChat';

const DB_NAME = 'gsm-repository-chat-db';
const DB_VERSION = 2;
const FALLBACK_KEY = 'gsm-repository-chat-fallback-v1';
const FALLBACK_MODE_KEY = 'gsm-repository-chat-use-fallback-v1';
const STORE_NAMES = ['sessions', 'messages', 'toolEvents', 'evidence', 'feedback'] as const;
type StoreName = typeof STORE_NAMES[number];

type FallbackSnapshot = {
  sessions: RepositoryChatSession[];
  messages: RepositoryChatMessage[];
  toolEvents: RepositoryChatToolEvent[];
  evidence: ToolEvidence[];
  feedback: RepositoryChatFeedback[];
};

const emptySnapshot = (): FallbackSnapshot => ({ sessions: [], messages: [], toolEvents: [], evidence: [], feedback: [] });

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
      feedback: Array.isArray(value.feedback) ? value.feedback : [],
    };
  } catch {
    return emptySnapshot();
  }
};

const writeFallback = (snapshot: FallbackSnapshot): void => {
  if (typeof window === 'undefined') {
    throw new Error('[repository-chat] localStorage is unavailable for fallback persistence');
  }
  try {
    window.localStorage.setItem(FALLBACK_KEY, JSON.stringify(snapshot));
  } catch {
    throw new Error('[repository-chat] unable to persist fallback snapshot');
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
    if (!db.objectStoreNames.contains('feedback')) {
      const store = db.createObjectStore('feedback', { keyPath: 'messageId' });
      store.createIndex('sessionId', 'sessionId', { unique: false });
      store.createIndex('accountId', 'accountId', { unique: false });
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
      feedback: await requestValue(stores.feedback.getAll()) as RepositoryChatFeedback[],
    })));
    const fallbackSnapshot = readFallback();
    writeFallback({
      sessions: mergeById(fallbackSnapshot.sessions, indexedDbSnapshot.sessions),
      messages: mergeById(fallbackSnapshot.messages, indexedDbSnapshot.messages),
      toolEvents: mergeById(fallbackSnapshot.toolEvents, indexedDbSnapshot.toolEvents),
      evidence: mergeById(fallbackSnapshot.evidence, indexedDbSnapshot.evidence),
      feedback: mergeById(fallbackSnapshot.feedback, indexedDbSnapshot.feedback),
    });
    return true;
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

const byCreatedAt = <T extends { id: string; createdAt: string; role?: 'user' | 'assistant' | 'system' }>(left: T, right: T) => {
  const timestampOrder = left.createdAt.localeCompare(right.createdAt);
  if (timestampOrder !== 0) return timestampOrder;
  // Legacy turns may share a timestamp because their user and assistant records
  // were written concurrently. Preserve the conversational order on reload.
  const roleOrder = (role: T['role']) => role === 'user' ? 0 : role === 'assistant' ? 1 : 2;
  const byRole = roleOrder(left.role) - roleOrder(right.role);
  return byRole !== 0 ? byRole : left.id.localeCompare(right.id);
};
const byUpdatedAtDescending = <T extends { updatedAt: string }>(left: T, right: T) => right.updatedAt.localeCompare(left.updatedAt);

const sessionMatchesScope = (session: RepositoryChatSession, scope: RepositoryChatAccountScope): boolean => {
  if (!scope.accountId) return false;
  if (session.accountId) return session.accountId === scope.accountId;
  // Legacy sessions are visible only when their old login marker matches. Untagged
  // records stay quarantined in place instead of leaking across accounts or being deleted.
  return Boolean(scope.accountLogin && session.accountLogin === scope.accountLogin);
};

const claimLegacySession = (session: RepositoryChatSession, scope: RepositoryChatAccountScope): RepositoryChatSession => (
  session.accountId || !sessionMatchesScope(session, scope)
    ? session
    : { ...session, accountId: scope.accountId! }
);

const scopedSessions = (sessions: RepositoryChatSession[], scope: RepositoryChatAccountScope): RepositoryChatSession[] => (
  sessions.filter((session) => sessionMatchesScope(session, scope)).map((session) => claimLegacySession(session, scope))
);

export const repositoryChatStorage = {
  async listSessionsByRepository(repoId: number, scope: RepositoryChatAccountScope): Promise<RepositoryChatSession[]> {
    if (!scope.accountId) return [];
    const fallback = () => scopedSessions(
      fallbackList<RepositoryChatSession>('sessions', (session) => session.repoId === repoId && !session.deletedAt),
      scope,
    ).sort(byUpdatedAtDescending);
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    try {
      return await withTimeout(runTransaction('sessions', 'readonly', async (stores) => {
        const records = await requestValue(stores.sessions.index('repoId').getAll(repoId));
        return scopedSessions((records as RepositoryChatSession[]).filter((session) => !session.deletedAt), scope)
          .sort(byUpdatedAtDescending);
      }));
    } catch (error) {
      console.warn('[repository-chat] session list fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      return fallback();
    }
  },

  async listRecentSessions(
    scope: RepositoryChatAccountScope,
    limit = 50,
    offset = 0,
  ): Promise<RepositoryChatSession[]> {
    if (!scope.accountId) return [];
    const count = Math.max(1, Math.floor(limit));
    const skip = Math.max(0, Math.floor(offset));
    const fallback = () => scopedSessions(readFallback().sessions.filter((session) => !session.deletedAt), scope)
      .sort(byUpdatedAtDescending)
      .slice(skip, skip + count);
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    try {
      return await withTimeout(runTransaction('sessions', 'readonly', async (stores) => {
        const records = await requestValue(stores.sessions.getAll()) as RepositoryChatSession[];
        return scopedSessions(records.filter((session) => !session.deletedAt), scope)
          .sort(byUpdatedAtDescending)
          .slice(skip, skip + count);
      }));
    } catch (error) {
      console.warn('[repository-chat] recent session list fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      return fallback();
    }
  },

  async getSession(sessionId: string, scope: RepositoryChatAccountScope): Promise<RepositoryChatSession | null> {
    if (!scope.accountId) return null;
    const fallback = () => {
      const session = readFallback().sessions.find((item) => item.id === sessionId);
      return session && sessionMatchesScope(session, scope) ? claimLegacySession(session, scope) : null;
    };
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    try {
      return await withTimeout(runTransaction('sessions', 'readonly', async (stores) => {
        const session = (await requestValue(stores.sessions.get(sessionId)) as RepositoryChatSession | undefined) ?? null;
        return session && sessionMatchesScope(session, scope) ? claimLegacySession(session, scope) : null;
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

  async updateSessionMetadata(
    session: RepositoryChatSession,
    scope: RepositoryChatAccountScope,
    options: { titleIfCurrent?: string } = {},
  ): Promise<RepositoryChatSession | null> {
    if (!scope.accountId) return null;
    const merge = (current: RepositoryChatSession | undefined): RepositoryChatSession | null => {
      if (!current || !sessionMatchesScope(current, scope)) return null;
      return {
        ...current,
        accountId: current.accountId ?? scope.accountId!,
        title: options.titleIfCurrent === undefined || current.title === options.titleIfCurrent
          ? session.title
          : current.title,
        modelConfigId: session.modelConfigId,
        modelLabelAtTime: session.modelLabelAtTime,
        updatedAt: Date.parse(current.updatedAt) > Date.parse(session.updatedAt)
          ? current.updatedAt
          : session.updatedAt,
      };
    };
    const fallback = () => {
      const snapshot = readFallback();
      const index = snapshot.sessions.findIndex((item) => item.id === session.id);
      const updated = merge(snapshot.sessions[index]);
      if (!updated) return null;
      snapshot.sessions[index] = updated;
      writeFallback(snapshot);
      return updated;
    };
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    try {
      return await withTimeout(runTransaction('sessions', 'readwrite', async (stores) => {
        const current = await requestValue(stores.sessions.get(session.id)) as RepositoryChatSession | undefined;
        const updated = merge(current);
        if (!updated) return null;
        await requestValue(stores.sessions.put(updated));
        return updated;
      }));
    } catch (error) {
      console.warn('[repository-chat] session metadata write fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      return fallback();
    }
  },

  async claimLegacySessions(
    sessionIds: string[],
    scope: RepositoryChatAccountScope,
  ): Promise<RepositoryChatSession[]> {
    if (!scope.accountId || sessionIds.length === 0) return [];
    const fallback = () => {
      const snapshot = readFallback();
      const claimed: RepositoryChatSession[] = [];
      for (const sessionId of sessionIds) {
        const index = snapshot.sessions.findIndex((item) => item.id === sessionId);
        const session = snapshot.sessions[index];
        if (!session || session.accountId || !sessionMatchesScope(session, scope)) continue;
        const next = { ...session, accountId: scope.accountId! };
        snapshot.sessions[index] = next;
        claimed.push(next);
      }
      if (claimed.length > 0) writeFallback(snapshot);
      return claimed;
    };
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    try {
      return await withTimeout(runTransaction('sessions', 'readwrite', async (stores) => {
        const claimed: RepositoryChatSession[] = [];
        for (const sessionId of sessionIds) {
          const session = await requestValue(stores.sessions.get(sessionId)) as RepositoryChatSession | undefined;
          if (!session || session.accountId || !sessionMatchesScope(session, scope)) continue;
          const next = { ...session, accountId: scope.accountId! };
          await requestValue(stores.sessions.put(next));
          claimed.push(next);
        }
        return claimed;
      }));
    } catch (error) {
      console.warn('[repository-chat] legacy session claim fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      return fallback();
    }
  },

  async renameSession(
    sessionId: string,
    title: string,
    scope: RepositoryChatAccountScope,
  ): Promise<RepositoryChatSession | null> {
    if (!scope.accountId) return null;
    const updatedAt = new Date().toISOString();
    const fallback = () => {
      const snapshot = readFallback();
      const index = snapshot.sessions.findIndex((item) => item.id === sessionId);
      const session = snapshot.sessions[index];
      if (!session || !sessionMatchesScope(session, scope)) return null;
      const updated = { ...session, accountId: session.accountId ?? scope.accountId!, title, updatedAt };
      snapshot.sessions[index] = updated;
      writeFallback(snapshot);
      return updated;
    };
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    try {
      return await withTimeout(runTransaction('sessions', 'readwrite', async (stores) => {
        const session = await requestValue(stores.sessions.get(sessionId)) as RepositoryChatSession | undefined;
        if (!session || !sessionMatchesScope(session, scope)) return null;
        const updated = { ...session, accountId: session.accountId ?? scope.accountId!, title, updatedAt };
        await requestValue(stores.sessions.put(updated));
        return updated;
      }));
    } catch (error) {
      console.warn('[repository-chat] session rename fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      return fallback();
    }
  },

  async purgeExpiredSessions(
    repoId: number,
    retainSessionDays: number,
    scope: RepositoryChatAccountScope,
  ): Promise<void> {
    const cutoff = Date.now() - Math.max(1, retainSessionDays) * 24 * 60 * 60 * 1000;
    const sessions = await this.listSessionsByRepository(repoId, scope);
    await Promise.all(sessions
      .filter((session) => Date.parse(session.updatedAt) < cutoff)
      .map((session) => this.permanentlyDeleteSession(session.id, scope)));
  },

  async purgeEmptySessions(scope: RepositoryChatAccountScope): Promise<void> {
    const cutoff = Date.now() - 60 * 60 * 1000;
    const sessions = await this.listRecentSessions(scope, Number.MAX_SAFE_INTEGER);
    const candidates = sessions.filter((session) => Date.parse(session.createdAt) < cutoff);
    for (let index = 0; index < candidates.length; index += 8) {
      await Promise.all(candidates.slice(index, index + 8).map((session) => (
        this.permanentlyDeleteSession(session.id, scope, { onlyIfEmpty: true })
      )));
    }
  },

  async purgeDeletedSessions(scope: RepositoryChatAccountScope, minimumAgeMs = 10 * 60 * 1000): Promise<void> {
    if (!scope.accountId) return;
    const cutoff = Date.now() - Math.max(0, minimumAgeMs);
    const fallback = () => scopedSessions(readFallback().sessions, scope)
      .filter((session) => session.deletedAt && Date.parse(session.updatedAt) < cutoff);
    let sessions: RepositoryChatSession[];
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      sessions = fallback();
    } else {
      try {
        sessions = await withTimeout(runTransaction('sessions', 'readonly', async (stores) => {
          const records = await requestValue(stores.sessions.getAll()) as RepositoryChatSession[];
          return scopedSessions(records, scope)
            .filter((session) => session.deletedAt && Date.parse(session.updatedAt) < cutoff);
        }));
      } catch (error) {
        console.warn('[repository-chat] deleted-session purge fell back to localStorage', error);
        if (!await transitionToFallbackStorage()) throw error;
        sessions = fallback();
      }
    }
    await Promise.all(sessions.map((session) => (
      this.permanentlyDeleteSession(session.id, scope, { onlyIfDeleted: true })
    )));
  },

  async softDeleteSession(sessionId: string, scope: RepositoryChatAccountScope): Promise<void> {
    if (!scope.accountId) return;
    const updatedAt = new Date().toISOString();
    const fallback = () => {
      const snapshot = readFallback();
      const index = snapshot.sessions.findIndex((item) => item.id === sessionId);
      const session = snapshot.sessions[index];
      if (!session || !sessionMatchesScope(session, scope)) return;
      snapshot.sessions[index] = {
        ...session,
        accountId: session.accountId ?? scope.accountId!,
        deletedAt: updatedAt,
        updatedAt,
      };
      writeFallback(snapshot);
    };
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    try {
      await withTimeout(runTransaction('sessions', 'readwrite', async (stores) => {
        const session = await requestValue(stores.sessions.get(sessionId)) as RepositoryChatSession | undefined;
        if (!session || !sessionMatchesScope(session, scope)) return;
        await requestValue(stores.sessions.put({
          ...session,
          accountId: session.accountId ?? scope.accountId!,
          deletedAt: updatedAt,
          updatedAt,
        }));
      }));
    } catch (error) {
      console.warn('[repository-chat] session delete fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      fallback();
    }
  },

  async restoreSession(sessionId: string, scope: RepositoryChatAccountScope): Promise<RepositoryChatSession | null> {
    if (!scope.accountId) return null;
    const updatedAt = new Date().toISOString();
    const restore = (session: RepositoryChatSession | undefined): RepositoryChatSession | null => {
      if (!session || !sessionMatchesScope(session, scope)) return null;
      return {
        ...session,
        accountId: session.accountId ?? scope.accountId!,
        deletedAt: undefined,
        updatedAt,
      };
    };
    const fallback = () => {
      const snapshot = readFallback();
      const index = snapshot.sessions.findIndex((item) => item.id === sessionId);
      const restored = restore(snapshot.sessions[index]);
      if (!restored) return null;
      snapshot.sessions[index] = restored;
      writeFallback(snapshot);
      return restored;
    };
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    try {
      return await withTimeout(runTransaction('sessions', 'readwrite', async (stores) => {
        const session = await requestValue(stores.sessions.get(sessionId)) as RepositoryChatSession | undefined;
        const restored = restore(session);
        if (!restored) return null;
        await requestValue(stores.sessions.put(restored));
        return restored;
      }));
    } catch (error) {
      console.warn('[repository-chat] session restore fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      return fallback();
    }
  },

  async permanentlyDeleteSession(
    sessionId: string,
    scope: RepositoryChatAccountScope,
    options: { onlyIfEmpty?: boolean; onlyIfDeleted?: boolean } = {},
  ): Promise<void> {
    if (!scope.accountId) return;
    const fallback = () => {
      const snapshot = readFallback();
      const session = snapshot.sessions.find((item) => item.id === sessionId);
      if (!session || !sessionMatchesScope(session, scope)) return;
      if (options.onlyIfDeleted && !session.deletedAt) return;
      if (options.onlyIfEmpty && snapshot.messages.some((item) => item.sessionId === sessionId)) return;
      snapshot.sessions = snapshot.sessions.filter((item) => item.id !== sessionId);
      const removedToolEvents = snapshot.toolEvents.filter((item) => item.sessionId === sessionId);
      const evidenceIds = new Set([
        ...snapshot.messages.filter((item) => item.sessionId === sessionId).flatMap((item) => item.evidenceIds),
        ...removedToolEvents.flatMap((event) => event.evidenceId ? [event.evidenceId] : []),
      ]);
      snapshot.messages = snapshot.messages.filter((item) => item.sessionId !== sessionId);
      snapshot.toolEvents = snapshot.toolEvents.filter((item) => item.sessionId !== sessionId);
      snapshot.evidence = snapshot.evidence.filter((item) => !evidenceIds.has(item.id));
      snapshot.feedback = snapshot.feedback.filter((item) => item.sessionId !== sessionId);
      writeFallback(snapshot);
    };
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    try {
      await withTimeout(runTransaction(['sessions', 'messages', 'toolEvents', 'evidence', 'feedback'], 'readwrite', async (stores) => {
        const current = await requestValue(stores.sessions.get(sessionId)) as RepositoryChatSession | undefined;
        if (!current || !sessionMatchesScope(current, scope)) return;
        if (options.onlyIfDeleted && !current.deletedAt) return;
        if (options.onlyIfEmpty) {
          const messageCount = await requestValue(stores.messages.index('sessionId').count(sessionId));
          if (messageCount > 0) return;
        }
        const messages = options.onlyIfEmpty
          ? []
          : await requestValue(stores.messages.index('sessionId').getAll(sessionId)) as RepositoryChatMessage[];
        await requestValue(stores.sessions.delete(sessionId));
        await Promise.all(messages.map((message) => requestValue(stores.messages.delete(message.id))));
        const toolEvents = await requestValue(stores.toolEvents.index('sessionId').getAll(sessionId)) as RepositoryChatToolEvent[];
        await Promise.all(toolEvents.map((event) => requestValue(stores.toolEvents.delete(event.id))));
        const evidenceIds = new Set([
          ...messages.flatMap((message) => message.evidenceIds),
          ...toolEvents.flatMap((event) => event.evidenceId ? [event.evidenceId] : []),
        ]);
        await Promise.all([...evidenceIds].map((id) => requestValue(stores.evidence.delete(id))));
        const feedback = await requestValue(stores.feedback.index('sessionId').getAll(sessionId)) as RepositoryChatFeedback[];
        await Promise.all(feedback.map((item) => requestValue(stores.feedback.delete(item.messageId))));
      }));
    } catch (error) {
      console.warn('[repository-chat] permanent deletion fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      fallback();
    }
  },

  async listMessages(sessionId: string, scope: RepositoryChatAccountScope): Promise<RepositoryChatMessage[]> {
    if (!await this.getSession(sessionId, scope)) return [];
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
      if (!snapshot.sessions.some((item) => item.id === message.sessionId)) {
        throw new Error(`Repository chat session not found: ${message.sessionId}`);
      }
      const index = snapshot.messages.findIndex((item) => item.id === message.id);
      if (index >= 0) snapshot.messages[index] = message;
      else snapshot.messages.push(message);
      writeFallback(snapshot);
    };
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    let missingSession = false;
    try {
      await withTimeout(runTransaction(['sessions', 'messages'], 'readwrite', async (stores) => {
        const session = await requestValue(stores.sessions.get(message.sessionId));
        if (!session) {
          missingSession = true;
          return;
        }
        await requestValue(stores.messages.put(message));
      }));
    } catch (error) {
      console.warn('[repository-chat] message write fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      fallback();
      return;
    }
    if (missingSession) throw new Error(`Repository chat session not found: ${message.sessionId}`);
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
      snapshot.feedback = snapshot.feedback.filter((item) => !messageIdSet.has(item.messageId));
      writeFallback(snapshot);
    };
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    try {
      await withTimeout(runTransaction(['messages', 'toolEvents', 'evidence', 'feedback'], 'readwrite', async (stores) => {
        const messages = (await Promise.all(messageIds.map(async (id) => await requestValue(stores.messages.get(id)) as RepositoryChatMessage | undefined))).filter((message): message is RepositoryChatMessage => Boolean(message));
        await Promise.all(messageIds.map((id) => requestValue(stores.messages.delete(id))));
        const toolEvents = (await Promise.all(messageIds.map(async (id) => await requestValue(stores.toolEvents.index('messageId').getAll(id)) as RepositoryChatToolEvent[]))).flat();
        await Promise.all(toolEvents.map((event) => requestValue(stores.toolEvents.delete(event.id))));
        const evidenceIds = new Set([
          ...messages.flatMap((message) => message.evidenceIds),
          ...toolEvents.flatMap((event) => event.evidenceId ? [event.evidenceId] : []),
        ]);
        await Promise.all([...evidenceIds].map((id) => requestValue(stores.evidence.delete(id))));
        await Promise.all(messageIds.map((id) => requestValue(stores.feedback.delete(id))));
      }));
    } catch (error) {
      console.warn('[repository-chat] message deletion fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      fallback();
    }
  },

  async deleteMessagesAfter(
    sessionId: string,
    createdAt: string,
    scope: RepositoryChatAccountScope,
  ): Promise<void> {
    const messages = await this.listMessages(sessionId, scope);
    await this.permanentlyDeleteMessages(
      messages.filter((message) => message.createdAt.localeCompare(createdAt) >= 0).map((message) => message.id),
    );
  },

  async listToolEvents(sessionId: string, scope: RepositoryChatAccountScope): Promise<RepositoryChatToolEvent[]> {
    if (!await this.getSession(sessionId, scope)) return [];
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

  async listFeedback(sessionId: string, scope: RepositoryChatAccountScope): Promise<RepositoryChatFeedback[]> {
    if (!await this.getSession(sessionId, scope)) return [];
    const matches = (feedback: RepositoryChatFeedback) => (
      feedback.sessionId === sessionId && feedback.accountId === scope.accountId
    );
    const fallback = () => readFallback().feedback.filter(matches);
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    try {
      return await withTimeout(runTransaction('feedback', 'readonly', async (stores) => {
        const records = await requestValue(stores.feedback.index('sessionId').getAll(sessionId)) as RepositoryChatFeedback[];
        return records.filter(matches);
      }));
    } catch (error) {
      console.warn('[repository-chat] feedback read fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      return fallback();
    }
  },

  async saveFeedback(feedback: RepositoryChatFeedback, scope: RepositoryChatAccountScope): Promise<void> {
    if (!scope.accountId || feedback.accountId !== scope.accountId) {
      throw new Error('Repository chat feedback account is inaccessible');
    }
    const fallback = () => {
      const snapshot = readFallback();
      const session = snapshot.sessions.find((item) => item.id === feedback.sessionId);
      if (!session || !sessionMatchesScope(session, scope)) {
        throw new Error('Repository chat feedback session is inaccessible');
      }
      const index = snapshot.feedback.findIndex((item) => item.messageId === feedback.messageId);
      if (index >= 0) snapshot.feedback[index] = feedback;
      else snapshot.feedback.push(feedback);
      writeFallback(snapshot);
    };
    if (useFallbackStorage || !canUseIndexedDb()) {
      enableFallbackStorage();
      return fallback();
    }
    let inaccessible = false;
    try {
      await withTimeout(runTransaction(['sessions', 'feedback'], 'readwrite', async (stores) => {
        const session = await requestValue(stores.sessions.get(feedback.sessionId)) as RepositoryChatSession | undefined;
        if (!session || !sessionMatchesScope(session, scope)) {
          inaccessible = true;
          return;
        }
        await requestValue(stores.feedback.put(feedback));
      }));
    } catch (error) {
      console.warn('[repository-chat] feedback write fell back to localStorage', error);
      if (!await transitionToFallbackStorage()) throw error;
      fallback();
      return;
    }
    if (inaccessible) throw new Error('Repository chat feedback session is inaccessible');
  },
};
