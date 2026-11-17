import { describe, expect, it } from 'vitest';
import {
  applyAccountWorkspaceForTypes,
  buildFullWorkspaces,
  maskSavedAccountsForBackup,
  mergeWorkspacesById,
  trimWorkspacesForSelectedTypes,
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

  it('unions read/subscription sets so restored entries keep their read and watch state', () => {
    const local = {
      ...workspaceOf([repo(1, 'local')]),
      readForks: [10],
      releaseSubscriptions: [100],
      readReleases: [1000],
    };
    const incoming = {
      ...workspaceOf([repo(2, 'incoming')]),
      readForks: [10, 20],
      releaseSubscriptions: [100, 200],
      readReleases: [1000, 2000],
    };

    const merged = mergeWorkspacesById(local, incoming);
    // 并集合并：本机条目保留，备份条目恢复
    expect(merged.readForks).toEqual([10, 20]);
    expect(merged.releaseSubscriptions).toEqual([100, 200]);
    expect(merged.readReleases).toEqual([1000, 2000]);
    // 其他字段行为不变：本地值优先
    expect(merged.lastSync).toBe('2026-02-01T00:00:00.000Z');
    expect(merged.syncMode).toBe('stars');
  });

  it('trims workspace fields to the selected export types (privacy boundary)', () => {
    const full = workspaceOf([repo(1, 'private-summary')]);
    const workspaces = { '1': full, '2': { ...workspaceOf([repo(2, 'other-account')]) } };

    // 只选 customCategories：其他账号的仓库/Release/Gist/Fork 绝不导出
    const trimmed = trimWorkspacesForSelectedTypes(workspaces, ['customCategories']);
    expect(trimmed['1'].customCategories).toEqual(full.customCategories);
    expect(trimmed['1'].categoryOrder).toEqual(full.categoryOrder);
    expect(trimmed['1'].repositories).toEqual([]);
    expect(trimmed['1'].releases).toEqual([]);
    expect(trimmed['1'].gists).toEqual([]);
    expect(trimmed['1'].forks).toEqual([]);
    expect(trimmed['2'].repositories).toEqual([]);

    // 选 repositories + releases：对应字段保留，分类字段不导出
    const repoTrimmed = trimWorkspacesForSelectedTypes(workspaces, ['repositories', 'releases']);
    expect(repoTrimmed['1'].repositories).toEqual(full.repositories);
    expect(repoTrimmed['1'].releases).toEqual(full.releases);
    expect(repoTrimmed['1'].syncMode).toBe(full.syncMode);
    expect(repoTrimmed['1'].customCategories).toEqual([]);
    expect(repoTrimmed['1'].categoryListIdMap).toEqual({});
  });

  it('applies only workspace fields for the selected import types', () => {
    const workspace: AccountWorkspace = {
      ...workspaceOf([repo(1, 'restored')]),
      lastSync: '2026-03-01T00:00:00.000Z',
      releases: [],
      releaseSubscriptions: [42],
      readReleases: [43],
      customCategories: [],
      categoryOrder: ['cat-1'],
      syncMode: 'stars-and-lists',
      syncModeConfigured: true,
    };

    // 只选 customCategories：仓库相关字段不出现在补丁中
    const categoriesOnly = applyAccountWorkspaceForTypes(workspace, ['customCategories']);
    expect(categoriesOnly.customCategories).toEqual(workspace.customCategories);
    expect(categoriesOnly.categoryOrder).toEqual(['cat-1']);
    expect(categoriesOnly.repositories).toBeUndefined();
    expect(categoriesOnly.syncMode).toBeUndefined();

    // 选 repositories：syncMode/lastSync 等仅存于工作区的设置随仓库类型恢复
    const reposOnly = applyAccountWorkspaceForTypes(workspace, ['repositories']);
    expect(reposOnly.repositories).toEqual(workspace.repositories);
    expect(reposOnly.syncMode).toBe('stars-and-lists');
    expect(reposOnly.syncModeConfigured).toBe(true);
    expect(reposOnly.lastSync).toBe('2026-03-01T00:00:00.000Z');
    expect(reposOnly.releaseSubscriptions).toBeUndefined();

    // 全类型选择：等价于完整应用
    const all = applyAccountWorkspaceForTypes(
      workspace,
      ['repositories', 'releases', 'releaseSubscriptions', 'customCategories'],
    );
    expect(all.releaseSubscriptions).toEqual(new Set([42]));
    expect(all.readReleases).toEqual(new Set([43]));
    expect(all.categoryListIdMap).toEqual(workspace.categoryListIdMap);
  });
});
