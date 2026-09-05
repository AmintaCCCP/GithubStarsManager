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
  searchRepositoriesWithSelection: vi.fn(),
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
    searchRepositoriesWithSelection = mocks.searchRepositoriesWithSelection;
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
  syncMode: 'stars-only' as 'stars-only' | 'stars-and-lists',
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

const identity = <T,>(repos: T[]): T[] => repos;

// resetAllMocks 会连同 useAppStore 的 mockImplementation 一起清掉，每次重建。
// 用 resetAllMocks 而非 clearAllMocks：后者不清实现，mockRejectedValue 等会
// 泄漏进后续用例，形成用例顺序依赖。
const setupStoreMocks = () => {
  storeState = createStoreState();
  mockUseAppStore.mockImplementation((selector?: (state: typeof storeState) => unknown) =>
    selector ? selector(storeState) : storeState);
  (mockUseAppStore as unknown as { getState: () => typeof storeState }).getState = () => storeState;
};

describe('useSearchActions.aiSearch (vector hit)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupStoreMocks();
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

  it('falls back to the raw query when HyDE misses the 5s budget and aborts the HyDE request', async () => {
    vi.useFakeTimers();
    try {
      storeState.vectorSearchConfig = {
        enabled: true,
        workerUrl: 'https://worker.example',
        authToken: 'worker-token',
        embeddingConfigId: 'emb',
        indexMode: 'description',
        readmeMaxChars: 6000,
        enableHyDE: true,
        enableReranking: false,
      };
      const hydeSignals: AbortSignal[] = [];
      mocks.generateHyDEQuery.mockImplementation((_q: string, signal: AbortSignal) => {
        hydeSignals.push(signal);
        return new Promise<string>(() => undefined);
      });
      mocks.embed.mockResolvedValue([[0.1]]);
      mocks.vectorQuery.mockResolvedValue([]);
      mocks.searchRepositoriesWithSelection.mockResolvedValue([]);

      const { result } = renderHook(() => useSearchActions());
      let promise!: Promise<void>;
      act(() => { promise = result.current.aiSearch('foo', identity); });
      await act(async () => { await vi.advanceTimersByTimeAsync(5100); });
      await act(async () => { await promise; });

      expect(mocks.embed).toHaveBeenCalledWith(['foo'], 'query');
      // 5s 预算耗尽后 HyDE 局部 controller 必须真正 abort 掉挂起的请求
      expect(hydeSignals[0]?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns early for a blank query without touching search state', async () => {
    const { result } = renderHook(() => useSearchActions());
    await act(async () => { await result.current.aiSearch('   ', identity); });
    expect(mocks.embed).not.toHaveBeenCalled();
    expect(mocks.searchRepositoriesWithSelection).not.toHaveBeenCalled();
    expect(storeState.setSearchResults).not.toHaveBeenCalled();
    expect(storeState.setSearchFilters).not.toHaveBeenCalled();
    expect(result.current.isSearching).toBe(false);
    expect(result.current.skipNextTextSearchRef.current).toBe(false);
  });

  it('falls through to keyword search when the embedding returns no vectors', async () => {
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
      baseRepo({ id: 1, full_name: 'owner/foo-repo' }),
      baseRepo({ id: 2, full_name: 'owner/bar-repo' }),
    ];
    mocks.embed.mockResolvedValue([]);
    mocks.searchRepositoriesWithSelection.mockResolvedValue([storeState.repositories[0]]);

    const { result } = renderHook(() => useSearchActions());
    await act(async () => { await result.current.aiSearch('foo', identity); });

    expect(mocks.vectorQuery).not.toHaveBeenCalled();
    expect(storeState.setSearchResults).toHaveBeenCalledWith([storeState.repositories[0]]);
    expect(storeState.setSearchFilters).toHaveBeenCalledWith({ query: 'foo' });
  });

  it('falls through to keyword search when vector hits match no local repository', async () => {
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
      baseRepo({ id: 1, full_name: 'owner/foo-repo' }),
      baseRepo({ id: 2, full_name: 'owner/bar-repo' }),
    ];
    mocks.embed.mockResolvedValue([[0.1]]);
    mocks.vectorQuery.mockResolvedValue([
      { id: '99', score: 0.9, metadata: { full_name: '', description: '', tags: [] } },
    ]);
    mocks.searchRepositoriesWithSelection.mockResolvedValue([storeState.repositories[0]]);

    const { result } = renderHook(() => useSearchActions());
    await act(async () => { await result.current.aiSearch('foo', identity); });

    // 落入 keywordSearch 后 AI 精选成功：结果须像向量路径一样挡住过滤 effect 的覆盖
    expect(result.current.skipNextTextSearchRef.current).toBe(true);
    expect(storeState.setSearchResults).toHaveBeenCalledWith([storeState.repositories[0]]);
    expect(storeState.setSearchFilters).toHaveBeenCalledWith({ query: 'foo' });
  });

  it('falls back to keyword search when the vector pipeline throws', async () => {
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
      baseRepo({ id: 1, full_name: 'owner/foo-repo' }),
      baseRepo({ id: 2, full_name: 'owner/bar-repo' }),
    ];
    mocks.embed.mockRejectedValue(new Error('embed down'));
    mocks.searchRepositoriesWithSelection.mockResolvedValue([storeState.repositories[0]]);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = renderHook(() => useSearchActions());
    await act(async () => { await result.current.aiSearch('foo', identity); });
    warnSpy.mockRestore();

    expect(storeState.setSearchResults).toHaveBeenCalledWith([storeState.repositories[0]]);
    expect(storeState.setSearchFilters).toHaveBeenCalledWith({ query: 'foo' });
    expect(result.current.isSearching).toBe(false);
  });

  it('uses the HyDE output when it resolves within the budget', async () => {
    storeState.vectorSearchConfig = {
      enabled: true,
      workerUrl: 'https://worker.example',
      authToken: 'worker-token',
      embeddingConfigId: 'emb',
      indexMode: 'description',
      readmeMaxChars: 6000,
      enableHyDE: true,
      enableReranking: false,
    };
    mocks.generateHyDEQuery.mockResolvedValue('an ideal description of foo');
    mocks.embed.mockResolvedValue([[0.1]]);
    mocks.vectorQuery.mockResolvedValue([]);
    mocks.searchRepositoriesWithSelection.mockResolvedValue([]);

    const { result } = renderHook(() => useSearchActions());
    await act(async () => { await result.current.aiSearch('foo', identity); });
    expect(mocks.embed).toHaveBeenCalledWith(['an ideal description of foo'], 'query');
  });
});

