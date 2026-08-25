import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../../../types';
import { useRepositoryAnalysisJob } from './useRepositoryAnalysisJob';
import { useAppStore } from '../../../store/useAppStore';

const mocks = vi.hoisted(() => ({
  useAppStore: vi.fn(),
  toast: vi.fn(),
  confirm: vi.fn(),
  analyzeRepositoriesPipelined: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  abort: vi.fn(),
  getStats: vi.fn(() => ({ averageResponseTime: 12 })),
  forceSyncToBackend: vi.fn(),
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: mocks.useAppStore,
}));

vi.mock('../../../hooks/useDialog', () => ({
  useDialog: () => ({ toast: mocks.toast, confirm: mocks.confirm }),
}));

vi.mock('../../../services/aiAnalysisOptimizer', () => ({
  AIAnalysisOptimizer: vi.fn(function AIAnalysisOptimizer() {
    return {
      analyzeRepositoriesPipelined: mocks.analyzeRepositoriesPipelined,
      pause: mocks.pause,
      resume: mocks.resume,
      abort: mocks.abort,
      isPaused: vi.fn(() => false),
      getStats: mocks.getStats,
    };
  }),
}));

vi.mock('../../../services/aiService', () => ({
  AIService: vi.fn(),
}));

vi.mock('../../../services/githubApi', () => ({
  GitHubApiService: vi.fn(),
}));

vi.mock('../../../services/autoSync', () => ({
  forceSyncToBackend: mocks.forceSyncToBackend,
}));

const repository = (id: number, overrides: Partial<Repository> = {}): Repository => ({
  id,
  name: `repository-${id}`,
  full_name: `owner/repository-${id}`,
  description: 'Repository description',
  html_url: `https://github.com/owner/repository-${id}`,
  stargazers_count: 10,
  forks_count: 1,
  forks: 1,
  language: 'TypeScript',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
  pushed_at: '2026-01-03T00:00:00.000Z',
  owner: { login: 'owner', avatar_url: 'https://example.com/avatar.png' },
  topics: [],
  ...overrides,
});

const createStoreState = () => ({
  githubToken: 'github-token',
  aiConfigs: [{
    id: 'ai-config',
    baseUrl: 'https://ai.example.com/v1',
    apiKey: 'ai-key',
    model: 'test-model',
    concurrency: 1,
  }],
  activeAIConfig: 'ai-config',
  language: 'zh' as const,
  updateRepository: vi.fn(),
  setLoading: vi.fn(),
  setAnalysisProgress: vi.fn(),
});

let storeState = createStoreState();
const mockUseAppStore = vi.mocked(useAppStore);
const runOptions = (repositories: Repository[], syncOnComplete = false) => ({
  repositories,
  scope: 'all' as const,
  syncOnComplete,
});

const renderJob = () => renderHook(() => useRepositoryAnalysisJob({ allCategories: [] }));

