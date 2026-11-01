import { IDBFactory, IDBIndex } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepositoryChatFeedback, RepositoryChatMessage, RepositoryChatSession } from '../types/repositoryChat';

const scope = { accountId: 'account-a', accountLogin: 'alice' };
const DB_NAME = 'gsm-repository-chat-db';

const createSession = (id: string): RepositoryChatSession => ({
  id,
  repoId: 1,
  accountId: scope.accountId,
  repoFullName: 'owner/repository',
  sourceRefSha: 'abcdef1234567890',
  title: id,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const createMessage = (id: string, sessionId: string): RepositoryChatMessage => ({
  id,
  sessionId,
  role: 'assistant',
  content: 'Answer',
  status: 'complete',
  evidenceIds: [],
  createdAt: new Date().toISOString(),
});

const countStore = (storeName: 'messages' | 'feedback'): Promise<number> => new Promise((resolve, reject) => {
  const request = window.indexedDB.open(DB_NAME);
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const db = request.result;
    const transaction = db.transaction(storeName, 'readonly');
    const countRequest = transaction.objectStore(storeName).count();
    countRequest.onsuccess = () => resolve(countRequest.result);
    countRequest.onerror = () => reject(countRequest.error);
    transaction.oncomplete = () => db.close();
  };
});

describe('repositoryChatStorage IndexedDB invariants', () => {
  let storage: typeof import('./repositoryChatStorage').repositoryChatStorage;

  beforeEach(async () => {
    vi.resetModules();
    window.localStorage.clear();
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: new IDBFactory() });
    ({ repositoryChatStorage: storage } = await import('./repositoryChatStorage'));
  });

  afterEach(() => {
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined });
  });

  it('does not delete a session that gained a message before empty-session cleanup', async () => {
    const session = createSession('raced-empty-session');
    await storage.saveSession(session);
    await storage.saveMessage(createMessage('message-1', session.id));

    await storage.permanentlyDeleteSession(session.id, scope, { onlyIfEmpty: true });

    await expect(storage.getSession(session.id, scope)).resolves.toMatchObject({ id: session.id });
    await expect(countStore('messages')).resolves.toBe(1);
  });

  it('checks emptiness in the same readwrite transaction as deletion', async () => {
    const session = createSession('transactional-empty-session');
    await storage.saveSession(session);
    const originalCount = IDBIndex.prototype.count;
    const countTransactions: IDBTransaction[] = [];
    const countSpy = vi.spyOn(IDBIndex.prototype, 'count').mockImplementation(function (this: IDBIndex) {
      if (this.name === 'sessionId') {
        countTransactions.push(this.objectStore.transaction);
        this.objectStore.transaction.objectStore('messages')
          .put(createMessage('interleaved-message', session.id));
      }
      return originalCount.call(this);
    });

    await storage.permanentlyDeleteSession(session.id, scope, { onlyIfEmpty: true });

    expect(countTransactions).toHaveLength(1);
    expect(countTransactions[0]!.mode).toBe('readwrite');
    expect(Array.from(countTransactions[0]!.objectStoreNames)).toContain('sessions');
    await expect(storage.getSession(session.id, scope)).resolves.toMatchObject({ id: session.id });
    await expect(countStore('messages')).resolves.toBe(1);
    countSpy.mockRestore();
  });

  it('rejects a message write after its session was deleted', async () => {
    await expect(storage.saveMessage(createMessage('orphan-message', 'missing-session')))
      .rejects.toThrow('Repository chat session not found: missing-session');
    await expect(countStore('messages')).resolves.toBe(0);
  });

  it('deletes feedback by its messageId key when the feedback id differs', async () => {
    const session = createSession('feedback-session');
    const feedback: RepositoryChatFeedback = {
      id: 'feedback-record',
      messageId: 'message-1',
      sessionId: session.id,
      accountId: scope.accountId,
      rating: 'up',
      createdAt: new Date().toISOString(),
    };
    await storage.saveSession(session);
    await storage.saveFeedback(feedback, scope);

    await storage.permanentlyDeleteSession(session.id, scope);

    await expect(countStore('feedback')).resolves.toBe(0);
  });

  it('does not let a stale final-delete timer remove a restored session', async () => {
    const session = createSession('restored-session');
    await storage.saveSession(session);
    await storage.saveMessage(createMessage('restored-message', session.id));
    await storage.softDeleteSession(session.id, scope);
    await expect(storage.restoreSession(session.id, scope)).resolves.toMatchObject({ id: session.id });

    await storage.permanentlyDeleteSession(session.id, scope, { onlyIfDeleted: true });

    await expect(storage.getSession(session.id, scope)).resolves.toMatchObject({ id: session.id });
    await expect(countStore('messages')).resolves.toBe(1);
  });
});
