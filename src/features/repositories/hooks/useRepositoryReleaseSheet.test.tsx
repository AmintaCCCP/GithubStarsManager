import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository, RouteMode } from '../../../types';
import { useRepositoryReleaseSheet } from './useRepositoryReleaseSheet';

const mocks = vi.hoisted(() => ({
  backend: {
    isAvailable: false,
    getRepositoryReleases: vi.fn(),
    downloadGitHubResource: vi.fn(),
  },
  githubGetRepositoryReleasesPage: vi.fn(),
  toast: vi.fn(),
  store: {
    language: 'zh' as const,
    githubToken: 'token' as string | null,
    rpcDownloadConfig: { enabled: false, host: '', port: 6800, secret: '' },
    backendApiSecret: null as string | null,
    aiConfigs: [],
    activeAIConfig: null as string | null,
    routeMode: 'auto' as RouteMode,
  },
}));

vi.mock('../../../services/backendAdapter', () => ({ backend: mocks.backend }));
vi.mock('../../../services/githubApi', () => ({
  GitHubApiService: class {
    getRepositoryReleasesPage = mocks.githubGetRepositoryReleasesPage;
  },
}));
vi.mock('../../../hooks/useDialog', () => ({
  useDialog: () => ({ toast: mocks.toast, confirm: vi.fn() }),
}));
vi.mock('../../../store/useAppStore', () => ({
  useAppStore: Object.assign(
    (selector: (state: typeof mocks.store) => unknown) => selector(mocks.store),
    { getState: () => mocks.store },
  ),
}));

const repository: Repository = {
  id: 9,
  name: 'repo',
  full_name: 'owner/repo',
  description: null,
  html_url: 'https://github.com/owner/repo',
  stargazers_count: 0,
  forks_count: 0,
  forks: 0,
  language: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  pushed_at: '2026-01-01T00:00:00.000Z',
  owner: { login: 'owner', avatar_url: 'https://example.com/avatar.png' },
  topics: [],
};

const rawRelease = {
  id: 100,
  tag_name: 'v1.0.0',
  name: 'Version 1.0.0',
  body: 'Notes',
  published_at: '2026-01-02T00:00:00.000Z',
  html_url: 'https://github.com/owner/repo/releases/tag/v1.0.0',
  assets: [],
  prerelease: false,
};

