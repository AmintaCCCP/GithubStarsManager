import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from './ui/tooltip';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../types';

const mocks = vi.hoisted(() => ({
  useAppStore: vi.fn(),
  consoleError: vi.fn(),
  repositoryCardActions: {
    analyze: vi.fn(),
    findSimilar: vi.fn(),
    unstar: vi.fn(),
    toggleReleaseSubscription: vi.fn(),
    isSubscribed: false,
    isAnalyzing: false,
    isFindingSimilar: false,
    isUnstarring: false,
    vectorSearchAvailable: false,
  },
}));

vi.mock('../store/useAppStore', () => ({
  useAppStore: mocks.useAppStore,
}));

vi.mock('../features/repositories/hooks/useRepositoryCardActions', () => ({
  useRepositoryCardActions: () => mocks.repositoryCardActions,
}));

vi.mock('./RepositoryEditModal', () => ({
  RepositoryEditModal: () => null,
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
  ai_platforms: ['web'],
};

type ReadmeModalMockProps = {
  onClose: () => void;
  onCloseAutoFocus?: () => void;
};

const storeState = {
  releaseSubscriptions: new Set<number>(),
  analyzingRepositoryIds: new Set<number>(),
  toggleReleaseSubscription: vi.fn(),
  githubToken: null,
  activeAIConfig: null,
  setAnalyzingRepository: vi.fn(),
  language: 'en' as const,
  updateRepository: vi.fn(),
  deleteRepository: vi.fn(),
  vectorSearchConfig: {
    enabled: false,
    workerUrl: '',
    authToken: '',
    embeddingConfigId: '',
    indexMode: 'readme' as const,
    readmeMaxChars: 6000,
  },
  vectorSearchStatus: null,
  embeddingConfigs: [],
  activeEmbeddingConfig: '',
  repositories: [repository],
  enterSimilarView: vi.fn(),
  aiConfigs: [],
};

describe('RepositoryCard README lazy boundary', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(mocks.consoleError);
    mocks.useAppStore.mockImplementation((selector?: (state: typeof storeState) => unknown) => (
      selector ? selector(storeState) : storeState
    ));
  });

  it('restores focus to the keyboard trigger after the README modal closes', async () => {
    vi.doMock('./ReadmeModal', () => ({
      ReadmeModal: ({ onClose, onCloseAutoFocus }: ReadmeModalMockProps) => (
        <button
          type="button"
          onClick={() => {
            onClose();
            onCloseAutoFocus?.();
          }}
        >
          Close README
        </button>
      ),
    }));

    const { RepositoryCard } = await import('./RepositoryCard');
    const user = userEvent.setup();

    render(
      <TooltipProvider>
        <RepositoryCard repository={repository} allCategories={[]} />
      </TooltipProvider>,
    );

    const trigger = screen.getByRole('button', { name: /owner\/example-repository/i });
    trigger.focus();
    await user.keyboard('{Enter}');

    await user.click(await screen.findByRole('button', { name: 'Close README' }));

    expect(trigger).toHaveFocus();
  });

  it('renders the existing error boundary when the README lazy chunk cannot load', async () => {
    vi.doMock('./ReadmeModal', () => {
      throw new Error('README lazy chunk failed');
    });

    const { RepositoryCard } = await import('./RepositoryCard');
    const user = userEvent.setup();

    render(
      <TooltipProvider>
        <RepositoryCard repository={repository} allCategories={[]} />
      </TooltipProvider>,
    );

    await user.click(screen.getByRole('button', { name: /owner\/example-repository/i }));

    expect(await screen.findByRole('heading', { name: 'Application Error' })).toBeInTheDocument();
  });
});
