import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscoveryRepo } from '../../../types';
import { discoveryRepoToRepository, useDiscoveryRepoActions } from './useDiscoveryRepoActions';

const mocks = vi.hoisted(() => ({
  useAppStore: vi.fn(),
  getAllCategories: vi.fn(() => []),
  toast: vi.fn(),
  analyzeRepository: vi.fn(),
  createFailedAnalysisResult: vi.fn((error: string) => ({
    analyzed_at: '2026-08-25T00:00:00.000Z',
    analysis_failed: true,
    analysis_error: error,
  })),
  forceSyncToBackend: vi.fn(),
  starRepository: vi.fn(),
  unstarRepository: vi.fn(),
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: mocks.useAppStore,
  getAllCategories: mocks.getAllCategories,
}));

vi.mock('../../../hooks/useDialog', () => ({
  useDialog: () => ({ toast: mocks.toast, confirm: vi.fn() }),
}));

vi.mock('../../../services/aiAnalysisHelper', () => ({
  analyzeRepository: mocks.analyzeRepository,
  createFailedAnalysisResult: mocks.createFailedAnalysisResult,
}));

vi.mock('../../../services/autoSync', () => ({
  forceSyncToBackend: mocks.forceSyncToBackend,
}));

vi.mock('../../../services/githubApi', () => ({
  GitHubApiService: class {
    starRepository = mocks.starRepository;
    unstarRepository = mocks.unstarRepository;
  },
}));

const repo: DiscoveryRepo = {
  id: 7,
  name: 'discovered-repo',
  full_name: 'owner/discovered-repo',
  description: 'A discovered repository',
  html_url: 'https://github.com/owner/discovered-repo',
  stargazers_count: 512,
  forks_count: 12,
  forks: 12,
  language: 'TypeScript',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
  pushed_at: '2026-01-03T00:00:00.000Z',
  owner: { login: 'owner', avatar_url: 'https://example.com/avatar.png' },
  topics: ['test'],
  rank: 3,
  channel: 'trending',
  platform: 'Macos',
};

const createStoreState = () => ({
  githubToken: 'github-token' as string | null,
  aiConfigs: [{
    id: 'ai-config',
    name: 'Test AI',
    baseUrl: 'https://example.com/v1',
    apiKey: 'ai-key',
    model: 'ai-model',
  }] as Array<{ id: string; name: string; baseUrl?: string; apiKey?: string; model?: string; apiKeyStatus?: 'ok' | 'decrypt_failed' | 'empty' }>,
  activeAIConfig: 'ai-config',
  language: 'zh' as const,
  customCategories: [],
  repositories: [] as { id: number; full_name: string }[],
  updateDiscoveryRepo: vi.fn(),
  addRepository: vi.fn(),
  deleteRepository: vi.fn(),
});

let storeState = createStoreState();
const mockUseAppStore = vi.mocked(mocks.useAppStore);
mockUseAppStore.mockImplementation((selector?: (state: typeof storeState) => unknown) =>
  selector ? selector(storeState) : storeState);
(mockUseAppStore as unknown as { getState: () => typeof storeState }).getState = () => storeState;