describe('useSearchActions.keywordSearch', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupStoreMocks();
  });

  it('falls back to basic text search when AI selection fails and vector search found nothing', async () => {
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
    mocks.searchRepositoriesWithSelection.mockRejectedValue(new Error('ai down'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = renderHook(() => useSearchActions());
    await act(async () => { await result.current.aiSearch('foo', identity); });
    warnSpy.mockRestore();

    expect(mocks.searchRepositoriesWithSelection).toHaveBeenCalledTimes(1);
    expect(storeState.setSearchResults).toHaveBeenCalledWith([storeState.repositories[0]]);
    expect(storeState.setSearchFilters).toHaveBeenCalledWith({ query: 'foo' });
    // AI 失败走基础文本搜索兜底：顺序非 AI 产物，无需挡 SearchBar 的过滤 effect
    expect(result.current.skipNextTextSearchRef.current).toBe(false);
  });

  it('presents an empty result when AI selection explicitly returns no relevant repositories', async () => {
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
    // 模型明确判断"没有相关仓库"：返回 [] 是合法结果，UI 应呈现空态而非全库噪声
    mocks.searchRepositoriesWithSelection.mockResolvedValue([]);

    const { result } = renderHook(() => useSearchActions());
    await act(async () => { await result.current.aiSearch('完全不相关的东西', identity); });

    expect(storeState.setSearchResults).toHaveBeenCalledWith([]);
    expect(storeState.setSearchFilters).toHaveBeenCalledWith({ query: '完全不相关的东西' });
    // 空态是模型的明确判断，同样必须挡住 SearchBar 过滤 effect 的回填
    expect(result.current.skipNextTextSearchRef.current).toBe(true);
  });

  it('keeps the AI-provided ordering instead of the default star ordering', async () => {
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
      baseRepo({ id: 1, full_name: 'owner/high-star', stargazers_count: 1000 }),
      baseRepo({ id: 2, full_name: 'owner/low-star', stargazers_count: 3 }),
    ];
    mocks.embed.mockResolvedValue([[0.1]]);
    mocks.vectorQuery.mockResolvedValue([]);
    // LLM 精选把低 star 的排在前面：applyFilters 的 star 降序不能覆盖该顺序
    mocks.searchRepositoriesWithSelection.mockResolvedValue([
      storeState.repositories[1],
      storeState.repositories[0],
    ]);
    // 模拟 SearchBar 真实的 applyFilters：按 star 降序排序
    const starSort = (repos: Repository[]) =>
      [...repos].sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0));

    const { result } = renderHook(() => useSearchActions());
    await act(async () => { await result.current.aiSearch('foo', starSort); });

    expect(storeState.setSearchResults).toHaveBeenCalledWith([
      storeState.repositories[1],
      storeState.repositories[0],
    ]);
    // AI 结果的顺序/子集/空态不能被 SearchBar 的过滤 effect 用基础文本搜索覆盖：
    // keywordSearch 需像向量路径一样置位 skipNextTextSearchRef
    expect(result.current.skipNextTextSearchRef.current).toBe(true);
  });

  it('toasts the fallback reason when AI selection reports a failure', async () => {
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
    // 端点抖动/配置问题：service 回调 ai_failed，词法命中照常返回
    mocks.searchRepositoriesWithSelection.mockImplementation(
      (_repos: Repository[], _query: string, opts?: { onFallback?: (reason: string) => void }) => {
        opts?.onFallback?.('ai_failed');
        return Promise.resolve([storeState.repositories[0]]);
      },
    );

    const { result } = renderHook(() => useSearchActions());
    await act(async () => { await result.current.aiSearch('foo', identity); });

    expect(mocks.toast).toHaveBeenCalledWith('AI 请求失败，已回退本地词法搜索', 'warning');
    expect(storeState.setSearchResults).toHaveBeenCalledWith([storeState.repositories[0]]);
  });

  it('uses basic text search directly when no AI config exists', async () => {
    storeState.aiConfigs = [];
    storeState.repositories = [
      baseRepo({ id: 1, full_name: 'owner/foo-repo' }),
      baseRepo({ id: 2, full_name: 'owner/bar-repo' }),
    ];
    const { result } = renderHook(() => useSearchActions());
    await act(async () => { await result.current.keywordSearch('foo', identity); });

    expect(mocks.searchRepositoriesWithSelection).not.toHaveBeenCalled();
    expect(storeState.setSearchResults).toHaveBeenCalledWith([storeState.repositories[0]]);
  });
});

