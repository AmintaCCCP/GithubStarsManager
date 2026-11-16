import { describe, expect, it } from 'vitest';
import {
  buildFullWorkspaces,
  maskSavedAccountsForBackup,
  mergeWorkspacesById,
} from './backupWorkspace';
import type { AccountWorkspace, GitHubUser, Repository, SavedAccount } from '../types';

const userA: GitHubUser = { id: 1, login: 'alice', name: 'Alice', avatar_url: 'https://x/a.png', email: null };
const userB: GitHubUser = { id: 2, login: 'bob', name: 'Bob', avatar_url: 'https://x/b.png', email: null };

const repo = (id: number, summary?: string): Repository => ({
  id,
  name: `repo-${id}`,
  full_name: `owner/repo-${id}`,
  description: null,
  html_url: `https://github.com/owner/repo-${id}`,
  stargazers_count: 1,
  forks_count: 0,
  forks: 0,
  language: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  pushed_at: '2026-01-01T00:00:00.000Z',
  owner: { login: 'owner', avatar_url: '' },
  topics: [],
  ...(summary ? { ai_summary: summary } : {}),
});

const workspaceOf = (repos: Repository[]): AccountWorkspace => ({
  repositories: repos,
  lastSync: '2026-02-01T00:00:00.000Z',
  gists: [],
  starredGists: [],
  selectedGistCategory: 'all',
  releases: [],
  releaseSubscriptions: [],
  releaseSourceSettings: {
    customRepos: [],
    enabledSourceIds: [],
  } as unknown as AccountWorkspace['releaseSourceSettings'],
  readReleases: [],
  forks: [],
  readForks: [],
  customCategories: [],
  hiddenDefaultCategoryIds: [],
  categoryOrder: [],
  defaultCategoryOverrides: {},
  categoryListIdMap: {},
  syncMode: 'stars',
  syncModeConfigured: false,
});

const savedAccount = (id: string, user: GitHubUser, token: string): SavedAccount => ({
  accountId: id,
  user,
  githubToken: token,
  addedAt: '2026-01-01T00:00:00.000Z',
  lastUsedAt: '2026-01-01T00:00:00.000Z',
});

const liveState = {
  user: userA,
  accountWorkspaces: {
    '2': workspaceOf([repo(2, 'bob-ai')]),
  },
  repositories: [repo(1, 'alice-ai')],
  lastSync: null,
  gists: [],
  starredGists: [],
  selectedGistCategory: 'all' as const,
  releases: [],
  releaseSubscriptions: new Set<number>(),
  releaseSourceSettings: workspaceOf([]).releaseSourceSettings,
  readReleases: new Set<number>(),
  forks: [],
  readForks: new Set<number>(),
  customCategories: [],
  hiddenDefaultCategoryIds: [],
  categoryOrder: [],
  defaultCategoryOverrides: {},
  categoryListIdMap: {},
  syncMode: 'stars' as const,
  syncModeConfigured: false,
};

describe('multi-account backup helpers (Issue #611)', () => {
  it('merges the live workspace of the signed-in account into the full workspace map', () => {
    const full = buildFullWorkspaces(liveState);
    // 当前账号实时状态在导出时刻合成，未被旧快照覆盖
    expect(full['1'].repositories[0].ai_summary).toBe('alice-ai');
    // 其他账号快照保留
    expect(full['2'].repositories[0].ai_summary).toBe('bob-ai');
  });

  it('masks saved account tokens unless keys are included', () => {
    const savedAccounts = {
      '1': savedAccount('1', userA, 'ghp_a'),
      '2': savedAccount('2', userB, ''),
    };
    const masked = maskSavedAccountsForBackup(savedAccounts, false);
    expect(masked['1'].githubToken).toBe('***');
    expect(masked['2'].githubToken).toBe('');

    const plain = maskSavedAccountsForBackup(savedAccounts, true);
    expect(plain['1'].githubToken).toBe('ghp_a');
    expect(plain['2'].githubToken).toBe('');
  });

  it('merges incoming workspace lists by id and keeps local entries untouched', () => {
    const local = workspaceOf([repo(1, 'local-summary'), repo(9, 'local-only')]);
    const incoming = workspaceOf([repo(1, 'incoming-duplicate'), repo(3, 'incoming-new')]);

    const merged = mergeWorkspacesById(local, incoming);
    const summaries = merged.repositories.map((r: Repository) => r.ai_summary);
    // 本地条目保留（不覆盖），仅追加本地没有的新条目
    expect(summaries).toEqual(['local-summary', 'local-only', 'incoming-new']);
  });
});