describe('useRepositoryReleaseSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.backend.isAvailable = false;
    mocks.store.githubToken = 'token';
    mocks.store.routeMode = 'auto';
  });

  it('uses the live backend GitHub proxy when available and maps repository identity locally', async () => {
    mocks.backend.isAvailable = true;
    mocks.backend.getRepositoryReleases.mockResolvedValue([rawRelease]);
    const { result } = renderHook(() => useRepositoryReleaseSheet(repository));

    await act(async () => {
      await result.current.loadReleases();
    });

    expect(mocks.backend.getRepositoryReleases).toHaveBeenCalledWith('owner', 'repo', 1, 100, expect.any(AbortSignal));
    expect(mocks.githubGetRepositoryReleasesPage).not.toHaveBeenCalled();
    expect(result.current.releases).toEqual([expect.objectContaining({
      id: rawRelease.id,
      repository: { id: repository.id, name: repository.name, full_name: repository.full_name },
    })]);
  });

  it('filters backend draft releases with null publication times before mapping', async () => {
    mocks.backend.isAvailable = true;
    mocks.backend.getRepositoryReleases.mockResolvedValue([
      { ...rawRelease, id: 99, draft: true, published_at: null },
      rawRelease,
    ]);
    const { result } = renderHook(() => useRepositoryReleaseSheet(repository));

    await act(async () => {
      await result.current.loadReleases();
    });

    expect(result.current.releases).toEqual([expect.objectContaining({ id: rawRelease.id })]);
  });

  it('falls back to a fresh token-authenticated GitHub request when the backend proxy fails', async () => {
    mocks.backend.isAvailable = true;
    mocks.backend.getRepositoryReleases.mockRejectedValue(new Error('Proxy unavailable'));
    mocks.githubGetRepositoryReleasesPage.mockResolvedValue({
      releases: [{ ...rawRelease, repository: { id: 0, name: 'repo', full_name: 'owner/repo' } }],
      hasMore: false,
    });
    const { result } = renderHook(() => useRepositoryReleaseSheet(repository));

    await act(async () => {
      await result.current.loadReleases();
    });

    expect(mocks.githubGetRepositoryReleasesPage).toHaveBeenCalledWith('owner', 'repo', 1, 100, expect.any(AbortSignal));
    expect(result.current.error).toBeNull();
    expect(result.current.releases[0]?.repository.id).toBe(repository.id);
  });

  it('downloads a private asset through its authenticated GitHub API endpoint', async () => {
    const blob = new Blob(['release asset']);
    const fetchMock = vi.mocked(window.fetch).mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(blob),
    } as unknown as Response);
    const createObjectUrl = vi.fn(() => 'blob:release-asset');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const { result } = renderHook(() => useRepositoryReleaseSheet(repository));

    await act(async () => {
      await result.current.downloadAsset({
        id: 'asset-1',
        name: 'private.zip',
        url: 'https://github.com/owner/repo/releases/download/v1/private.zip',
        authenticatedUrl: 'https://api.github.com/repos/owner/repo/releases/assets/1',
        size: 10,
        isSourceCode: false,
        assetId: 1,
      });
    });

    expect(fetchMock).toHaveBeenCalledWith('https://api.github.com/repos/owner/repo/releases/assets/1', {
      headers: {
        Accept: 'application/octet-stream',
        Authorization: 'Bearer token',
      },
    });
    expect(createObjectUrl).toHaveBeenCalledWith(blob);
    expect(clickSpy).toHaveBeenCalledOnce();
  });

  it('uses the authenticated backend proxy for private downloads in backend-only sessions', async () => {
    mocks.store.githubToken = null;
    mocks.backend.isAvailable = true;
    const blob = new Blob(['backend release asset']);
    mocks.backend.downloadGitHubResource.mockResolvedValue(blob);
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:backend-release') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const { result } = renderHook(() => useRepositoryReleaseSheet(repository));

    await act(async () => {
      await result.current.downloadAsset({
        id: 'asset-2',
        name: 'backend-private.zip',
        url: 'https://github.com/owner/repo/releases/download/v1/backend-private.zip',
        authenticatedPath: '/repos/owner/repo/releases/assets/2',
        size: 10,
        isSourceCode: false,
        assetId: 2,
      });
    });

    expect(mocks.backend.downloadGitHubResource).toHaveBeenCalledWith('/repos/owner/repo/releases/assets/2');
    expect(clickSpy).toHaveBeenCalledOnce();
  });

  it('skips the backend proxy and fetches releases directly in browser route mode', async () => {
    mocks.store.routeMode = 'browser';
    mocks.backend.isAvailable = true;
    mocks.githubGetRepositoryReleasesPage.mockResolvedValue({
      releases: [{ ...rawRelease, repository: { id: 0, name: 'repo', full_name: 'owner/repo' } }],
      hasMore: false,
    });
    const { result } = renderHook(() => useRepositoryReleaseSheet(repository));

    await act(async () => {
      await result.current.loadReleases();
    });

    expect(mocks.backend.getRepositoryReleases).not.toHaveBeenCalled();
    expect(mocks.githubGetRepositoryReleasesPage).toHaveBeenCalledWith('owner', 'repo', 1, 100, expect.any(AbortSignal));
    expect(result.current.error).toBeNull();
  });

  it('opens a new window instead of the backend proxy for tokenless downloads in browser route mode', async () => {
    mocks.store.routeMode = 'browser';
    mocks.store.githubToken = null;
    mocks.backend.isAvailable = true;
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { result } = renderHook(() => useRepositoryReleaseSheet(repository));

    await act(async () => {
      await result.current.downloadAsset({
        id: 'asset-3',
        name: 'browser-fallback.zip',
        url: 'https://github.com/owner/repo/releases/download/v1/browser-fallback.zip',
        authenticatedPath: '/repos/owner/repo/releases/assets/3',
        size: 10,
        isSourceCode: false,
        assetId: 3,
      });
    });

    expect(mocks.backend.downloadGitHubResource).not.toHaveBeenCalled();
    expect(openSpy).toHaveBeenCalledWith('https://github.com/owner/repo/releases/download/v1/browser-fallback.zip', '_blank', 'noopener,noreferrer');
    openSpy.mockRestore();
  });
});
