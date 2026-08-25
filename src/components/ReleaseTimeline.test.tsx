import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReleaseTimeline } from './ReleaseTimeline';
import { useAppStore } from '../store/useAppStore';
import { defaultReleaseSourceSettings } from '../types';
import type { Release, Repository } from '../types';

const { markAllReleasesOnBackend } = vi.hoisted(() => ({
  markAllReleasesOnBackend: vi.fn(),
}));

vi.mock('../store/useAppStore', () => ({
  useAppStore: vi.fn(),
}));

vi.mock('../services/githubApi', () => ({
  GitHubApiService: vi.fn(),
}));

vi.mock('../services/backendAdapter', () => ({
  backend: { markAllReleasesAsRead: markAllReleasesOnBackend },
}));

vi.mock('../services/autoSync', () => ({
  forceSyncToBackend: vi.fn(),
}));

const toastMock = vi.fn();
const confirmMock = vi.fn();

vi.mock('../hooks/useDialog', () => ({
  useDialog: () => ({
    toast: toastMock,
    confirm: confirmMock,
  }),
}));

const repository: Repository = {
  id: 7,
  name: 'repo',
  full_name: 'owner/repo',
  description: null,
  html_url: 'https://github.com/owner/repo',
  stargazers_count: 1,
  forks_count: 0,
  forks: 0,
  language: 'TypeScript',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
  pushed_at: '2026-08-01T00:00:00.000Z',
  topics: [],
  owner: { login: 'owner', avatar_url: 'https://github.com/owner.png' },
};

// 带“资产已更新”标识的未读 Release：展开资产按钮会触发 markReleaseAsRead，
// 真实 store 会同时清空 updated_asset_ids 并生成新的 releases 数组。
const createRelease = (): Release => ({
  id: 101,
  tag_name: 'v1.0.0',
  name: null,
  body: null,
  published_at: '2026-08-20T00:00:00.000Z',
  html_url: 'https://github.com/owner/repo/releases/tag/v1.0.0',
  prerelease: false,
  repository: {
    id: repository.id,
    full_name: repository.full_name,
    name: repository.name,
  },
  assets: [
    {
      id: 501,
      name: 'app.zip',
      size: 1024,
      download_count: 3,
      browser_download_url: 'https://github.com/owner/repo/releases/download/v1.0.0/app.zip',
      content_type: 'application/zip',
      created_at: '2026-08-21T00:00:00.000Z',
      updated_at: '2026-08-21T00:00:00.000Z',
    },
  ],
  updated_asset_ids: [501],
});

let storeState: ReturnType<typeof createStoreState>;

const baseStoreState = () => ({
  releases: [createRelease()],
  repositories: [repository],
  releaseSubscriptions: new Set<number>([repository.id]),
  releaseSourceSettings: defaultReleaseSourceSettings,
  readReleases: new Set<number>(),
  githubToken: 'token',
  language: 'zh' as const,
  assetFilters: [],
  addReleases: vi.fn(),
  upsertReleases: vi.fn(),
  markReleaseAsRead: vi.fn(),
  markAssetAsRead: vi.fn(),
  markAllReleasesAsRead: vi.fn(),
  batchUnsubscribeReleases: vi.fn(),
  removeReleasesByRepoFullName: vi.fn(),
  updateRepository: vi.fn(),
  removeReleaseSourceRepository: vi.fn(),
  updateReleaseSourceRepository: vi.fn(),
  addReleaseSourceRepository: vi.fn(),
  removeReleaseSourceRepositoryByName: vi.fn(),
  releaseViewMode: 'list' as const,
  releaseSelectedFilters: [] as string[],
  releaseSearchQuery: '',
  releaseExpandedRepositories: new Set<number>([7]),
  releaseIsRefreshing: false,
  setReleaseViewMode: vi.fn(),
  toggleReleaseSelectedFilter: vi.fn(),
  clearReleaseSelectedFilters: vi.fn(),
  setReleaseSearchQuery: vi.fn(),
  toggleReleaseExpandedRepository: vi.fn(),
  setReleaseIsRefreshing: vi.fn(),
  includePreRelease: false,
  setIncludePreRelease: vi.fn(),
  releaseShowMode: 'unread' as const,
  setReleaseShowMode: vi.fn(),
  releaseLatestMode: 'all' as const,
  setReleaseLatestMode: vi.fn(),
  rpcDownloadConfig: { enabled: false, host: '', secret: '' },
  backendApiSecret: '',
  aiConfigs: [] as Array<{ id: string }>,
  activeAIConfig: null as string | null,
});

const createStoreState = (overrides: Partial<ReturnType<typeof baseStoreState>> = {}) => ({
  ...baseStoreState(),
  ...overrides,
});

const mockUseAppStore = vi.mocked(useAppStore);

describe('ReleaseTimeline unread snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState = createStoreState();

    mockUseAppStore.mockImplementation(((selector?: (s: typeof storeState) => unknown) =>
      selector ? selector(storeState) : storeState) as unknown as typeof useAppStore);
    Object.assign(mockUseAppStore, {
      getState: vi.fn(() => storeState),
      setState: vi.fn((update: Partial<typeof storeState>) => Object.assign(storeState, update)),
    });

    // 复刻真实 store 的 markReleaseAsRead 行为：标记已读并清空
    // updated_asset_ids 时会生成新的 releases 数组（引用变化）。
    markAllReleasesOnBackend.mockResolvedValue(undefined);
    storeState.markAllReleasesAsRead = vi.fn(() => {
      storeState.readReleases = new Set(storeState.releases.map(release => release.id));
    });
    storeState.markReleaseAsRead = vi.fn((releaseId: number) => {
      storeState.readReleases = new Set(storeState.readReleases);
      storeState.readReleases.add(releaseId);
      storeState.releases = storeState.releases.map(r =>
        r.id === releaseId && (r.updated_asset_ids?.length ?? 0) > 0
          ? { ...r, updated_asset_ids: [] }
          : r
      );
    }) as unknown as typeof storeState.markReleaseAsRead;
  });

  it('restores the prior read state when backend bulk mark-all fails', async () => {
    const user = userEvent.setup();
    storeState.readReleases = new Set([999]);
    markAllReleasesOnBackend.mockRejectedValueOnce(new Error('backend offline'));

    render(<ReleaseTimeline />);
    await user.click(screen.getByRole('button', { name: '全部已读' }));

    await waitFor(() => {
      expect(storeState.readReleases).toEqual(new Set([999]));
      expect(toastMock).toHaveBeenCalledWith('标记全部已读失败', 'error');
    });
  });

  it('expanding an asset-updated release keeps it visible under unread-only mode', async () => {
    const user = userEvent.setup();
    render(<ReleaseTimeline />);

    const itemTexts = await screen.findAllByText('owner/repo');
    expect(itemTexts.length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: '显示下载资产' }));

    await waitFor(() => {
      expect(storeState.markReleaseAsRead).toHaveBeenCalledWith(101);
    });

    // 标记已读后条目必须保留在“仅显示未读”列表中，直到快照真正刷新
    await waitFor(() => {
      expect(screen.queryAllByText('owner/repo')).toHaveLength(itemTexts.length);
    });
    // 展开确实生效：资产行可见
    expect(await screen.findByText('app.zip')).toBeInTheDocument();
  });
});
