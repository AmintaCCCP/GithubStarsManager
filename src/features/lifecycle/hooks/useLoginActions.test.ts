import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiTokens: [] as string[],
  getCurrentUser: vi.fn(),
  syncFromBackend: vi.fn(),
  backend: {
    configuredUrl: 'https://backend.example/api',
    init: vi.fn(),
    isAvailable: true,
    verifyAuth: vi.fn(),
    restoreAuth: vi.fn(),
    syncSettings: vi.fn(),
  },
}));

vi.mock('../../../services/githubApi', () => ({
  GitHubApiService: class {
    constructor(token: string) {
      mocks.apiTokens.push(token);
    }

    getCurrentUser() {
      return mocks.getCurrentUser();
    }
  },
}));
vi.mock('../../../services/backendAdapter', () => ({ backend: mocks.backend }));
vi.mock('../../../services/autoSync', () => ({ syncFromBackend: mocks.syncFromBackend }));

import { useLoginActions } from './useLoginActions';

const user = { id: 1, login: 'octocat' };

describe('useLoginActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiTokens.splice(0);
    mocks.backend.isAvailable = true;
    mocks.backend.verifyAuth.mockResolvedValue(true);
    mocks.backend.restoreAuth.mockResolvedValue({ github_token: 'ghp_restored' });
    mocks.getCurrentUser.mockResolvedValue(user);
  });

  it('restores a GitHub session from an authenticated backend', async () => {
    const { result } = renderHook(() => useLoginActions());

    let restored;
    await act(async () => {
      restored = await result.current.restoreBackendSession('https://backend.example');
    });

    expect(result.current.configuredBackendUrl).toBe('https://backend.example/api');
    expect(mocks.backend.init).toHaveBeenCalledWith('https://backend.example');
    expect(mocks.backend.verifyAuth).toHaveBeenCalledOnce();
    expect(mocks.backend.restoreAuth).toHaveBeenCalledOnce();
    expect(mocks.apiTokens).toEqual(['ghp_restored']);
    expect(restored).toEqual({ status: 'connected', githubToken: 'ghp_restored', user });
  });

  it('requests first-time GitHub token setup when the backend has none', async () => {
    mocks.backend.restoreAuth.mockResolvedValueOnce({ github_token: null });
    const { result } = renderHook(() => useLoginActions());

    await expect(result.current.restoreBackendSession('https://backend.example')).resolves.toEqual({
      status: 'github-token-required',
    });
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
  });

  it('distinguishes unreachable and unauthorized backends', async () => {
    const { result } = renderHook(() => useLoginActions());
    mocks.backend.isAvailable = false;
    await expect(result.current.restoreBackendSession('https://offline.example')).resolves.toEqual({
      status: 'backend-unavailable',
    });

    mocks.backend.isAvailable = true;
    mocks.backend.verifyAuth.mockResolvedValueOnce(false);
    await expect(result.current.restoreBackendSession('https://backend.example')).resolves.toEqual({
      status: 'unauthorized',
    });
  });

  it('validates and stores a token before syncing backend data', async () => {
    const { result } = renderHook(() => useLoginActions());

    await expect(result.current.setupBackendGitHubToken('ghp_new')).resolves.toEqual(user);
    expect(mocks.apiTokens).toEqual(['ghp_new']);
    expect(mocks.backend.syncSettings).toHaveBeenCalledWith({ github_token: 'ghp_new' });
    expect(mocks.syncFromBackend).not.toHaveBeenCalled();

    await result.current.syncBackendData();
    expect(mocks.syncFromBackend).toHaveBeenCalledOnce();
  });
});
