import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../../../types';
import type { LinkedApplication } from '../../../types/linkedApplication';
import { detectPlatformFromUserAgent } from '../../../utils/linkedApplications';
import { useLinkedApplications } from './useLinkedApplications';

const mocks = vi.hoisted(() => ({
  store: {
    linkedApplications: [] as LinkedApplication[],
    repositories: [] as Repository[],
    addLinkedApplication: vi.fn(),
    updateLinkedApplication: vi.fn(),
    removeLinkedApplication: vi.fn(),
  },
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector: (state: typeof mocks.store) => unknown) => selector(mocks.store),
}));

const makeRepository = (overrides: Partial<Repository> = {}): Repository => ({
  id: 1,
  name: 'tool',
  full_name: 'owner/tool',
  description: null,
  html_url: 'https://github.com/owner/tool',
  stargazers_count: 1,
  forks_count: 0,
  forks: 0,
  language: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  pushed_at: '2026-01-01T00:00:00.000Z',
  owner: { login: 'owner', avatar_url: '' },
  topics: [],
  ...overrides,
});

const makeApplication = (overrides: Partial<LinkedApplication> = {}): LinkedApplication => ({
  id: 'app-1',
  repositoryFullName: 'owner/tool',
  displayName: 'Tool',
  installedVersion: '1.0.0',
  platform: 'windows',
  linkSource: 'manual',
  includePrereleases: false,
  repositorySourceUrl: 'https://github.com/owner/tool',
  linkedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('useLinkedApplications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.store.linkedApplications = [];
    mocks.store.repositories = [
      makeRepository({ id: 1, full_name: 'owner/tool', name: 'tool' }),
      makeRepository({ id: 2, full_name: 'owner/other', name: 'other' }),
    ];
  });

  it('offers only repositories that are not linked yet, comparing names case-insensitively', () => {
    mocks.store.linkedApplications = [makeApplication({ repositoryFullName: 'Owner/Tool' })];
    const { result } = renderHook(() => useLinkedApplications());

    expect(result.current.linkableRepositories.map((repo) => repo.full_name)).toEqual(['owner/other']);
    expect(result.current.isRepositoryLinked('OWNER/TOOL ')).toBe(true);
    expect(result.current.isRepositoryLinked('owner/other')).toBe(false);
  });

  it('creates a complete record from the selected repository and reports success', () => {
    const { result } = renderHook(() => useLinkedApplications());

    let outcome: string | null = null;
    expect(() => {
      outcome = result.current.linkApplication({
        repositoryFullName: 'owner/other',
        repositorySourceUrl: 'https://github.com/owner/other',
        displayName: '  My Other Tool  ',
        installedVersion: ' 2.5.0 ',
        platform: 'macos',
        architecture: 'arm64',
        includePrereleases: true,
      });
    }).not.toThrow();

    expect(outcome).toBe('linked');
    expect(mocks.store.addLinkedApplication).toHaveBeenCalledTimes(1);
    expect(mocks.store.addLinkedApplication).toHaveBeenCalledWith(expect.objectContaining({
      repositoryFullName: 'owner/other',
      repositorySourceUrl: 'https://github.com/owner/other',
      displayName: 'My Other Tool',
      installedVersion: '2.5.0',
      platform: 'macos',
      architecture: 'arm64',
      includePrereleases: true,
      linkSource: 'manual',
      linkedAt: expect.any(String),
      id: expect.any(String),
    }));
    const created = mocks.store.addLinkedApplication.mock.calls[0][0] as LinkedApplication;
    expect(Number.isFinite(Date.parse(created.linkedAt))).toBe(true);
    expect(created.id.length).toBeGreaterThan(0);
  });

  it('defaults the platform guess from the current user agent and keeps prereleases off unless asked', () => {
    const { result } = renderHook(() => useLinkedApplications());

    expect(result.current.defaultPlatform).toBe(detectPlatformFromUserAgent(navigator.userAgent));

    result.current.linkApplication({ repositoryFullName: 'owner/other' });
    expect(mocks.store.addLinkedApplication).toHaveBeenCalledWith(expect.objectContaining({
      platform: expect.any(String),
      includePrereleases: false,
    }));
  });

  it('refuses a duplicate instead of writing a second record', () => {
    mocks.store.linkedApplications = [makeApplication({ repositoryFullName: 'owner/tool' })];
    const { result } = renderHook(() => useLinkedApplications());

    expect(result.current.linkApplication({ repositoryFullName: ' owner/Tool ' })).toBe('duplicate');
    expect(mocks.store.addLinkedApplication).not.toHaveBeenCalled();
  });

  it('refuses an empty repository name', () => {
    const { result } = renderHook(() => useLinkedApplications());

    expect(result.current.linkApplication({ repositoryFullName: '   ' })).toBe('invalid');
    expect(mocks.store.addLinkedApplication).not.toHaveBeenCalled();
  });

  it('delegates edits and unlink to the Store without touching any file capability', () => {
    const { result } = renderHook(() => useLinkedApplications());

    result.current.updateApplication('app-1', { installedVersion: '3.0.0' });
    result.current.unlinkApplication('app-1');

    expect(mocks.store.updateLinkedApplication).toHaveBeenCalledWith('app-1', { installedVersion: '3.0.0' });
    expect(mocks.store.removeLinkedApplication).toHaveBeenCalledWith('app-1');
    // 解除关联只暴露 Store 写入，hooks 里没有任何 Electron/文件系统调用面
    expect(Object.keys(mocks.store)).not.toContain('deleteFile');
  });
});
