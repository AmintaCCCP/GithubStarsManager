import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  it('shows only personal-account forks by default', async () => {
    render(<ForkTimeline />);

    await screen.findByRole('combobox', { name: '拥有者:' });

    expect(screen.getByText('personal-fork')).toBeInTheDocument();
    expect(screen.queryByText('org-fork')).not.toBeInTheDocument();
  });

  it('switches to organization-owned forks without mixing personal forks', async () => {
    render(<ForkTimeline />);

    const user = userEvent.setup();
    const ownerSelector = await screen.findByRole('combobox', { name: '拥有者:' });
    await user.click(ownerSelector);
    await user.click(await screen.findByRole('option', { name: 'team-org' }));

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
      expect(toastMock).toHaveBeenCalledWith('组织列表加载失败，请检查 GitHub token 权限。', 'error');
    });
  });
});


describe('ForkTimeline async session and sync contracts', () => {
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
    storeState.setForkIsRefreshing = vi.fn((refreshing: boolean) => {
      storeState.forkIsRefreshing = refreshing;
    });
    MockGitHubApiService.mockImplementation(() => ({
      getUserOrganizations: vi.fn().mockResolvedValue([]),
      getUserForks: vi.fn().mockResolvedValue([personalFork]),
      getOrganizationForks: vi.fn().mockResolvedValue([]),
      checkForkSyncNeeded: vi.fn().mockResolvedValue({ needsSync: false }),
      getRepositoryWorkflows: vi.fn().mockResolvedValue([]),
      getBranches: vi.fn().mockResolvedValue(['main']),
      syncFork: vi.fn().mockResolvedValue({ hasUpdates: true, sourceUpdatedAt: '2026-02-01T00:00:00.000Z', mergeType: 'fast-forward' }),
      triggerWorkflowRun: vi.fn().mockResolvedValue(undefined),
    } as unknown as GitHubApiService));
  });

  it('does not write an old refresh response after logout and same-credential login', async () => {
    storeState.forks = [];
    let resolveForks: (forks: ForkRepo[]) => void = () => undefined;
    const pendingForks = new Promise<ForkRepo[]>(resolve => {
      resolveForks = resolve;
    });
    const getUserForks = vi.fn().mockReturnValue(pendingForks);
    MockGitHubApiService.mockImplementation(() => ({
      getUserOrganizations: vi.fn().mockResolvedValue([]),
      getUserForks,
      getOrganizationForks: vi.fn(),
    } as unknown as GitHubApiService));

    const { rerender } = render(<ForkTimeline />);
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    await waitFor(() => expect(getUserForks).toHaveBeenCalledOnce());

    const originalUser = storeState.user;
    storeState.githubToken = '';
    storeState.user = { ...originalUser, id: 0, login: 'signed-out' };
    rerender(<ForkTimeline />);
    storeState.githubToken = 'token';
    storeState.user = originalUser;
    rerender(<ForkTimeline />);
    resolveForks([personalFork]);

    await waitFor(() => expect(storeState.forks).toEqual([]));
    expect(storeState.setForkIsRefreshing).toHaveBeenLastCalledWith(false);
    expect(toastMock).not.toHaveBeenCalledWith('刷新完成！', expect.anything());
  });

  it('closes the upstream-sync modal and reports a localized error when branches cannot load', async () => {
    MockGitHubApiService.mockImplementation(() => ({
      getUserOrganizations: vi.fn().mockResolvedValue([]),
      getBranches: vi.fn().mockRejectedValue(new Error('network unavailable')),
    } as unknown as GitHubApiService));

    render(<ForkTimeline />);
    fireEvent.click(await screen.findByRole('button', { name: '更新分支' }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith('加载分支失败，请检查网络连接后重试。', 'error');
    });
    expect(screen.queryByText('同步上游代码 (Sync upstream)')).not.toBeInTheDocument();
  });

  it('persists synced upstream time and read state to avoid re-reporting the same update', async () => {
    render(<ForkTimeline />);
    fireEvent.click(await screen.findByRole('button', { name: '更新分支' }));
    await screen.findByText('同步上游代码 (Sync upstream)');
    fireEvent.click(screen.getByRole('button', { name: '确认同步' }));

    await waitFor(() => {
      expect(storeState.forks.find(fork => fork.id === personalFork.id)).toMatchObject({
        upstream_updated_at: '2026-02-01T00:00:00.000Z',
        has_unread: false,
      });
      expect(storeState.readForks.has(personalFork.id)).toBe(true);
    });
  });
});
