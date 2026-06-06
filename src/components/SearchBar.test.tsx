import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchBar } from './SearchBar';
import { useAppStore } from '../store/useAppStore';
import type { SearchFilters } from '../types';

vi.mock('../store/useAppStore', () => ({
  useAppStore: vi.fn(),
  getAllCategories: vi.fn(() => []),
}));

const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  configurable: true,
});

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  configurable: true,
});

const defaultSearchFilters: SearchFilters = {
  query: '',
  tags: [],
  languages: [],
  platforms: [],
  sortBy: 'stars',
  sortOrder: 'desc',
};

const createStoreState = (overrides: Partial<ReturnType<typeof baseStoreState>> = {}) => ({
  ...baseStoreState(),
  ...overrides,
});

const baseStoreState = () => ({
  searchFilters: { ...defaultSearchFilters },
  repositories: [],
  releaseSubscriptions: new Set<number>(),
  aiConfigs: [],
  activeAIConfig: null,
  language: 'zh',
  setSearchFilters: vi.fn(),
  setSearchResults: vi.fn(),
  customCategories: [],
  hiddenDefaultCategoryIds: [],
  defaultCategoryOverrides: {},
});

const mockUseAppStore = vi.mocked(useAppStore);

describe('SearchBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('clears the committed query when the search input is manually emptied', () => {
    const setSearchFilters = vi.fn();
    mockUseAppStore.mockReturnValue(createStoreState({
      searchFilters: {
        ...defaultSearchFilters,
        query: 'react',
      },
      setSearchFilters,
    }) as ReturnType<typeof useAppStore>);

    render(<SearchBar />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });

    expect(setSearchFilters).toHaveBeenCalledWith({ query: '' });
  });

  it('keeps the committed query empty when sorting after manual clearing', () => {
    const storeState = createStoreState({
      searchFilters: {
        ...defaultSearchFilters,
        query: 'react',
        sortOrder: 'desc',
      },
    });

    const setSearchFilters = vi.fn((filters: Partial<SearchFilters>) => {
      storeState.searchFilters = {
        ...storeState.searchFilters,
        ...filters,
      };
    });
    storeState.setSearchFilters = setSearchFilters;

    mockUseAppStore.mockReturnValue(storeState as ReturnType<typeof useAppStore>);

    const { rerender } = render(<SearchBar />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });

    expect(storeState.searchFilters.query).toBe('');

    rerender(<SearchBar />);
    fireEvent.click(screen.getByText('↓'));

    expect(storeState.searchFilters).toMatchObject({
      query: '',
      sortOrder: 'asc',
    });
    expect(setSearchFilters).toHaveBeenCalledWith({ query: '' });
    expect(setSearchFilters).toHaveBeenCalledWith({ sortOrder: 'asc' });
  });
});
