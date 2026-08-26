import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TooltipProvider } from './ui/tooltip';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositoryCard } from './RepositoryCard';
import { useAppStore } from '../store/useAppStore';
import type { Repository } from '../types';

const actionMocks = vi.hoisted(() => ({
  releaseSheet: {
    suspend: null as Promise<void> | null,
  },
  actions: {
    analyze: vi.fn(),
    findSimilar: vi.fn(),
    unstar: vi.fn(),
    toggleReleaseSubscription: vi.fn(),
    isSubscribed: true,
    isAnalyzing: false,
    isFindingSimilar: false,
    isUnstarring: false,
    vectorSearchAvailable: true,
  },
}));

vi.mock('../store/useAppStore', () => ({
  useAppStore: vi.fn(),
}));

vi.mock('../features/repositories/hooks/useRepositoryCardActions', () => ({
  useRepositoryCardActions: () => actionMocks.actions,
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

vi.mock('./RepositoryReleaseSheet', () => ({
  RepositoryReleaseSheet: ({ isOpen }: { isOpen: boolean }) => {
    if (actionMocks.releaseSheet.suspend) throw actionMocks.releaseSheet.suspend;
    return isOpen ? <div data-testid="repository-release-sheet" /> : null;
  },
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

const renderRepositoryCard = (
  viewMode: 'list' | 'grid',
  options: { onAskRepository?: (repository: Repository) => void; selectionMode?: boolean } = {},
) => render(
  <TooltipProvider>
    <RepositoryCard repository={repository} allCategories={[]} viewMode={viewMode} {...options} />
  </TooltipProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  actionMocks.releaseSheet.suspend = null;
  storeState.releaseSubscriptions = new Set<number>([1]);
  storeState.vectorSearchConfig.enabled = true;
  Object.assign(actionMocks.actions, {
    isSubscribed: true,
    isAnalyzing: false,
    isFindingSimilar: false,
    isUnstarring: false,
    vectorSearchAvailable: true,
  });
  mockUseAppStore.mockImplementation(((selector?: (state: typeof storeState) => unknown) => (
    selector ? selector(storeState) : storeState
  )) as typeof useAppStore);
});

describe('RepositoryCard view modes', () => {
  it('moves single-card actions into an accessible more-actions menu in list mode', async () => {
    const user = userEvent.setup();
    renderRepositoryCard('list', { onAskRepository: vi.fn() });

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
    expect(screen.getByRole('menuitem', { name: '问答此仓库' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '查找同类仓库' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '查看 Release' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '取消 Star' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '在 GitHub 中查看' })).toHaveAttribute('href', repository.html_url);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText('仓库操作')).not.toBeInTheDocument());
  });

  it('only exposes similar-repository search in the menu when vector search is available', async () => {
    const user = userEvent.setup();
    const originalVectorSearchAvailable = actionMocks.actions.vectorSearchAvailable;
    try {
      actionMocks.actions.vectorSearchAvailable = false;
      renderRepositoryCard('list');

      await user.click(screen.getByRole('button', { name: '更多操作' }));
      expect(screen.queryByRole('menuitem', { name: '查找同类仓库' })).not.toBeInTheDocument();
      expect(screen.queryByText('查找同类')).not.toBeInTheDocument();
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByText('仓库操作')).not.toBeInTheDocument());
    } finally {
      actionMocks.actions.vectorSearchAvailable = originalVectorSearchAvailable;
    }
  });

  it('delegates the list similar-search menu action to the domain Hook', async () => {
    const user = userEvent.setup();
    renderRepositoryCard('list');

    await user.click(screen.getByRole('button', { name: '更多操作' }));
    await user.click(screen.getByRole('menuitem', { name: '查找同类仓库' }));

    expect(actionMocks.actions.findSimilar).toHaveBeenCalledOnce();
  });

  it('closes the list action menu from card whitespace, page whitespace, or Escape', async () => {
    const user = userEvent.setup();
    const { container } = renderRepositoryCard('list');
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


  it('does not let the card keyboard handler intercept list menu or direct edit activation', async () => {
    const user = userEvent.setup();
    renderRepositoryCard('list');

    const moreActions = screen.getByRole('button', { name: '更多操作' });
    moreActions.focus();
    await user.keyboard('{Enter}');
    expect(screen.queryByTestId('readme-modal')).not.toBeInTheDocument();

    const unsubscribe = await screen.findByRole('menuitem', { name: '取消订阅 Release' });
    unsubscribe.focus();
    await user.keyboard('{Enter}');
    expect(actionMocks.actions.toggleReleaseSubscription).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: '取消订阅 Release' })).not.toBeInTheDocument());
    expect(screen.queryByTestId('readme-modal')).not.toBeInTheDocument();

    const editAction = screen.getByRole('button', { name: '编辑仓库信息' });
    editAction.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('repository-edit-modal')).toBeInTheDocument();
  });

  it('delegates grid quick actions to the domain Hook without changing their presentation', async () => {
    const user = userEvent.setup();
    renderRepositoryCard('grid');

    await user.click(screen.getByTitle('AI分析此仓库'));
    await user.click(screen.getByTitle('取消 Star'));

    expect(actionMocks.actions.analyze).toHaveBeenCalledOnce();
    expect(actionMocks.actions.unstar).toHaveBeenCalledOnce();
  });

  it('emits a repository-chat intent from both grid and list controls without invoking a service', async () => {
    const user = userEvent.setup();
    const onAskRepository = vi.fn();
    const { unmount } = renderRepositoryCard('grid', { onAskRepository });

    await user.click(screen.getByRole('button', { name: '问答此仓库' }));
    expect(onAskRepository).toHaveBeenCalledWith(repository);
    unmount();

    renderRepositoryCard('list', { onAskRepository });
    await user.click(screen.getByRole('button', { name: '更多操作' }));
    await user.click(screen.getByRole('menuitem', { name: '问答此仓库' }));
    expect(onAskRepository).toHaveBeenCalledTimes(2);
  });

  it('opens the release sheet from the grid action immediately before the DeepWiki/Zread action', async () => {
    const user = userEvent.setup();
    renderRepositoryCard('grid');

    const releaseButton = screen.getByRole('button', { name: '查看 Release' });
    const zreadLink = screen.getByTitle('在Zread中查看');
    expect(releaseButton.compareDocumentPosition(zreadLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(releaseButton);
    expect(screen.getByTestId('repository-release-sheet')).toBeInTheDocument();
  });

  it('opens the release sheet from the list action menu without opening README', async () => {
    const user = userEvent.setup();
    renderRepositoryCard('list');

    await user.click(screen.getByRole('button', { name: '更多操作' }));
    await user.click(screen.getByRole('menuitem', { name: '查看 Release' }));

    expect(screen.getByTestId('repository-release-sheet')).toBeInTheDocument();
    expect(screen.queryByTestId('readme-modal')).not.toBeInTheDocument();
  });

  it('does not open README when an outside click closes the lazy release-sheet fallback', async () => {
    const user = userEvent.setup();
    actionMocks.releaseSheet.suspend = new Promise(() => undefined);
    const { container } = renderRepositoryCard('grid');
    const card = container.firstElementChild as HTMLElement;

    await user.click(screen.getByRole('button', { name: '查看 Release' }));
    expect(await screen.findByText('Loading releases...')).toBeInTheDocument();

    await act(async () => {
      fireEvent.pointerDown(document.body);
      fireEvent.click(card);
    });

    expect(screen.queryByTestId('readme-modal')).not.toBeInTheDocument();
  });

  it('retains the existing quick action row in grid mode', () => {
    renderRepositoryCard('grid', { onAskRepository: vi.fn() });

    expect(screen.queryByRole('button', { name: '更多操作' })).not.toBeInTheDocument();
    expect(screen.getByTitle('AI分析此仓库')).toBeInTheDocument();
    expect(screen.getByTitle('问答此仓库')).toBeInTheDocument();
    expect(screen.getByTitle('取消订阅发布')).toBeInTheDocument();
    expect(screen.getByTitle('编辑仓库信息')).toBeInTheDocument();

    const actionRow = screen.getByTestId('grid-action-row');
    expect(actionRow).toHaveClass('w-full', 'justify-start', 'overflow-hidden');

    const footer = screen.getByText(/最近提交/).closest('.border-t');
    expect(footer?.parentElement).toHaveClass('mt-4');
  });

  it('collapses trailing grid actions into a more-actions menu when the card is narrow', async () => {
    const user = userEvent.setup();
    renderRepositoryCard('grid', { onAskRepository: vi.fn() });
    const actionRow = screen.getByTestId('grid-action-row');
    Object.defineProperty(actionRow, 'clientWidth', { configurable: true, value: 190 });

    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });

    expect(screen.queryByTitle('在Zread中查看')).not.toBeInTheDocument();
    const moreActions = screen.getByRole('button', { name: '更多仓库操作' });
    await user.click(moreActions);

    expect(screen.getByRole('menuitem', { name: '在 Zread 中查看' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '在 GitHub 中查看' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '取消 Star' })).toBeInTheDocument();

    Object.defineProperty(actionRow, 'clientWidth', { configurable: true, value: 76 });
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.getByRole('menuitem', { name: '问答此仓库' })).toBeInTheDocument();
  });
});
