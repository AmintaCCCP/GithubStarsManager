import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReleaseTimeline } from './ReleaseTimeline';
import { useAppStore } from '../store/useAppStore';
import { defaultReleaseSourceSettings } from '../types';
import type { AssetFilter, Release, Repository } from '../types';

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
  assetFilters: [] as AssetFilter[],
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
  releaseViewMode: 'list' as 'list' | 'timeline',
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
  releaseShowMode: 'unread' as 'unread' | 'all',
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

const wireStoreMocks = () => {
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
};

describe('ReleaseTimeline unread snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wireStoreMocks();
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

const makeRepo = (id: number, name: string, fullName: string): Repository => ({
  ...repository,
  id,
  name,
  full_name: fullName,
});

const makeRepoRelease = (id: number, repo: Repository, assetNames: string[]): Release => ({
  id,
  tag_name: `v${id}`,
  name: null,
  body: null,
  published_at: '2026-08-20T00:00:00.000Z',
  html_url: `https://github.com/${repo.full_name}/releases/tag/v${id}`,
  prerelease: false,
  repository: { id: repo.id, full_name: repo.full_name, name: repo.name },
  assets: assetNames.map((name, index) => ({
    id: id * 100 + index,
    name,
    size: 1024,
    download_count: 0,
    browser_download_url: `https://github.com/${repo.full_name}/releases/download/v${id}/${name}`,
    content_type: 'application/zip',
    created_at: '2026-08-20T00:00:00.000Z',
    updated_at: '2026-08-20T00:00:00.000Z',
  })),
});

describe('ReleaseTimeline asset filter matching', () => {
  const beta = makeRepo(8, 'beta', 'owner/beta');
  const gamma = makeRepo(9, 'gamma', 'owner/gamma');

  // 复刻 issue #404 场景：Portable 过滤器；beta 的 Release 不含 Portable 字眼，
  // 但被加入「始终包含」列表，启用过滤器时必须照常出现。
  const portableFilter: AssetFilter = {
    id: 'f1',
    name: 'Portable',
    keywords: ['portable'],
    includeRepos: ['owner/beta'],
  };

  const activateFilter = (filter: AssetFilter = portableFilter) => {
    storeState.assetFilters = [filter];
    storeState.releaseSelectedFilters = ['f1'];
    storeState.releaseViewMode = 'timeline';
    storeState.releaseShowMode = 'all';
  };

  beforeEach(() => {
    vi.clearAllMocks();
    wireStoreMocks();
  });

  it('shows releases whose repo is on the include list even without keyword hits', async () => {
    storeState.repositories = [beta];
    storeState.releaseSubscriptions = new Set([beta.id]);
    storeState.releases = [makeRepoRelease(201, beta, ['beta-1.0.zip'])];
    activateFilter();

    render(<ReleaseTimeline />);
    expect(await screen.findByText('owner/beta')).toBeInTheDocument();
  });

  it('hides releases that neither hit keywords nor sit on the include list', async () => {
    storeState.repositories = [gamma];
    storeState.releaseSubscriptions = new Set([gamma.id]);
    storeState.releases = [makeRepoRelease(301, gamma, ['tool-1.0.exe'])];
    activateFilter();

    render(<ReleaseTimeline />);
    expect(await screen.findByText('当前过滤器没有匹配到任何资产，请尝试其他过滤条件')).toBeInTheDocument();
    expect(screen.queryByText('owner/gamma')).not.toBeInTheDocument();
  });

  it('shows keyword-matching releases when the filter is active', async () => {
    const alpha = makeRepo(7, 'alpha', 'owner/alpha');
    storeState.repositories = [alpha];
    storeState.releaseSubscriptions = new Set([alpha.id]);
    storeState.releases = [makeRepoRelease(101, alpha, ['app-portable.zip'])];
    activateFilter();

    render(<ReleaseTimeline />);
    expect(await screen.findByText('owner/alpha')).toBeInTheDocument();
  });

  it('lists only the keyword-matching assets and reveals the rest on demand', async () => {
    const user = userEvent.setup();
    const alpha = makeRepo(7, 'alpha', 'owner/alpha');
    storeState.repositories = [alpha];
    storeState.releaseSubscriptions = new Set([alpha.id]);
    // app-setup.exe 不命中 portable 关键词：默认不列出，但可用「显示全部」展开
    storeState.releases = [makeRepoRelease(101, alpha, ['app-portable.zip', 'app-setup.exe'])];
    activateFilter();

    render(<ReleaseTimeline />);
    const assetToggles = await screen.findAllByRole('button', { name: '显示下载资产' });
    await user.click(assetToggles[0]);

    expect(await screen.findByText('app-portable.zip')).toBeInTheDocument();
    expect(screen.queryByText('app-setup.exe')).not.toBeInTheDocument();

    // 卡片提供展开全部资产的入口，并在展开后允许收回
    await user.click(screen.getByRole('button', { name: '显示全部 2 个' }));
    expect(await screen.findByText('app-setup.exe')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '仅显示命中的 1 个' }));
    expect(screen.queryByText('app-setup.exe')).not.toBeInTheDocument();
  });

  it('keeps only assets whose names hit the include keywords (macos / arm64), source archives excluded', async () => {
    const user = userEvent.setup();
    const alpha = makeRepo(7, 'alpha', 'owner/alpha');
    const release = makeRepoRelease(601, alpha, [
      'koreader-macos-11.0-arm64-v1.7z',
      'koreader-android-x86-v1.apk',
      'koreader-appimage-aarch64-latest-nightly',
    ]);
    // GitHub 为每个 Release 自动生成的源码归档伪资产：含 zip/mac 的都不该被展示
    release.zipball_url = 'https://github.com/owner/alpha/zipball/v601';
    release.tarball_url = 'https://github.com/owner/alpha/tarball/v601';
    storeState.repositories = [alpha];
    storeState.releaseSubscriptions = new Set([alpha.id]);
    storeState.releases = [release];
    activateFilter({ id: 'f1', name: 'macOS', keywords: ['macos', 'arm64'] });

    render(<ReleaseTimeline />);
    const assetToggles = await screen.findAllByRole('button', { name: '显示下载资产' });
    await user.click(assetToggles[0]);

    // 只保留名称含 macos 或 arm64 的那一项
    expect(await screen.findByText('koreader-macos-11.0-arm64-v1.7z')).toBeInTheDocument();
    expect(screen.queryByText('koreader-android-x86-v1.apk')).not.toBeInTheDocument();
    expect(screen.queryByText('koreader-appimage-aarch64-latest-nightly')).not.toBeInTheDocument();
    expect(screen.queryByText('Source code (v601.zip)')).not.toBeInTheDocument();
    expect(screen.queryByText('Source code (v601.tar.gz)')).not.toBeInTheDocument();
    // 3 个真实资产 + 2 个源码归档被折叠，计数跟随可见项
    expect(screen.getByText('(1)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '显示全部 5 个' })).toBeInTheDocument();
  });

  it('shows every asset of an always-included repository even when keywords miss them', async () => {
    const user = userEvent.setup();
    const beta = makeRepo(8, 'beta', 'owner/beta');
    storeState.repositories = [beta];
    storeState.releaseSubscriptions = new Set([beta.id]);
    storeState.releases = [makeRepoRelease(201, beta, ['beta-1.0.zip', 'beta-1.0.exe'])];
    // includeRepos 绕过关键词判断：该仓库的 Release 不受资产级裁剪
    activateFilter({ id: 'f1', name: 'Portable', keywords: ['portable'], includeRepos: ['owner/beta'] });

    render(<ReleaseTimeline />);
    const assetToggles = await screen.findAllByRole('button', { name: '显示下载资产' });
    await user.click(assetToggles[0]);

    expect(await screen.findByText('beta-1.0.zip')).toBeInTheDocument();
    expect(screen.getByText('beta-1.0.exe')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /显示全部/ })).not.toBeInTheDocument();
  });

  it('ignores the auto-generated source archives when matching include keywords', async () => {
    const alpha = makeRepo(7, 'alpha', 'owner/alpha');
    const beta = makeRepo(8, 'beta', 'owner/beta');
    // 复刻线上误报：GitHub 给每个 Release 都挂 "Source code (<tag>.zip)"，
    // 于是只要关键词里有 zip，零资产或纯 .whl 的 Release 也会出现在过滤结果里。
    const whlOnly = makeRepoRelease(101, alpha, ['mineru-4.0.0-py3-none-any.whl']);
    whlOnly.zipball_url = 'https://github.com/owner/alpha/zipball/v101';
    whlOnly.tarball_url = 'https://github.com/owner/alpha/tarball/v101';
    const realZip = makeRepoRelease(201, beta, ['app-1.0.zip']);
    realZip.zipball_url = 'https://github.com/owner/beta/zipball/v201';

    storeState.repositories = [alpha, beta];
    storeState.releaseSubscriptions = new Set([alpha.id, beta.id]);
    storeState.releases = [whlOnly, realZip];
    activateFilter({ id: 'f1', name: 'Zip', keywords: ['zip'] });

    render(<ReleaseTimeline />);
    expect(await screen.findByText('owner/beta')).toBeInTheDocument();
    expect(screen.queryByText('owner/alpha')).not.toBeInTheDocument();
  });
});