describe('useRepositoryAnalysisJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState = createStoreState();
    mockUseAppStore.mockImplementation(((selector?: (state: typeof storeState) => unknown) => (
      selector ? selector(storeState) : storeState
    )) as typeof useAppStore);
    mocks.confirm.mockResolvedValue(true);
    mocks.forceSyncToBackend.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stores successful analysis results without syncing toolbar jobs', async () => {
    const target = repository(1, { custom_description: 'Keep me' });
    mocks.analyzeRepositoriesPipelined.mockImplementation(async (...args: unknown[]) => {
      const onProgress = args[5] as (current: number, total: number, concurrency: number) => void;
      const onResult = args[6] as (result: Record<string, unknown>) => void;
      onProgress(1, 1, 1);
      onResult({ success: true, repo: target, summary: 'AI summary', tags: ['ai'], platforms: ['web'] });
    });
    const { result } = renderJob();

    await act(async () => {
      await result.current.run(runOptions([target]));
    });

    expect(storeState.updateRepository).toHaveBeenCalledWith(expect.objectContaining({
      id: target.id,
      ai_summary: 'AI summary',
      ai_tags: ['ai'],
      custom_description: 'Keep me',
      analysis_failed: false,
    }));
    expect(mocks.forceSyncToBackend).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ isRunning: false, isPaused: false, progress: { current: 0, total: 0 } });
  });

  it('stores both successful and failed results from a partially failing job and syncs once when requested', async () => {
    const successful = repository(1);
    const failed = repository(2, { custom_tags: ['user-tag'] });
    mocks.analyzeRepositoriesPipelined.mockImplementation(async (...args: unknown[]) => {
      const onResult = args[6] as (result: Record<string, unknown>) => void;
      onResult({ success: true, repo: successful, summary: 'done', tags: [], platforms: [] });
      onResult({ success: false, repo: failed, error: new Error('model unavailable') });
    });
    const { result } = renderJob();

    await act(async () => {
      await result.current.run(runOptions([successful, failed], true));
    });

    expect(storeState.updateRepository).toHaveBeenCalledTimes(2);
    expect(storeState.updateRepository).toHaveBeenCalledWith(expect.objectContaining({ id: failed.id, analysis_failed: true, analysis_error: 'model unavailable', custom_tags: ['user-tag'] }));
    expect(mocks.forceSyncToBackend).toHaveBeenCalledTimes(1);
  });

  it('pauses and resumes the active optimizer without starting a second job', async () => {
    const target = repository(1);
    let finishPipeline: (() => void) | undefined;
    mocks.analyzeRepositoriesPipelined.mockImplementation(() => new Promise<void>((resolve) => {
      finishPipeline = resolve;
    }));
    const { result } = renderJob();
    let runningJob!: Promise<boolean>;

    act(() => {
      runningJob = result.current.run(runOptions([target]));
    });
    await waitFor(() => expect(result.current.isRunning).toBe(true));

    act(() => result.current.pause());
    expect(mocks.pause).toHaveBeenCalledTimes(1);
    expect(result.current.isPaused).toBe(true);

    act(() => result.current.resume());
    expect(mocks.resume).toHaveBeenCalledTimes(1);
    expect(result.current.isPaused).toBe(false);

    await act(async () => {
      finishPipeline?.();
      await runningJob;
    });
    expect(mocks.analyzeRepositoriesPipelined).toHaveBeenCalledTimes(1);
  });

  it('leaves results written before a confirmed stop intact and resets task state', async () => {
    const target = repository(1, { custom_description: 'User value' });
    let finishPipeline: (() => void) | undefined;
    mocks.analyzeRepositoriesPipelined.mockImplementation((...args: unknown[]) => {
      const onResult = args[6] as (result: Record<string, unknown>) => void;
      onResult({ success: true, repo: target, summary: 'Completed before stop', tags: [], platforms: [] });
      return new Promise<void>((resolve) => {
        finishPipeline = resolve;
      });
    });
    mocks.abort.mockImplementation(() => finishPipeline?.());
    const { result } = renderJob();
    let runningJob!: Promise<boolean>;

    act(() => {
      runningJob = result.current.run(runOptions([target]));
    });
    await waitFor(() => expect(storeState.updateRepository).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.requestStop();
      await runningJob;
    });

    expect(mocks.abort).toHaveBeenCalledTimes(1);
    expect(storeState.updateRepository).toHaveBeenCalledWith(expect.objectContaining({ id: target.id, ai_summary: 'Completed before stop', custom_description: 'User value' }));
    expect(result.current).toMatchObject({ isRunning: false, isPaused: false });
  });

  it('does not abort or change task state when stop confirmation is cancelled', async () => {
    const target = repository(1);
    let finishPipeline: (() => void) | undefined;
    mocks.analyzeRepositoriesPipelined.mockImplementation(() => new Promise<void>((resolve) => {
      finishPipeline = resolve;
    }));
    const { result } = renderJob();
    let runningJob!: Promise<boolean>;

    act(() => {
      runningJob = result.current.run(runOptions([target]));
    });
    await waitFor(() => expect(result.current.isRunning).toBe(true));
    mocks.confirm.mockResolvedValueOnce(false);

    await act(async () => {
      await result.current.requestStop();
    });
    expect(mocks.abort).not.toHaveBeenCalled();
    expect(result.current.isRunning).toBe(true);

    await act(async () => {
      finishPipeline?.();
      await runningJob;
    });
  });

  it('reports optimizer exceptions and resets state', async () => {
    mocks.analyzeRepositoriesPipelined.mockRejectedValue(new Error('network unavailable'));
    const { result } = renderJob();

    await act(async () => {
      await result.current.run(runOptions([repository(1)]));
    });

    expect(mocks.toast).toHaveBeenCalledWith('AI分析失败，请检查AI配置和网络连接。', 'error');
    expect(result.current).toMatchObject({ isRunning: false, isPaused: false, progress: { current: 0, total: 0 } });
  });

  it('aborts an active job on unmount and prevents further result writes', async () => {
    const target = repository(1);
    let onResult: ((result: Record<string, unknown>) => void) | undefined;
    mocks.analyzeRepositoriesPipelined.mockImplementation((...args: unknown[]) => {
      onResult = args[6] as (result: Record<string, unknown>) => void;
      return new Promise<void>(() => undefined);
    });
    const { result, unmount } = renderJob();

    act(() => {
      void result.current.run(runOptions([target]));
    });
    await waitFor(() => expect(mocks.analyzeRepositoriesPipelined).toHaveBeenCalledTimes(1));
    unmount();
    onResult?.({ success: true, repo: target, summary: 'late result', tags: [], platforms: [] });

    expect(mocks.abort).toHaveBeenCalledTimes(1);
    expect(storeState.updateRepository).not.toHaveBeenCalled();
  });
});
