import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositoryList } from './RepositoryList';
import { useAppStore } from '../store/useAppStore';
import type { Repository } from '../types';

vi.mock('../store/useAppStore', () => ({
  useAppStore: vi.fn(),
  getAllCategories: vi.fn(() => []),
}));

vi.mock('../hooks/useDialog', () => ({
  useDialog: () => ({ toast: vi.fn(), confirm: vi.fn() }),
}));

vi.mock('./RepositoryCard', () => ({
  RepositoryCard: ({ repository, viewMode }: { repository: Repository; viewMode: string }) => (
    <div data-testid={`repository-card-${repository.id}`} data-view-mode={viewMode}>{repository.name}</div>
  ),
}));

vi.mock('./SimilarViewBanner', () => ({ SimilarViewBanner: () => null }));
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

const searchFilters = {
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
  similarView: null,
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
  Object.assign(searchFilters, { sortBy: 'stars', sortOrder: 'desc' });
  mockUseAppStore.mockImplementation(() => storeState as ReturnType<typeof useAppStore>);
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
    } as never;

    render(<RepositoryList repositories={[lowScoreLowStarRepository, highScoreHighStarRepository, repository]} selectedCategory="all" />);

    expect(screen.getAllByTestId(/repository-card-/).map((card) => card.textContent)).toEqual([
      'first-by-vector-score',
      'second-by-vector-score',
      'repository-one',
    ]);
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
