import { makeT } from '../../../i18n/useT';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGitHubTokenActions } from './useGitHubTokenActions';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  setUser: vi.fn(),
  setGitHubToken: vi.fn(),
  toast: vi.fn(),
  syncSettings: vi.fn(),
  backend: { isAvailable: false, syncSettings: vi.fn() },
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    user: { id: 1, login: 'octocat', name: 'Octo', avatar_url: '', email: null },
    setUser: mocks.setUser,
    setGitHubToken: mocks.setGitHubToken,
  }),
}));
vi.mock('../../../hooks/useDialog', () => ({
  useDialog: () => ({ toast: mocks.toast }),
}));
vi.mock('../../../services/githubApi', () => ({
  GITHUB_TOKEN_INVALID_ERROR: 'GitHub token expired or invalid',
  GitHubApiService: class {
    getCurrentUser() {
      return mocks.getCurrentUser();
    }
  },
}));
vi.mock('../../../services/backendAdapter', () => ({ backend: mocks.backend }));

describe('useGitHubTokenActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.backend.isAvailable = false;
    mocks.getCurrentUser.mockResolvedValue({ id: 1, login: 'octocat', name: 'Octo', avatar_url: '', email: null });
  });

  it('updates the token for the same GitHub user without logging out', async () => {
    const { result } = renderHook(() => useGitHubTokenActions({ t: makeT('zh', 'settings') }));
    act(() => result.current.setTokenInput('ghp_new'));

    await act(async () => {
      await result.current.updateToken();
    });

    expect(mocks.setGitHubToken).toHaveBeenCalledWith('ghp_new');
    expect(mocks.setUser).toHaveBeenCalledWith(expect.objectContaining({ id: 1, login: 'octocat' }));
    expect(mocks.toast).toHaveBeenCalledWith('GitHub Token 已更新', 'success');
    expect(result.current.tokenInput).toBe('');
  });

  it('refuses a token that belongs to a different GitHub account', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 2, login: 'other', name: 'Other', avatar_url: '', email: null });
    const { result } = renderHook(() => useGitHubTokenActions({ t: makeT('zh', 'settings') }));
    act(() => result.current.setTokenInput('ghp_other'));

    await act(async () => {
      await result.current.updateToken();
    });

    expect(mocks.setGitHubToken).not.toHaveBeenCalled();
    expect(mocks.setUser).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('other'), 'error');
  });
});
