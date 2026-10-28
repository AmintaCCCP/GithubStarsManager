import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  setUser: vi.fn(),
});

describe('ForkTimeline owner filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState = createStoreState();
    mockUseAppStore.mockImplementation(((selector?: (state: unknown) => unknown) => (selector ? selector(storeState) : storeState)) as unknown as typeof useAppStore);
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
    storeState.setUser = vi.fn((user: typeof storeState.user) => {
      storeState.user = user;
    });
    MockGitHubApiService.mockImplementation(function () { return {
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
      getCurrentUser: vi.fn().mockResolvedValue(storeState.user),
      checkForkSyncNeeded: vi.fn().mockResolvedValue({ needsSync: false }),
      getRepositoryWorkflows: vi.fn().mockResolvedValue([]),
      getBranches: vi.fn().mockResolvedValue(['main']),
      syncFork: vi.fn().mockResolvedValue({ hasUpdates: false, sourceUpdatedAt: null, mergeType: 'none' }),
      triggerWorkflowRun: vi.fn().mockResolvedValue(undefined),
    } as unknown as GitHubApiService; });
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

  it('keeps personal forks when the cached GitHub login is stale after a rename', async () => {
    const renamedFork = createFork(3, 'twdlight', 'zsh-autocomplete');
    storeState.user = {
      ...storeState.user,
      login: 'TowardLights',
      name: 'TowardLights',
    };
    storeState.forks = [];
    const getCurrentUser = vi.fn().mockResolvedValue({
      id: 1,
      login: 'twdlight',
      name: 'Twdlight',
      avatar_url: 'https://github.com/twdlight.png',
      email: null,
    });
    MockGitHubApiService.mockImplementation(function () { return {
      getUserOrganizations: vi.fn().mockResolvedValue([]),
      getUserForks: vi.fn().mockResolvedValue([renamedFork]),
      getOrganizationForks: vi.fn().mockResolvedValue([]),
      getCurrentUser,
      checkForkSyncNeeded: vi.fn().mockResolvedValue({ needsSync: false }),
    } as unknown as GitHubApiService; });

    const { rerender } = render(<ForkTimeline />);
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));

    await waitFor(() => {
      expect(storeState.forks).toHaveLength(1);
    });
    expect(storeState.forks[0]).toMatchObject({
      full_name: 'twdlight/zsh-autocomplete',
      owner: { login: 'twdlight' },
    });
    await waitFor(() => {
      expect(getCurrentUser).toHaveBeenCalledOnce();
      expect(storeState.setUser).toHaveBeenCalledWith(expect.objectContaining({ login: 'twdlight' }));
    });
    rerender(<ForkTimeline />);
    expect(await screen.findByText('zsh-autocomplete')).toBeInTheDocument();
  });

  it('matches personal forks case-insensitively without treating them as a rename', async () => {
    const casedFork = createFork(1, 'Tamina', 'personal-fork');
    storeState.forks = [];
    const getCurrentUser = vi.fn();
    MockGitHubApiService.mockImplementation(function () { return {
      getUserOrganizations: vi.fn().mockResolvedValue([]),
      getUserForks: vi.fn().mockResolvedValue([casedFork, orgFork]),
      getOrganizationForks: vi.fn().mockResolvedValue([]),
      getCurrentUser,
      checkForkSyncNeeded: vi.fn().mockResolvedValue({ needsSync: false }),
    } as unknown as GitHubApiService; });

    render(<ForkTimeline />);
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));

    await waitFor(() => {
      expect(storeState.forks).toHaveLength(1);
    });
    expect(storeState.forks[0].owner.login).toBe('Tamina');
    expect(getCurrentUser).not.toHaveBeenCalled();
    expect(storeState.setUser).not.toHaveBeenCalled();
  });

  it('warns when organization owners cannot be loaded', async () => {
    MockGitHubApiService.mockImplementation(function () { return {
      getUserOrganizations: vi.fn().mockRejectedValue(new Error('missing scope')),
    } as unknown as GitHubApiService; });

    render(<ForkTimeline />);

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith('组织列表加载失败，请检查 GitHub token 权限。', 'error');
    });
  });

  it('keeps route-scoped owner control and refresh control in their correct regions', async () => {
    render(<ForkTimeline />);

    await screen.findByRole('combobox', { name: '拥有者:' });

    const sidebar = screen.getByRole('complementary', { name: '复刻' });
    expect(sidebar.querySelectorAll('[role="combobox"]')).toHaveLength(0);
    expect(within(sidebar).getByRole('button', { name: '全部复刻1' })).toBeInTheDocument();
    expect(within(sidebar).getByRole('button', { name: '有更新0' })).toBeInTheDocument();
    expect(within(sidebar).getByRole('button', { name: '已同步0' })).toBeInTheDocument();
    expect(within(sidebar).getByRole('button', { name: '待检查1' })).toBeInTheDocument();
    expect(screen.getAllByRole('combobox', { name: '拥有者:' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '刷新' })).toHaveLength(1);
    expect(screen.queryAllByText('仓库分类')).toHaveLength(0);
  });

  it('shows the last refresh time in the sidebar after a refresh completes', async () => {
    render(<ForkTimeline />);

    await screen.findByRole('combobox', { name: '拥有者:' });

    expect(screen.queryByText(/上次刷新:/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '刷新' }));

    await waitFor(() => {
      expect(storeState.forks).toHaveLength(2);
    });
    expect(await screen.findByText(/上次刷新:/)).toBeInTheDocument();
  });

  it('keeps a fork unchecked when the sync-status request fails', async () => {
    storeState.forks = [personalFork];
    let rejectCheck: (error: Error) => void = () => undefined;
    const checkForkSyncNeeded = vi.fn().mockReturnValue(new Promise((_, reject) => {
      rejectCheck = reject;
    }));
    MockGitHubApiService.mockImplementation(function () { return {
      getUserOrganizations: vi.fn().mockResolvedValue([]),
      getUserForks: vi.fn().mockResolvedValue([personalFork]),
      getOrganizationForks: vi.fn().mockResolvedValue([]),
      getCurrentUser: vi.fn().mockResolvedValue(storeState.user),
      checkForkSyncNeeded,
    } as unknown as GitHubApiService; });

    render(<ForkTimeline />);
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    await waitFor(() => expect(checkForkSyncNeeded).toHaveBeenCalledOnce());

    rejectCheck(new Error('rate limited'));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith('刷新完成！', 'info');
    });
    const sidebar = screen.getByRole('complementary', { name: '复刻' });
    expect(within(sidebar).getByRole('button', { name: '待检查1' })).toBeInTheDocument();
    expect(within(sidebar).getByRole('button', { name: '已同步0' })).toBeInTheDocument();
  });

  it('keeps upstream repositories out of the fork sidebar', async () => {
    storeState.forks = Array.from({ length: 8 }, (_, index) =>
      createFork(index + 1, 'tamina', `fork-${index + 1}`),
    );

    render(<ForkTimeline />);

    const sidebar = screen.getByRole('complementary', { name: '复刻' });
    expect(within(sidebar).queryByText('上游仓库')).not.toBeInTheDocument();
    expect(within(sidebar).queryByText('upstream/fork-6')).not.toBeInTheDocument();
    expect(within(sidebar).queryByRole('button', { name: '显示全部 8 个' })).not.toBeInTheDocument();
  });

  it('uses the filtered empty state and clears sync filters', async () => {
    storeState.forks = [personalFork];

    render(<ForkTimeline />);

    fireEvent.click(screen.getByRole('button', { name: '有更新0' }));

    expect(await screen.findByRole('heading', { name: '无符合条件的结果' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(await screen.findByText('personal-fork')).toBeInTheDocument();
  });

  it('keeps the forks sidebar mounted when no forks are cached', async () => {
    storeState.forks = [];

    render(<ForkTimeline />);

    await screen.findByRole('combobox', { name: '拥有者:' });

    expect(document.querySelectorAll('[data-context-sidebar="forks"]')).toHaveLength(1);
    const sidebar = screen.getByRole('complementary', { name: '复刻' });
    expect(within(sidebar).queryByText('上游仓库')).not.toBeInTheDocument();
    expect(await screen.findByText('没有Fork仓库')).toBeInTheDocument();
    expect(screen.queryAllByText('仓库分类')).toHaveLength(0);
  });
});


describe('ForkTimeline async session and sync contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState = createStoreState();
    mockUseAppStore.mockImplementation(((selector?: (state: unknown) => unknown) => (selector ? selector(storeState) : storeState)) as unknown as typeof useAppStore);
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
    MockGitHubApiService.mockImplementation(function () { return {
      getUserOrganizations: vi.fn().mockResolvedValue([]),
      getUserForks: vi.fn().mockResolvedValue([personalFork]),
      getOrganizationForks: vi.fn().mockResolvedValue([]),
      getCurrentUser: vi.fn().mockResolvedValue(storeState.user),
      checkForkSyncNeeded: vi.fn().mockResolvedValue({ needsSync: false }),
      getRepositoryWorkflows: vi.fn().mockResolvedValue([]),
      getBranches: vi.fn().mockResolvedValue(['main']),
      syncFork: vi.fn().mockResolvedValue({ hasUpdates: true, sourceUpdatedAt: '2026-02-01T00:00:00.000Z', mergeType: 'fast-forward' }),
      triggerWorkflowRun: vi.fn().mockResolvedValue(undefined),
    } as unknown as GitHubApiService; });
  });

  it('does not write an old refresh response after logout and same-credential login', async () => {
    storeState.forks = [];
    let resolveForks: (forks: ForkRepo[]) => void = () => undefined;
    const pendingForks = new Promise<ForkRepo[]>(resolve => {
      resolveForks = resolve;
    });
    const getUserForks = vi.fn().mockReturnValue(pendingForks);
    MockGitHubApiService.mockImplementation(function () { return {
      getUserOrganizations: vi.fn().mockResolvedValue([]),
      getUserForks,
      getOrganizationForks: vi.fn(),
    } as unknown as GitHubApiService; });

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
    const checkForkSyncNeeded = vi.fn().mockResolvedValue({ needsSync: true });
    MockGitHubApiService.mockImplementation(function () { return {
      getUserOrganizations: vi.fn().mockResolvedValue([]),
      getUserForks: vi.fn().mockResolvedValue([personalFork]),
      getCurrentUser: vi.fn().mockResolvedValue(storeState.user),
      checkForkSyncNeeded,
      getBranches: vi.fn().mockRejectedValue(new Error('network unavailable')),
    } as unknown as GitHubApiService; });

    render(<ForkTimeline />);
    fireEvent.click(await screen.findByRole('button', { name: '刷新' }));
    fireEvent.click(await screen.findByRole('button', { name: '更新分支' }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith('加载分支失败，请检查网络连接后重试。', 'error');
    });
    expect(screen.queryByText('同步上游代码 (Sync upstream)')).not.toBeInTheDocument();
  });

  it('persists synced upstream time and read state to avoid re-reporting the same update', async () => {
    const checkForkSyncNeeded = vi.fn().mockResolvedValue({ needsSync: true });
    MockGitHubApiService.mockImplementation(function () { return {
      getUserOrganizations: vi.fn().mockResolvedValue([]),
      getUserForks: vi.fn().mockResolvedValue([personalFork]),
      getCurrentUser: vi.fn().mockResolvedValue(storeState.user),
      checkForkSyncNeeded,
      getBranches: vi.fn().mockResolvedValue(['main']),
      syncFork: vi.fn().mockResolvedValue({ hasUpdates: true, sourceUpdatedAt: '2026-02-01T00:00:00.000Z', mergeType: 'fast-forward' }),
    } as unknown as GitHubApiService; });

    render(<ForkTimeline />);
    fireEvent.click(await screen.findByRole('button', { name: '刷新' }));
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


describe('ForkTimeline branch request ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState = createStoreState();
    mockUseAppStore.mockImplementation(((selector?: (state: unknown) => unknown) => (selector ? selector(storeState) : storeState)) as unknown as typeof useAppStore);
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
    MockGitHubApiService.mockImplementation(function () { return {
      getUserOrganizations: vi.fn().mockResolvedValue([]),
      getUserForks: vi.fn().mockResolvedValue([personalFork]),
      getOrganizationForks: vi.fn().mockResolvedValue([orgFork]),
      getCurrentUser: vi.fn().mockResolvedValue(storeState.user),
      checkForkSyncNeeded: vi.fn().mockResolvedValue({ needsSync: false }),
    } as unknown as GitHubApiService; });
  });

  it('ignores an earlier branch-load failure after a later fork request owns the modal', async () => {
    storeState.forks = [personalFork, orgFork];
    let rejectFirstRequest: (error: Error) => void = () => undefined;
    const firstRequest = new Promise<string[]>((_, reject) => {
      rejectFirstRequest = reject;
    });
    const secondRequest = new Promise<string[]>(() => undefined);
    const getBranches = vi.fn()
      .mockReturnValueOnce(firstRequest)
      .mockReturnValueOnce(secondRequest);
    const checkForkSyncNeeded = vi.fn().mockResolvedValue({ needsSync: true });
    MockGitHubApiService.mockImplementation(function () { return {
      getUserOrganizations: vi.fn().mockResolvedValue([]),
      getUserForks: vi.fn().mockResolvedValue([personalFork]),
      getOrganizationForks: vi.fn().mockResolvedValue([orgFork]),
      getCurrentUser: vi.fn().mockResolvedValue(storeState.user),
      checkForkSyncNeeded,
      getBranches,
    } as unknown as GitHubApiService; });

    render(<ForkTimeline />);
    fireEvent.click(await screen.findByRole('button', { name: '刷新' }));
    fireEvent.click(await screen.findByRole('button', { name: '更新分支' }));

    fireEvent.click(screen.getByText('tamina（个人）'));
    fireEvent.click(await screen.findByRole('option', { name: 'team-org' }));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    const sidebar = screen.getByRole('complementary', { name: '复刻' });
    await screen.findByText(/team-org\/org-fork/);
    const refreshButton = within(sidebar).getByRole('button', { name: '刷新' });
    expect(refreshButton).not.toBeNull();
    fireEvent.click(refreshButton);
    await waitFor(() => {
      expect(checkForkSyncNeeded).toHaveBeenCalledWith('team-org', 'org-fork', 'main', 'upstream/org-fork');
    });
    fireEvent.click(await screen.findByRole('button', { name: '更新分支' }));

    rejectFirstRequest(new Error('stale branch request'));

    await waitFor(() => {
      expect(screen.getAllByText(/team-org\/org-fork/).length).toBeGreaterThan(0);
      expect(screen.getByText('加载分支列表中…')).toBeInTheDocument();
    });
    expect(toastMock).not.toHaveBeenCalledWith('加载分支失败，请检查网络连接后重试。', 'error');
  });
});
