import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../../../types';
import { useRepositoryReleaseSheet } from './useRepositoryReleaseSheet';

const mocks = vi.hoisted(() => ({
  backend: {
    isAvailable: false,
    getRepositoryReleases: vi.fn(),
  },
  githubGetRepositoryReleases: vi.fn(),
  toast: vi.fn(),
  store: {
    language: 'zh' as const,
    githubToken: 'token',
    rpcDownloadConfig: { enabled: false, host: '', port: 6800, secret: '' },
    backendApiSecret: null as string | null,
    aiConfigs: [],
    activeAIConfig: null as string | null,
  },
}));

vi.mock('../../../services/backendAdapter', () => ({ backend: mocks.backend }));
vi.mock('../../../services/githubApi', () => ({
  GitHubApiService: class {
    getRepositoryReleases = mocks.githubGetRepositoryReleases;
  },
}));
vi.mock('../../../hooks/useDialog', () => ({
  useDialog: () => ({ toast: mocks.toast, confirm: vi.fn() }),
}));
vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector: (state: typeof mocks.store) => unknown) => selector(mocks.store),
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
  });

  it('uses the live backend GitHub proxy when available and maps repository identity locally', async () => {
    mocks.backend.isAvailable = true;
    mocks.backend.getRepositoryReleases.mockResolvedValue([rawRelease]);
    const { result } = renderHook(() => useRepositoryReleaseSheet(repository));

    await act(async () => {
      await result.current.loadReleases();
    });

    expect(mocks.backend.getRepositoryReleases).toHaveBeenCalledWith('owner', 'repo', 1, 100, expect.any(AbortSignal));
    expect(mocks.githubGetRepositoryReleases).not.toHaveBeenCalled();
    expect(result.current.releases).toEqual([expect.objectContaining({
      id: rawRelease.id,
      repository: { id: repository.id, name: repository.name, full_name: repository.full_name },
    })]);
  });

  it('falls back to a fresh token-authenticated GitHub request when the backend proxy fails', async () => {
    mocks.backend.isAvailable = true;
    mocks.backend.getRepositoryReleases.mockRejectedValue(new Error('Proxy unavailable'));
    mocks.githubGetRepositoryReleases.mockResolvedValue([{ ...rawRelease, repository: { id: 0, name: 'repo', full_name: 'owner/repo' } }]);
    const { result } = renderHook(() => useRepositoryReleaseSheet(repository));

    await act(async () => {
      await result.current.loadReleases();
    });

    expect(mocks.githubGetRepositoryReleases).toHaveBeenCalledWith('owner', 'repo', 1, 100, expect.any(AbortSignal));
    expect(result.current.error).toBeNull();
    expect(result.current.releases[0]?.repository.id).toBe(repository.id);
  });
});
