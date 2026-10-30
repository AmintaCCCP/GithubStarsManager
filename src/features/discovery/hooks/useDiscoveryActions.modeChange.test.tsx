import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RefObject } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { buildDiscoverySearchKey, getLastSettledSearchKey, useDiscoveryActions } from './useDiscoveryActions';

// src/test/setup.ts 把 store 换成了组件级 mock。本用例验证搜索刷新、取消和
// 查询键的真实链路（refreshChannel 读 latestStateRef），需要真实 store。
vi.mock('../../../store/useAppStore', async () => await vi.importActual('../../../store/useAppStore'));

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  searchRepositories: vi.fn(),
  searchSemantically: vi.fn(),
  loadAllAnalyses: vi.fn(),
}));

vi.mock('../../../hooks/useDialog', () => ({
  useDialog: () => ({ toast: mocks.toast, confirm: vi.fn() }),
}));

vi.mock('../../../services/githubApiFactory', () => ({
  createGitHubApiService: () => ({
    searchRepositories: mocks.searchRepositories,
  }),
}));

vi.mock('../../../services/aiService', () => ({
  AIService: class {},
  isAbortError: (error: unknown) => error instanceof Error && error.name === 'AbortError',
}));

vi.mock('../../../services/semanticRepoSearchService', () => ({
  searchRepositoriesSemantically: mocks.searchSemantically,
}));

vi.mock('../../../services/discoveryAnalysisStorage', () => ({
  discoveryAnalysisStorage: { loadAllAnalyses: mocks.loadAllAnalyses },
}));

const setupStore = (mode: 'keyword' | 'semantic', query = 'markdown editor') => {
  useAppStore.setState({
    githubToken: 'token-test',
    selectedDiscoveryChannel: 'search',
    discoverySearchQuery: query,
    discoverySearchMode: mode,
    discoveryLanguage: 'All',
    discoveryPlatform: 'All',
    discoverySortBy: 'BestMatch',
    discoverySortOrder: 'Descending',
    activeAIConfig: 'cfg-1',
    aiConfigs: [{
      id: 'cfg-1',
      name: 'cfg',
      baseUrl: 'https://api.example.test',
      apiKey: 'key',
      model: 'model-x',
      isActive: true,
    }],
  });
};

const renderActions = () => renderHook(() => useDiscoveryActions({ current: null } as RefObject<HTMLDivElement | null>));

const emptyPage = { repos: [], hasMore: false, nextPageIndex: 2, totalCount: 0 };

