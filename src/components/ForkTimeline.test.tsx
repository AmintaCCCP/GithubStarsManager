import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForkTimeline } from './ForkTimeline';
import { useAppStore } from '../store/useAppStore';
import { GitHubApiService } from '../services/githubApi';
import type { ForkRepo } from '../types';

vi.mock('../store/useAppStore', () => ({
  useAppStore: vi.fn(),
}));

vi.mock('../services/githubApi', () => ({
  GitHubApiService: vi.fn(),
}));

const toastMock = vi.fn();
const confirmMock = vi.fn();

vi.mock('../hooks/useDialog', () => ({
  useDialog: () => ({
    toast: toastMock,
    confirm: confirmMock,
  }),
}));

const createFork = (id: number, owner: string, name: string): ForkRepo => ({
  id,
  name,
  fork: true,
  full_name: `${owner}/${name}`,
  description: `${name} description`,
  html_url: `https://github.com/${owner}/${name}`,
  stargazers_count: 1,
  forks_count: 1,
  forks: 1,
  language: 'TypeScript',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
  pushed_at: '2026-01-03T00:00:00.000Z',
  default_branch: 'main',
  owner: {
    login: owner,
    avatar_url: `https://github.com/${owner}.png`,
  },
  source: {
    id: id + 1000,
    full_name: `upstream/${name}`,
    name,
    description: `${name} upstream`,
    html_url: `https://github.com/upstream/${name}`,
    stargazers_count: 10,
    forks_count: 2,
    updated_at: '2026-01-04T00:00:00.000Z',
    owner: {
      login: 'upstream',
      avatar_url: 'https://github.com/upstream.png',
    },
  },
});

const personalFork = createFork(1, 'tamina', 'personal-fork');
const orgFork = createFork(2, 'team-org', 'org-fork');

const mockUseAppStore = vi.mocked(useAppStore);
const MockGitHubApiService = vi.mocked(GitHubApiService);

let storeState: ReturnType<typeof createStoreState>;

const createStoreState = (overrides: Partial<ReturnType<typeof baseStoreState>> = {}) => ({
  ...baseStoreState(),
  ...overrides,
});

const baseStoreState = () => ({
  user: {
    id: 1,
    login: 'tamina',
    name: 'Tamina',
    avatar_url: 'https://github.com/tamina.png',
    email: null,
  },
  forks: [personalFork, orgFork],
  readForks: new Set<number>(),
  githubToken: 'token',
  language: 'zh' as const,
  setForks: vi.fn(),
  markForkAsRead: vi.fn(),
  forkSearchQuery: '',
  forkIsRefreshing: false,
  setForkSearchQuery: vi.fn(),
  setForkIsRefreshing: vi.fn(),
});

describe('ForkTimeline owner filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState = createStoreState();
    mockUseAppStore.mockImplementation(() => storeState as ReturnType<typeof useAppStore>);
    Object.assign(mockUseAppStore, {
      getState: vi.fn(() => storeState),
      setState: vi.fn((updater: unknown) => {
        if (typeof updater === 'function') {
          Object.assign(storeState, (updater as (state: typeof storeState) => Partial<typeof storeState>)(storeState));
        } else if (updater && typeof updater === 'object') {
          Object.assign(storeState, updater);
        }
      }),
    });
    storeState.setForks = vi.fn((forks: ForkRepo[]) => {
      storeState.forks = forks;
    });
    storeState.setForkIsRefreshing = vi.fn((refreshing: boolean) => {
      storeState.forkIsRefreshing = refreshing;
    });
    MockGitHubApiService.mockImplementation(() => ({
      getUserOrganizations: vi.fn().mockResolvedValue([
        {
          id: 10,
          login: 'team-org',
          avatar_url: 'https://github.com/team-org.png',
          description: null,
          html_url: 'https://github.com/team-org',
        },
      ]),
      getUserForks: vi.fn().mockResolvedValue([personalFork, orgFork]),
      getOrganizationForks: vi.fn().mockResolvedValue([orgFork]),
      checkForkSyncNeeded: vi.fn().mockResolvedValue({ needsSync: false }),
      getRepositoryWorkflows: vi.fn().mockResolvedValue([]),
      getBranches: vi.fn().mockResolvedValue(['main']),
      syncFork: vi.fn().mockResolvedValue({ hasUpdates: false, sourceUpdatedAt: null, mergeType: 'none' }),
      triggerWorkflowRun: vi.fn().mockResolvedValue(undefined),
    } as unknown as GitHubApiService));
  });

  it('shows only personal-account forks by default', () => {
    render(<ForkTimeline />);

    expect(screen.getByText('personal-fork')).toBeInTheDocument();
    expect(screen.queryByText('org-fork')).not.toBeInTheDocument();
  });

  it('switches to organization-owned forks without mixing personal forks', async () => {
    render(<ForkTimeline />);

    const ownerSelector = await screen.findByLabelText('选择 Fork 拥有者');
    fireEvent.change(ownerSelector, { target: { value: 'team-org' } });

    expect(await screen.findByText('org-fork')).toBeInTheDocument();
    expect(screen.queryByText('personal-fork')).not.toBeInTheDocument();
  });

  it('filters personal refresh results to the personal owner before caching', async () => {
    storeState.forks = [];

    render(<ForkTimeline />);

    fireEvent.click(screen.getByRole('button', { name: '刷新' }));

    await waitFor(() => {
      expect(storeState.forks).toHaveLength(1);
    });
    expect(storeState.forks[0]).toMatchObject({
      id: personalFork.id,
      full_name: personalFork.full_name,
      owner: { login: 'tamina' },
    });
  });

  it('warns when organization owners cannot be loaded', async () => {
    MockGitHubApiService.mockImplementation(() => ({
      getUserOrganizations: vi.fn().mockRejectedValue(new Error('missing scope')),
    } as unknown as GitHubApiService));

    render(<ForkTimeline />);

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith('组织列表加载失败，请检查 GitHub token 权限。', 'warning');
    });
  });
});
