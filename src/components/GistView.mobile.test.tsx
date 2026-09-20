import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GistView } from './GistView';
import { useGistActions } from '../features/gists/hooks/useGistActions';
import { useAppStore } from '../store/useAppStore';

vi.mock('../features/gists/hooks/useGistActions', () => ({ useGistActions: vi.fn() }));
vi.mock('../store/useAppStore', () => ({ useAppStore: vi.fn() }));
vi.mock('./GistDetailModal', () => ({ GistDetailModal: () => null }));
vi.mock('./GistEditorModal', () => ({ GistEditorModal: () => null }));

const mockActions = vi.mocked(useGistActions);
const mockStore = vi.mocked(useAppStore);

beforeEach(() => {
  vi.clearAllMocks();
  mockActions.mockReturnValue({
    user: { login: 'me' }, gists: [], starredGists: [],
    gistSearchFilters: { query: '', sortBy: 'updated', sortOrder: 'desc' }, gistSearchResults: [],
    selectedGistCategory: 'all', language: 'en', setGistSearchFilters: vi.fn(), setGistSearchResults: vi.fn(),
    setSelectedGistCategory: vi.fn(), setStarredGists: vi.fn(), isRefreshing: false, isSearching: false,
    isAnalyzingAll: false, refreshGists: vi.fn(), aiSearch: vi.fn(), analyzeVisibleGists: vi.fn(),
    fetchGistDetail: vi.fn(), submitGist: vi.fn(),
  } as unknown as ReturnType<typeof useGistActions>);
  mockStore.mockReturnValue({ starredGists: [] } as ReturnType<typeof useAppStore>);
});

describe('GistView mobile layout', () => {
  it('uses a contained horizontal category strip and touch-safe toolbar', () => {
    const { container } = render(<GistView />);

    expect(container.querySelector('aside')).toHaveClass('max-w-full');
    expect(screen.getByTestId('gist-category-strip')).toHaveClass('overflow-x-auto', 'touch-pan-x', 'lg:overflow-visible');
    expect(screen.getByRole('textbox', { name: 'Search gists, filenames, or summaries' })).toHaveClass('h-11', 'text-base', 'sm:h-10', 'sm:text-sm');
    for (const name of ['AI search', 'Desc', 'AI analyze', 'Sync', 'New']) {
      expect(screen.getByRole('button', { name })).toHaveClass('min-h-11', 'sm:min-h-9');
    }
  });

  it('opens named permission help without hover', () => {
    render(<GistView />);
    fireEvent.click(screen.getByRole('button', { name: 'Gist permission help' }));
    expect(screen.getByText('Gist access requires the gist scope')).toBeVisible();
  });
});
