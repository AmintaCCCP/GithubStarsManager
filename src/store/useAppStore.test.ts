import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmbeddingConfig, Release, Repository, VectorSearchConfig, VectorSearchStatus, defaultReleaseSourceSettings } from '../types';
import { EMBEDDING_FORMAT_VERSION, indexAllRepos } from '../services/vectorSearchService';
import { CUSTOM_RELEASE_SOURCE_ID, createCustomReleaseRepository } from '../utils/releaseSources';
import { findReleasesWithChangedAssets, shouldShowAssetsUpdatedIndicator } from '../utils/releaseAssets';
import {
  buildExpectedResetDiscoveryState,
  buildPersistedSnapshot,
  buildTransientDiscoverySnapshot,
  type PersistedSnapshot,
} from './__fixtures__/persistedSnapshots';

let useAppStore: typeof import('./useAppStore').useAppStore;
let normalizePersistedState: typeof import('./useAppStore').normalizePersistedState;

beforeAll(async () => {
  const { indexedDBStorage } = await vi.importActual<typeof import('../services/indexedDbStorage')>('../services/indexedDbStorage');
  window.localStorage?.removeItem?.('github-stars-manager');
  await indexedDBStorage.removeItem('github-stars-manager');
  ({ useAppStore, normalizePersistedState } = await vi.importActual<typeof import('./useAppStore')>('./useAppStore'));
});

const createRepository = (id: number, overrides: Partial<Repository> = {}): Repository => ({
  id,
  name: `repo-${id}`,
  full_name: `owner/repo-${id}`,
  description: 'A test repository',
  html_url: `https://github.com/owner/repo-${id}`,
  stargazers_count: 10,
  forks_count: 1,
  forks: 1,
  language: 'TypeScript',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
  pushed_at: '2026-01-03T00:00:00.000Z',
  owner: {
    login: 'owner',
    avatar_url: 'https://github.com/avatar.png',
  },
  topics: ['test'],
  ...overrides,
});

describe('useAppStore release source settings', () => {
  beforeEach(() => {
    useAppStore.setState({
      releaseSourceSettings: defaultReleaseSourceSettings,
      releaseSubscriptions: new Set<number>(),
      releases: [],
      readReleases: new Set<number>(),
    });
  });

  it('keeps the starred release subscription source enabled by default', () => {
    expect(useAppStore.getState().releaseSourceSettings.enabledSourceIds).toEqual(['starred-release-subscription']);
  });

  it('dedupes custom release repositories by full name', () => {
    const first = createCustomReleaseRepository('owner/repo', CUSTOM_RELEASE_SOURCE_ID)!;
    const duplicate = createCustomReleaseRepository('https://github.com/OWNER/repo', CUSTOM_RELEASE_SOURCE_ID)!;

    useAppStore.getState().addReleaseSourceRepository(CUSTOM_RELEASE_SOURCE_ID, first);
    useAppStore.getState().addReleaseSourceRepository(CUSTOM_RELEASE_SOURCE_ID, duplicate);

    expect(useAppStore.getState().releaseSourceSettings.customReleaseRepos).toHaveLength(1);
  });

  it('removes custom release repositories by full name', () => {
    const repo = createCustomReleaseRepository('owner/repo', CUSTOM_RELEASE_SOURCE_ID)!;

    useAppStore.getState().addReleaseSourceRepository(CUSTOM_RELEASE_SOURCE_ID, repo);
    useAppStore.getState().removeReleaseSourceRepository(CUSTOM_RELEASE_SOURCE_ID, 'OWNER/repo');

    expect(useAppStore.getState().releaseSourceSettings.customReleaseRepos).toHaveLength(0);
  });
});

