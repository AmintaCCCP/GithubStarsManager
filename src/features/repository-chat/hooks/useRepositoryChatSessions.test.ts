import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRepositoryChatSessions } from './useRepositoryChatSessions';
import { repositoryChatStorage } from '../../../services/repositoryChatStorage';
import type { Repository } from '../../../types';
import type { RepositoryChatMessage } from '../../../types/repositoryChat';

const mocks = vi.hoisted(() => ({
  appState: {} as Record<string, unknown>,
}));

vi.mock('../../../store/useAppStore', () => {
  return {
    useAppStore: Object.assign(
      (selector: (value: Record<string, unknown>) => unknown) => selector(mocks.appState),
      { getState: () => mocks.appState },
    ),
  };
});

const repository = {
  id: 1,
  full_name: 'owner/repo-one',
  description: 'demo description',
  html_url: 'https://github.com/owner/repo-one',
  language: 'TypeScript',
  owner: { login: 'owner', avatar_url: 'https://example.com/avatar.png' },
} as unknown as Repository;

describe('useRepositoryChatSessions global history notification', () => {
  beforeEach(() => {
    mocks.appState = {
      language: 'zh',
      githubToken: 'test-token',
      user: { id: 42, login: 'test-user' },
      repositoryChatSettings: { retainSessionDays: 90 },
    };
    window.localStorage.clear();
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mocks.appState = {};
  });

  it('创建会话后派发全局历史刷新事件', async () => {
    const dispatchSpy = vi.fn();
    window.addEventListener('gsm:global-chat-history-changed', dispatchSpy);
    try {
      const { result } = renderHook(() =>
        useRepositoryChatSessions({
          repository,
          language: 'zh',
          resolveSourceRefSha: async () => 'abc123def456',
        }),
      );

      let sessionId = '';
      await act(async () => {
        sessionId = (await result.current.createSession())?.id ?? '';
      });

      expect(sessionId).toBeTruthy();
      const saved = await repositoryChatStorage.getSession(sessionId, { accountId: '42', accountLogin: 'test-user' });
      expect(saved?.accountId).toBe('42');
      expect(saved?.repoSnapshot).toEqual({
        ownerLogin: 'owner',
        ownerAvatarUrl: 'https://example.com/avatar.png',
        htmlUrl: 'https://github.com/owner/repo-one',
        description: 'demo description',
        language: 'TypeScript',
      });
      expect(dispatchSpy).toHaveBeenCalled();
    } finally {
      window.removeEventListener('gsm:global-chat-history-changed', dispatchSpy);
    }
  });

  it('删除会话后派发全局历史刷新事件', async () => {
    const dispatchSpy = vi.fn();
    window.addEventListener('gsm:global-chat-history-changed', dispatchSpy);
    try {
      const { result } = renderHook(() =>
        useRepositoryChatSessions({
          repository,
          language: 'zh',
          resolveSourceRefSha: async () => 'abc123def456',
        }),
      );

      let sessionId = '';
      await act(async () => {
        sessionId = (await result.current.createSession())?.id ?? '';
      });
      dispatchSpy.mockClear();

      await act(async () => {
        await result.current.deleteSession(sessionId);
      });
      expect(dispatchSpy).toHaveBeenCalled();
    } finally {
      window.removeEventListener('gsm:global-chat-history-changed', dispatchSpy);
    }
  });

  it('切换会话时先清空旧消息并保持加载态，避免在错误会话下显示旧回答', async () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const at = (offsetMs: number) => new Date(now + offsetMs).toISOString();
    const base = {
      repoId: repository.id,
      accountId: '42',
      accountLogin: 'test-user',
      repoFullName: repository.full_name,
      sourceRefSha: 'abc123def456',
      title: 'Session',
      createdAt: at(-3 * day),
      updatedAt: at(-3 * day),
    };
    await repositoryChatStorage.saveSession({ ...base, id: 'older', updatedAt: at(-2 * day) });
    await repositoryChatStorage.saveSession({ ...base, id: 'newer', updatedAt: at(-day) });
    await repositoryChatStorage.saveMessage({
      id: 'older-message',
      sessionId: 'older',
      role: 'assistant',
      content: 'Older answer',
      status: 'complete',
      evidenceIds: [],
      createdAt: at(-2 * day + 1000),
    });
    await repositoryChatStorage.saveMessage({
      id: 'newer-message',
      sessionId: 'newer',
      role: 'assistant',
      content: 'Newest answer',
      status: 'complete',
      evidenceIds: [],
      createdAt: at(-day + 1000),
    });

    const { result } = renderHook(() => useRepositoryChatSessions({
      repository,
      language: 'zh',
      resolveSourceRefSha: async () => 'abc123def456',
    }));
    await waitFor(() => expect(result.current.sessions).toHaveLength(2));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    const olderMessage: RepositoryChatMessage = {
      id: 'older-message',
      sessionId: 'older',
      role: 'assistant',
      content: 'Older answer after switch',
      status: 'complete',
      evidenceIds: [],
      createdAt: at(-2 * day + 2000),
    };
    let resolveMessages!: (messages: RepositoryChatMessage[]) => void;
    vi.spyOn(repositoryChatStorage, 'listMessages').mockReturnValueOnce(new Promise((resolve) => {
      resolveMessages = resolve;
    }));
    let selecting!: Promise<boolean>;
    await act(async () => {
      selecting = result.current.selectSession('older');
      await Promise.resolve();
    });

    expect(result.current.activeSession?.id).toBe('older');
    expect(result.current.messages).toEqual([]);
    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      resolveMessages([olderMessage]);
      await selecting;
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.messages).toEqual([olderMessage]);
  });

  it('retries an initial message load once after storage recovers', async () => {
    const at = new Date().toISOString();
    await repositoryChatStorage.saveSession({
      id: 'retry-session',
      repoId: repository.id,
      accountId: '42',
      accountLogin: 'test-user',
      repoFullName: repository.full_name,
      sourceRefSha: 'abc123def456',
      title: 'Retry session',
      createdAt: at,
      updatedAt: at,
    });
    const message: RepositoryChatMessage = {
      id: 'retry-message',
      sessionId: 'retry-session',
      role: 'assistant',
      content: 'Recovered answer',
      status: 'complete',
      evidenceIds: [],
      createdAt: at,
    };
    const { result } = renderHook(() => useRepositoryChatSessions({
      repository,
      language: 'zh',
      resolveSourceRefSha: async () => 'abc123def456',
    }));
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));
    vi.spyOn(repositoryChatStorage, 'listMessages')
      .mockRejectedValueOnce(new Error('storage temporarily unavailable'))
      .mockResolvedValueOnce([message]);

    let selected = false;
    await act(async () => {
      selected = await result.current.selectSession('retry-session');
    });

    expect(selected).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.messages).toEqual([message]);
  });

  it('登录态消失时结束加载，不把上一账号的刷新状态锁死', async () => {
    vi.spyOn(repositoryChatStorage, 'purgeExpiredSessions').mockReturnValueOnce(new Promise(() => undefined));
    const { result, rerender } = renderHook(() => useRepositoryChatSessions({
      repository,
      language: 'zh',
      resolveSourceRefSha: async () => 'abc123def456',
    }));
    await waitFor(() => expect(result.current.isLoading).toBe(true));

    mocks.appState = { ...mocks.appState, user: null };
    rerender();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.sessions).toEqual([]);
    expect(result.current.messages).toEqual([]);
  });
});
