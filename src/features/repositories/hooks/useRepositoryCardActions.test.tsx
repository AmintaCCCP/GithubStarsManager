import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../../../types';
import { useRepositoryCardActions } from './useRepositoryCardActions';
import { useAppStore } from '../../../store/useAppStore';
import { bumpAccountSessionGeneration } from '../../../store/helpers/accountWorkspace';

const mocks = vi.hoisted(() => ({
  useAppStore: vi.fn(),
  toast: vi.fn(),
  confirm: vi.fn(),
  analyzeRepository: vi.fn(),
  createFailedAnalysisResult: vi.fn((error: string) => ({
    analyzed_at: '2026-08-25T00:00:00.000Z',
    analysis_error: error,
  })),
  runSimilarRepositoryPipeline: vi.fn(),
  aiServiceConstructor: vi.fn(),
  crossEncoderConstructor: vi.fn(),
  isAbortError: vi.fn((error: unknown) => (
    Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError')
  )),
  forceSyncToBackend: vi.fn(),
  markPendingAccountSync: vi.fn(),
  markPendingRepositoryDeletion: vi.fn(),
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
}));

vi.mock('../../../services/aiService', () => ({
  AIService: mocks.aiServiceConstructor,
  isAbortError: mocks.isAbortError,
}));

vi.mock('../../../services/crossEncoderReranker', () => ({
  CrossEncoderReranker: mocks.crossEncoderConstructor,
}));

vi.mock('../../../services/similarRepositoryPipeline', () => ({
  runSimilarRepositoryPipeline: mocks.runSimilarRepositoryPipeline,
}));