const makeRelease = (id: number, overrides: Partial<Release> = {}): Release => ({
  id,
  tag_name: `v${id}`,
  name: `Release ${id}`,
  body: null,
  published_at: '2026-01-01T00:00:00.000Z',
  html_url: `https://github.com/owner/repo/releases/tag/v${id}`,
  assets: [
    {
      id: 100 + id,
      name: 'app.dmg',
      size: 1000,
      download_count: 0,
      browser_download_url: 'https://example.com/app.dmg',
      content_type: 'application/octet-stream',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  ],
  repository: { id: 1, full_name: 'owner/repo', name: 'repo' },
  ...overrides,
});

describe('useAppStore release add/upsert actions', () => {
  beforeEach(() => {
    useAppStore.setState({
      releaseSourceSettings: defaultReleaseSourceSettings,
      releaseSubscriptions: new Set<number>(),
      releases: [],
      readReleases: new Set<number>(),
    });
  });

  it('addReleases only appends new ids', () => {
    useAppStore.getState().addReleases([makeRelease(1), makeRelease(2)]);
    useAppStore.getState().addReleases([makeRelease(2), makeRelease(3)]);
    expect(useAppStore.getState().releases.map(r => r.id)).toEqual([1, 2, 3]);
  });

  it('upsertReleases updates assets/metadata and resets read state', () => {
    useAppStore.getState().addReleases([makeRelease(1, { is_read: true })]);
    useAppStore.getState().markReleaseAsRead(1);

    const updated = makeRelease(1, {
      name: 'Updated name',
      assets: [{ ...makeRelease(1).assets[0], size: 9999 }],
    });
    useAppStore.getState().upsertReleases([updated]);

    const result = useAppStore.getState().releases[0];
    expect(result.name).toBe('Updated name');
    expect(result.assets[0].size).toBe(9999);
    expect(result.is_read).toBe(false);
    expect(useAppStore.getState().readReleases.has(1)).toBe(false);
  });

  it('upsertReleases keeps read state of unaffected releases', () => {
    useAppStore.getState().addReleases([makeRelease(1), makeRelease(2)]);
    useAppStore.getState().markReleaseAsRead(2);

    useAppStore.getState().upsertReleases([makeRelease(1, {
      assets: [{ ...makeRelease(1).assets[0], size: 8888 }],
    })]);

    expect(useAppStore.getState().readReleases.has(1)).toBe(false);
    expect(useAppStore.getState().readReleases.has(2)).toBe(true);
  });

  it('upsertReleases ignores ids not present in store', () => {
    useAppStore.getState().addReleases([makeRelease(1)]);
    useAppStore.getState().upsertReleases([makeRelease(99)]);
    expect(useAppStore.getState().releases.map(r => r.id)).toEqual([1]);
  });

  it('regression: asset update resets read state and gates the "Assets updated" indicator until marked read', () => {
    const publishedAt = '2026-01-01T00:00:00.000Z';
    const assetAtPublish = { ...makeRelease(1).assets[0], updated_at: publishedAt };

    // 初始：已同步的 release，用户已标记为已读
    useAppStore.getState().addReleases([makeRelease(1, {
      published_at: publishedAt,
      assets: [assetAtPublish],
    })]);
    useAppStore.getState().markReleaseAsRead(1);
    const isUnread = () => !useAppStore.getState().readReleases.has(1);

    // 刷新：GitHub 返回同 id 但资产已被替换（updated_at 晚于 published_at）
    const latest = makeRelease(1, {
      published_at: publishedAt,
      assets: [
        { ...assetAtPublish, updated_at: '2026-01-05T00:00:00.000Z' },
        {
          ...assetAtPublish,
          id: 999,
          name: 'new-app.zip',
        },
      ],
    });

    // 复用 handleRefresh 的共享筛选逻辑（findReleasesWithChangedAssets），不依赖已读状态
    const updatedReleases = findReleasesWithChangedAssets([latest], useAppStore.getState().releases);
    expect(updatedReleases).toHaveLength(1);
    useAppStore.getState().upsertReleases(updatedReleases);

    // 资产更新后：无论之前是否已读，都重置为未读并展示"资产已更新"
    const merged = useAppStore.getState().releases.find(r => r.id === 1)!;
    expect(merged.is_read).toBe(false);
    expect(merged.updated_asset_ids).toEqual([101, 999]);
    expect(isUnread()).toBe(true);
    expect(shouldShowAssetsUpdatedIndicator(merged)).toBe(true);

    // 用户再次点击该条 release → 已读，"资产已更新"随 updated_asset_ids 清空而消失
    useAppStore.getState().markReleaseAsRead(1);
    expect(isUnread()).toBe(false);
    const afterRead = useAppStore.getState().releases.find(r => r.id === 1)!;
    expect(afterRead.updated_asset_ids).toEqual([]);
    expect(shouldShowAssetsUpdatedIndicator(afterRead)).toBe(false);
  });

  it('regression: asset updated_at newer than published_at alone does not show the indicator', () => {
    // GitHub 上资产几乎都在 Release 创建后上传（updated_at > published_at 常态），
    // 只有"相对上次拉取发生了变化"（updated_asset_ids 非空）才允许展示标识。
    const publishedAt = '2026-01-01T00:00:00.000Z';
    useAppStore.getState().addReleases([makeRelease(1, {
      published_at: publishedAt,
      assets: [{ ...makeRelease(1).assets[0], updated_at: '2026-01-02T00:00:00.000Z' }],
    })]);

    const fresh = useAppStore.getState().releases.find(r => r.id === 1)!;
    expect(fresh.updated_asset_ids).toBeUndefined();
    expect(shouldShowAssetsUpdatedIndicator(fresh)).toBe(false);
  });
});

describe('useAppStore release asset read actions', () => {
  beforeEach(() => {
    useAppStore.setState({
      releaseSourceSettings: defaultReleaseSourceSettings,
      releaseSubscriptions: new Set<number>(),
      releases: [],
      readReleases: new Set<number>(),
    });
  });

  it('markAssetAsRead removes only the clicked asset id from updated_asset_ids', () => {
    useAppStore.getState().addReleases([
      makeRelease(1, { updated_asset_ids: [101, 202, 303] }),
      makeRelease(2, { updated_asset_ids: [404] }),
    ]);

    useAppStore.getState().markAssetAsRead(202);

    const first = useAppStore.getState().releases.find(r => r.id === 1)!;
    const second = useAppStore.getState().releases.find(r => r.id === 2)!;
    expect(first.updated_asset_ids).toEqual([101, 303]);
    expect(second.updated_asset_ids).toEqual([404]);
  });

  it('markAssetAsRead does not touch the release read state', () => {
    useAppStore.getState().addReleases([makeRelease(1, { updated_asset_ids: [101] })]);
    useAppStore.getState().markAssetAsRead(101);

    expect(useAppStore.getState().readReleases.has(1)).toBe(false);
    expect(useAppStore.getState().releases[0].is_read).toBeUndefined();
  });

  it('markAssetAsRead is a no-op for unknown asset ids', () => {
    useAppStore.getState().addReleases([makeRelease(1, { updated_asset_ids: [101] })]);
    useAppStore.getState().markAssetAsRead(999);
    expect(useAppStore.getState().releases[0].updated_asset_ids).toEqual([101]);
  });

  it('markReleaseAsRead clears updated_asset_ids only on the clicked release', () => {
    useAppStore.getState().addReleases([
      makeRelease(1, { updated_asset_ids: [101] }),
      makeRelease(2, { updated_asset_ids: [202] }),
    ]);

    useAppStore.getState().markReleaseAsRead(1);

    expect(useAppStore.getState().releases[0].updated_asset_ids).toEqual([]);
    expect(useAppStore.getState().releases[1].updated_asset_ids).toEqual([202]);
  });

  it('markAllReleasesAsRead clears updated_asset_ids and sets is_read across releases', () => {
    useAppStore.getState().addReleases([
      makeRelease(1, { updated_asset_ids: [101, 202] }),
      makeRelease(2, { updated_asset_ids: [404] }),
    ]);

    useAppStore.getState().markAllReleasesAsRead();

    expect(useAppStore.getState().readReleases.has(1)).toBe(true);
    expect(useAppStore.getState().readReleases.has(2)).toBe(true);
    expect(useAppStore.getState().releases[0].updated_asset_ids).toEqual([]);
    expect(useAppStore.getState().releases[1].updated_asset_ids).toEqual([]);
    expect(useAppStore.getState().releases[0].is_read).toBe(true);
    expect(useAppStore.getState().releases[1].is_read).toBe(true);
  });

  it('markAllReleasesAsRead leaves releases without updated_asset_ids untouched', () => {
    useAppStore.getState().addReleases([makeRelease(1)]);
    useAppStore.getState().markAllReleasesAsRead();
    expect(useAppStore.getState().releases[0].updated_asset_ids).toBeUndefined();
    expect(useAppStore.getState().releases[0].is_read).toBe(true);
  });
});

describe('useAppStore vector search config normalization', () => {
  const embeddingConfig: EmbeddingConfig = {
    id: 'emb-1',
    name: 'Test Embedding',
    apiType: 'openai-compatible',
    baseUrl: 'https://example.com/v1',
    apiKey: 'test-key',
    model: 'test-model',
    dimensions: 1024,
    isActive: true,
  };

  it('preserves full vectorSearchConfig during persisted-state hydration', () => {
    const normalized = normalizePersistedState({
      embeddingConfigs: [embeddingConfig],
      activeEmbeddingConfig: embeddingConfig.id,
      vectorSearchConfig: {
        enabled: true,
        workerUrl: 'https://worker.example.com',
        authToken: 'worker-token',
        embeddingConfigId: embeddingConfig.id,
        indexMode: 'description',
        readmeMaxChars: 4096,
        searchThreshold: 0,
        searchTopK: 12,
        enableHyDE: false,
        enableReranking: false,
        embeddingFormatVersion: 2,
      },
    }, useAppStore.getState());

    expect(normalized.vectorSearchConfig).toEqual({
      enabled: true,
      workerUrl: 'https://worker.example.com',
      authToken: 'worker-token',
      embeddingConfigId: embeddingConfig.id,
      indexMode: 'description',
      readmeMaxChars: 4096,
      searchThreshold: 0,
      searchTopK: 12,
      enableHyDE: false,
      enableReranking: false,
      embeddingFormatVersion: 2,
    });
  });

  it('defaults missing vectorSearchConfig fields for old persisted state', () => {
    const normalized = normalizePersistedState({
      embeddingConfigs: [embeddingConfig],
      vectorSearchConfig: {
        enabled: true,
        workerUrl: 'https://worker.example.com',
        authToken: 'worker-token',
        embeddingConfigId: embeddingConfig.id,
        indexMode: 'readme',
        readmeMaxChars: 6000,
      },
    }, useAppStore.getState());

    expect(normalized.vectorSearchConfig).toMatchObject({
      enabled: true,
      workerUrl: 'https://worker.example.com',
      authToken: 'worker-token',
      embeddingConfigId: embeddingConfig.id,
      indexMode: 'readme',
      readmeMaxChars: 6000,
      searchThreshold: 0.35,
      searchTopK: 30,
      enableHyDE: true,
      enableReranking: true,
      embeddingFormatVersion: 1,
    });
  });

  it('uses the latest format version for a fresh/reset config so new users are not forced into a full reindex', () => {
    const normalized = normalizePersistedState(
      { embeddingConfigs: [embeddingConfig] },
      useAppStore.getState()
    );

    expect(normalized.vectorSearchConfig?.embeddingFormatVersion).toBe(EMBEDDING_FORMAT_VERSION);
  });

  const baseVectorSearchConfig: VectorSearchConfig = {
    enabled: true,
    workerUrl: 'https://worker.example.com',
    authToken: 'worker-token',
    embeddingConfigId: embeddingConfig.id,
    indexMode: 'readme',
    readmeMaxChars: 6000,
    searchThreshold: 0.35,
    searchTopK: 30,
    enableHyDE: true,
    enableReranking: true,
    embeddingFormatVersion: EMBEDDING_FORMAT_VERSION,
  };

  beforeEach(() => {
    useAppStore.setState({
      embeddingConfigs: [embeddingConfig],
      vectorSearchConfig: { ...baseVectorSearchConfig },
    });
  });

  it('does not downgrade embeddingFormatVersion from stale runtime config updates', () => {
    useAppStore.getState().setVectorSearchConfig({ embeddingFormatVersion: 1 });

    expect(useAppStore.getState().vectorSearchConfig.embeddingFormatVersion).toBe(EMBEDDING_FORMAT_VERSION);
  });

  it('merges ordinary stale backend fields while preserving current embeddingFormatVersion', () => {
    useAppStore.getState().setVectorSearchConfig({
      workerUrl: 'https://stale-backend.example.com',
      authToken: 'stale-token',
      embeddingFormatVersion: 1,
    });

    expect(useAppStore.getState().vectorSearchConfig).toMatchObject({
      workerUrl: 'https://stale-backend.example.com',
      authToken: 'stale-token',
      embeddingFormatVersion: EMBEDDING_FORMAT_VERSION,
    });
  });

  it('allows runtime upgrades from legacy to the latest embeddingFormatVersion', () => {
    useAppStore.setState({
      vectorSearchConfig: { ...baseVectorSearchConfig, embeddingFormatVersion: 1 },
    });

    useAppStore.getState().setVectorSearchConfig({ embeddingFormatVersion: EMBEDDING_FORMAT_VERSION });

    expect(useAppStore.getState().vectorSearchConfig.embeddingFormatVersion).toBe(EMBEDDING_FORMAT_VERSION);
  });

  it('ignores invalid runtime embeddingFormatVersion updates', () => {
    useAppStore.getState().setVectorSearchConfig({
      embeddingFormatVersion: EMBEDDING_FORMAT_VERSION + 1,
    });

    expect(useAppStore.getState().vectorSearchConfig.embeddingFormatVersion).toBe(EMBEDDING_FORMAT_VERSION);
  });

  it('keeps incremental indexing scoped to newly analyzed repos after a stale backend config sync', async () => {
    useAppStore.getState().setVectorSearchConfig({ embeddingFormatVersion: 1 });
    expect(useAppStore.getState().vectorSearchConfig.embeddingFormatVersion).toBe(EMBEDDING_FORMAT_VERSION);

    const indexedIds: number[] = [];
    const client = {
      embed: vi.fn(async (texts: string[]) => texts.map((_, i) => [i, i + 1, i + 2])),
    } as unknown as Parameters<typeof indexAllRepos>[1];
    const vectorService = {
      upsert: vi.fn(async (vectors: Array<{ id: string }>) => ({ upserted: vectors.length })),
    } as unknown as Parameters<typeof indexAllRepos>[2];

    const result = await indexAllRepos([
      createRepository(1, { analyzed_at: '2026-01-04T00:00:00.000Z', vector_indexed_at: '2026-01-05T00:00:00.000Z' }),
      createRepository(2, { analyzed_at: '2026-01-04T00:00:00.000Z', vector_indexed_at: '2026-01-05T00:00:00.000Z' }),
      createRepository(3, { analyzed_at: '2026-01-06T00:00:00.000Z', vector_indexed_at: undefined }),
      createRepository(4, { analyzed_at: undefined, vector_indexed_at: undefined }),
    ], client, vectorService, {
      incremental: true,
      formatVersion: useAppStore.getState().vectorSearchConfig.embeddingFormatVersion,
      currentFormatVersion: EMBEDDING_FORMAT_VERSION,
      indexMode: 'description',
      onRepoIndexed: (repoId) => indexedIds.push(repoId),
    });

    expect(indexedIds).toEqual([3]);
    expect(result.indexedRepoIds).toEqual([3]);
  });

  it('sanitizes corrupt persisted vector search status before hydration', () => {
    const normalized = normalizePersistedState({
      vectorSearchStatus: {
        connected: 'yes',
        vectorCount: -1,
        dimensions: Number.NaN,
        lastSyncAt: 123,
        error: { message: 'invalid' },
      } as unknown as VectorSearchStatus,
    }, useAppStore.getState());

    expect(normalized.vectorSearchStatus).toEqual({
      connected: false,
      vectorCount: 0,
      dimensions: 0,
    });
  });

  it('omits invalid persisted vector search status timestamps during hydration', () => {
    const normalized = normalizePersistedState({
      vectorSearchStatus: {
        connected: true,
        vectorCount: 42,
        dimensions: 1536,
        lastSyncAt: 'not-a-date',
      },
    }, useAppStore.getState());

    expect(normalized.vectorSearchStatus).toEqual({
      connected: true,
      vectorCount: 42,
      dimensions: 1536,
    });
  });

  it('preserves valid persisted vector search status during hydration', () => {
    const normalized = normalizePersistedState({
      vectorSearchStatus: {
        connected: true,
        vectorCount: 42,
        dimensions: 1536,
        lastSyncAt: '2026-08-15T00:00:00.000Z',
        error: 'stale error',
      },
    }, useAppStore.getState());

    expect(normalized.vectorSearchStatus).toEqual({
      connected: true,
      vectorCount: 42,
      dimensions: 1536,
      lastSyncAt: '2026-08-15T00:00:00.000Z',
      error: 'stale error',
    });
  });
});

describe('useAppStore repository performance guards', () => {
  beforeEach(() => {
    useAppStore.setState({
      repositories: [],
      searchResults: [],
      analyzingRepositoryIds: new Set(),
    });
  });

  it('does not notify subscribers when updateRepository receives an equivalent repository', () => {
    const repo = createRepository(1);
    useAppStore.setState({ repositories: [repo], searchResults: [repo] });

    const previousRepositories = useAppStore.getState().repositories;
    const previousSearchResults = useAppStore.getState().searchResults;
    let notifications = 0;
    const unsubscribe = useAppStore.subscribe(() => {
      notifications++;
    });

    useAppStore.getState().updateRepository({ ...repo });
    unsubscribe();

    expect(notifications).toBe(0);
    expect(useAppStore.getState().repositories).toBe(previousRepositories);
    expect(useAppStore.getState().searchResults).toBe(previousSearchResults);
  });

  it('updates only lists that contain the repository', () => {
    const repo = createRepository(1);
    useAppStore.setState({ repositories: [repo], searchResults: [] });

    const previousSearchResults = useAppStore.getState().searchResults;
    useAppStore.getState().updateRepository({ ...repo, ai_summary: 'Updated summary' });

    expect(useAppStore.getState().repositories[0].ai_summary).toBe('Updated summary');
    expect(useAppStore.getState().searchResults).toBe(previousSearchResults);
  });

  it('does not notify subscribers when analyzing state is unchanged', () => {
    useAppStore.setState({ analyzingRepositoryIds: new Set([1]) });

    const previousAnalyzingIds = useAppStore.getState().analyzingRepositoryIds;
    let notifications = 0;
    const unsubscribe = useAppStore.subscribe(() => {
      notifications++;
    });

    useAppStore.getState().setAnalyzingRepository(1, true);
    unsubscribe();

    expect(notifications).toBe(0);
    expect(useAppStore.getState().analyzingRepositoryIds).toBe(previousAnalyzingIds);
  });

  it('preserves an active search result set when setRepositories runs (Issue #304)', () => {
    const first = createRepository(1);
    const second = createRepository(2);
    useAppStore.setState({
      repositories: [first, second],
      searchResults: [second],
      searchFilters: { ...useAppStore.getState().searchFilters, query: 'repo-2' },
    });
    const previousSearchResults = useAppStore.getState().searchResults;

    const refreshed = [createRepository(1), createRepository(2), createRepository(3)];
    useAppStore.getState().setRepositories(refreshed);

    // The stale searchResults reference is kept so the filtered card (and its
    // open edit modal) stays mounted; SearchBar recomputes results afterwards.
    expect(useAppStore.getState().searchResults).toBe(previousSearchResults);
    expect(useAppStore.getState().repositories).toBe(refreshed);
  });

  it('preserves an active search result set when only a license filter is active', () => {
    const first = createRepository(1);
    const second = createRepository(2);
    useAppStore.setState({
      repositories: [first, second],
      searchResults: [second],
      searchFilters: { ...useAppStore.getState().searchFilters, licenses: ['MIT'] },
    });
    const previousSearchResults = useAppStore.getState().searchResults;

    const refreshed = [createRepository(1), createRepository(2), createRepository(3)];
    useAppStore.getState().setRepositories(refreshed);

    expect(useAppStore.getState().searchResults).toBe(previousSearchResults);
  });

  it('resets searchResults to the full list when no search filter is active', () => {
    // Reset searchFilters to defaults before the test; the license-only test above
    // may have left licenses set, which would keep hasActiveSearchFilters true.
    useAppStore.setState({ searchFilters: { ...useAppStore.getState().searchFilters, licenses: [] } });
    const repo = createRepository(1);
    useAppStore.setState({
      repositories: [repo],
      searchResults: [repo],
      searchFilters: { ...useAppStore.getState().searchFilters, query: '' },
    });

    const refreshed = [repo, createRepository(2)];
    useAppStore.getState().setRepositories(refreshed);

    expect(useAppStore.getState().searchResults).toBe(refreshed);
  });

  it('preserves an active search result set when addRepository runs (Issue #304)', () => {
    const existing = createRepository(2);
    useAppStore.setState({
      repositories: [existing],
      searchResults: [existing],
      searchFilters: { ...useAppStore.getState().searchFilters, query: 'repo-2' },
    });
    const previousSearchResults = useAppStore.getState().searchResults;

    useAppStore.getState().addRepository(createRepository(3));

    // Same guard as setRepositories: swapping the full list into searchResults
    // while filters are active would unmount the filtered card being edited.
    expect(useAppStore.getState().searchResults).toBe(previousSearchResults);
    expect(useAppStore.getState().repositories).toHaveLength(2);

    // Without active filters, the full list is published to searchResults.
    useAppStore.setState({ searchFilters: { ...useAppStore.getState().searchFilters, query: '' } });
    useAppStore.getState().addRepository(createRepository(4));

    expect(useAppStore.getState().searchResults).toBe(useAppStore.getState().repositories);
  });
});

describe('useAppStore auth localStorage mirror (Issue #259)', () => {
  const AUTH_MIRROR_KEY = 'github-stars-manager-auth';
  const user = { id: 1, login: 'test-user', name: 'Test', avatar_url: 'https://x/a.png', email: null };

  beforeEach(() => {
    window.localStorage?.removeItem?.(AUTH_MIRROR_KEY);
  });

  it('persists auth to the synchronous localStorage mirror on login', () => {
    useAppStore.getState().setGitHubToken('ghp_xxx');
    useAppStore.getState().setUser(user);

    const raw = window.localStorage.getItem(AUTH_MIRROR_KEY);
    const mirror = JSON.parse(raw || '{}');
    expect(mirror.githubToken).toBe('ghp_xxx');
    expect(mirror.user.login).toBe('test-user');
  });

  it('persists backendApiSecret to the mirror and clears on logout', () => {
    useAppStore.getState().setBackendApiSecret('secret-1');
    const parsed = JSON.parse(window.localStorage.getItem(AUTH_MIRROR_KEY) || '{}');
    expect(parsed.backendApiSecret).toBe('secret-1');

    useAppStore.getState().logout();
    expect(window.localStorage.getItem(AUTH_MIRROR_KEY)).toBeNull();
    // The in-memory secret and the sessionStorage cache must also be torn down;
    // otherwise the backend keeps authenticating a logged-out user (and on v10
    // the secret is re-persisted to IndexedDB on the next partialize).
    expect(useAppStore.getState().backendApiSecret).toBeNull();
    expect(window.sessionStorage.getItem('github-stars-manager-backend-secret')).toBeNull();
  });

  it('restores auth from the mirror when the persisted snapshot lacks credentials', () => {
    // Simulate the reported bug: async IndexedDB write never landed, so the
    // persisted snapshot has empty auth while the mirror holds the real values.
    window.localStorage.setItem(
      AUTH_MIRROR_KEY,
      JSON.stringify({ user, githubToken: 'ghp_restored', backendApiSecret: null })
    );

    const normalized = normalizePersistedState({}, useAppStore.getState());
    expect(normalized.user).toEqual(user);
    expect(normalized.githubToken).toBe('ghp_restored');
    expect(normalized.isAuthenticated).toBe(true);
  });

  it('prefers persisted credentials over the mirror when both exist', () => {
    window.localStorage.setItem(
      AUTH_MIRROR_KEY,
      JSON.stringify({ user, githubToken: 'ghp_mirror', backendApiSecret: null })
    );
    const otherUser = { id: 2, login: 'other', name: 'Other', avatar_url: 'https://x/b.png', email: null };

    const normalized = normalizePersistedState(
      { user: otherUser, githubToken: 'ghp_persisted' },
      useAppStore.getState()
    );
    expect(normalized.user).toEqual(otherUser);
    expect(normalized.githubToken).toBe('ghp_persisted');
  });
});

describe('useAppStore repository view mode', () => {
  beforeEach(() => {
    useAppStore.setState({ repositoryViewMode: 'grid' });
  });

  it('keeps grid as the backwards-compatible default for persisted states without a view preference', () => {
    const normalized = normalizePersistedState({}, useAppStore.getState());

    expect(normalized.repositoryViewMode).toBe('grid');
  });

  it('restores the persisted list preference', () => {
    const normalized = normalizePersistedState({ repositoryViewMode: 'list' }, useAppStore.getState());

    expect(normalized.repositoryViewMode).toBe('list');
  });

  it('updates the repository view preference without changing repository records', () => {
    const repositories = [createRepository(1)];
    useAppStore.setState({ repositories, repositoryViewMode: 'grid' });

    useAppStore.getState().setRepositoryViewMode('list');

    expect(useAppStore.getState().repositoryViewMode).toBe('list');
    expect(useAppStore.getState().repositories).toBe(repositories);
  });
});

describe('useAppStore theme preset', () => {
  it('defaults the theme preset for legacy persisted state', () => {
    const normalized = normalizePersistedState({}, useAppStore.getState());

    expect(normalized.themePreset).toBe('default');
  });

  it('falls back to the default preset for unknown persisted values', () => {
    const normalized = normalizePersistedState(
      { themePreset: 'does-not-exist' as never },
      useAppStore.getState(),
    );

    expect(normalized.themePreset).toBe('default');
  });

  it('restores a known persisted preset and switches it at runtime', () => {
    const normalized = normalizePersistedState({ themePreset: 'deep-purple' }, useAppStore.getState());
    expect(normalized.themePreset).toBe('deep-purple');

    useAppStore.setState({ themePreset: 'default' });
    const themeBeforeSwitch = useAppStore.getState().theme;
    useAppStore.getState().setThemePreset('deep-purple');
    expect(useAppStore.getState().themePreset).toBe('deep-purple');
    expect(useAppStore.getState().theme).toBe(themeBeforeSwitch);
  });
});

type PersistenceOptions = {
  partialize: (state: typeof useAppStore extends never ? never : ReturnType<typeof useAppStore.getState>) => PersistedSnapshot;
  migrate: (snapshot: PersistedSnapshot, version: number) => PersistedSnapshot | Promise<PersistedSnapshot>;
  merge: (
    snapshot: PersistedSnapshot,
    currentState: ReturnType<typeof useAppStore.getState>,
  ) => ReturnType<typeof useAppStore.getState>;
};

const persistenceOptions = (): PersistenceOptions => (
  useAppStore.persist.getOptions() as unknown as PersistenceOptions
);

const migrateSnapshot = async (snapshot: PersistedSnapshot): Promise<PersistedSnapshot> => (
  await persistenceOptions().migrate(snapshot, 0)
);

const partializeState = (overrides: Partial<ReturnType<typeof useAppStore.getState>> = {}): PersistedSnapshot => (
  persistenceOptions().partialize({ ...useAppStore.getState(), ...overrides })
);

const backendSecretMirror = (secret: string | null): void => {
  window.localStorage.setItem(
    'github-stars-manager-auth',
    JSON.stringify({ user: null, githubToken: null, backendApiSecret: secret }),
  );
};

describe('useAppStore persisted-state historical fixtures', () => {
  beforeEach(() => {
    window.localStorage.removeItem('github-stars-manager-auth');
    window.sessionStorage.removeItem('github-stars-manager-backend-secret');
  });

  it('migrates the historical __EMPTY__ description marker to an explicit empty description', async () => {
    const migrated = await migrateSnapshot(buildPersistedSnapshot({
      repositories: [createRepository(1, { custom_description: '__EMPTY__' })],
    }));

    expect((migrated.repositories as Repository[])[0].custom_description).toBe('');
  });

  it('backfills release-sync metadata from the latest persisted release for legacy repositories', () => {
    const normalized = normalizePersistedState(buildPersistedSnapshot({
      repositories: [createRepository(1)],
      releases: [
        makeRelease(11, { repository: { id: 1, full_name: 'owner/repo-1', name: 'repo-1' }, published_at: '2026-01-03T00:00:00.000Z' }),
        makeRelease(12, { repository: { id: 1, full_name: 'owner/repo-1', name: 'repo-1' }, published_at: '2026-02-04T00:00:00.000Z' }),
      ],
    }), useAppStore.getInitialState());

    expect(normalized.repositories?.[0]).toMatchObject({
      has_fetched_releases: true,
      last_release_fetch_time: '2026-02-04T00:00:00.000Z',
    });
  });

  it('preserves a historical MCP token while filling host and port defaults during migration and hydration', async () => {
    const migrated = await migrateSnapshot(buildPersistedSnapshot({
      mcpConfig: { enabled: true, token: 'mcp-historical-token' },
    }));
    const normalized = normalizePersistedState(migrated, useAppStore.getInitialState());

    expect(normalized.mcpConfig).toEqual({
      ...useAppStore.getInitialState().mcpConfig,
      enabled: true,
      token: 'mcp-historical-token',
    });
  });

  it('maps legacy daily-dev channels into the most-dev schema and restores the trending channel', async () => {
    const migrated = await migrateSnapshot(buildPersistedSnapshot({
      subscriptionChannels: [{ id: 'daily-dev', name: 'Daily developers', enabled: false }],
    }));
    const channels = migrated.subscriptionChannels as Array<Record<string, unknown>>;

    expect(channels).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'most-dev', nameEn: 'Top Developers', enabled: false }),
      expect.objectContaining({ id: 'trending', nameEn: 'Trending', enabled: true }),
    ]));
  });

  it('fills the header menu contract for snapshots written before the header configuration existed', async () => {
    const migrated = await migrateSnapshot(buildPersistedSnapshot());

    expect(migrated.headerMenuConfig).toEqual(useAppStore.getInitialState().headerMenuConfig);
  });

  it('migrates a historical snapshot idempotently across repeated startups', async () => {
    const fixture = buildPersistedSnapshot({
      repositories: [createRepository(1, { custom_description: '__EMPTY__' })],
      subscriptionChannels: [{ id: 'daily-dev', name: 'Daily developers', enabled: true }],
    });

    const once = await migrateSnapshot(fixture);
    const twice = await migrateSnapshot(once);

    expect(twice).toEqual(once);
  });

  it('does not revive analyzing or discovery loading state from historical snapshots', () => {
    const snapshot = buildPersistedSnapshot({
      ...buildTransientDiscoverySnapshot(),
      analyzingRepositoryIds: [1],
      analyzingGistIds: ['gist-1'],
    });
    const normalized = normalizePersistedState(snapshot, useAppStore.getInitialState());

    expect(normalized.analyzingRepositoryIds).toEqual(new Set());
    expect(normalized.analyzingGistIds).toEqual(new Set());
    expect(normalized).toMatchObject(buildExpectedResetDiscoveryState());
  });

  it('serializes number Sets as arrays and reconstructs Sets during hydration', () => {
    const serialized = partializeState({
      releaseSubscriptions: new Set([1, 2]),
      readReleases: new Set([3]),
      readForks: new Set([4]),
      releaseExpandedRepositories: new Set([5]),
      forkExpandedRepositories: new Set([6]),
    });
    const normalized = normalizePersistedState(serialized, useAppStore.getInitialState());

    expect(serialized).toMatchObject({
      releaseSubscriptions: [1, 2],
      readReleases: [3],
      readForks: [4],
      releaseExpandedRepositories: [5],
      forkExpandedRepositories: [6],
    });
    expect(normalized.releaseSubscriptions).toEqual(new Set([1, 2]));
    expect(normalized.readReleases).toEqual(new Set([3]));
    expect(normalized.readForks).toEqual(new Set([4]));
    expect(normalized.releaseExpandedRepositories).toEqual(new Set([5]));
    expect(normalized.forkExpandedRepositories).toEqual(new Set([6]));
  });
});

