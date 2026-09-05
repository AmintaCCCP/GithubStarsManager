import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Category, Repository, VectorSearchConfig } from '../../../types';
import {
  applyListsToRepositories,
  buildSearchPatch,
  mergeStarredRepositories,
  planListCategories,
  useSearchActions,
} from './useSearchActions';

const mocks = vi.hoisted(() => ({
  useAppStore: vi.fn(),
  toast: vi.fn(),
  embed: vi.fn(),
  vectorQuery: vi.fn(),
  generateHyDEQuery: vi.fn(),
  searchRepositoriesWithSemanticReranking: vi.fn(),
  searchRepositoriesWithReranking: vi.fn(),
  getAllStarredRepositories: vi.fn(),
  getUserLists: vi.fn(),
  forceSyncToBackend: vi.fn(),
}));

vi.mock('../../../store/useAppStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../store/useAppStore')>();
  return { ...actual, useAppStore: mocks.useAppStore };
});

vi.mock('../../../hooks/useDialog', () => ({
  useDialog: () => ({ toast: mocks.toast, confirm: vi.fn() }),
}));

vi.mock('../../../services/vectorSearchService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/vectorSearchService')>();
  return {
    ...actual,
    EmbeddingClient: class {
      embed = mocks.embed;
    },
    VectorSearchService: class {
      query = mocks.vectorQuery;
    },
  };
});

vi.mock('../../../services/aiService', () => ({
  AIService: class {
    generateHyDEQuery = mocks.generateHyDEQuery;
    searchRepositoriesWithSemanticReranking = mocks.searchRepositoriesWithSemanticReranking;
    searchRepositoriesWithReranking = mocks.searchRepositoriesWithReranking;
  },
}));

vi.mock('../../../services/githubApi', () => ({
  GitHubApiService: class {
    getAllStarredRepositories = mocks.getAllStarredRepositories;
  },
}));

vi.mock('../../../services/githubApiFactory', () => ({
  createGitHubListsApiService: () => ({
    getUserLists: mocks.getUserLists,
  }),
}));

vi.mock('../../../services/autoSync', () => ({
  forceSyncToBackend: mocks.forceSyncToBackend,
}));

const baseRepo = (overrides: Partial<Repository> & { id: number; full_name: string }): Repository => ({
  name: overrides.full_name.split('/')[1] ?? 'repo',
  description: '',
  html_url: `https://github.com/${overrides.full_name}`,
  stargazers_count: 1,
  forks_count: 0,
  forks: 0,
  language: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
  pushed_at: '2026-01-03T00:00:00.000Z',
  owner: { login: 'owner', avatar_url: 'https://example.com/a.png' },
  topics: [],
  ...overrides,
});

const createStoreState = () => ({
  repositories: [] as Repository[],
  aiConfigs: [{
    id: 'ai-config',
    name: 'Test AI',
    baseUrl: 'https://example.com/v1',
    apiKey: 'ai-key',
    model: 'ai-model',
  }],
  activeAIConfig: 'ai-config',
  language: 'zh' as const,
  setSearchFilters: vi.fn(),
  setSearchResults: vi.fn(),
  githubToken: 'github-token' as string | null,
  setRepositories: vi.fn(),
  setLastSync: vi.fn(),
  setSyncingStars: vi.fn(),
  syncMode: 'stars-only' as const,
  user: { login: 'me' } as { login: string } | null,
  addCustomCategory: vi.fn(),
  customCategories: [] as Category[],
  hiddenDefaultCategoryIds: [] as string[],
  defaultCategoryOverrides: {},
  vectorSearchConfig: {
    enabled: false,
    workerUrl: '',
    authToken: '',
    embeddingConfigId: 'emb',
    indexMode: 'description' as const,
    readmeMaxChars: 6000,
  } as VectorSearchConfig,
  embeddingConfigs: [{
    id: 'emb',
    name: 'Test embedding',
    apiType: 'openai-compatible' as const,
    baseUrl: 'https://example.com/v1',
    apiKey: 'emb-key',
    model: 'emb-model',
  }],
});

let storeState = createStoreState();
const mockUseAppStore = vi.mocked(mocks.useAppStore);
mockUseAppStore.mockImplementation((selector?: (state: typeof storeState) => unknown) =>
  selector ? selector(storeState) : storeState);
