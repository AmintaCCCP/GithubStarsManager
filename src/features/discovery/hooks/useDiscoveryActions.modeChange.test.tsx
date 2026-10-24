import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RefObject } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { useDiscoveryActions } from './useDiscoveryActions';

// src/test/setup.ts 把 store 换成了组件级 mock。本用例验证"模式切换 → effect →
// refreshChannel"的真实链路（refreshChannel 读 latestStateRef），需要真实 store，
// 恢复实际模块。
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

describe('useDiscoveryActions — 搜索模式切换自动重搜（CodeRabbit major 修复回归）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadAllAnalyses.mockResolvedValue(new Map());
    mocks.searchRepositories.mockResolvedValue(emptyPage);
    mocks.searchSemantically.mockResolvedValue(emptyPage);
  });

  it('已有查询时 关键词→语义：由模式变化 effect 以新模式重搜，而不是被签名守卫丢弃', async () => {
    setupStore('keyword');
    const { result } = renderActions();

    await act(async () => { await result.current.refreshChannel('search', 1, false); });
    expect(mocks.searchRepositories).toHaveBeenCalledTimes(1);
    expect(mocks.searchSemantically).not.toHaveBeenCalled();

    await act(async () => { useAppStore.getState().setDiscoverySearchMode('semantic'); });

    await waitFor(() => expect(mocks.searchSemantically).toHaveBeenCalledTimes(1));
    // 关键词请求不再多发；语义管道收到 trimmed 查询与语义选项
    expect(mocks.searchRepositories).toHaveBeenCalledTimes(1);
    expect(mocks.searchSemantically).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'markdown editor',
      expect.objectContaining({ language: 'All' }),
    );
  });

  it('已有查询时 语义→关键词：切回后恢复关键词搜索', async () => {
    setupStore('semantic');
    const { result } = renderActions();

    await act(async () => { await result.current.refreshChannel('search', 1, false); });
    expect(mocks.searchSemantically).toHaveBeenCalledTimes(1);

    await act(async () => { useAppStore.getState().setDiscoverySearchMode('keyword'); });

    await waitFor(() => expect(mocks.searchRepositories).toHaveBeenCalledTimes(1));
    expect(mocks.searchSemantically).toHaveBeenCalledTimes(1);
  });

  it('查询为空时切换模式不触发重搜', async () => {
    setupStore('keyword', '   ');
    renderActions();

    await act(async () => { useAppStore.getState().setDiscoverySearchMode('semantic'); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });

    expect(mocks.searchSemantically).not.toHaveBeenCalled();
    expect(mocks.searchRepositories).not.toHaveBeenCalled();
  });
});
