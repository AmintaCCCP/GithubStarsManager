import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositoryCard } from './RepositoryCard';
import { useAppStore } from '../store/useAppStore';
import type { Repository } from '../types';

vi.mock('../store/useAppStore', () => ({
  useAppStore: vi.fn(),
}));

vi.mock('../hooks/useDialog', () => ({
  useDialog: () => ({ toast: vi.fn(), confirm: vi.fn() }),
}));

vi.mock('./FloatingTooltip', () => ({
  FloatingTooltip: () => null,
}));

vi.mock('./RepositoryEditModal', () => ({
  RepositoryEditModal: ({ isOpen }: { isOpen: boolean }) => (
    isOpen ? <div data-testid="repository-edit-modal" /> : null
  ),
}));

vi.mock('./ReadmeModal', () => ({
  ReadmeModal: ({ isOpen }: { isOpen: boolean }) => (
    isOpen ? <div data-testid="readme-modal" /> : null
  ),
}));

const repository: Repository = {
  id: 1,
  name: 'example-repository',
  full_name: 'owner/example-repository',
  description: 'Repository description',
  html_url: 'https://github.com/owner/example-repository',
  stargazers_count: 128,
  forks_count: 3,
  forks: 3,
  language: 'TypeScript',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
  pushed_at: '2026-01-03T00:00:00.000Z',
  owner: {
    login: 'owner',
    avatar_url: 'https://example.com/avatar.png',
  },
  topics: ['test'],
  ai_platforms: ['web', 'cli'],
};

const storeState = {
  releaseSubscriptions: new Set<number>([1]),
  analyzingRepositoryIds: new Set<number>(),
  toggleReleaseSubscription: vi.fn(),
  githubToken: null,
  activeAIConfig: null,
  setAnalyzingRepository: vi.fn(),
  language: 'zh' as const,
  updateRepository: vi.fn(),
  deleteRepository: vi.fn(),
  vectorSearchConfig: {
    enabled: true,
    workerUrl: 'https://worker.example.com',
    authToken: 'token',
    embeddingConfigId: 'embedding',
    indexMode: 'readme' as const,
    readmeMaxChars: 6000,
  },
  vectorSearchStatus: { connected: true, vectorCount: 1, dimensions: 1536 },
  embeddingConfigs: [{
    id: 'embedding',
    name: 'Test embedding',
    apiType: 'openai-compatible' as const,
    baseUrl: 'https://example.com/v1',
    apiKey: 'test-key',
    model: 'test-model',
    dimensions: 1536,
    isActive: true,
  }],
  activeEmbeddingConfig: 'embedding',
  repositories: [repository],
  enterSimilarView: vi.fn(),
  aiConfigs: [],
};

const mockUseAppStore = vi.mocked(useAppStore);

beforeEach(() => {
  vi.clearAllMocks();
  storeState.releaseSubscriptions = new Set<number>([1]);
  storeState.vectorSearchConfig.enabled = true;
  mockUseAppStore.mockImplementation(((selector?: (state: typeof storeState) => unknown) => (
    selector ? selector(storeState) : storeState
  )) as typeof useAppStore);
});

