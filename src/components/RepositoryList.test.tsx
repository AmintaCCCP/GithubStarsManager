import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositoryList } from './RepositoryList';
import { useAppStore, getAllCategories } from '../store/useAppStore';
import type { Category, Repository, SearchFilters, SimilarViewState } from '../types';

vi.mock('../store/useAppStore', () => ({
  useAppStore: vi.fn(),
  getAllCategories: vi.fn(() => []),
}));

vi.mock('../hooks/useDialog', () => ({
  useDialog: () => ({ toast: vi.fn(), confirm: vi.fn() }),
}));

vi.mock('./RepositoryCard', () => ({
  RepositoryCard: ({ repository, viewMode, showAISummary }: { repository: Repository; viewMode: string; showAISummary: boolean }) => (
    <div data-testid={`repository-card-${repository.id}`} data-view-mode={viewMode} data-show-ai={String(showAISummary)}>{repository.name}</div>
  ),
}));

vi.mock('./SimilarViewBanner', () => ({
  SimilarViewBanner: ({ onReset }: { onReset: () => void }) => (
    <button type="button" onClick={onReset}>重置相似仓库</button>
  ),
}));
vi.mock('./BulkActionToolbar', () => ({ BulkActionToolbar: () => null }));
vi.mock('./BulkCategorizeModal', () => ({ BulkCategorizeModal: () => null }));
vi.mock('./BulkRestoreModal', () => ({ BulkRestoreModal: () => null }));

const repository: Repository = {
  id: 1,
  name: 'repository-one',
  full_name: 'owner/repository-one',
  description: 'Repository description',
  html_url: 'https://github.com/owner/repository-one',
  stargazers_count: 42,
  forks_count: 0,
  forks: 0,
  language: 'TypeScript',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
  pushed_at: '2026-01-03T00:00:00.000Z',
  owner: { login: 'owner', avatar_url: 'https://example.com/avatar.png' },
  topics: [],
};

const searchFilters: SearchFilters = {
  query: '',
  tags: [],
  languages: [],
  platforms: [],
  licenses: [],
  sortBy: 'stars' as const,
  sortOrder: 'desc' as const,
};

const storeState = {
  githubToken: null,
  aiConfigs: [],
  activeAIConfig: null,
  isLoading: false,
  setLoading: vi.fn(),
  updateRepository: vi.fn(),
  deleteRepository: vi.fn(),
  language: 'zh' as const,
  customCategories: [],
  hiddenDefaultCategoryIds: [],
  defaultCategoryOverrides: {},
  categoryMatchMode: 'effective' as const,
  analysisProgress: { current: 0, total: 0 },
  setAnalysisProgress: vi.fn(),
  searchFilters,
  toggleReleaseSubscription: vi.fn(),
  batchUnsubscribeReleases: vi.fn(),
  releaseSubscriptions: new Set<number>(),
  similarView: null as SimilarViewState | null,
  resetSimilarView: vi.fn(),
  repositoryViewMode: 'grid' as 'grid' | 'list',
  setRepositoryViewMode: vi.fn((mode: 'grid' | 'list') => {
    storeState.repositoryViewMode = mode;
  }),
};

const mockUseAppStore = vi.mocked(useAppStore);

beforeEach(() => {
  vi.clearAllMocks();
  storeState.repositoryViewMode = 'grid';
  storeState.similarView = null;
  Object.assign(searchFilters, { query: '', sortBy: 'stars', sortOrder: 'desc' });
  mockUseAppStore.mockImplementation(((selector?: (state: unknown) => unknown) => (selector ? selector(storeState) : storeState)) as unknown as typeof useAppStore);
  Object.assign(mockUseAppStore, {
    getState: () => storeState,
  });
});

