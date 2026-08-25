import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmbeddingConfig, Release, Repository, VectorSearchConfig, VectorSearchStatus, defaultReleaseSourceSettings } from '../types';
import { EMBEDDING_FORMAT_VERSION, indexAllRepos } from '../services/vectorSearchService';
import { CUSTOM_RELEASE_SOURCE_ID, createCustomReleaseRepository } from '../utils/releaseSources';
import { findReleasesWithChangedAssets, shouldShowAssetsUpdatedIndicator } from '../utils/releaseAssets';

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