describe('ReleaseTimeline per-filter repository exclusions', () => {
  const beta = makeRepo(8, 'beta', 'owner/beta');
  const gamma = makeRepo(9, 'gamma', 'owner/gamma');
  const alpha = makeRepo(7, 'alpha', 'owner/alpha');

  const activate = (filters: AssetFilter[], selectedIds: string[]) => {
    storeState.assetFilters = filters;
    storeState.releaseSelectedFilters = selectedIds;
    storeState.releaseViewMode = 'timeline';
    storeState.releaseShowMode = 'all';
    storeState.releaseLatestMode = 'all';
  };

  const expectVisible = async (fullName: string) => {
    expect(await screen.findByText(fullName)).toBeInTheDocument();
  };

  beforeEach(() => {
    vi.clearAllMocks();
    wireStoreMocks();
  });

  it('hides a release whose repo is always-excluded even with keyword hits and include listing', async () => {
    storeState.repositories = [alpha];
    storeState.releaseSubscriptions = new Set([alpha.id]);
    storeState.releases = [makeRepoRelease(101, alpha, ['app.zip'])];
    activate(
      [{ id: 'f1', name: 'Zip', keywords: ['zip'], includeRepos: ['owner/alpha'], alwaysExcludeRepos: ['owner/alpha'] }],
      ['f1'],
    );

    render(<ReleaseTimeline />);
    await expectVisible('当前过滤器没有匹配到任何资产，请尝试其他过滤条件');
    expect(screen.queryByText('owner/alpha')).not.toBeInTheDocument();
  });

  it('lets always-include bypass the same filter\u2019s exclude keywords', async () => {
    storeState.repositories = [beta];
    storeState.releaseSubscriptions = new Set([beta.id]);
    // 资产名同时命中包含词与排除词，但仓库被始终包含 → 绕过关键词判断
    storeState.releases = [makeRepoRelease(201, beta, ['beta-app.zip'])];
    activate(
      [{ id: 'f1', name: 'App', keywords: ['app'], excludeKeywords: ['beta'], includeRepos: ['owner/beta'] }],
      ['f1'],
    );

    render(<ReleaseTimeline />);
    await expectVisible('owner/beta');
  });

  it('shows only whitelisted repositories for a pure includeRepos filter', async () => {
    storeState.repositories = [beta, gamma];
    storeState.releaseSubscriptions = new Set([beta.id, gamma.id]);
    storeState.releases = [
      makeRepoRelease(201, beta, ['beta-1.0.zip']),
      makeRepoRelease(301, gamma, ['gamma-1.0.zip']),
    ];
    activate([{ id: 'f1', name: 'Beta only', keywords: [], includeRepos: ['owner/beta'] }], ['f1']);

    render(<ReleaseTimeline />);
    await expectVisible('owner/beta');
    expect(screen.queryByText('owner/gamma')).not.toBeInTheDocument();
  });

  it('shows every other repository for a pure alwaysExcludeRepos filter', async () => {
    storeState.repositories = [beta, gamma];
    storeState.releaseSubscriptions = new Set([beta.id, gamma.id]);
    storeState.releases = [
      makeRepoRelease(201, beta, ['beta-1.0.zip']),
      makeRepoRelease(301, gamma, ['gamma-1.0.zip']),
    ];
    activate([{ id: 'f1', name: 'No gamma', keywords: [], alwaysExcludeRepos: ['owner/gamma'] }], ['f1']);

    render(<ReleaseTimeline />);
    await expectVisible('owner/beta');
    expect(screen.queryByText('owner/gamma')).not.toBeInTheDocument();
  });

  it('hides releases whose real assets are all excluded, even when pseudo assets survive', async () => {
    const excluded = makeRepoRelease(401, alpha, ['app-setup.exe']);
    excluded.zipball_url = 'https://github.com/owner/alpha/zipball/v401';
    const noRealAssets = makeRepoRelease(402, beta, []);
    noRealAssets.zipball_url = 'https://github.com/owner/beta/zipball/v402';
    const surviving = makeRepoRelease(403, gamma, ['app.zip', 'app-setup.exe']);
    surviving.zipball_url = 'https://github.com/owner/gamma/zipball/v403';

    storeState.repositories = [alpha, beta, gamma];
    storeState.releaseSubscriptions = new Set([alpha.id, beta.id, gamma.id]);
    storeState.releases = [excluded, noRealAssets, surviving];
    activate([{ id: 'f1', name: 'No setup', keywords: [], excludeKeywords: ['setup'] }], ['f1']);

    render(<ReleaseTimeline />);
    await expectVisible('owner/gamma');
    expect(screen.queryByText('owner/alpha')).not.toBeInTheDocument();
    expect(screen.queryByText('owner/beta')).not.toBeInTheDocument();
  });

  it('keeps pseudo-asset name matching when include keywords are present (preset-source regression)', async () => {
    const release = makeRepoRelease(501, alpha, ['binary.bin']);
    release.zipball_url = 'https://github.com/owner/alpha/zipball/v501';

    storeState.repositories = [alpha];
    storeState.releaseSubscriptions = new Set([alpha.id]);
    storeState.releases = [release];
    // preset-source 不在 assetFilters 中时由 PRESET_FILTERS 常量兜底
    activate([], ['preset-source']);

    render(<ReleaseTimeline />);
    await expectVisible('owner/alpha');
  });

  it('does not let one filter\u2019s exclusion veto another filter\u2019s match (OR across filters)', async () => {
    storeState.repositories = [alpha];
    storeState.releaseSubscriptions = new Set([alpha.id]);
    storeState.releases = [makeRepoRelease(101, alpha, ['app-portable.zip'])];
    activate(
      [
        { id: 'f1', name: 'Portable', keywords: ['portable'] },
        { id: 'f2', name: 'No alpha', keywords: [], alwaysExcludeRepos: ['owner/alpha'] },
      ],
      ['f1', 'f2'],
    );

    render(<ReleaseTimeline />);
    await expectVisible('owner/alpha');
  });

  it('hides a release only when every selected filter misses it', async () => {
    storeState.repositories = [alpha];
    storeState.releaseSubscriptions = new Set([alpha.id]);
    storeState.releases = [makeRepoRelease(101, alpha, ['app.zip'])];
    activate(
      [
        { id: 'f1', name: 'Deb only', keywords: ['deb'] },
        { id: 'f2', name: 'No alpha', keywords: [], alwaysExcludeRepos: ['owner/alpha'] },
      ],
      ['f1', 'f2'],
    );

    render(<ReleaseTimeline />);
    await expectVisible('当前过滤器没有匹配到任何资产，请尝试其他过滤条件');
    expect(screen.queryByText('owner/alpha')).not.toBeInTheDocument();
  });

  it('matches repository keys case-insensitively for exclusions and includes', async () => {
    storeState.repositories = [alpha, beta];
    storeState.releaseSubscriptions = new Set([alpha.id, beta.id]);
    storeState.releases = [
      makeRepoRelease(101, alpha, ['alpha-1.0.zip']),
      makeRepoRelease(201, beta, ['beta-1.0.zip']),
    ];
    activate(
      [{ id: 'f1', name: 'Case', keywords: [], includeRepos: ['OWNER/BETA'], alwaysExcludeRepos: ['OWNER/ALPHA'] }],
      ['f1'],
    );

    render(<ReleaseTimeline />);
    await expectVisible('owner/beta');
    expect(screen.queryByText('owner/alpha')).not.toBeInTheDocument();
  });

  it('hides repositories outside both lists when a filter combines include and exclude repos', async () => {
    const delta = makeRepo(10, 'delta', 'owner/delta');
    storeState.repositories = [alpha, beta, delta];
    storeState.releaseSubscriptions = new Set([alpha.id, beta.id, delta.id]);
    storeState.releases = [
      makeRepoRelease(101, alpha, ['alpha-1.0.zip']),
      makeRepoRelease(201, beta, ['beta-1.0.zip']),
      makeRepoRelease(401, delta, ['delta-1.0.zip']),
    ];
    activate(
      [{ id: 'f1', name: 'Beta minus alpha', keywords: [], includeRepos: ['owner/beta'], alwaysExcludeRepos: ['owner/alpha'] }],
      ['f1'],
    );

    render(<ReleaseTimeline />);
    // 包含列表内的仓库显示；排除列表与两组之外的仓库都隐藏
    await expectVisible('owner/beta');
    expect(screen.queryByText('owner/alpha')).not.toBeInTheDocument();
    expect(screen.queryByText('owner/delta')).not.toBeInTheDocument();
  });
});
