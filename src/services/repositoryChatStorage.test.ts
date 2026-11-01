import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { repositoryChatStorage } from './repositoryChatStorage';
import type { RepositoryChatFeedback, RepositoryChatMessage, RepositoryChatSession, RepositoryChatToolEvent, ToolEvidence } from '../types/repositoryChat';

const scopeA = { accountId: 'account-a', accountLogin: 'alice' };
const scopeB = { accountId: 'account-b', accountLogin: 'bob' };

const createSession = (id: string, repoId: number, updatedAt: string, accountId = scopeA.accountId): RepositoryChatSession => ({
  id,
  repoId,
  accountId,
  repoFullName: `owner/repository-${repoId}`,
  sourceRefSha: 'abcdef1234567890',
  title: id,
  createdAt: updatedAt,
  updatedAt,
});

const createMessage = (id: string, sessionId: string, evidenceIds: string[] = []): RepositoryChatMessage => ({
  id,
  sessionId,
  role: 'assistant',
  content: 'Answer',
  status: 'complete',
  evidenceIds,
  createdAt: '2026-08-26T00:00:00.000Z',
});

const createToolEvent = (sessionId: string, evidenceId?: string): RepositoryChatToolEvent => ({
  id: `tool-${sessionId}`,
  sessionId,
  messageId: `message-${sessionId}`,
  toolName: 'read_repo_readme',
  status: 'success',
  paramSummary: 'README.md',
  ...(evidenceId ? { evidenceId } : {}),
  createdAt: '2026-08-26T00:00:00.000Z',
});

const createEvidence = (id: string): ToolEvidence => ({
  id,
  source: 'github',
  repoFullName: 'owner/repository-1',
  refSha: 'abcdef1234567890',
  path: 'README.md',
  lineStart: 1,
  lineEnd: 2,
  url: 'https://github.com/owner/repository-1/blob/abcdef1234567890/README.md#L1-L2',
  excerpt: 'README',
  retrievedAt: '2026-08-26T00:00:00.000Z',
});

const createFeedback = (
  sessionId: string,
  messageId: string,
  accountId = scopeA.accountId,
  rating: RepositoryChatFeedback['rating'] = 'up',
): RepositoryChatFeedback => ({
  id: messageId,
  messageId,
  sessionId,
  accountId,
  rating,
  createdAt: '2026-08-26T00:00:00.000Z',
});

const fallbackMessages = (): RepositoryChatMessage[] => {
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key) continue;
    try {
      const value = JSON.parse(window.localStorage.getItem(key) ?? '') as { messages?: unknown };
      if (Array.isArray(value.messages)) return value.messages as RepositoryChatMessage[];
    } catch {
      // Not the repository-chat fallback snapshot.
    }
  }
  return [];
};