describe('RepositoryList view mode controls', () => {
  it('sorts the raw default repository list by stars before rendering cards', () => {
    const lowerStarRepository = { ...repository, id: 2, name: 'lower-star', full_name: 'owner/lower-star', stargazers_count: 1 };
    const higherStarRepository = { ...repository, id: 3, name: 'higher-star', full_name: 'owner/higher-star', stargazers_count: 999 };

    render(<RepositoryList repositories={[lowerStarRepository, higherStarRepository, repository]} selectedCategory="all" />);

    expect(screen.getAllByTestId(/repository-card-/).map((card) => card.textContent)).toEqual([
      'higher-star',
      'repository-one',
      'lower-star',
    ]);
  });

  it('preserves the incoming order while a relevance query is active', () => {
    const lowerStarRepository = { ...repository, id: 2, name: 'first-by-relevance', full_name: 'owner/first-by-relevance', stargazers_count: 1 };
    const higherStarRepository = { ...repository, id: 3, name: 'second-by-relevance', full_name: 'owner/second-by-relevance', stargazers_count: 999 };
    searchFilters.query = 'relevance';

    render(<RepositoryList repositories={[lowerStarRepository, higherStarRepository, repository]} selectedCategory="all" />);

    expect(screen.getAllByTestId(/repository-card-/).map((card) => card.textContent)).toEqual([
      'first-by-relevance',
      'second-by-relevance',
      'repository-one',
    ]);
  });

  it('preserves the card vector-result order in similar view instead of applying the normal star sort', () => {
    const lowScoreLowStarRepository = { ...repository, id: 2, name: 'first-by-vector-score', full_name: 'owner/first-by-vector-score', stargazers_count: 1 };
    const highScoreHighStarRepository = { ...repository, id: 3, name: 'second-by-vector-score', full_name: 'owner/second-by-vector-score', stargazers_count: 999 };
    storeState.similarView = {
      active: true,
      anchorRepoFullName: repository.full_name,
      anchorRepoName: repository.name,
      similarResults: [lowScoreLowStarRepository, highScoreHighStarRepository, repository],
      originalSearchResults: [],
      originalSearchFilters: searchFilters,
    };

    render(<RepositoryList repositories={[lowScoreLowStarRepository, highScoreHighStarRepository, repository]} selectedCategory="all" />);

    expect(screen.getAllByTestId(/repository-card-/).map((card) => card.textContent)).toEqual([
      'first-by-vector-score',
      'second-by-vector-score',
      'repository-one',
    ]);
  });

  it('keeps the similar-view reset control visible when no similar repositories are found', () => {
    storeState.similarView = {
      active: true,
      anchorRepoFullName: repository.full_name,
      anchorRepoName: repository.name,
      similarResults: [],
      originalSearchResults: [],
      originalSearchFilters: searchFilters,
    };

    render(<RepositoryList repositories={[]} selectedCategory="all" />);

    expect(screen.getByText('未找到相似的仓库。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重置相似仓库' }));
    expect(storeState.resetSimilarView).toHaveBeenCalledTimes(1);
  });

  it('keeps the established grid as default and switches cards to the compact list mode', () => {
    const { rerender } = render(<RepositoryList repositories={[repository]} selectedCategory="all" />);

    const card = screen.getByTestId('repository-card-1');
    expect(card).toHaveAttribute('data-view-mode', 'grid');
    expect(screen.getByTitle('多列卡片')).toHaveAttribute('aria-pressed', 'true');

    const layoutControls = screen.getByRole('group', { name: '仓库布局' });
    const toolbar = layoutControls.closest('.ui-toolbar');
    expect(toolbar?.lastElementChild).toContainElement(layoutControls);

    fireEvent.click(screen.getByTitle('单列列表'));

    expect(storeState.setRepositoryViewMode).toHaveBeenCalledWith('list');
    rerender(<RepositoryList repositories={[repository]} selectedCategory="all" />);
    expect(screen.getByTestId('repository-card-1')).toHaveAttribute('data-view-mode', 'list');
    expect(screen.getByTitle('单列列表')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('RepositoryList AI summary display toggle', () => {
  const analyzedRepository: Repository = {
    ...repository,
    id: 10,
    name: 'analyzed-repo',
    full_name: 'owner/analyzed-repo',
    analyzed_at: '2026-01-05T00:00:00.000Z',
  };
  const plainRepository: Repository = {
    ...repository,
    id: 11,
    name: 'plain-repo',
    full_name: 'owner/plain-repo',
  };

  it('renders cards with AI summary content enabled by default', () => {
    render(<RepositoryList repositories={[analyzedRepository, plainRepository]} selectedCategory="all" />);

    expect(screen.getByTestId('repository-card-10')).toHaveAttribute('data-show-ai', 'true');
  });

  it('switches to original descriptions and back to AI content when analyzed repositories exist', () => {
    render(<RepositoryList repositories={[analyzedRepository, plainRepository]} selectedCategory="all" />);

    fireEvent.click(screen.getByText('原始描述'));
    expect(screen.getByTestId('repository-card-10')).toHaveAttribute('data-show-ai', 'false');

    fireEvent.click(screen.getByText('AI分析内容'));
    expect(screen.getByTestId('repository-card-10')).toHaveAttribute('data-show-ai', 'true');
  });

  it('keeps original descriptions when the AI option has no analyzed repositories to show', () => {
    render(<RepositoryList repositories={[plainRepository]} selectedCategory="all" />);

    fireEvent.click(screen.getByText('原始描述'));
    expect(screen.getByTestId('repository-card-11')).toHaveAttribute('data-show-ai', 'false');

    fireEvent.click(screen.getByText('AI分析内容'));
    expect(screen.getByTestId('repository-card-11')).toHaveAttribute('data-show-ai', 'false');
  });

  it('automatically falls back to original descriptions when switching to a category without analyzed repositories', () => {
    vi.mocked(getAllCategories).mockReturnValue([
      { id: 'cat-x', name: '未分析分类', isCustom: true, keywords: [], icon: '' } satisfies Category,
    ]);
    const lockedPlainRepository: Repository = {
      ...plainRepository,
      category_locked: true,
      custom_category: '未分析分类',
    };

    const { rerender } = render(<RepositoryList repositories={[analyzedRepository]} selectedCategory="all" />);
    expect(screen.getByTestId('repository-card-10')).toHaveAttribute('data-show-ai', 'true');

    rerender(<RepositoryList repositories={[lockedPlainRepository]} selectedCategory="cat-x" />);
    expect(screen.getByTestId('repository-card-11')).toHaveAttribute('data-show-ai', 'false');
  });

  it('restores the AI summary default on a fresh mount', () => {
    const first = render(<RepositoryList repositories={[analyzedRepository]} selectedCategory="all" />);
    fireEvent.click(screen.getByText('原始描述'));
    expect(first.getByTestId('repository-card-10')).toHaveAttribute('data-show-ai', 'false');

    first.unmount();
    render(<RepositoryList repositories={[analyzedRepository]} selectedCategory="all" />);
    expect(screen.getByTestId('repository-card-10')).toHaveAttribute('data-show-ai', 'true');
  });
});
