import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSyncExternalStore } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositoryList } from './RepositoryList';
import { useAppStore } from '../store/useAppStore';
import type { Repository } from '../types';

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  toast: vi.fn(),
  analyzeRepositoriesPipelined: vi.fn(),
  abort: vi.fn(),
  getStats: vi.fn(() => ({ averageResponseTime: 1 })),
  unstarRepository: vi.fn(),
  forceSyncToBackend: vi.fn(),
}));

vi.mock('../store/useAppStore', () => ({
  useAppStore: vi.fn(),
  getAllCategories: vi.fn(() => [
    { id: 'all', name: '全部分类', icon: 'folder', keywords: [] },
    { id: 'locked', name: '已锁定', icon: 'lock', keywords: [], isCustom: true },
  ]),
}));

vi.mock('../hooks/useDialog', () => ({
  useDialog: () => ({ toast: mocks.toast, confirm: mocks.confirm }),
}));

vi.mock('../services/githubApi', () => ({
  GitHubApiService: vi.fn(function GitHubApiService() {
    return { unstarRepository: mocks.unstarRepository };
  }),
}));

vi.mock('../services/aiService', () => ({
  AIService: vi.fn(),
}));

vi.mock('../services/aiAnalysisOptimizer', () => ({
  AIAnalysisOptimizer: vi.fn(function AIAnalysisOptimizer() {
    return {
      analyzeRepositoriesPipelined: mocks.analyzeRepositoriesPipelined,
      abort: mocks.abort,
      getStats: mocks.getStats,
      pause: vi.fn(),
      resume: vi.fn(),
    };
  }),
}));

vi.mock('../services/autoSync', () => ({
  forceSyncToBackend: mocks.forceSyncToBackend,
}));

vi.mock('./RepositoryCard', () => ({
  RepositoryCard: ({ repository, onSelect }: { repository: Repository; onSelect?: (id: number) => void }) => (
    <button type="button" onClick={() => onSelect?.(repository.id)}>
      select-{repository.id}
    </button>
  ),
}));

vi.mock('./BulkActionToolbar', () => ({
  BulkActionToolbar: ({ repositories, onBulkAction }: { repositories: Repository[]; onBulkAction: (action: string, repos: Repository[]) => void }) => (
    <div>
      <button type="button" aria-label="contract-run-bulk-ai" onClick={() => void onBulkAction('ai-summary', repositories)}>AI</button>
      <button type="button" aria-label="contract-run-unstar" onClick={() => void onBulkAction('unstar', repositories)}>Unstar</button>
      <button type="button" aria-label="contract-run-restore" onClick={() => void onBulkAction('restore', repositories)}>Restore</button>
    </div>
  ),
}));

vi.mock('./BulkCategorizeModal', () => ({
  BulkCategorizeModal: () => null,
}));

vi.mock('./BulkRestoreModal', () => ({
  BulkRestoreModal: ({ isOpen, onRestore }: { isOpen: boolean; onRestore: (config: unknown) => Promise<void> }) => (
    isOpen ? (
      <button
        type="button"
        aria-label="contract-confirm-restore"
        onClick={() => void onRestore({
          description: { enabled: true, target: 'original' },
          tags: { enabled: true, target: 'original' },
          category: { enabled: true, target: 'original' },
        })}
      >
        Confirm restore
      </button>
    ) : null
  ),
}));

type StoreState = {
  githubToken: string | null;
  aiConfigs: Array<Record<string, unknown>>;
  activeAIConfig: string | null;
  isLoading: boolean;
  setLoading: (loading: boolean) => void;
  updateRepository: ReturnType<typeof vi.fn>;
  deleteRepository: ReturnType<typeof vi.fn>;
  language: 'zh' | 'en';
  customCategories: never[];
  hiddenDefaultCategoryIds: never[];
  defaultCategoryOverrides: Record<string, never>;
  categoryMatchMode: 'legacy' | 'effective';
  analysisProgress: { current: number; total: number };
  setAnalysisProgress: (progress: { current: number; total: number }) => void;
  searchFilters: { query: string };
  toggleReleaseSubscription: ReturnType<typeof vi.fn>;
  batchUnsubscribeReleases: ReturnType<typeof vi.fn>;
  releaseSubscriptions: Set<number>;
  similarView: null;
  resetSimilarView: ReturnType<typeof vi.fn>;
  repositoryViewMode: 'grid' | 'list';
  setRepositoryViewMode: ReturnType<typeof vi.fn>;
};