(mockUseAppStore as unknown as { getState: () => typeof storeState }).getState = () => storeState;

const identity = <T,>(repos: T[]): T[] => repos;

describe('useSearchActions.aiSearch (vector hit)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState = createStoreState();
  });

  it('queries with default topK 30 / threshold 0.35, boosts scores and sets the skip ref', async () => {
    storeState.vectorSearchConfig = {
      enabled: true,
      workerUrl: 'https://worker.example',
      authToken: 'worker-token',
      embeddingConfigId: 'emb',
      indexMode: 'description',
      readmeMaxChars: 6000,
      enableHyDE: false,
      enableReranking: false,
    };
    storeState.repositories = [
      baseRepo({ id: 1, full_name: 'owner/foo-bar' }),
      baseRepo({ id: 2, full_name: 'owner/other', description: 'has foo inside' }),
      baseRepo({ id: 3, full_name: 'owner/tagged', topics: [] }),
    ];
    // 预置与 list 同名的本地分类，使本用例不触发新建分类分支
    storeState.customCategories = [{ id: 'custom-1', name: 'MyList', icon: 'x', isCustom: true, keywords: [] }];
    mocks.embed.mockResolvedValue([[0.1, 0.2]]);
    mocks.vectorQuery.mockResolvedValue([
      { id: '1', score: 0.9, metadata: { full_name: 'owner/foo-bar', description: '', tags: [] } },
      { id: '2', score: 0.8, metadata: { full_name: '', description: 'the foo thing', tags: [] } },
      { id: '3', score: 0.7, metadata: { full_name: '', description: '', tags: ['FOO'] } },
    ]);

    const { result } = renderHook(() => useSearchActions());
    await act(async () => { await result.current.aiSearch('foo', identity); });

    expect(mocks.vectorQuery).toHaveBeenCalledWith([0.1, 0.2], { topK: 30, threshold: 0.35 });
    expect(result.current.vectorScoreMapRef.current).toEqual({
      query: 'foo',
      scores: new Map([['1', 0.9 + 0.05], ['2', 0.8 + 0.03], ['3', 0.7 + 0.02]]),
    });
    expect(result.current.skipNextTextSearchRef.current).toBe(true);
    // 加分后按分数降序：3(0.72+0.02=0.74)? —— 见下：tag 加分 0.02 → 0.72
    expect(storeState.setSearchResults).toHaveBeenCalledWith([
      storeState.repositories[0],
      storeState.repositories[1],
      storeState.repositories[2],
    ]);
    expect(storeState.setSearchFilters).toHaveBeenCalledWith({ query: 'foo' });
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(result.current.isSearching).toBe(false);
  });

  it('falls back to vector order without a toast when AI reranking fails', async () => {
    storeState.vectorSearchConfig = {
      enabled: true,
      workerUrl: 'https://worker.example',
      authToken: 'worker-token',
      embeddingConfigId: 'emb',
      indexMode: 'description',
      readmeMaxChars: 6000,
      enableHyDE: false,
    };
    storeState.repositories = [
      baseRepo({ id: 1, full_name: 'owner/aaa' }),
      baseRepo({ id: 2, full_name: 'owner/bbb' }),
    ];
    mocks.embed.mockResolvedValue([[0.1]]);
    mocks.vectorQuery.mockResolvedValue([
      { id: '1', score: 0.9, metadata: { full_name: '', description: '', tags: [] } },
      { id: '2', score: 0.8, metadata: { full_name: '', description: '', tags: [] } },
    ]);
    mocks.searchRepositoriesWithSemanticReranking.mockRejectedValue(new Error('rerank down'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = renderHook(() => useSearchActions());
    await act(async () => { await result.current.aiSearch('anything', identity); });
    warnSpy.mockRestore();

    expect(mocks.searchRepositoriesWithSemanticReranking).toHaveBeenCalledTimes(1);
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(storeState.setSearchResults).toHaveBeenCalledWith([
      storeState.repositories[0],
      storeState.repositories[1],
    ]);
  });

  it('falls back to the raw query when HyDE misses the 5s budget', async () => {
    vi.useFakeTimers();
    try {
      storeState.vectorSearchConfig = {
        enabled: true,
        workerUrl: 'https://worker.example',
        authToken: 'worker-token',
        embeddingConfigId: 'emb',
        indexMode: 'description',
        readmeMaxChars: 6000,
      };
      mocks.generateHyDEQuery.mockImplementation(() => new Promise<string>(() => undefined));
      mocks.embed.mockResolvedValue([[0.1]]);
      mocks.vectorQuery.mockResolvedValue([]);
      mocks.searchRepositoriesWithReranking.mockResolvedValue([]);

      const { result } = renderHook(() => useSearchActions());
      let promise!: Promise<void>;
      act(() => { promise = result.current.aiSearch('foo', identity); });
      await act(async () => { await vi.advanceTimersByTimeAsync(5100); });
      await act(async () => { await promise; });

      expect(mocks.embed).toHaveBeenCalledWith(['foo'], 'query');
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the HyDE output when it resolves within the budget', async () => {
    storeState.vectorSearchConfig = {
      enabled: true,
      workerUrl: 'https://worker.example',
      authToken: 'worker-token',
      embeddingConfigId: 'emb',
      indexMode: 'description',
      readmeMaxChars: 6000,
    };
    mocks.generateHyDEQuery.mockResolvedValue('an ideal description of foo');
    mocks.embed.mockResolvedValue([[0.1]]);
    mocks.vectorQuery.mockResolvedValue([]);
    mocks.searchRepositoriesWithReranking.mockResolvedValue([]);

    const { result } = renderHook(() => useSearchActions());
    await act(async () => { await result.current.aiSearch('foo', identity); });
    expect(mocks.embed).toHaveBeenCalledWith(['an ideal description of foo'], 'query');
  });
});

describe('useSearchActions.keywordSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState = createStoreState();
  });

  it('falls back to basic text search when AI reranking fails and vector search found nothing', async () => {
    storeState.vectorSearchConfig = {
      enabled: true,
      workerUrl: 'https://worker.example',
      authToken: 'worker-token',
      embeddingConfigId: 'emb',
      indexMode: 'description',
      readmeMaxChars: 6000,
      enableHyDE: false,
    };
    storeState.repositories = [
      baseRepo({ id: 1, full_name: 'owner/foo-repo' }),
      baseRepo({ id: 2, full_name: 'owner/bar-repo' }),
    ];
    mocks.embed.mockResolvedValue([[0.1]]);
    mocks.vectorQuery.mockResolvedValue([]);
    mocks.searchRepositoriesWithReranking.mockRejectedValue(new Error('ai down'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = renderHook(() => useSearchActions());
    await act(async () => { await result.current.aiSearch('foo', identity); });
    warnSpy.mockRestore();

    expect(mocks.searchRepositoriesWithReranking).toHaveBeenCalledTimes(1);
    expect(storeState.setSearchResults).toHaveBeenCalledWith([storeState.repositories[0]]);
    expect(storeState.setSearchFilters).toHaveBeenCalledWith({ query: 'foo' });
  });

  it('uses basic text search directly when no AI config exists', async () => {
    storeState.aiConfigs = [];
    storeState.repositories = [
      baseRepo({ id: 1, full_name: 'owner/foo-repo' }),
      baseRepo({ id: 2, full_name: 'owner/bar-repo' }),
    ];
    const { result } = renderHook(() => useSearchActions());
    await act(async () => { await result.current.keywordSearch('foo', identity); });

    expect(mocks.searchRepositoriesWithReranking).not.toHaveBeenCalled();
    expect(storeState.setSearchResults).toHaveBeenCalledWith([storeState.repositories[0]]);
  });
});