describe('RepositoryCard view modes', () => {
  it('moves single-card actions into an accessible more-actions menu in list mode', async () => {
    const user = userEvent.setup();
    render(<RepositoryCard repository={repository} allCategories={[]} viewMode="list" />);

    const lastPushed = screen.getByText(/最近提交/);
    expect(lastPushed).toBeInTheDocument();
    expect(lastPushed).not.toHaveClass('group-hover:opacity-0');
    expect(screen.getByRole('button', { name: '更多操作' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '编辑仓库信息' })).toBeInTheDocument();
    expect(screen.getByText('test')).toBeInTheDocument();
    expect(screen.getByText('TypeScript')).toBeInTheDocument();
    expect(screen.queryByTitle('AI分析此仓库')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '更多操作' }));

    expect(screen.getByText('仓库操作')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'AI 分析' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '查找同类仓库' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '取消 Star' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '在 GitHub 中查看' })).toHaveAttribute('href', repository.html_url);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText('仓库操作')).not.toBeInTheDocument());
  });

  it('only exposes similar-repository search in the menu when vector search is available', async () => {
    const user = userEvent.setup();
    const originalVectorSearchEnabled = storeState.vectorSearchConfig.enabled;
    try {
      storeState.vectorSearchConfig.enabled = false;
      render(<RepositoryCard repository={repository} allCategories={[]} viewMode="list" />);

      await user.click(screen.getByRole('button', { name: '更多操作' }));
      expect(screen.queryByRole('menuitem', { name: '查找同类仓库' })).not.toBeInTheDocument();
      expect(screen.queryByText('查找同类')).not.toBeInTheDocument();
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByText('仓库操作')).not.toBeInTheDocument());
    } finally {
      storeState.vectorSearchConfig.enabled = originalVectorSearchEnabled;
    }
  });

  it('closes the list action menu from card whitespace, page whitespace, or Escape', async () => {
    const user = userEvent.setup();
    const { container } = render(<RepositoryCard repository={repository} allCategories={[]} viewMode="list" />);
    const moreActions = screen.getByRole('button', { name: '更多操作' });
    const card = container.firstElementChild as HTMLElement;

    await user.click(moreActions);
    expect(screen.getByText('仓库操作')).toBeInTheDocument();
    await act(async () => {
      fireEvent.pointerDown(card);
      fireEvent.click(card);
    });
    await waitFor(() => expect(screen.queryByText('仓库操作')).not.toBeInTheDocument());
    expect(screen.queryByTestId('readme-modal')).not.toBeInTheDocument();

    await user.click(moreActions);
    await act(async () => {
      fireEvent.pointerDown(document.body);
    });
    await waitFor(() => expect(screen.queryByText('仓库操作')).not.toBeInTheDocument());

    await user.click(moreActions);
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    await waitFor(() => expect(screen.queryByText('仓库操作')).not.toBeInTheDocument());
  });

  it('does not open README when menu dismissal is followed by a card click', async () => {
    const user = userEvent.setup();
    const { container } = render(<RepositoryCard repository={repository} allCategories={[]} viewMode="list" />);
    const card = container.firstElementChild as HTMLElement;

    await user.click(screen.getByRole('button', { name: '更多操作' }));
    expect(screen.getByText('仓库操作')).toBeInTheDocument();

    await act(async () => {
      fireEvent.pointerDown(card);
      fireEvent.click(card);
    });

    await waitFor(() => expect(screen.queryByText('仓库操作')).not.toBeInTheDocument());
    expect(screen.queryByTestId('readme-modal')).not.toBeInTheDocument();
  });

  it('does not let the card keyboard handler intercept list menu or direct edit activation', async () => {
    const user = userEvent.setup();
    render(<RepositoryCard repository={repository} allCategories={[]} viewMode="list" />);

    const moreActions = screen.getByRole('button', { name: '更多操作' });
    await act(async () => {
      moreActions.focus();
      await user.keyboard('{Enter}');
    });
    expect(screen.queryByTestId('readme-modal')).not.toBeInTheDocument();

    const unsubscribe = await screen.findByRole('menuitem', { name: '取消订阅 Release' });
    await act(async () => {
      unsubscribe.focus();
      await user.keyboard('{Enter}');
    });
    expect(storeState.toggleReleaseSubscription).toHaveBeenCalledWith(repository.id);
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: '取消订阅 Release' })).not.toBeInTheDocument());
    expect(screen.queryByTestId('readme-modal')).not.toBeInTheDocument();

    const editAction = screen.getByRole('button', { name: '编辑仓库信息' });
    await act(async () => {
      editAction.focus();
      await user.keyboard('{Enter}');
    });
    expect(screen.getByTestId('repository-edit-modal')).toBeInTheDocument();
  });

  it('retains the existing quick action row in grid mode', () => {
    render(<RepositoryCard repository={repository} allCategories={[]} viewMode="grid" />);

    expect(screen.queryByRole('button', { name: '更多操作' })).not.toBeInTheDocument();
    expect(screen.getByTitle('AI分析此仓库')).toBeInTheDocument();
    expect(screen.getByTitle('取消订阅发布')).toBeInTheDocument();
    expect(screen.getByTitle('编辑仓库信息')).toBeInTheDocument();

    const footer = screen.getByText(/最近提交/).closest('.border-t');
    expect(footer?.parentElement).toHaveClass('mt-4');
  });
});
