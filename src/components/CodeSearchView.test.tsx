import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodeSearchView } from './CodeSearchView';
import { useAppStore } from '../store/useAppStore';
import { searchGrepApp, type GrepSearchResult } from '../services/grepAppService';
import type { Repository } from '../types';

vi.mock('../store/useAppStore', () => ({
  useAppStore: vi.fn(),
}));

vi.mock('../services/grepAppService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/grepAppService')>();
  return { ...actual, searchGrepApp: vi.fn() };
});

const mockedSearch = vi.mocked(searchGrepApp);
const mockedStore = vi.mocked(useAppStore);

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
  owner: { login: 'facebook', avatar_url: 'https://example.com/a.png' },
  topics: [],
  ...overrides,
});

const mockResult: GrepSearchResult = {
  total: 2,
  repoFacets: [
    { val: 'facebook/react', count: 1 },
    { val: 'other/repo', count: 1 },
  ],
  pathFacets: [{ val: 'src/', count: 2 }],
  langFacets: [{ val: 'TypeScript', count: 2 }],
  hits: [
    {
      repo: 'facebook/react',
      branch: 'main',
      path: 'src/index.ts',
      language: 'TypeScript',
      totalMatches: '3',
      snippetHtml: '<pre><mark>hello</mark></pre>',
    },
    {
      repo: 'other/repo',
      branch: 'main',
      path: 'a file with spaces.ts',
      language: 'TypeScript',
      totalMatches: '1',
      snippetHtml: '<pre>world</pre>',
    },
  ],
};

describe('CodeSearchView', () => {
  beforeEach(() => {
    mockedStore.mockImplementation(
      ((selector: (s: unknown) => unknown) =>
        selector({ repositories: [createRepository({})], language: 'zh' })) as unknown as typeof useAppStore
    );
    mockedSearch.mockResolvedValue(mockResult);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the idle empty state without fetching', () => {
    render(<CodeSearchView />);
    expect(screen.getByText('高级搜索')).toBeInTheDocument();
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it('does not search for queries shorter than 2 chars', async () => {
    render(<CodeSearchView />);
    fireEvent.change(screen.getByLabelText('代码搜索关键词'), { target: { value: 'a' } });
    await new Promise((resolve) => setTimeout(resolve, 650));
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it('debounces input and renders hits with encoded file links', async () => {
    render(<CodeSearchView />);
    fireEvent.change(screen.getByLabelText('代码搜索关键词'), { target: { value: 'hello' } });
    expect(mockedSearch).not.toHaveBeenCalled();
    await waitFor(() => expect(mockedSearch).toHaveBeenCalledTimes(1));
    expect(mockedSearch).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'hello', mode: 'fuzzy', page: 1 }),
      expect.anything()
    );
    expect(await screen.findByRole('link', { name: 'facebook/react' })).toBeInTheDocument();
    // 路径含空格需做分段编码
    const fileLink = await screen.findByText('a file with spaces.ts');
    expect(fileLink.getAttribute('href')).toContain('a%20file%20with%20spaces.ts');
    // 已收藏仓库打出 Starred 徽章
    expect(screen.getByText('已收藏')).toBeInTheDocument();
  });

  it('starred-only switch filters out non-starred hits', async () => {
    render(<CodeSearchView />);
    fireEvent.change(screen.getByLabelText('代码搜索关键词'), { target: { value: 'hello' } });
    await screen.findByRole('link', { name: 'other/repo' });
    fireEvent.click(screen.getByLabelText('只显示我收藏的仓库'));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'other/repo' })).not.toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'facebook/react' })).toBeInTheDocument();
  });

  it('facet selection re-searches with f.* params', async () => {
    render(<CodeSearchView />);
    fireEvent.change(screen.getByLabelText('代码搜索关键词'), { target: { value: 'hello' } });
    await screen.findByRole('link', { name: 'facebook/react' });
    fireEvent.click(screen.getByTitle('TypeScript (2)'));
    await waitFor(() => expect(mockedSearch).toHaveBeenCalledTimes(2));
    expect(mockedSearch).toHaveBeenLastCalledWith(
      expect.objectContaining({ langs: ['TypeScript'] }),
      expect.anything()
    );
  });

  it('shows retryable error on rate limit but keeps previous results', async () => {
    render(<CodeSearchView />);
    fireEvent.change(screen.getByLabelText('代码搜索关键词'), { target: { value: 'hello' } });
    await screen.findByRole('link', { name: 'facebook/react' });
    const rateLimit = new Error('limited');
    (rateLimit as { status?: number }).status = 429;
    mockedSearch.mockRejectedValueOnce(rateLimit);
    fireEvent.click(screen.getByTitle('TypeScript (2)'));
    await screen.findByText(/限流/);
    // 旧结果保留可见
    expect(screen.getByRole('link', { name: 'facebook/react' })).toBeInTheDocument();
  });
});