describe('useSearchActions.syncStars', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState = createStoreState();
  });

  it('keeps the setRepositories → forceSyncToBackend → setLastSync order and applies lists', async () => {
    mocks.getAllStarredRepositories.mockResolvedValue([
      baseRepo({ id: 1, full_name: 'owner/repo-one' }),
    ]);
    mocks.getUserLists.mockResolvedValue([{ id: 'l1', name: 'MyList', isPrivate: false, items: ['owner/repo-one'] }]);
    storeState.repositories = [baseRepo({ id: 1, full_name: 'owner/repo-one' })];
    // 预置与 list 同名的本地分类，使本用例不触发新建分类分支
    storeState.customCategories = [{ id: 'custom-1', name: 'MyList', icon: 'x', isCustom: true, keywords: [] }];

    const { result } = renderHook(() => useSearchActions());
    await act(async () => { await result.current.syncStars('stars-and-lists'); });

    expect(storeState.setRepositories).toHaveBeenCalledTimes(1);
    const written = storeState.setRepositories.mock.calls[0][0] as Repository[];
    expect(written[0].custom_tags).toContain('MyList');
    // list 名命中同名本地分类 → 设分类并加锁
    expect(written[0].custom_category).toBe('MyList');
    expect(written[0].category_locked).toBe(true);
    expect(written[0].last_edited).toEqual(expect.any(String));

    const setOrder = storeState.setRepositories.mock.invocationCallOrder[0];
    const syncOrder = mocks.forceSyncToBackend.mock.invocationCallOrder[0];
    const lastSyncOrder = storeState.setLastSync.mock.invocationCallOrder[0];
    expect(setOrder).toBeLessThan(syncOrder);
    expect(syncOrder).toBeLessThan(lastSyncOrder);

    expect(mocks.toast).toHaveBeenCalledWith(
      '已同步 1 个 list，并应用到 1 个未锁定仓库：MyList(1)',
      'info',
    );
    expect(mocks.toast).toHaveBeenCalledWith('同步完成！所有仓库都是最新的。', 'info');
    expect(storeState.setSyncingStars).toHaveBeenCalledWith(true);
    expect(storeState.setSyncingStars).toHaveBeenLastCalledWith(false);
  });

  it('creates missing categories for cloud lists', async () => {
    mocks.getAllStarredRepositories.mockResolvedValue([baseRepo({ id: 1, full_name: 'owner/repo-one' })]);
    mocks.getUserLists.mockResolvedValue([{ id: 'l1', name: 'BrandNewList', isPrivate: false, items: ['owner/repo-one'] }]);
    storeState.repositories = [baseRepo({ id: 1, full_name: 'owner/repo-one' })];

    const { result } = renderHook(() => useSearchActions());
    await act(async () => { await result.current.syncStars('stars-and-lists'); });

    expect(storeState.addCustomCategory).toHaveBeenCalledTimes(1);
    const created = storeState.addCustomCategory.mock.calls[0][0];
    expect(created.name).toBe('BrandNewList');
    expect(created.id).toMatch(/^custom-sync-\d+-0$/);
    expect(created.isCustom).toBe(true);
    expect(mocks.toast).toHaveBeenCalledWith(
      '已同步 1 个 list，并应用到 1 个未锁定仓库：BrandNewList(1)（新建 1 个分类）',
      'info',
    );
  });

  it('keeps the starred sync result when the list sync fails', async () => {
    mocks.getAllStarredRepositories.mockResolvedValue([baseRepo({ id: 1, full_name: 'owner/repo-one' })]);
    mocks.getUserLists.mockRejectedValue(new Error('lists unavailable'));
    storeState.repositories = [baseRepo({ id: 1, full_name: 'owner/repo-one' })];

    const { result } = renderHook(() => useSearchActions());
    await act(async () => { await result.current.syncStars('stars-and-lists'); });

    expect(mocks.toast).toHaveBeenCalledWith(
      'List 同步失败，星标仓库已同步。请稍后重试，或检查 GitHub Token 权限（需 user scope）。',
      'error',
    );
    expect(storeState.setRepositories).toHaveBeenCalledWith([
      expect.objectContaining({ id: 1, full_name: 'owner/repo-one' }),
    ]);
    expect(mocks.forceSyncToBackend).toHaveBeenCalledTimes(1);
    expect(mocks.toast).toHaveBeenCalledWith('同步完成！所有仓库都是最新的。', 'info');
  });

  it('shows the token-expired message when the sync error mentions token', async () => {
    mocks.getAllStarredRepositories.mockRejectedValue(new Error('Bad credentials: token expired'));
    const { result } = renderHook(() => useSearchActions());
    await act(async () => { await result.current.syncStars(); });

    expect(mocks.toast).toHaveBeenCalledWith('GitHub token 已过期或无效，请重新登录。', 'error');
    expect(storeState.setRepositories).not.toHaveBeenCalled();
  });

  it('toasts the token-missing message before doing anything', async () => {
    storeState.githubToken = null;
    const { result } = renderHook(() => useSearchActions());
    await act(async () => { await result.current.syncStars(); });
    expect(mocks.toast).toHaveBeenCalledWith('GitHub token 未找到，请重新登录。', 'error');
    expect(mocks.getAllStarredRepositories).not.toHaveBeenCalled();
    expect(storeState.setSyncingStars).not.toHaveBeenCalled();
  });
});