const createRepository = (id: number, overrides: Partial<Repository> = {}): Repository => ({
  id,
  name: `repo-${id}`,
  full_name: `owner/repo-${id}`,
  description: 'Original description',
  html_url: `https://github.com/owner/repo-${id}`,
  stargazers_count: 10,
  forks_count: 1,
  forks: 1,
  language: 'TypeScript',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
  pushed_at: '2026-01-03T00:00:00.000Z',
  owner: { login: 'owner', avatar_url: 'https://example.com/avatar.png' },
  topics: ['test'],
  ...overrides,
});

const mockUseAppStore = vi.mocked(useAppStore);
let storeState: StoreState;
const listeners = new Set<() => void>();

const setStoreState = (partial: Partial<StoreState>) => {
  storeState = { ...storeState, ...partial };
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const renderWithRepositories = (repositories: Repository[]) => render(
  <RepositoryList repositories={repositories} selectedCategory="all" />,
);

const selectRepositories = async (user: ReturnType<typeof userEvent.setup>, repositories: Repository[]) => {
  for (const repository of repositories) {
    await user.click(screen.getByRole('button', { name: `select-${repository.id}` }));
  }
  await screen.findByRole('button', { name: 'contract-run-bulk-ai' });
};

beforeEach(() => {
  vi.clearAllMocks();
  listeners.clear();
  mocks.confirm.mockResolvedValue(true);
  storeState = {
    githubToken: 'github-token',
    aiConfigs: [{ id: 'ai-config', baseUrl: 'https://ai.example.com', apiKey: 'api-key', model: 'test-model', concurrency: 1 }],
    activeAIConfig: 'ai-config',
    isLoading: false,
    setLoading: (isLoading) => setStoreState({ isLoading }),
    updateRepository: vi.fn(),
    deleteRepository: vi.fn(),
    language: 'zh',
    customCategories: [],
    hiddenDefaultCategoryIds: [],
    defaultCategoryOverrides: {},
    categoryMatchMode: 'effective',
    analysisProgress: { current: 0, total: 0 },
    setAnalysisProgress: (analysisProgress) => setStoreState({ analysisProgress }),
    searchFilters: { query: '' },
    toggleReleaseSubscription: vi.fn(),
    batchUnsubscribeReleases: vi.fn(),
    releaseSubscriptions: new Set(),
    similarView: null,
    resetSimilarView: vi.fn(),
    repositoryViewMode: 'grid',
    setRepositoryViewMode: vi.fn(),
  };

  mockUseAppStore.mockImplementation((() => (
    useSyncExternalStore(subscribe, () => storeState, () => storeState)
  )) as unknown as typeof useAppStore);
  Object.assign(mockUseAppStore, { getState: () => storeState });
});

describe('RepositoryList repository workflow contracts', () => {
  it('stores AI success fields, keeps a locked category, and leaves user overrides intact on an AI failure', async () => {
    const lockedRepository = createRepository(1, {
      custom_description: 'Keep this description',
      custom_tags: ['keep-tag'],
      custom_category: '已锁定',
      category_locked: true,
    });
    const failedRepository = createRepository(2, {
      custom_description: 'Do not erase',
      custom_tags: ['do-not-erase'],
      custom_category: '已锁定',
      category_locked: true,
    });
    mocks.analyzeRepositoriesPipelined.mockImplementation(async (...args: unknown[]) => {
      const onResult = args[6] as (result: Record<string, unknown>) => void;
      onResult({
        success: true,
        repo: lockedRepository,
        summary: 'AI summary',
        tags: ['ai-tag'],
        platforms: ['web'],
      });
      onResult({ success: false, repo: failedRepository, error: new Error('AI unavailable') });
    });

    const user = userEvent.setup();
    renderWithRepositories([lockedRepository, failedRepository]);
    await selectRepositories(user, [lockedRepository, failedRepository]);
    await user.click(screen.getByRole('button', { name: 'contract-run-bulk-ai' }));

    await waitFor(() => expect(storeState.updateRepository).toHaveBeenCalledTimes(2));
    expect(storeState.updateRepository).toHaveBeenCalledWith(expect.objectContaining({
      id: lockedRepository.id,
      ai_summary: 'AI summary',
      ai_tags: ['ai-tag'],
      ai_platforms: ['web'],
      custom_category: '已锁定',
      category_locked: true,
      custom_description: 'Keep this description',
      custom_tags: ['keep-tag'],
      analysis_failed: false,
      analysis_error: undefined,
    }));
    expect(storeState.updateRepository).toHaveBeenCalledWith(expect.objectContaining({
      id: failedRepository.id,
      custom_description: 'Do not erase',
      custom_tags: ['do-not-erase'],
      custom_category: '已锁定',
      category_locked: true,
      analysis_failed: true,
      analysis_error: 'AI unavailable',
    }));
  });

  it('clears description, tags, category lock, and AI-derived fields when bulk restore targets original values', async () => {
    const repository = createRepository(1, {
      custom_description: 'Custom description',
      custom_tags: ['custom-tag'],
      custom_category: '已锁定',
      category_locked: true,
      ai_summary: 'AI summary',
      ai_tags: ['ai-tag'],
      ai_platforms: ['web'],
      analyzed_at: '2026-02-01T00:00:00.000Z',
      analysis_failed: true,
      analysis_error: 'old failure',
    });

    const user = userEvent.setup();
    renderWithRepositories([repository]);
    await selectRepositories(user, [repository]);
    await user.click(screen.getByRole('button', { name: 'contract-run-restore' }));
    await user.click(await screen.findByRole('button', { name: 'contract-confirm-restore' }));

    await waitFor(() => expect(storeState.updateRepository).toHaveBeenCalledTimes(1));
    expect(storeState.updateRepository).toHaveBeenCalledWith(expect.objectContaining({
      id: repository.id,
      custom_description: undefined,
      custom_tags: undefined,
      custom_category: undefined,
      category_locked: false,
      ai_summary: undefined,
      ai_tags: undefined,
      ai_platforms: undefined,
      analyzed_at: undefined,
      analysis_failed: undefined,
      analysis_error: undefined,
    }));
  });

  it('keeps local repositories whose remote batch unstar operation fails', async () => {
    const first = createRepository(1);
    const second = createRepository(2);
    mocks.unstarRepository.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('network failure'));

    const user = userEvent.setup();
    renderWithRepositories([first, second]);
    await selectRepositories(user, [first, second]);
    await user.click(screen.getByRole('button', { name: 'contract-run-unstar' }));

    await waitFor(() => expect(mocks.unstarRepository).toHaveBeenCalledTimes(2));
    expect(storeState.deleteRepository).toHaveBeenCalledTimes(1);
    expect(storeState.deleteRepository).toHaveBeenCalledWith(first.id);
    expect(storeState.deleteRepository).not.toHaveBeenCalledWith(second.id);
  });

  it('retains completed AI results after the user stops a running batch', async () => {
    const repository = createRepository(1, { custom_description: 'User description' });
    let finishPipeline: (() => void) | undefined;
    mocks.analyzeRepositoriesPipelined.mockImplementation((...args: unknown[]) => {
      const onResult = args[6] as (result: Record<string, unknown>) => void;
      onResult({
        success: true,
        repo: repository,
        summary: 'Completed before stop',
        tags: ['done'],
        platforms: ['cli'],
      });
      return new Promise<void>((resolve) => {
        finishPipeline = resolve;
      });
    });
    mocks.abort.mockImplementation(() => finishPipeline?.());

    const user = userEvent.setup();
    renderWithRepositories([repository]);
    await selectRepositories(user, [repository]);
    await user.click(screen.getByRole('button', { name: 'contract-run-bulk-ai' }));

    await waitFor(() => expect(storeState.updateRepository).toHaveBeenCalledWith(expect.objectContaining({
      id: repository.id,
      ai_summary: 'Completed before stop',
      custom_description: 'User description',
    })));
    await user.click(await screen.findByRole('button', { name: '停止' }));

    await waitFor(() => expect(mocks.abort).toHaveBeenCalledTimes(1));
    expect(storeState.updateRepository).toHaveBeenCalledWith(expect.objectContaining({
      id: repository.id,
      ai_summary: 'Completed before stop',
      custom_description: 'User description',
    }));
  });
});
