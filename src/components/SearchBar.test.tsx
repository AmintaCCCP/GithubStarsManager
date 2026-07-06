import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchBar } from './SearchBar';
import { useAppStore } from '../store/useAppStore';
import type { Repository, SearchFilters } from '../types';

vi.mock('../store/useAppStore', () => ({
  useAppStore: vi.fn(),
  getAllCategories: vi.fn(() => []),
}));

vi.mock('../hooks/useDialog', () => ({
  useDialog: () => ({
    toast: vi.fn(),
    confirm: vi.fn(),
  }),
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

const createRepository = (overrides: Partial<Repository>): Repository => ({
  id: 1,
  name: 'react',
  full_name: 'facebook/react',
  description: null,
  html_url: 'https://github.com/facebook/react',
  stargazers_count: 1000,
  forks_count: 100,
  forks: 100,
  language: 'TypeScript',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  pushed_at: '2024-01-03T00:00:00Z',
  owner: {
    login: 'facebook',
    avatar_url: 'https://example.com/avatar.png',
  },
  topics: [],
  ...overrides,
});

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
  vectorSearchConfig: { enabled: false, workerUrl: '', authToken: '', embeddingConfigId: '', indexMode: 'readme' as const, readmeMaxChars: 6000 },
  vectorSearchStatus: { connected: false, vectorCount: 0, dimensions: 0 },
  embeddingConfigs: [],
});

const mockUseAppStore = vi.mocked(useAppStore);
// Track the current mock state so getState() returns the same overrides as the hook.
let currentState = baseStoreState();
(mockUseAppStore as unknown as { getState: () => ReturnType<typeof baseStoreState> }).getState =
  () => currentState;

describe('SearchBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    currentState = baseStoreState();
  });

  it('clears the committed query when the search input is manually emptied', () => {
    const setSearchFilters = vi.fn();
    currentState = createStoreState({
      searchFilters: {
        ...defaultSearchFilters,
        query: 'react',
      },
      setSearchFilters,
    });
    mockUseAppStore.mockReturnValue(currentState as ReturnType<typeof useAppStore>);

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

    currentState = storeState;
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

  it('pauses real-time search for IME preedit text and resumes after composition ends', () => {
    vi.useFakeTimers();
    const setSearchResults = vi.fn();
    currentState = createStoreState({
      repositories: [
        createRepository({ id: 1, name: 'nested-rain', full_name: 'owner/nested-rain' }),
        createRepository({ id: 2, name: 'vector-search', full_name: 'owner/vector-search' }),
      ],
      setSearchResults,
    });
    mockUseAppStore.mockReturnValue(currentState as ReturnType<typeof useAppStore>);

    try {
      render(<SearchBar />);
      const input = screen.getByRole('textbox');

      fireEvent.compositionStart(input);
      fireEvent.change(input, { target: { value: 'rain' } });

      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(setSearchResults).not.toHaveBeenCalledWith([
        expect.objectContaining({ name: 'nested-rain' }),
      ]);

      fireEvent.compositionEnd(input, { currentTarget: { value: 'rain' } });

      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(setSearchResults).toHaveBeenLastCalledWith([
        expect.objectContaining({ name: 'nested-rain' }),
      ]);
      expect(screen.getByText('实时搜索模式 - 匹配仓库名称')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets stale real-time results when the input becomes whitespace-only', () => {
    vi.useFakeTimers();
    const repositories = [
      createRepository({ id: 1, name: 'nested-rain', full_name: 'owner/nested-rain' }),
      createRepository({ id: 2, name: 'vector-search', full_name: 'owner/vector-search' }),
    ];
    const setSearchResults = vi.fn();
    currentState = createStoreState({
      repositories,
      setSearchResults,
    });
    mockUseAppStore.mockReturnValue(currentState as ReturnType<typeof useAppStore>);

    try {
      render(<SearchBar />);
      const input = screen.getByRole('textbox');

      fireEvent.change(input, { target: { value: 'rain' } });
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(setSearchResults).toHaveBeenLastCalledWith([
        expect.objectContaining({ name: 'nested-rain' }),
      ]);

      fireEvent.change(input, { target: { value: '   ' } });

      expect(setSearchResults).toHaveBeenLastCalledWith(repositories);
    } finally {
      vi.useRealTimers();
    }
  });
});
