import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReadmeModal } from './ReadmeModal';
import { backend } from '../services/backendAdapter';
import { GitHubApiService } from '../services/githubApi';
import { useAppStore } from '../store/useAppStore';
import type { Repository } from '../types';

vi.mock('./BilingualMarkdownRenderer', async () => {
  const React = await import('react');
  return {
    default: React.forwardRef(({ markdown }: { markdown: string }, ref) => {
      void ref;
      return <div>{markdown}</div>;
    }),
  };
});

vi.mock('../services/backendAdapter', () => ({
  backend: {
    isAvailable: true,
    getRepositoryReadme: vi.fn(),
    getRepositoryReadmeByPath: vi.fn(),
    listRepositoryReadmeCandidates: vi.fn(),
  },
}));

vi.mock('../services/githubApi', () => ({
  GitHubApiService: vi.fn(),
}));

vi.mock('../store/useAppStore', () => ({
  useAppStore: vi.fn(),
}));

const mockGitHubApi = {
  getRepositoryReadme: vi.fn(),
  getRepositoryReadmeByPath: vi.fn(),
  listRepositoryReadmeCandidates: vi.fn(),
};

const setMockStore = (githubToken: string | null = null) => {
  (useAppStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector?: (state: unknown) => unknown) => {
    const state = {
      language: 'zh',
      githubToken,
      setReadmeModalOpen: vi.fn(),
    };
    return selector ? selector(state) : state;
  });
};

const mockedGitHubApiService = GitHubApiService as unknown as ReturnType<typeof vi.fn>;

const mockRepository: Repository = {
  id: 1,
  name: 'demo',
  full_name: 'owner/demo',
  description: 'Demo repository',
  html_url: 'https://github.com/owner/demo',
  stargazers_count: 10,
  forks_count: 2,
  forks: 2,
  language: 'TypeScript',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  pushed_at: '2026-01-03T00:00:00Z',
  owner: {
    login: 'owner',
    avatar_url: 'https://example.com/avatar.png',
  },
  topics: [],
};

