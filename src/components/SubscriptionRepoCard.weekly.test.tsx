import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

const mockedUseWeeklyIssueBody = vi.fn();

vi.mock('../features/discovery/hooks/useWeeklyIssueBody', () => ({
  useWeeklyIssueBody: (issueNumber: number, enabled: boolean) => mockedUseWeeklyIssueBody()(issueNumber, enabled),
}));

vi.mock('./ReadmeModal', () => ({
  ReadmeModal: () => null,
}));

const makeWeeklyRepo = (): DiscoveryRepo => ({
  id: 1001,
  name: 'bar',
  full_name: 'foo/bar',
  description: 'a nice tool',
  html_url: 'https://github.com/foo/bar',
  stargazers_count: 1234,
  forks_count: 12,
  forks: 12,
  language: 'TypeScript',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  pushed_at: '2026-01-02T00:00:00Z',
  owner: { login: 'foo', avatar_url: 'https://github.com/foo.png' },
  topics: [],
  rank: 1,
  channel: 'weekly',
  platform: 'All',
  weeklyIssue: {
    number: 42,
    title: '【开源自荐】bar',
    html_url: 'https://github.com/ruanyf/weekly/issues/42',
    labels: ['weekly', 'issue-300'],
    createdAt: '2026-02-03T00:00:00Z',
  },
});

describe('SubscriptionRepoCard weekly channel', () => {
  beforeEach(() => {
    mockedUseAppStore.mockImplementation((selector: (s: unknown) => unknown) =>
      selector({ language: 'zh', githubToken: 'token' }));
    mockedUseWeeklyIssueBody.mockReturnValue(() => ({
      issueData: { body: '项目地址：**https://github.com/foo/bar**' },
      loading: false,
      error: null,
    }));
  });

  it('renders weekly badges and the view-original-post button', () => {
    render(<TooltipProvider><SubscriptionRepoCard repo={makeWeeklyRepo()} /></TooltipProvider>);
    expect(screen.getByTitle('查看原贴')).toBeInTheDocument();
    expect(screen.getByText('周刊收录')).toBeInTheDocument();
    expect(screen.getByText('第 300 期')).toBeInTheDocument();
  });

  it('does not render weekly badges without a weekly issue', () => {
    const repo = makeWeeklyRepo();
    delete repo.weeklyIssue;
    render(<TooltipProvider><SubscriptionRepoCard repo={repo} /></TooltipProvider>);
    expect(screen.queryByTitle('查看原贴')).not.toBeInTheDocument();
    expect(screen.queryByText('周刊收录')).not.toBeInTheDocument();
  });

  it('opens the original-post modal with the cached issue body', () => {
    render(<TooltipProvider><SubscriptionRepoCard repo={makeWeeklyRepo()} /></TooltipProvider>);
    fireEvent.click(screen.getByTitle('查看原贴'));
    expect(screen.getByText('【开源自荐】bar')).toBeInTheDocument();
    expect(screen.getByText('在 GitHub 打开')).toBeInTheDocument();
  });
});
