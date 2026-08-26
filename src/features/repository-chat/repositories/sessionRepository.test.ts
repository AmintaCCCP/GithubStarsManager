import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { repositoryChatSessionRepository } from './sessionRepository';
import type { RepositoryChatMessage, RepositoryChatSession, RepositoryChatToolEvent, ToolEvidence } from '../../../types/repositoryChat';

const createSession = (id: string, repoId: number, updatedAt: string): RepositoryChatSession => ({
  id,
  repoId,
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

describe('repositoryChatSessionRepository local fallback', () => {
  const originalIndexedDb = Object.getOwnPropertyDescriptor(window, 'indexedDB');

  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalIndexedDb) Object.defineProperty(window, 'indexedDB', originalIndexedDb);
    else delete (window as { indexedDB?: IDBFactory }).indexedDB;
  });

  it('filters, orders, and soft-deletes sessions strictly within the selected repository', async () => {
    await repositoryChatSessionRepository.saveSession(createSession('older', 1, '2026-08-24T00:00:00.000Z'));
    await repositoryChatSessionRepository.saveSession(createSession('other-repository', 2, '2026-08-26T00:00:00.000Z'));
    await repositoryChatSessionRepository.saveSession(createSession('newer', 1, '2026-08-25T00:00:00.000Z'));

    await expect(repositoryChatSessionRepository.listSessionsByRepository(1)).resolves.toMatchObject([
      { id: 'newer', repoId: 1 },
      { id: 'older', repoId: 1 },
    ]);

    await repositoryChatSessionRepository.softDeleteSession('newer');
    await expect(repositoryChatSessionRepository.listSessionsByRepository(1)).resolves.toMatchObject([
      { id: 'older', repoId: 1 },
    ]);
    await expect(repositoryChatSessionRepository.listSessionsByRepository(2)).resolves.toMatchObject([
      { id: 'other-repository', repoId: 2 },
    ]);
  });

  it('purges expired sessions for the active repository while retaining current sessions', async () => {
    await repositoryChatSessionRepository.saveSession(createSession('expired', 1, '2026-01-01T00:00:00.000Z'));
    await repositoryChatSessionRepository.saveSession(createSession('current', 1, new Date().toISOString()));

    await repositoryChatSessionRepository.purgeExpiredSessions(1, 1);

    await expect(repositoryChatSessionRepository.getSession('expired')).resolves.toBeNull();
    await expect(repositoryChatSessionRepository.getSession('current')).resolves.toMatchObject({ id: 'current' });
  });

  it('physically deletes all messages, tool events, and evidence connected to the deleted session', async () => {
    const session = createSession('session-1', 1, '2026-08-26T00:00:00.000Z');
    const messageEvidence = createEvidence('message-evidence');
    const toolEvidence = createEvidence('tool-evidence');
    await repositoryChatSessionRepository.saveSession(session);
    await repositoryChatSessionRepository.saveMessage(createMessage('message-1', session.id, [messageEvidence.id]));
    await repositoryChatSessionRepository.saveToolEvent(createToolEvent(session.id, toolEvidence.id));
    await repositoryChatSessionRepository.saveEvidence(messageEvidence);
    await repositoryChatSessionRepository.saveEvidence(toolEvidence);

    await repositoryChatSessionRepository.permanentlyDeleteSession(session.id);

    await expect(repositoryChatSessionRepository.getSession(session.id)).resolves.toBeNull();
    await expect(repositoryChatSessionRepository.listMessages(session.id)).resolves.toEqual([]);
    await expect(repositoryChatSessionRepository.listToolEvents(session.id)).resolves.toEqual([]);
    await expect(repositoryChatSessionRepository.listEvidence([messageEvidence.id, toolEvidence.id])).resolves.toEqual([]);
  });

  it('rejects fallback writes when localStorage persistence is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('storage is unavailable');
    });

    await expect(repositoryChatSessionRepository.saveSession(createSession('cannot-persist', 1, '2026-08-26T00:00:00.000Z')))
      .rejects.toThrow('unable to persist fallback snapshot');
  });
});
