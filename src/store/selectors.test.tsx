import { act, render, screen } from '@testing-library/react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppStoreState } from './types';
import { selectRepositoryListState } from './selectors';

interface SelectorTestState {
  repositories: AppStoreState['repositories'];
  searchResults: AppStoreState['searchResults'];
  searchFilters: AppStoreState['searchFilters'];
  selectedCategory: string;
  repositoryViewMode: AppStoreState['repositoryViewMode'];
  language: AppStoreState['language'];
  readReleases: Set<number>;
}

const useSelectorTestStore = create<SelectorTestState>()(() => ({
  repositories: [],
  searchResults: [],
  searchFilters: {
    query: '',
    tags: [],
    languages: [],
    platforms: [],
    licenses: [],
    sortBy: 'stars',
    sortOrder: 'desc',
  },
  selectedCategory: 'all',
  repositoryViewMode: 'grid',
  language: 'en',
  readReleases: new Set(),
}));

const renderSpy = vi.fn();

const RepositoryListSelectorProbe = () => {
  const selection = useSelectorTestStore(useShallow((state) => selectRepositoryListState(state as AppStoreState)));
  renderSpy();
  return <output data-testid="repository-count">{selection.repositories.length}</output>;
};

describe('typed Store selectors', () => {
  afterEach(() => {
    renderSpy.mockReset();
    useSelectorTestStore.setState({ readReleases: new Set() });
  });

  it('does not rerender a repository-list subscriber for an unrelated release read-state update', () => {
    render(<RepositoryListSelectorProbe />);
    expect(screen.getByTestId('repository-count')).toBeInTheDocument();
    expect(renderSpy).toHaveBeenCalledTimes(1);

    act(() => {
      useSelectorTestStore.setState({ readReleases: new Set([-1]) });
    });

    expect(renderSpy).toHaveBeenCalledTimes(1);
  });
});