describe('useDiscoveryRepoActions.analyze', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState = createStoreState();
  });

  it('runs the four validations in order with the card-specific wording', async () => {
    storeState.githubToken = null;
    const { result, rerender } = renderHook(() => useDiscoveryRepoActions({ repo }));
    await act(async () => { await result.current.analyze(); });
    expect(mocks.toast).toHaveBeenNthCalledWith(1, 'GitHub Token 未找到，请重新登录。', 'error');

    storeState.githubToken = 'github-token';
    storeState.aiConfigs = [];
    rerender();
    await act(async () => { await result.current.analyze(); });
    expect(mocks.toast).toHaveBeenNthCalledWith(2, '请先在设置中配置AI服务。', 'error');

    storeState.aiConfigs = [{
      id: 'ai-config',
      name: 'Broken',
      baseUrl: 'https://example.com/v1',
      apiKey: 'ai-key',
      model: 'ai-model',
      apiKeyStatus: 'decrypt_failed',
    }];
    rerender();
    await act(async () => { await result.current.analyze(); });
    expect(mocks.toast).toHaveBeenNthCalledWith(3, 'AI服务的API密钥无法解密或为空，请在设置中重新输入并保存该配置。', 'error');

    storeState.aiConfigs = [{ id: 'ai-config', name: 'Incomplete', baseUrl: '', apiKey: '', model: '' }];
    rerender();
    await act(async () => { await result.current.analyze(); });
    expect(mocks.toast).toHaveBeenNthCalledWith(4, 'AI服务配置不完整，请检查API端点、密钥和模型名称。', 'error');
    expect(mocks.analyzeRepository).not.toHaveBeenCalled();
    expect(mocks.forceSyncToBackend).not.toHaveBeenCalled();
  });

  it('patches success fields without custom_category and without force sync; forwards onAnalyzed', async () => {
    mocks.analyzeRepository.mockResolvedValue({
      summary: 'AI summary',
      tags: ['tag'],
      platforms: ['cli'],
      analyzed_at: '2026-09-05T00:00:00.000Z',
      analysis_failed: false,
    });
    const onAnalyzed = vi.fn();
    const { result } = renderHook(() => useDiscoveryRepoActions({ repo }));
    await act(async () => { await result.current.analyze(onAnalyzed); });

    expect(storeState.updateDiscoveryRepo).toHaveBeenCalledTimes(1);
    const patch = storeState.updateDiscoveryRepo.mock.calls[0][0] as DiscoveryRepo;
    expect(patch).toEqual({
      ...repo,
      ai_summary: 'AI summary',
      ai_tags: ['tag'],
      ai_platforms: ['cli'],
      analyzed_at: '2026-09-05T00:00:00.000Z',
      analysis_failed: false,
      analysis_error: undefined,
    });
    expect('custom_category' in patch).toBe(false);
    expect('category_locked' in patch).toBe(false);
    expect(onAnalyzed).toHaveBeenCalledWith(patch);
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(mocks.forceSyncToBackend).not.toHaveBeenCalled();
  });

  it('stores the failure result and toasts on analysis error', async () => {
    mocks.analyzeRepository.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useDiscoveryRepoActions({ repo }));
    await act(async () => { await result.current.analyze(); });

    expect(mocks.createFailedAnalysisResult).toHaveBeenCalledWith('network down');
    expect(storeState.updateDiscoveryRepo).toHaveBeenCalledWith({
      ...repo,
      analyzed_at: '2026-08-25T00:00:00.000Z',
      analysis_failed: true,
      analysis_error: 'network down',
    });
    expect(mocks.toast).toHaveBeenCalledWith('AI分析失败，请检查AI配置。', 'error');
  });

  it('stays silent after unmount aborts an in-flight analysis', async () => {
    let rejectAnalysis!: (error: Error) => void;
    mocks.analyzeRepository.mockImplementation(({ signal }: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        rejectAnalysis = (error: Error) => {
          if (signal.aborted) {
            reject(error);
          }
        };
      }),
    );
    const { result, unmount } = renderHook(() => useDiscoveryRepoActions({ repo }));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.analyze();
    });
    unmount();
    rejectAnalysis(new Error('Aborted'));
    await act(async () => { await pending.catch(() => undefined); });

    expect(storeState.updateDiscoveryRepo).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});