describe('repositoryChatStorage local fallback', () => {
  const originalIndexedDb = Object.getOwnPropertyDescriptor(window, 'indexedDB');
  const originalLocalStorage = Object.getOwnPropertyDescriptor(window, 'localStorage');

  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalIndexedDb) Object.defineProperty(window, 'indexedDB', originalIndexedDb);
    else delete (window as { indexedDB?: IDBFactory }).indexedDB;
    if (originalLocalStorage) Object.defineProperty(window, 'localStorage', originalLocalStorage);
  });

  it('filters, orders, and soft-deletes sessions strictly within the selected repository', async () => {
    await repositoryChatStorage.saveSession(createSession('older', 1, '2026-08-24T00:00:00.000Z'));
    await repositoryChatStorage.saveSession(createSession('other-repository', 2, '2026-08-26T00:00:00.000Z'));
    await repositoryChatStorage.saveSession(createSession('newer', 1, '2026-08-25T00:00:00.000Z'));

    await expect(repositoryChatStorage.listSessionsByRepository(1, scopeA)).resolves.toMatchObject([
      { id: 'newer', repoId: 1 },
      { id: 'older', repoId: 1 },
    ]);

    await repositoryChatStorage.softDeleteSession('newer', scopeA);
    await expect(repositoryChatStorage.listSessionsByRepository(1, scopeA)).resolves.toMatchObject([
      { id: 'older', repoId: 1 },
    ]);
    await expect(repositoryChatStorage.listSessionsByRepository(2, scopeA)).resolves.toMatchObject([
      { id: 'other-repository', repoId: 2 },
    ]);
  });

  it('purges expired sessions for the active repository while retaining current sessions', async () => {
    await repositoryChatStorage.saveSession(createSession('expired', 1, '2026-01-01T00:00:00.000Z'));
    await repositoryChatStorage.saveSession(createSession('current', 1, new Date().toISOString()));

    await repositoryChatStorage.purgeExpiredSessions(1, 1, scopeA);

    await expect(repositoryChatStorage.getSession('expired', scopeA)).resolves.toBeNull();
    await expect(repositoryChatStorage.getSession('current', scopeA)).resolves.toMatchObject({ id: 'current' });
  });

  it('physically deletes all messages, tool events, and evidence connected to the deleted session', async () => {
    const session = createSession('session-1', 1, '2026-08-26T00:00:00.000Z');
    const messageEvidence = createEvidence('message-evidence');
    const toolEvidence = createEvidence('tool-evidence');
    await repositoryChatStorage.saveSession(session);
    await repositoryChatStorage.saveMessage(createMessage('message-1', session.id, [messageEvidence.id]));
    await repositoryChatStorage.saveToolEvent(createToolEvent(session.id, toolEvidence.id));
    await repositoryChatStorage.saveEvidence(messageEvidence);
    await repositoryChatStorage.saveEvidence(toolEvidence);

    await repositoryChatStorage.permanentlyDeleteSession(session.id, scopeA);

    await expect(repositoryChatStorage.getSession(session.id, scopeA)).resolves.toBeNull();
    await expect(repositoryChatStorage.listMessages(session.id, scopeA)).resolves.toEqual([]);
    await expect(repositoryChatStorage.listToolEvents(session.id, scopeA)).resolves.toEqual([]);
    await expect(repositoryChatStorage.listEvidence([messageEvidence.id, toolEvidence.id])).resolves.toEqual([]);
  });

  it('only purges a session when the empty-session cleanup confirms it has no messages', async () => {
    const session = createSession('non-empty', 1, new Date().toISOString());
    await repositoryChatStorage.saveSession(session);
    await repositoryChatStorage.saveMessage(createMessage('message-1', session.id));

    await repositoryChatStorage.permanentlyDeleteSession(session.id, scopeA, { onlyIfEmpty: true });

    await expect(repositoryChatStorage.getSession(session.id, scopeA)).resolves.toMatchObject({ id: session.id });
  });

  it('rejects writes to a session that no longer exists', async () => {
    await expect(repositoryChatStorage.saveMessage(createMessage('orphan', 'missing-session')))
      .rejects.toThrow('Repository chat session not found: missing-session');
  });

  it('renames from the latest persisted session instead of a stale full snapshot', async () => {
    const session = createSession('rename-me', 1, new Date().toISOString());
    await repositoryChatStorage.saveSession(session);
    await repositoryChatStorage.saveSession({
      ...session,
      modelConfigId: 'newer-config',
      modelLabelAtTime: 'Newer model',
    });

    const renamed = await repositoryChatStorage.renameSession('rename-me', 'New title', scopeA);

    expect(renamed).toMatchObject({
      title: 'New title',
      modelConfigId: 'newer-config',
      modelLabelAtTime: 'Newer model',
    });
  });

  it('preserves a concurrent rename when metadata is written from a stale snapshot', async () => {
    const session = createSession('metadata-race', 1, new Date().toISOString());
    await repositoryChatStorage.saveSession(session);
    await repositoryChatStorage.renameSession(session.id, 'Renamed by user', scopeA);
    const renamed = await repositoryChatStorage.getSession(session.id, scopeA);

    const updated = await repositoryChatStorage.updateSessionMetadata({
      ...session,
      title: 'Old title',
      modelConfigId: 'model-2',
      modelLabelAtTime: 'Model 2',
      updatedAt: new Date(Date.now() - 1000).toISOString(),
    }, scopeA, { titleIfCurrent: 'Old title' });

    expect(updated).toMatchObject({
      title: 'Renamed by user',
      modelConfigId: 'model-2',
      modelLabelAtTime: 'Model 2',
      updatedAt: renamed?.updatedAt,
    });
  });

  it('lists recent sessions across repositories in recency order with a limit', async () => {
    await repositoryChatStorage.saveSession(createSession('repo1-older', 1, '2026-08-24T00:00:00.000Z'));
    await repositoryChatStorage.saveSession(createSession('repo2-newer', 2, '2026-08-26T00:00:00.000Z'));
    await repositoryChatStorage.saveSession(createSession('repo1-middle', 1, '2026-08-25T00:00:00.000Z'));

    await expect(repositoryChatStorage.listRecentSessions(scopeA, 2)).resolves.toMatchObject([
      { id: 'repo2-newer', repoId: 2 },
      { id: 'repo1-middle', repoId: 1 },
    ]);
    await expect(repositoryChatStorage.listRecentSessions(scopeA)).resolves.toMatchObject([
      { id: 'repo2-newer', repoId: 2 },
      { id: 'repo1-middle', repoId: 1 },
      { id: 'repo1-older', repoId: 1 },
    ]);

    await repositoryChatStorage.softDeleteSession('repo2-newer', scopeA);
    await expect(repositoryChatStorage.listRecentSessions(scopeA)).resolves.toMatchObject([
      { id: 'repo1-middle', repoId: 1 },
      { id: 'repo1-older', repoId: 1 },
    ]);
  });

  it('partitions lists, reads, messages, and deletes by account id', async () => {
    await repositoryChatStorage.saveSession(createSession('alice-session', 1, '2026-08-26T00:00:00.000Z'));
    await repositoryChatStorage.saveSession(createSession('bob-session', 1, '2026-08-27T00:00:00.000Z', scopeB.accountId));
    await repositoryChatStorage.saveMessage(createMessage('bob-message', 'bob-session'));

    await expect(repositoryChatStorage.listRecentSessions(scopeA)).resolves.toMatchObject([{ id: 'alice-session' }]);
    await expect(repositoryChatStorage.listSessionsByRepository(1, scopeA)).resolves.toMatchObject([{ id: 'alice-session' }]);
    await expect(repositoryChatStorage.getSession('bob-session', scopeA)).resolves.toBeNull();
    await expect(repositoryChatStorage.listMessages('bob-session', scopeA)).resolves.toEqual([]);

    await repositoryChatStorage.permanentlyDeleteSession('bob-session', scopeA);
    await expect(repositoryChatStorage.getSession('bob-session', scopeB)).resolves.toMatchObject({ id: 'bob-session' });
  });

  it('claims a legacy login-tagged session for the active account but hides untagged rows', async () => {
    await repositoryChatStorage.saveSession({
      ...createSession('legacy-tagged', 1, '2026-08-26T00:00:00.000Z'),
      accountId: undefined,
      accountLogin: 'alice',
    });
    await repositoryChatStorage.saveSession({
      ...createSession('legacy-untagged', 1, '2026-08-27T00:00:00.000Z'),
      accountId: undefined,
      accountLogin: undefined,
    });

    await expect(repositoryChatStorage.listRecentSessions(scopeA)).resolves.toMatchObject([
      { id: 'legacy-tagged', accountId: scopeA.accountId },
    ]);
    await expect(repositoryChatStorage.getSession('legacy-tagged', scopeA)).resolves.toMatchObject({
      id: 'legacy-tagged',
      accountId: scopeA.accountId,
    });
    await expect(repositoryChatStorage.getSession('legacy-untagged', scopeA)).resolves.toBeNull();
  });

  it('partitions feedback by session and account', async () => {
    await repositoryChatStorage.saveSession(createSession('alice-session', 1, '2026-08-26T00:00:00.000Z'));
    await repositoryChatStorage.saveSession(createSession('bob-session', 1, '2026-08-27T00:00:00.000Z', scopeB.accountId));

    await repositoryChatStorage.saveFeedback(createFeedback('alice-session', 'alice-message'), scopeA);
    await repositoryChatStorage.saveFeedback(createFeedback('bob-session', 'bob-message', scopeB.accountId, 'down'), scopeB);
    await expect(repositoryChatStorage.saveFeedback(createFeedback('bob-session', 'forged-message'), scopeA))
      .rejects.toThrow('Repository chat feedback session is inaccessible');

    await expect(repositoryChatStorage.listFeedback('alice-session', scopeA)).resolves.toMatchObject([
      { messageId: 'alice-message', accountId: scopeA.accountId, rating: 'up' },
    ]);
    await expect(repositoryChatStorage.listFeedback('bob-session', scopeB)).resolves.toMatchObject([
      { messageId: 'bob-message', accountId: scopeB.accountId, rating: 'down' },
    ]);
    await expect(repositoryChatStorage.listFeedback('bob-session', scopeA)).resolves.toEqual([]);
  });

  it('removes feedback when its message is permanently deleted', async () => {
    const session = createSession('alice-session', 1, '2026-08-26T00:00:00.000Z');
    await repositoryChatStorage.saveSession(session);
    await repositoryChatStorage.saveMessage(createMessage('alice-message', session.id));
    await repositoryChatStorage.saveFeedback(createFeedback(session.id, 'alice-message'), scopeA);

    await repositoryChatStorage.permanentlyDeleteMessages(['alice-message']);

    await expect(repositoryChatStorage.listFeedback(session.id, scopeA)).resolves.toEqual([]);
  });

  it('purges abandoned soft-deleted sessions and their payloads', async () => {
    const session = {
      ...createSession('deleted-session', 1, '2026-08-26T00:00:00.000Z'),
      deletedAt: '2026-08-26T00:00:00.000Z',
      updatedAt: '2026-08-26T00:00:00.000Z',
    };
    await repositoryChatStorage.saveSession(session);
    await repositoryChatStorage.saveMessage(createMessage('deleted-message', session.id));
    expect(fallbackMessages()).toHaveLength(1);

    await repositoryChatStorage.purgeDeletedSessions(scopeA, 0);

    await expect(repositoryChatStorage.getSession(session.id, scopeA)).resolves.toBeNull();
    expect(fallbackMessages()).toHaveLength(0);
  });

  it('rejects fallback writes when localStorage persistence is unavailable', async () => {
    // 直接把 window.localStorage 换成抛错桩：不同平台的 jsdom 对 Storage 原型/
    // 实例方法的实现有差异，逐方法 spy 在 CI（Linux）上不可靠。
    const storageError = () => { throw new DOMException('storage is unavailable'); };
    const throwingStorage = {
      getItem: storageError,
      setItem: storageError,
      removeItem: storageError,
      clear: storageError,
      key: storageError,
      get length() { throw new DOMException('storage is unavailable'); },
    };
    Object.defineProperty(window, 'localStorage', { configurable: true, value: throwingStorage });

    await expect(repositoryChatStorage.saveSession(createSession('cannot-persist', 1, '2026-08-26T00:00:00.000Z')))
      .rejects.toThrow('unable to persist fallback snapshot');
  });
});