describe('useAppStore backend API secret three-store contract', () => {
  const sessionState = (backendApiSecret: string | null) => ({
    ...useAppStore.getInitialState(),
    backendApiSecret,
  });

  beforeEach(() => {
    window.localStorage.removeItem('github-stars-manager-auth');
    window.sessionStorage.removeItem('github-stars-manager-backend-secret');
  });

  it('uses the IndexedDB snapshot first and realigns the auth mirror after hydration', () => {
    backendSecretMirror('mirror-secret');
    window.sessionStorage.setItem('github-stars-manager-backend-secret', 'session-secret');
    const merged = persistenceOptions().merge(
      buildPersistedSnapshot({ backendApiSecret: 'idb-secret' }),
      sessionState('session-secret'),
    );

    expect(merged.backendApiSecret).toBe('idb-secret');
    expect(JSON.parse(window.localStorage.getItem('github-stars-manager-auth') || '{}')).toMatchObject({
      backendApiSecret: 'idb-secret',
    });
  });

  it('uses the localStorage auth mirror when IndexedDB lacks the secret', () => {
    backendSecretMirror('mirror-secret');
    const normalized = normalizePersistedState(buildPersistedSnapshot(), sessionState('session-secret'));

    expect(normalized.backendApiSecret).toBe('mirror-secret');
  });

  it('falls back to the session secret when IndexedDB and the mirror are empty', () => {
    const normalized = normalizePersistedState(buildPersistedSnapshot(), sessionState('session-secret'));

    expect(normalized.backendApiSecret).toBe('session-secret');
  });

  it('keeps IndexedDB ahead of conflicting mirror and session values', () => {
    backendSecretMirror('mirror-secret');
    const normalized = normalizePersistedState(
      buildPersistedSnapshot({ backendApiSecret: 'idb-secret' }),
      sessionState('session-secret'),
    );

    expect(normalized.backendApiSecret).toBe('idb-secret');
  });

  it('treats an explicitly empty persisted secret as a clear and aligns a stale mirror to null', () => {
    backendSecretMirror('mirror-secret');
    const merged = persistenceOptions().merge(
      buildPersistedSnapshot({ backendApiSecret: '' }),
      sessionState('session-secret'),
    );

    expect(merged.backendApiSecret).toBeNull();
    expect(JSON.parse(window.localStorage.getItem('github-stars-manager-auth') || '{}')).toMatchObject({
      backendApiSecret: null,
    });
  });
});