describe('useSearchActions pure helpers', () => {
  it('buildSearchPatch applies name/desc/tag boosts', () => {
    const scores = buildSearchPatch('foo', [
      { id: '1', score: 0.9, metadata: { full_name: 'x/foo', description: '', language: '', stars: 0, tags: [] } },
      { id: '2', score: 0.8, metadata: { full_name: '', description: 'a foo b', language: '', stars: 0, tags: [] } },
      { id: '3', score: 0.7, metadata: { full_name: '', description: '', language: '', stars: 0, tags: ['FOO'] } },
      { id: '4', score: 0.6, metadata: { full_name: '', description: '', language: '', stars: 0, tags: [] } },
    ]);
    expect(scores.get('1')).toBe(0.9 + 0.05);
    expect(scores.get('2')).toBe(0.8 + 0.03);
    expect(scores.get('3')).toBe(0.7 + 0.02);
    expect(scores.get('4')).toBe(0.6);
  });

  it('mergeStarredRepositories overwrites syncable fields and backfills license null', () => {
    const storeRepos = [
      baseRepo({ id: 1, full_name: 'owner/one', description: 'old', license: 'MIT', custom_tags: ['keep'] }),
      baseRepo({ id: 2, full_name: 'owner/two' }),
    ];
    const newRepos = [
      baseRepo({ id: 1, full_name: 'owner/one', description: 'new', stargazers_count: 99, license: undefined }),
      baseRepo({ id: 3, full_name: 'owner/three' }),
    ];
    const merged = mergeStarredRepositories(newRepos, storeRepos);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ id: 1, description: 'new', stargazers_count: 99, custom_tags: ['keep'], license: null });
    expect(merged[1]).toMatchObject({ id: 3 });
  });

  it('planListCategories skips reserved names and existing categories', () => {
    const { toCreate, categoryByLowerName } = planListCategories(
      [
        { id: 'l1', name: 'fresh', isPrivate: false, items: [] },
        { id: 'l2', name: 'none', isPrivate: false, items: [] },
        { id: 'l3', name: 'existing', isPrivate: false, items: [] },
      ],
      [{ id: 'c1', name: 'Existing', icon: '', isCustom: false, keywords: [] }],
      (idx) => `custom-sync-123-${idx}`,
    );
    expect(toCreate).toEqual([
      { id: 'custom-sync-123-0', name: 'fresh', icon: ' 📋', isCustom: true, keywords: [] },
    ]);
    expect(categoryByLowerName.get('fresh')).toBe('fresh');
    expect(categoryByLowerName.get('existing')).toBe('Existing');
    expect(categoryByLowerName.has('none')).toBe(false);
  });

  it('applyListsToRepositories tags, locks by category and respects pre-existing locks', () => {
    const categoryByLowerName = new Map([['web apps', 'Web Apps']]);
    const repositories = [
      baseRepo({ id: 1, full_name: 'owner/locked-early', category_locked: true, custom_category: 'Web Apps' }),
      baseRepo({ id: 2, full_name: 'owner/normal' }),
    ];
    const lists = [
      { id: 'l1', name: 'Web Apps', isPrivate: false, items: ['owner/locked-early', 'owner/normal'] },
      { id: 'l2', name: 'Second List', isPrivate: false, items: ['owner/normal'] },
    ];
    const { repositories: mapped, appliedTagsCount } = applyListsToRepositories(repositories, lists, categoryByLowerName);

    // 预存在锁定：仅追加标签，不改分类/锁定
    expect(mapped[0]).toMatchObject({ custom_tags: ['Web Apps'], custom_category: 'Web Apps', category_locked: true });
    expect(mapped[0].last_edited).toBeUndefined();
    // 正常仓库：第一个 list 命中分类 → 设分类并加锁；第二个 list 时仓库已被锁定 → 仅追加标签
    expect(mapped[1]).toMatchObject({ custom_tags: ['Web Apps', 'Second List'], custom_category: 'Web Apps', category_locked: true });
    expect(mapped[1].last_edited).toEqual(expect.any(String));
    expect(appliedTagsCount).toEqual({ 'Web Apps': 2, 'Second List': 1 });
  });
});