describe('ReadmeModal multilingual README switching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (backend as { isAvailable: boolean }).isAvailable = true;
    setMockStore();
    mockGitHubApi.getRepositoryReadme.mockResolvedValue('Direct README content');
    mockGitHubApi.getRepositoryReadmeByPath.mockResolvedValue('Direct localized README content');
    mockGitHubApi.listRepositoryReadmeCandidates.mockResolvedValue([
      { path: 'README.md', type: 'blob' },
      { path: 'README_zh.md', type: 'blob' },
    ]);
    mockedGitHubApiService.mockImplementation(() => mockGitHubApi);
    (backend.getRepositoryReadme as ReturnType<typeof vi.fn>).mockResolvedValue('Default README content');
    (backend.getRepositoryReadmeByPath as ReturnType<typeof vi.fn>).mockResolvedValue('中文 README 内容');
    (backend.listRepositoryReadmeCandidates as ReturnType<typeof vi.fn>).mockResolvedValue([
      { path: 'README.md', type: 'blob' },
      { path: 'README_zh.md', type: 'blob' },
      { path: 'docs/README.ja.md', type: 'blob' },
    ]);
  });

  it('loads the default README first and then shows all detected README variants', async () => {
    render(<ReadmeModal isOpen onClose={vi.fn()} repository={mockRepository} />);

    expect(await screen.findByText('Default README content')).toBeInTheDocument();
    expect(backend.getRepositoryReadme).toHaveBeenCalledWith('owner', 'demo', expect.any(AbortSignal));

    const selector = await screen.findByLabelText('切换 README 语言');
    expect(selector).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '默认 README' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '中文 · README_zh.md' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '日语 · docs/README.ja.md' })).toBeInTheDocument();
  });

  it('loads the selected README variant by path', async () => {
    render(<ReadmeModal isOpen onClose={vi.fn()} repository={mockRepository} />);

    await screen.findByText('Default README content');
    const selector = await screen.findByLabelText('切换 README 语言');

    fireEvent.change(selector, { target: { value: 'README_zh.md' } });

    await waitFor(() => {
      expect(backend.getRepositoryReadmeByPath).toHaveBeenCalledWith('owner', 'demo', 'README_zh.md', expect.any(AbortSignal));
    });
    expect(await screen.findByText('中文 README 内容')).toBeInTheDocument();
  });

  it('does not show the selector when no localized README exists', async () => {
    (backend.listRepositoryReadmeCandidates as ReturnType<typeof vi.fn>).mockResolvedValue([
      { path: 'README.md', type: 'blob' },
    ]);

    render(<ReadmeModal isOpen onClose={vi.fn()} repository={mockRepository} />);

    expect(await screen.findByText('Default README content')).toBeInTheDocument();
    await waitFor(() => {
      expect(backend.listRepositoryReadmeCandidates).toHaveBeenCalled();
    });
    expect(screen.queryByLabelText('切换 README 语言')).not.toBeInTheDocument();
  });

  it('shows backend README errors instead of treating them as missing README', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      (backend.getRepositoryReadme as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('GitHub token not configured'));

      render(<ReadmeModal isOpen onClose={vi.fn()} repository={mockRepository} />);

      expect(await screen.findByText('GitHub token not configured')).toBeInTheDocument();
      expect(mockGitHubApi.getRepositoryReadme).not.toHaveBeenCalled();
      expect(screen.queryByText('该仓库没有 README 文件')).not.toBeInTheDocument();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('falls back to the direct GitHub API when backend README proxy fails and a token exists', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      setMockStore('github-token');
      (backend.getRepositoryReadme as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('GitHub token not configured'));
      mockGitHubApi.getRepositoryReadme.mockResolvedValue('Direct README content');

      render(<ReadmeModal isOpen onClose={vi.fn()} repository={mockRepository} />);

      expect(await screen.findByText('Direct README content')).toBeInTheDocument();
      expect(mockedGitHubApiService).toHaveBeenCalledWith('github-token');
      expect(mockGitHubApi.getRepositoryReadme).toHaveBeenCalledWith('owner', 'demo', expect.any(AbortSignal));
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('does not use direct fallback when the backend reports README is missing', async () => {
    setMockStore('github-token');
    (backend.getRepositoryReadme as ReturnType<typeof vi.fn>).mockResolvedValue('');

    render(<ReadmeModal isOpen onClose={vi.fn()} repository={mockRepository} />);

    expect(await screen.findByText('该仓库没有 README 文件')).toBeInTheDocument();
    expect(mockGitHubApi.getRepositoryReadme).not.toHaveBeenCalled();
  });

  it('falls back to the direct GitHub API when a selected README path fails through backend', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      setMockStore('github-token');
      (backend.getRepositoryReadmeByPath as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('GitHub token not configured'));
      mockGitHubApi.getRepositoryReadmeByPath.mockResolvedValue('Direct 中文 README 内容');

      render(<ReadmeModal isOpen onClose={vi.fn()} repository={mockRepository} />);

      await screen.findByText('Default README content');
      const selector = await screen.findByLabelText('切换 README 语言');
      fireEvent.change(selector, { target: { value: 'README_zh.md' } });

      expect(await screen.findByText('Direct 中文 README 内容')).toBeInTheDocument();
      expect(mockGitHubApi.getRepositoryReadmeByPath).toHaveBeenCalledWith('owner', 'demo', 'README_zh.md', expect.any(AbortSignal));
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('falls back to direct README variant detection when backend candidate listing fails', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      setMockStore('github-token');
      (backend.listRepositoryReadmeCandidates as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('GitHub token not configured'));
      mockGitHubApi.listRepositoryReadmeCandidates.mockResolvedValue([
        { path: 'README.md', type: 'blob' },
        { path: 'README_zh.md', type: 'blob' },
      ]);

      render(<ReadmeModal isOpen onClose={vi.fn()} repository={mockRepository} />);

      expect(await screen.findByText('Default README content')).toBeInTheDocument();
      const selector = await screen.findByLabelText('切换 README 语言');
      expect(selector).toBeInTheDocument();
      expect(screen.getByRole('option', { name: '中文 · README_zh.md' })).toBeInTheDocument();
      expect(mockGitHubApi.listRepositoryReadmeCandidates).toHaveBeenCalledWith('owner', 'demo', undefined, expect.any(AbortSignal));
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });
});
