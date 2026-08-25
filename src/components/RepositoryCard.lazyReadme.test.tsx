import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from './ui/tooltip';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../types';

const mocks = vi.hoisted(() => ({
  useAppStore: vi.fn(),
  consoleError: vi.fn(),
}));

vi.mock('../store/useAppStore', () => ({
  useAppStore: mocks.useAppStore,
}));

vi.mock('../hooks/useDialog', () => ({
  useDialog: () => ({ toast: vi.fn(), confirm: vi.fn() }),
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