describe('useDiscoveryActions — 搜索生命周期', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadAllAnalyses.mockResolvedValue(new Map());
    mocks.searchRepositories.mockResolvedValue(emptyPage);
    mocks.searchSemantically.mockResolvedValue(emptyPage);
  });

  it('刷新完成后记录查询键；模式变化不在 hook 内重复触发搜索', async () => {
    setupStore('keyword');
    const { result } = renderActions();

    await act(async () => { await result.current.refreshChannel('search', 1, false); });
    expect(mocks.searchRepositories).toHaveBeenCalledTimes(1);
    expect(mocks.searchSemantically).not.toHaveBeenCalled();
    expect(getLastSettledSearchKey()).toBe(buildDiscoverySearchKey(
      'markdown editor',
      'keyword',
      {
        owner: useAppStore.getState().githubToken,
        platform: useAppStore.getState().discoveryPlatform,
        language: useAppStore.getState().discoveryLanguage,
        sortBy: useAppStore.getState().discoverySortBy,
        sortOrder: useAppStore.getState().discoverySortOrder,
      },
    ));

    await act(async () => { useAppStore.getState().setDiscoverySearchMode('semantic'); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });

    // DiscoveryView 的查询键守卫负责按新模式发起一次搜索；hook 不再保留
    // 旧的 mode-change effect，否则会出现重复请求。
    expect(mocks.searchRepositories).toHaveBeenCalledTimes(1);
    expect(mocks.searchSemantically).not.toHaveBeenCalled();
  });

  it('停止语义搜索会中止请求、清理加载态，并记录已处理键防止重挂载后重跑', async () => {
    let searchSignal: AbortSignal | undefined;
    mocks.searchSemantically.mockImplementation(async (_api, _ai, _query, options) => {
      searchSignal = options.signal;
      await new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        }, { once: true });
      });
      return emptyPage;
    });
    setupStore('semantic');
    const { result } = renderActions();

    let pending!: Promise<void>;
    act(() => { pending = result.current.refreshChannel('search', 1, false); });
    await waitFor(() => expect(searchSignal).toBeDefined());

    act(() => { result.current.handleAbortSearch(); });
    await act(async () => { await pending; });

    expect(searchSignal?.aborted).toBe(true);
    expect(useAppStore.getState().discoveryIsLoading.search).toBe(false);
    expect(getLastSettledSearchKey()).toBe(buildDiscoverySearchKey(
      'markdown editor',
      'semantic',
      {
        owner: useAppStore.getState().githubToken,
        platform: useAppStore.getState().discoveryPlatform,
        language: useAppStore.getState().discoveryLanguage,
        sortBy: useAppStore.getState().discoverySortBy,
        sortOrder: useAppStore.getState().discoverySortOrder,
      },
    ));
  });

  it('停止关键词搜索也会中止底层 GitHub 请求', async () => {
    let searchSignal: AbortSignal | undefined;
    mocks.searchRepositories.mockImplementation(async (
      _query: string,
      _platform: unknown,
      _language: unknown,
      _sortBy: unknown,
      _sortOrder: unknown,
      _page: number,
      _perPage: number,
      signal?: AbortSignal,
    ) => {
      searchSignal = signal;
      await new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        }, { once: true });
      });
      return emptyPage;
    });
    setupStore('keyword');
    const { result } = renderActions();

    let pending!: Promise<void>;
    act(() => { pending = result.current.refreshChannel('search', 1, false); });
    await waitFor(() => expect(searchSignal).toBeDefined());

    act(() => { result.current.handleAbortSearch(); });
    await act(async () => { await pending; });

    expect(searchSignal?.aborted).toBe(true);
    expect(useAppStore.getState().discoveryIsLoading.search).toBe(false);
  });

  it('查询为空时切换模式不触发重搜', async () => {
    setupStore('keyword', '   ');
    renderActions();

    await act(async () => { useAppStore.getState().setDiscoverySearchMode('semantic'); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });

    expect(mocks.searchSemantically).not.toHaveBeenCalled();
    expect(mocks.searchRepositories).not.toHaveBeenCalled();
  });

  it('搜索键包含所有会改变请求的筛选条件', () => {
    const base = buildDiscoverySearchKey('markdown editor', 'semantic', {
      owner: 'token',
      platform: 'GitHub',
      language: 'TypeScript',
      sortBy: 'BestMatch',
      sortOrder: 'Descending',
    });
    const variants = [
      buildDiscoverySearchKey('markdown editor', 'semantic', {
        owner: 'token', platform: 'GitLab', language: 'TypeScript', sortBy: 'BestMatch', sortOrder: 'Descending',
      }),
      buildDiscoverySearchKey('markdown editor', 'semantic', {
        owner: 'token', platform: 'GitHub', language: 'Go', sortBy: 'BestMatch', sortOrder: 'Descending',
      }),
      buildDiscoverySearchKey('markdown editor', 'semantic', {
        owner: 'token', platform: 'GitHub', language: 'TypeScript', sortBy: 'Stars', sortOrder: 'Descending',
      }),
      buildDiscoverySearchKey('markdown editor', 'semantic', {
        owner: 'token', platform: 'GitHub', language: 'TypeScript', sortBy: 'BestMatch', sortOrder: 'Ascending',
      }),
    ];

    expect(new Set([base, ...variants]).size).toBe(5);
  });

  it('卸载后的旧请求不能清除新实例搜索的加载态', async () => {
    let resolveOld!: (value: typeof emptyPage) => void;
    mocks.searchRepositories.mockImplementationOnce(() => new Promise(resolve => {
      resolveOld = resolve;
    }));
    setupStore('keyword');
    const oldHook = renderActions();
    let oldPending!: Promise<void>;
    act(() => { oldPending = oldHook.result.current.refreshChannel('search', 1, false); });
    await waitFor(() => expect(useAppStore.getState().discoveryIsLoading.search).toBe(true));
    oldHook.unmount();

    let resolveNew!: (value: typeof emptyPage) => void;
    mocks.searchRepositories.mockImplementationOnce(() => new Promise(resolve => {
      resolveNew = resolve;
    }));
    const newHook = renderActions();
    let newPending!: Promise<void>;
    act(() => { newPending = newHook.result.current.refreshChannel('search', 1, false); });
    await waitFor(() => expect(useAppStore.getState().discoveryIsLoading.search).toBe(true));

    await act(async () => {
      resolveOld(emptyPage);
      await oldPending;
    });
    expect(useAppStore.getState().discoveryIsLoading.search).toBe(true);

    await act(async () => {
      resolveNew(emptyPage);
      await newPending;
    });
    newHook.unmount();
  });
});