describe('useSearchActions.syncStars', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupStoreMocks();
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

  it('syncs lists when auto mode follows the stars-and-lists config', async () => {
    mocks.getAllStarredRepositories.mockResolvedValue([baseRepo({ id: 1, full_name: 'owner/repo-one' })]);
    mocks.getUserLists.mockResolvedValue([{ id: 'l1', name: 'MyList', isPrivate: false, items: ['owner/repo-one'] }]);
    storeState.repositories = [baseRepo({ id: 1, full_name: 'owner/repo-one' })];
    storeState.syncMode = 'stars-and-lists';
    storeState.customCategories = [{ id: 'custom-1', name: 'MyList', icon: 'x', isCustom: true, keywords: [] }];

    const { result } = renderHook(() => useSearchActions());
    await act(async () => { await result.current.syncStars(); }); // mode 'auto'

    expect(mocks.getUserLists).toHaveBeenCalledTimes(1);
    const written = storeState.setRepositories.mock.calls[0][0] as Repository[];
    expect(written[0].custom_tags).toContain('MyList');
  });

  it('keeps the starred result and toasts the list failure when the user login is missing', async () => {
    mocks.getAllStarredRepositories.mockResolvedValue([baseRepo({ id: 1, full_name: 'owner/repo-one' })]);
    storeState.user = null;

    const { result } = renderHook(() => useSearchActions());
    await act(async () => { await result.current.syncStars('stars-and-lists'); });

    expect(mocks.getUserLists).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(
      'List 同步失败，星标仓库已同步。请稍后重试，或检查 GitHub Token 权限（需 user scope）。',
      'error',
    );
    expect(storeState.setRepositories).toHaveBeenCalledWith([
      expect.objectContaining({ id: 1, full_name: 'owner/repo-one' }),
    ]);
    expect(mocks.forceSyncToBackend).toHaveBeenCalledTimes(1);
  });

  it('toasts the created-categories summary when no list item matches a local repo', async () => {
    mocks.getAllStarredRepositories.mockResolvedValue([baseRepo({ id: 1, full_name: 'owner/repo-one' })]);
    mocks.getUserLists.mockResolvedValue([{ id: 'l1', name: 'BrandNewList', isPrivate: false, items: [] }]);
    storeState.repositories = [baseRepo({ id: 1, full_name: 'owner/repo-one' })];

    const { result } = renderHook(() => useSearchActions());
    await act(async () => { await result.current.syncStars('stars-and-lists'); });

    expect(storeState.addCustomCategory).toHaveBeenCalledTimes(1);
    expect(mocks.toast).toHaveBeenCalledWith('已同步 1 个 list（新建 1 个分类）。', 'info');
  });

  it('toasts the new-repositories count when the sync finds unseen repos', async () => {
    storeState.repositories = [baseRepo({ id: 1, full_name: 'owner/repo-one' })];
    mocks.getAllStarredRepositories.mockResolvedValue([
      baseRepo({ id: 1, full_name: 'owner/repo-one' }),
      baseRepo({ id: 2, full_name: 'owner/repo-two' }),
    ]);

    const { result } = renderHook(() => useSearchActions());
    await act(async () => { await result.current.syncStars('stars-only'); });

    expect(mocks.toast).toHaveBeenCalledWith('同步完成！发现 1 个新仓库。', 'success');
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