describe('useAppStore persistence contracts', () => {
  it('does not serialize discovery runtime repositories while retaining proxy credentials and the RPC secret', () => {
    const persisted = partializeState({
      discoveryRepos: buildTransientDiscoverySnapshot().discoveryRepos as ReturnType<typeof useAppStore.getState>['discoveryRepos'],
      proxyConfig: { enabled: true, type: 'http', host: 'proxy.example.com', port: 7890, username: 'user', password: 'proxy-password' },
      rpcDownloadConfig: { enabled: true, host: 'rpc.example.com', port: 6800, secret: 'rpc-secret' },
      routeMode: 'browser',
    });

    expect(persisted).not.toHaveProperty('discoveryRepos');
    expect(persisted.proxyConfig).toEqual({
      enabled: true,
      type: 'http',
      host: 'proxy.example.com',
      port: 7890,
      username: 'user',
      password: 'proxy-password',
    });
    expect(persisted.rpcDownloadConfig).toEqual({
      enabled: true,
      host: 'rpc.example.com',
      port: 6800,
      secret: 'rpc-secret',
    });
    expect(persisted.routeMode).toBe('browser');
  });

  it('falls back to auto for missing or invalid routeMode during hydration', () => {
    const normalized = normalizePersistedState(
      buildPersistedSnapshot({ routeMode: 'not-a-mode' as unknown as never }),
      useAppStore.getInitialState(),
    );
    expect(normalized.routeMode).toBe('auto');

    const legacy = normalizePersistedState(
      buildPersistedSnapshot() as unknown as Record<string, unknown>,
      useAppStore.getInitialState(),
    );
    expect(legacy.routeMode).toBe('auto');
  });

  it('restores the full proxy credential set after hydration', () => {
    const normalized = normalizePersistedState(buildPersistedSnapshot({
      proxyConfig: {
        enabled: true,
        type: 'socks5',
        host: 'proxy.example.com',
        port: 1080,
        username: 'user',
        password: 'proxy-password',
      },
    }), useAppStore.getInitialState());

    expect(normalized.proxyConfig).toEqual({
      enabled: true,
      type: 'socks5',
      host: 'proxy.example.com',
      port: 1080,
      username: 'user',
      password: 'proxy-password',
    });
  });
});
