import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRepositoryChatSessions } from './useRepositoryChatSessions';
import { repositoryChatStorage } from '../../../services/repositoryChatStorage';
import type { Repository } from '../../../types';

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: Object.assign(
    (selector: (state: { githubToken: string; repositoryChatSettings: { retainSessionDays: number } }) => unknown) =>
      selector({ githubToken: 'test-token', repositoryChatSettings: { retainSessionDays: 90 } }),
    { getState: () => ({ user: { login: 'test-user' } }) },
  ),
}));

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
    window.localStorage.clear();
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined });
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
      const saved = await repositoryChatStorage.getSession(sessionId);
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
});
