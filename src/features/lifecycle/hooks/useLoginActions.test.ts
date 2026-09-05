import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiTokens: [] as string[],
  getCurrentUser: vi.fn(),
  syncFromBackend: vi.fn(),
  backend: {
    configuredUrl: 'https://backend.example/api',
    backendUrl: null as string | null,
    init: vi.fn(),
    isAvailable: true,
    verifyAuth: vi.fn(),
    restoreAuth: vi.fn(),
    syncSettings: vi.fn(),
    rememberActiveUrl: vi.fn(),
  },
}));

vi.mock('../../../services/githubApi', () => ({
  GITHUB_TOKEN_INVALID_ERROR: 'GitHub token expired or invalid',
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
    mocks.backend.backendUrl = null;
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
    expect(mocks.backend.rememberActiveUrl).toHaveBeenCalledOnce();
    expect(mocks.apiTokens).toEqual(['ghp_restored']);
    expect(restored).toEqual({ status: 'connected', githubToken: 'ghp_restored', user });
  });

  it('does not remember the URL before the token setup step', async () => {
    mocks.backend.restoreAuth.mockResolvedValueOnce({ github_token: null });
    const { result } = renderHook(() => useLoginActions());

    await expect(result.current.restoreBackendSession('https://backend.example')).resolves.toEqual({
      status: 'github-token-required',
    });
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
    expect(mocks.backend.rememberActiveUrl).not.toHaveBeenCalled();
  });

  it('falls back to the previous backend when the key is rejected', async () => {
    mocks.backend.backendUrl = 'https://old.example/api';
    mocks.backend.verifyAuth.mockResolvedValueOnce(false);
    const { result } = renderHook(() => useLoginActions());

    await expect(result.current.restoreBackendSession('https://backend.example')).resolves.toEqual({
      status: 'unauthorized',
    });
    expect(mocks.backend.init).toHaveBeenLastCalledWith('https://old.example/api');
    expect(mocks.backend.rememberActiveUrl).not.toHaveBeenCalled();
  });

  it('reports an unusable stored token instead of a raw auth error', async () => {
    mocks.getCurrentUser.mockRejectedValueOnce(new Error('GitHub token expired or invalid'));
    const { result } = renderHook(() => useLoginActions());

    await expect(result.current.restoreBackendSession('https://backend.example')).resolves.toEqual({
      status: 'restored-token-invalid',
    });
  });

  it('propagates transient GitHub errors instead of flagging the stored token', async () => {
    mocks.getCurrentUser.mockRejectedValueOnce(new Error('GitHub API error: 503 Service Unavailable'));
    const { result } = renderHook(() => useLoginActions());

    await expect(result.current.restoreBackendSession('https://backend.example')).rejects.toThrow(
      'GitHub API error: 503 Service Unavailable'
    );
  });

  it('does not treat a backend proxy credential failure as an invalid stored token', async () => {
    mocks.getCurrentUser.mockRejectedValueOnce(new Error('Backend API key was rejected. Please check your backend settings'));
    const { result } = renderHook(() => useLoginActions());

    await expect(result.current.restoreBackendSession('https://backend.example')).rejects.toThrow(
      'Backend API key was rejected'
    );
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
    expect(mocks.backend.rememberActiveUrl).toHaveBeenCalledOnce();
    expect(mocks.syncFromBackend).not.toHaveBeenCalled();

    await result.current.syncBackendData();
    expect(mocks.syncFromBackend).toHaveBeenCalledOnce();
  });
});
