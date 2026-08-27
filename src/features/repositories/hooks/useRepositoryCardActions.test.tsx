import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../../../types';
import { useRepositoryCardActions } from './useRepositoryCardActions';
import { useAppStore } from '../../../store/useAppStore';

const mocks = vi.hoisted(() => ({
  useAppStore: vi.fn(),
  toast: vi.fn(),
  confirm: vi.fn(),
  analyzeRepository: vi.fn(),
  createFailedAnalysisResult: vi.fn((error: string) => ({
    analyzed_at: '2026-08-25T00:00:00.000Z',
    analysis_error: error,
  })),
  findSimilarRepositories: vi.fn(),
  forceSyncToBackend: vi.fn(),
  unstarRepository: vi.fn(),
  getRepositoryReadme: vi.fn(),
  loggerInfo: vi.fn(),
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: mocks.useAppStore,
}));

vi.mock('../../../hooks/useDialog', () => ({
  useDialog: () => ({ toast: mocks.toast, confirm: mocks.confirm }),
}));

vi.mock('../../../services/aiAnalysisHelper', () => ({
  analyzeRepository: mocks.analyzeRepository,
  createFailedAnalysisResult: mocks.createFailedAnalysisResult,
}));

vi.mock('../../../services/vectorSearchService', () => ({
  EmbeddingClient: vi.fn(),
  VectorSearchService: vi.fn(),
  findSimilarRepositories: mocks.findSimilarRepositories,
}));

vi.mock('../../../services/autoSync', () => ({
  forceSyncToBackend: mocks.forceSyncToBackend,
}));

vi.mock('../../../services/githubApi', () => ({
  GitHubApiService: class {
    unstarRepository = mocks.unstarRepository;
    getRepositoryReadme = mocks.getRepositoryReadme;
  },
}));

vi.mock('../../../services/logger', () => ({
  logger: { info: mocks.loggerInfo },
}));

const repository: Repository = {
  id: 1,
  name: 'example-repository',
  full_name: 'owner/example-repository',
  description: 'Repository description',
  html_url: 'https://github.com/owner/example-repository',
  stargazers_count: 128,
  forks_count: 3,
  forks: 3,
  language: 'TypeScript',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
  pushed_at: '2026-01-03T00:00:00.000Z',
  owner: {
    login: 'owner',
    avatar_url: 'https://example.com/avatar.png',
  },
  topics: ['test'],
};

const createStoreState = () => ({
  releaseSubscriptions: new Set<number>(),
  analyzingRepositoryIds: new Set<number>(),
  githubToken: 'github-token',
  activeAIConfig: 'ai-config',
  setAnalyzingRepository: vi.fn(),
  language: 'zh' as const,
  updateRepository: vi.fn(),
  deleteRepository: vi.fn(),
  vectorSearchConfig: {
    enabled: true,
    workerUrl: 'https://worker.example.com',
    authToken: 'worker-token',
    embeddingConfigId: 'embedding-config',
    indexMode: 'readme' as const,
    readmeMaxChars: 6000,
  },
  vectorSearchStatus: { connected: true, vectorCount: 1, dimensions: 1536 },
  embeddingConfigs: [{
    id: 'embedding-config',
    name: 'Test embedding',
    apiType: 'openai-compatible' as const,
    baseUrl: 'https://example.com/v1',
    apiKey: 'embedding-key',
    model: 'embedding-model',
    dimensions: 1536,
    isActive: true,
  }],
  activeEmbeddingConfig: 'embedding-config',
  repositories: [repository],
  enterSimilarView: vi.fn(),
  aiConfigs: [{
    id: 'ai-config',
    name: 'Test AI',
    baseUrl: 'https://example.com/v1',
    apiKey: 'ai-key',
    model: 'ai-model',
  }],
  toggleReleaseSubscription: vi.fn(),
});

let storeState = createStoreState();
const mockUseAppStore = vi.mocked(useAppStore);
const allCategories: [] = [];

const renderActions = (targetRepository = repository) => renderHook(() => (
  useRepositoryCardActions({ repository: targetRepository, allCategories })
));