describe('useDiscoveryRepoActions.star', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState = createStoreState();
  });

  it('keeps the optimistic → remote → addRepository → onStar → forceSync → clear → toast order', async () => {
    mocks.starRepository.mockResolvedValue(undefined);
    const onStar = vi.fn();
    const { result } = renderHook(() => useDiscoveryRepoActions({ repo }));
    await act(async () => { await result.current.star(onStar); });

    expect(mocks.starRepository).toHaveBeenCalledWith('owner', 'discovered-repo');
    expect(storeState.addRepository).toHaveBeenCalledTimes(1);
    const added = storeState.addRepository.mock.calls[0][0];
    expect(added).toEqual({
      ...repo,
      rank: undefined,
      channel: undefined,
      platform: undefined,
      starred_at: expect.any(String),
    });
    expect(onStar).toHaveBeenCalledWith(repo);

    const starRepoOrder = mocks.starRepository.mock.invocationCallOrder[0];
    const addOrder = storeState.addRepository.mock.invocationCallOrder[0];
    const onStarOrder = onStar.mock.invocationCallOrder[0];
    const syncOrder = mocks.forceSyncToBackend.mock.invocationCallOrder[0];
    expect(starRepoOrder).toBeLessThan(addOrder);
    expect(addOrder).toBeLessThan(onStarOrder);
    expect(onStarOrder).toBeLessThan(syncOrder);

    expect(result.current.optimisticStarred).toBeNull();
    expect(mocks.toast).toHaveBeenCalledWith('已成功添加 Star', 'success');
  });

  it('rolls back the optimistic state and toasts when starring fails', async () => {
    let rejectStar!: (error: Error) => void;
    mocks.starRepository.mockImplementation(() => new Promise((_resolve, reject) => {
      rejectStar = reject;
    }));
    storeState.repositories = [{ id: 1, full_name: 'other/repo' }];
    const { result } = renderHook(() => useDiscoveryRepoActions({ repo }));

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.star();
    });
    await waitFor(() => expect(result.current.optimisticStarred).toBe(true));

    rejectStar(new Error('network'));
    await act(async () => { await pending; });

    expect(result.current.optimisticStarred).toBeNull();
    expect(storeState.addRepository).not.toHaveBeenCalled();
    expect(mocks.forceSyncToBackend).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith('Star 操作失败，请检查网络连接或 GitHub Token 权限。', 'error');
  });

  it('adds the repository for a repo that is not yet starred', async () => {
    mocks.starRepository.mockResolvedValue(undefined);
    const { result } = renderHook(() => useDiscoveryRepoActions({ repo }));
    expect(result.current.isStarred).toBe(false);
    await act(async () => { await result.current.star(); });
    expect(result.current.isStarred).toBe(false); // repositories fixture 不含该仓库，乐观态已清
    expect(result.current.isStarring).toBe(false);
  });
});

describe('useDiscoveryRepoActions.executeUnstar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState = createStoreState();
  });

  it('deletes the local repository by full_name, forces sync, and never toasts on success', async () => {
    mocks.unstarRepository.mockResolvedValue(undefined);
    storeState.repositories = [{ id: 42, full_name: repo.full_name }];
    const { result, rerender } = renderHook(() => useDiscoveryRepoActions({ repo }));
    rerender();
    expect(result.current.isStarred).toBe(true);

    await act(async () => { await result.current.executeUnstar(); });

    expect(mocks.unstarRepository).toHaveBeenCalledWith('owner', 'discovered-repo');
    expect(storeState.deleteRepository).toHaveBeenCalledWith(42);
    const unstarOrder = mocks.unstarRepository.mock.invocationCallOrder[0];
    const deleteOrder = storeState.deleteRepository.mock.invocationCallOrder[0];
    const syncOrder = mocks.forceSyncToBackend.mock.invocationCallOrder[0];
    expect(unstarOrder).toBeLessThan(deleteOrder);
    expect(deleteOrder).toBeLessThan(syncOrder);
    expect(result.current.optimisticStarred).toBeNull();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('rolls back the optimistic state and toasts on failure', async () => {
    mocks.unstarRepository.mockRejectedValue(new Error('boom'));
    storeState.repositories = [{ id: 42, full_name: repo.full_name }];
    const { result } = renderHook(() => useDiscoveryRepoActions({ repo }));

    await act(async () => { await result.current.executeUnstar(); });

    expect(result.current.optimisticStarred).toBeNull();
    expect(storeState.deleteRepository).not.toHaveBeenCalled();
    expect(mocks.forceSyncToBackend).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith('取消 Star 失败，请检查网络连接或 GitHub Token 权限。', 'error');
  });
});

describe('discoveryRepoToRepository', () => {
  it('nulls discovery-only fields and stamps starred_at', () => {
    const converted = discoveryRepoToRepository(repo, '2026-09-05T00:00:00.000Z');
    expect(converted).toEqual({
      ...repo,
      rank: undefined,
      channel: undefined,
      platform: undefined,
      starred_at: '2026-09-05T00:00:00.000Z',
    });
  });
});
