import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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
  it('moves single-card actions into an accessible more-actions menu in list mode', () => {
    render(<RepositoryCard repository={repository} allCategories={[]} viewMode="list" />);

    const lastPushed = screen.getByText(/最近提交/);
    expect(lastPushed).toBeInTheDocument();
    expect(lastPushed).not.toHaveClass('group-hover:opacity-0');
    expect(screen.getByRole('button', { name: '更多操作' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '编辑仓库信息' })).toBeInTheDocument();
    expect(screen.getByText('test')).toBeInTheDocument();
    expect(screen.getByText('TypeScript')).toBeInTheDocument();
    expect(screen.queryByTitle('AI分析此仓库')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));

    expect(screen.getByText('仓库操作')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AI 分析' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查找同类仓库' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消 Star' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '在 GitHub 中查看' })).toHaveAttribute('href', repository.html_url);
  });

  it('only exposes similar-repository search in the menu when vector search is available', () => {
    storeState.vectorSearchConfig.enabled = false;
    render(<RepositoryCard repository={repository} allCategories={[]} viewMode="list" />);

    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    expect(screen.queryByRole('button', { name: '查找同类仓库' })).not.toBeInTheDocument();
    expect(screen.queryByText('查找同类')).not.toBeInTheDocument();
  });

  it('does not let the card keyboard handler intercept list menu or direct edit activation', async () => {
    const user = userEvent.setup();
    render(<RepositoryCard repository={repository} allCategories={[]} viewMode="list" />);

    const moreActions = screen.getByRole('button', { name: '更多操作' });
    moreActions.focus();
    await user.keyboard('{Enter}');
    expect(screen.queryByTestId('readme-modal')).not.toBeInTheDocument();

    const releaseAction = screen.getByRole('button', { name: '取消订阅 Release' });
    releaseAction.focus();
    await user.keyboard('{Enter}');
    expect(storeState.toggleReleaseSubscription).toHaveBeenCalledWith(repository.id);
    expect(screen.queryByTestId('readme-modal')).not.toBeInTheDocument();

    const editAction = screen.getByRole('button', { name: '编辑仓库信息' });
    editAction.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('repository-edit-modal')).toBeInTheDocument();
  });

  it('retains the existing quick action row in grid mode', () => {
    render(<RepositoryCard repository={repository} allCategories={[]} viewMode="grid" />);

    expect(screen.queryByRole('button', { name: '更多操作' })).not.toBeInTheDocument();
    expect(screen.getByTitle('AI分析此仓库')).toBeInTheDocument();
    expect(screen.getByTitle('取消订阅发布')).toBeInTheDocument();
    expect(screen.getByTitle('编辑仓库信息')).toBeInTheDocument();
  });
});
