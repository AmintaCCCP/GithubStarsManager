import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SubscriptionRepoCard } from './SubscriptionRepoCard';
import { TooltipProvider } from './ui/tooltip';
import type { DiscoveryRepo } from '../types';

const mockedUseAppStore = vi.fn();

vi.mock('../store/useAppStore', () => ({
  useAppStore: (selector: (s: unknown) => unknown) => mockedUseAppStore(selector),
}));

vi.mock('../features/discovery/hooks/useDiscoveryRepoActions', () => ({
  useDiscoveryRepoActions: () => ({
    analyze: vi.fn(),
    star: vi.fn(),
    executeUnstar: vi.fn(),
    isAnalyzing: false,
    isStarring: false,
    isStarred: false,
  }),
}));

vi.mock('./ReadmeModal', () => ({
  ReadmeModal: () => null,
}));

const makeTrendingRepo = (overrides: Partial<DiscoveryRepo> = {}): DiscoveryRepo => ({
  id: 2001,
  name: 'repo-a',
  full_name: 'owner/repo-a',
  description: null,
  html_url: 'https://github.com/owner/repo-a',
  stargazers_count: 10,
  forks_count: 2,
  forks: 2,
  language: 'TypeScript',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  pushed_at: '2026-01-02T00:00:00Z',
  owner: { login: 'owner', avatar_url: 'https://github.com/owner.png' },
  topics: [],
  rank: 1,
  channel: 'trending',
  platform: 'All',
  ...overrides,
});

describe('SubscriptionRepoCard description placeholder', () => {
  beforeEach(() => {
    mockedUseAppStore.mockImplementation((selector: (s: unknown) => unknown) =>
      selector({ language: 'zh', githubToken: 'token' }));
  });

  it('shows the localized no-description placeholder when the repo has no description', () => {
    render(<TooltipProvider><SubscriptionRepoCard repo={makeTrendingRepo()} /></TooltipProvider>);
    expect(screen.getByText('暂无描述')).toBeInTheDocument();
  });

  it('renders the description instead of the placeholder when present', () => {
    render(<TooltipProvider><SubscriptionRepoCard repo={makeTrendingRepo({ description: 'a nice tool' })} /></TooltipProvider>);
    expect(screen.getByText('a nice tool')).toBeInTheDocument();
    expect(screen.queryByText('暂无描述')).not.toBeInTheDocument();
  });
});