vi.mock('../../../services/autoSync', () => ({
  forceSyncToBackend: mocks.forceSyncToBackend,
  markPendingAccountSync: mocks.markPendingAccountSync,
  markPendingRepositoryDeletion: mocks.markPendingRepositoryDeletion,
  withAccountSwitchGuardSync: (fn: () => unknown) => fn(),
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

    expect(mocks.runSimilarRepositoryPipeline).not.toHaveBeenCalled();
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
    mocks.runSimilarRepositoryPipeline.mockResolvedValue({
      repositories: [],
      diagnostics: {},
    });
    const { result } = renderActions();

    await act(async () => {
      await result.current.findSimilar();
    });

    expect(mocks.runSimilarRepositoryPipeline).toHaveBeenCalledWith(expect.objectContaining({
      source: repository,
      repositories: storeState.repositories,
      vectorConfig: storeState.vectorSearchConfig,
      aiService: expect.anything(),
      crossEncoder: expect.anything(),
      readmeFetcher: expect.any(Function),
      signal: expect.any(AbortSignal),
    }));
    expect(storeState.enterSimilarView).toHaveBeenCalledWith([], repository);
    expect(mocks.forceSyncToBackend).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith('未找到相似的仓库。', 'info');
  });

  it('aborts a superseded similar search without entering the view', async () => {
    let capturedSignal: AbortSignal | undefined;
    mocks.runSimilarRepositoryPipeline.mockImplementation(({ signal }: { signal: AbortSignal }) => {
      capturedSignal = signal;
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });
    const { result, unmount } = renderActions();

    let promise!: Promise<void>;
    await act(async () => {
      promise = result.current.findSimilar();
    });
    await waitFor(() => expect(mocks.runSimilarRepositoryPipeline).toHaveBeenCalledTimes(1));

    unmount();
    await expect(promise).resolves.toBeUndefined();

    expect(capturedSignal?.aborted).toBe(true);
    expect(storeState.enterSimilarView).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.any(String), 'error');
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

/**
 * 账号代次校验回归（Issue #611 审计修复）：分析/相似搜索/取消星标在等待期间
 * 切号后，结果绝不写入切号后的当前账号工作区；分析标记的清理只作用于
 * 发起账号仍是当前账号的工作区。
 */
describe('useRepositoryCardActions account switch guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState = createStoreState();
    mockUseAppStore.mockImplementation(((selector?: (state: typeof storeState) => unknown) => (
      selector ? selector(storeState) : storeState
    )) as typeof useAppStore);
    (mockUseAppStore as unknown as { getState: () => typeof storeState }).getState = () => storeState;
    (storeState as { user?: unknown }).user = { id: 1, login: 'me', avatar_url: '' };
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

  const switchToB = () => {
    (storeState as { user?: unknown }).user = { id: 2, login: 'other', avatar_url: '' };
  };

  it('drops the analysis result but clears the old-generation analyzing marker after a switch', async () => {
    mocks.analyzeRepository.mockImplementation(async () => {
      switchToB();
      return { summary: 's', tags: [], platforms: [], custom_category: null, category_locked: false, analyzed_at: '2026-09-01T00:00:00.000Z' };
    });
    const { result } = renderActions();

    await act(async () => { await result.current.analyze(); });

    expect(storeState.updateRepository).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
    // R2-C19：结果被丢弃，但本请求自己的忙标记必须清除——切号（同账号换
    // 凭据只推进代次）后 isAnalyzing 不得永久残留 true。
    expect(storeState.setAnalyzingRepository).toHaveBeenCalledTimes(2);
    expect(storeState.setAnalyzingRepository).toHaveBeenNthCalledWith(1, 1, true);
    expect(storeState.setAnalyzingRepository).toHaveBeenNthCalledWith(2, 1, false);
  });

  it('drops the analysis failure patch but clears the old-generation marker after a switch', async () => {
    mocks.analyzeRepository.mockImplementation(async () => {
      switchToB();
      throw new Error('ai down');
    });
    const { result } = renderActions();

    await act(async () => { await result.current.analyze(); });

    expect(storeState.updateRepository).not.toHaveBeenCalled();
    expect(storeState.setAnalyzingRepository).toHaveBeenCalledTimes(2);
    expect(storeState.setAnalyzingRepository).toHaveBeenLastCalledWith(1, false);
  });

  it('does not enter the similar view after a switch', async () => {
    mocks.runSimilarRepositoryPipeline.mockImplementation(async () => {
      switchToB();
      return { repositories: [repository], diagnostics: {} };
    });
    const { result } = renderActions();

    await act(async () => { await result.current.findSimilar(); });

    expect(storeState.enterSimilarView).not.toHaveBeenCalled();
  });

  it('stops the unstar flow before the remote call when the account switched during confirm', async () => {
    mocks.confirm.mockImplementation(async () => {
      switchToB();
      return true;
    });
    const { result } = renderActions();

    await act(async () => { await result.current.unstar(); });

    expect(mocks.unstarRepository).not.toHaveBeenCalled();
    expect(storeState.deleteRepository).not.toHaveBeenCalled();
    expect(mocks.forceSyncToBackend).not.toHaveBeenCalled();
  });

  it('skips local deletion and sync when the remote unstar completed but the account switched', async () => {
    mocks.unstarRepository.mockImplementation(async () => {
      switchToB();
      return undefined;
    });
    const { result } = renderActions();

    await act(async () => { await result.current.unstar(); });

    expect(mocks.unstarRepository).toHaveBeenCalledWith('owner', 'example-repository');
    expect(storeState.deleteRepository).not.toHaveBeenCalled();
    expect(mocks.forceSyncToBackend).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('keeps the deletion state for the reactivated account after A→B→A (unstar)', async () => {
    // 审计修复（C31）：取消星标请求在 A 发起后保持 pending，用实际切号操作
    // 切 B 再切回 A（推进真实会话代次）后完成——执行真实的 setState 工作区删除，
    // 验证重新激活的 A 已移除该仓库及 release，且 B 中同 ID 仓库保持不变。
    const stateWithWorkspaces = storeState as unknown as {
      repositories: Repository[];
      searchResults: Repository[];
      releases: Array<{ id: number; repository: { id: number } }>;
      accountWorkspaces: Record<string, {
        repositories: Repository[];
        releases: Array<{ id: number; repository: { id: number } }>;
      }>;
    };
    stateWithWorkspaces.repositories = [repository];
    stateWithWorkspaces.searchResults = [repository];
    stateWithWorkspaces.releases = [{ id: 101, repository: { id: repository.id } }];
    stateWithWorkspaces.accountWorkspaces = {
      '1': {
        repositories: [repository],
        releases: [{ id: 101, repository: { id: repository.id } }],
      },
      '2': {
        repositories: [{ ...repository, full_name: 'other/example-repository' }],
        releases: [{ id: 202, repository: { id: repository.id } }],
      },
    };
    (mockUseAppStore as unknown as { setState: (updater: unknown) => void }).setState = vi.fn((updater: unknown) => {
      const patch = typeof updater === 'function'
        ? (updater as (state: typeof storeState) => Record<string, unknown>)(storeState)
        : updater as Record<string, unknown>;
      if (patch && typeof patch === 'object') Object.assign(storeState, patch);
    });

    let releaseUnstar!: () => void;
    mocks.unstarRepository.mockImplementation(() => new Promise<void>((resolve) => {
      releaseUnstar = resolve;
    }));
    const { result } = renderActions();
    let promise!: Promise<void>;
    await act(async () => {
      promise = result.current.unstar();
    });
    switchToB();
    bumpAccountSessionGeneration();
    (storeState as { user?: unknown }).user = { id: 1, login: 'me', avatar_url: '' };
    await act(async () => {
      releaseUnstar();
      await promise;
    });

    expect(mocks.unstarRepository).toHaveBeenCalledWith('owner', 'example-repository');
    // 重新激活的 A 已移除该仓库与 release，同时不触碰 B 中同 ID 的仓库与 release
    expect(stateWithWorkspaces.repositories).toEqual([]);
    expect(stateWithWorkspaces.releases).toEqual([]);
    expect(stateWithWorkspaces.accountWorkspaces['2'].repositories.map(r => r.id)).toEqual([repository.id]);
    expect(stateWithWorkspaces.accountWorkspaces['2'].releases.map(rel => rel.id)).toEqual([202]);
    expect(mocks.forceSyncToBackend).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
    // C29：为发起账号保留删除状态——登记 (发起账号, 发起时后端) 待补推标记
    expect(mocks.markPendingAccountSync).toHaveBeenCalledWith('1', expect.any(String));
  });

  it('drops the stale similar result after A→B→A (generation advanced)', async () => {
    // 审计修复（C31/R2-C27）：相似搜索在 A 发起后保持 pending，实际切号推进
    // 代次后放行一条有效的非空结果——若成功路径缺少会话守卫，enterSimilarView
    // 断言必然失败（旧 mock 解析 undefined 会让成功路径抛错，掩盖该缺陷）。
    let releasePipeline!: () => void;
    mocks.runSimilarRepositoryPipeline.mockImplementation(() => new Promise((resolve) => {
      releasePipeline = () => resolve({ repositories: [repository] });
    }));
    const { result } = renderActions();
    let promise!: Promise<void>;
    await act(async () => {
      promise = result.current.findSimilar();
    });
    // 先断言流水线已执行，再放行结果
    await waitFor(() => expect(mocks.runSimilarRepositoryPipeline).toHaveBeenCalledTimes(1));
    switchToB();
    bumpAccountSessionGeneration();
    (storeState as { user?: unknown }).user = { id: 1, login: 'me', avatar_url: '' };
    await act(async () => {
      releasePipeline();
      await promise;
    });

    expect(storeState.enterSimilarView).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});