describe('useRepositoryCardActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState = createStoreState();
    mockUseAppStore.mockImplementation(((selector?: (state: typeof storeState) => unknown) => (
      selector ? selector(storeState) : storeState
    )) as typeof useAppStore);
    mocks.confirm.mockResolvedValue(true);
    mocks.forceSyncToBackend.mockResolvedValue(undefined);
    mocks.unstarRepository.mockResolvedValue(undefined);
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      callback(performance.now());
      return 1;
    }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns a stable view API while its dependencies are unchanged', () => {
    const { result, rerender } = renderActions();
    const actions = result.current;

    rerender();

    expect(result.current).toBe(actions);
  });

  it('aborts an in-flight analysis and clears the store marker on unmount', async () => {
    let capturedSignal: AbortSignal | undefined;
    mocks.analyzeRepository.mockImplementation(({ signal }: { signal: AbortSignal }) => {
      capturedSignal = signal;
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });
    const { result, unmount } = renderActions();

    let analysisPromise!: Promise<void>;
    await act(async () => {
      analysisPromise = result.current.analyze();
    });
    await waitFor(() => expect(mocks.analyzeRepository).toHaveBeenCalledTimes(1));

    unmount();
    await expect(analysisPromise).resolves.toBeUndefined();

    expect(capturedSignal?.aborted).toBe(true);
    expect(storeState.setAnalyzingRepository).toHaveBeenCalledWith(repository.id, true);
    expect(storeState.setAnalyzingRepository).toHaveBeenLastCalledWith(repository.id, false);
  });

  it('does not start re-analysis when the confirmation is cancelled', async () => {
    mocks.confirm.mockResolvedValue(false);
    const analyzedRepository = {
      ...repository,
      analyzed_at: '2026-08-24T00:00:00.000Z',
    };
    const { result } = renderActions(analyzedRepository);

    await act(async () => {
      await result.current.analyze();
    });

    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(mocks.analyzeRepository).not.toHaveBeenCalled();
    expect(storeState.setAnalyzingRepository).not.toHaveBeenCalled();
  });

  it('reports an unavailable vector search without creating a search request', async () => {
    storeState.vectorSearchConfig.enabled = false;
    const { result } = renderActions();

    expect(result.current.vectorSearchAvailable).toBe(false);
    await act(async () => {
      await result.current.findSimilar();
    });

    expect(mocks.findSimilarRepositories).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(
      '向量搜索未就绪：请先在设置中开启向量搜索并完成索引。',
      'error',
    );
  });

  it('stores the PR-03 failure patch and preserves the failure toast on AI errors', async () => {
    mocks.analyzeRepository.mockRejectedValue(new Error('model unavailable'));
    const { result } = renderActions();

    await act(async () => {
      await result.current.analyze();
    });

    expect(storeState.updateRepository).toHaveBeenCalledWith(expect.objectContaining({
      id: repository.id,
      analyzed_at: '2026-08-25T00:00:00.000Z',
      analysis_failed: true,
      analysis_error: 'model unavailable',
    }));
    expect(mocks.toast).toHaveBeenCalledWith('AI分析失败，请检查AI配置和网络连接。', 'error');
    expect(mocks.forceSyncToBackend).not.toHaveBeenCalled();
  });

  it('stores the PR-03 success patch without triggering a backend sync', async () => {
    mocks.analyzeRepository.mockResolvedValue({
      summary: 'AI summary',
      tags: ['ai-tag'],
      platforms: ['web'],
      custom_category: 'Tools',
      category_locked: true,
      analyzed_at: '2026-08-25T00:00:00.000Z',
    });
    const { result } = renderActions();

    await act(async () => {
      await result.current.analyze();
    });

    expect(storeState.updateRepository).toHaveBeenCalledWith(expect.objectContaining({
      id: repository.id,
      ai_summary: 'AI summary',
      ai_tags: ['ai-tag'],
      analysis_failed: false,
    }));
    expect(mocks.forceSyncToBackend).not.toHaveBeenCalled();
  });

  it('enters the similar view with a README-symmetric card query and without triggering a backend sync', async () => {
    mocks.findSimilarRepositories.mockResolvedValue([]);
    const { result } = renderActions();

    await act(async () => {
      await result.current.findSimilar();
    });

    expect(mocks.findSimilarRepositories).toHaveBeenCalledWith(repository, expect.objectContaining({
      indexMode: 'readme',
      readmeMaxChars: 6000,
      readmeFetcher: expect.any(Function),
      allRepos: storeState.repositories,
    }));
    expect(storeState.enterSimilarView).toHaveBeenCalledWith([], repository);
    expect(mocks.forceSyncToBackend).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith('未找到相似的仓库。', 'info');
  });

  it('does not delete local data or trigger a backend sync when remote unstar fails', async () => {
    mocks.unstarRepository.mockRejectedValue(new Error('GitHub unavailable'));
    const { result } = renderActions();

    await act(async () => {
      await result.current.unstar();
    });

    expect(storeState.deleteRepository).not.toHaveBeenCalled();
    expect(mocks.forceSyncToBackend).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith('取消 Star 失败，请检查网络连接或重新登录。', 'error');
  });

  it('syncs only after a successful remote unstar and local deletion', async () => {
    const { result } = renderActions();

    await act(async () => {
      await result.current.unstar();
    });

    expect(mocks.unstarRepository).toHaveBeenCalledWith('owner', 'example-repository');
    expect(storeState.deleteRepository).toHaveBeenCalledWith(repository.id);
    expect(mocks.forceSyncToBackend).toHaveBeenCalledOnce();
    expect(mocks.toast).toHaveBeenCalledWith('已成功取消 Star', 'success');
  });
});
