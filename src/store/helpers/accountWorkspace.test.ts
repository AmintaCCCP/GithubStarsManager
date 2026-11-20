import { describe, expect, it } from 'vitest';
import { defaultReleaseSourceSettings } from '../../types';
import type { Repository } from '../../types';
import {
  accountIdKey,
  applyAccountWorkspace,
  captureAccountWorkspace,
  emptyAccountWorkspace,
  normalizeAccountWorkspaces,
  shouldPreserveExisting,
  switchAccountWorkspace,
  workspaceHasData,
  workspaceHasRetainableData,
  type AccountWorkspace,
  type AccountWorkspaceSource,
} from './accountWorkspace';

const repo = (id: number): Repository => ({
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
  updated_at: '2026-01-02T00:00:00.000Z',
  pushed_at: '2026-01-03T00:00:00.000Z',
  owner: { login: 'owner', avatar_url: '' },
  topics: [],
  ai_summary: `summary-${id}`,
});

const source = (overrides: Partial<AccountWorkspaceSource> = {}): AccountWorkspaceSource => ({
  repositories: [repo(1)],
  lastSync: '2026-09-16T00:00:00.000Z',
  gists: [],
  starredGists: [],
  selectedGistCategory: 'all',
  releases: [],
  releaseSubscriptions: new Set([1]),
  releaseSourceSettings: defaultReleaseSourceSettings,
  readReleases: new Set([2]),
  forks: [],
  readForks: new Set(),
  customCategories: [{ id: 'custom-1', name: 'Keep', icon: '', isCustom: true, keywords: [] }],
  hiddenDefaultCategoryIds: [],
  categoryOrder: ['custom-1'],
  defaultCategoryOverrides: {},
  categoryListIdMap: { 'custom-1': 'L1' },
  syncMode: 'stars-and-lists',
  syncModeConfigured: true,
  ...overrides,
});

describe('account workspace identity', () => {
  it('keys accounts by GitHub user id, not token', () => {
    expect(accountIdKey({ id: 42 })).toBe('42');
    expect(accountIdKey(42)).toBe('42');
    expect(accountIdKey(null)).toBeNull();
  });

  it('treats empty incoming lists as accidental unless the caller allows them', () => {
    expect(shouldPreserveExisting([], [repo(1)])).toBe(true);
    expect(shouldPreserveExisting([], [repo(1)], true)).toBe(false);
    expect(shouldPreserveExisting([repo(2)], [repo(1)])).toBe(false);
    expect(shouldPreserveExisting(undefined, [repo(1)])).toBe(false);
  });
});

describe('workspaceHasData predicate', () => {
  it('returns false for null, undefined, or empty objects', () => {
    expect(workspaceHasData(null)).toBe(false);
    expect(workspaceHasData(undefined)).toBe(false);
    expect(workspaceHasData({})).toBe(false);
    expect(workspaceHasData(emptyAccountWorkspace())).toBe(false);
  });

  it('returns false when only syncMode or syncModeConfigured are set', () => {
    expect(workspaceHasData({ syncMode: 'stars-and-lists' as const, syncModeConfigured: true })).toBe(false);
  });

  it('returns true when content lists hold items', () => {
    expect(workspaceHasData({ repositories: [repo(1)] })).toBe(true);
    expect(workspaceHasData({ gists: [{ id: 'g1' } as unknown as import('../../types').Gist] })).toBe(true);
    expect(workspaceHasData({ starredGists: [{ id: 'g2' } as unknown as import('../../types').Gist] })).toBe(true);
    expect(workspaceHasData({ releases: [{ id: 10 } as unknown as import('../../types').Release] })).toBe(true);
    expect(workspaceHasData({ forks: [{ id: 20 } as unknown as import('../../types').ForkRepo] })).toBe(true);
  });

  it('returns true when user-defined categories or category mappings exist', () => {
    expect(workspaceHasData({ customCategories: [{ id: 'c1', name: 'Cat', icon: '', isCustom: true, keywords: [] }] })).toBe(true);
    expect(workspaceHasData({ categoryOrder: ['c1'] })).toBe(true);
    expect(workspaceHasData({ hiddenDefaultCategoryIds: ['all'] })).toBe(true);
    expect(workspaceHasData({ defaultCategoryOverrides: { all: { name: 'Everything' } } })).toBe(true);
    expect(workspaceHasData({ categoryListIdMap: { c1: 'L1' } })).toBe(true);
  });
});

describe('workspaceHasRetainableData predicate (ISSUE-1)', () => {
  const customRepo = {
    id: 1,
    name: 'repo',
    full_name: 'owner/custom-repo',
    html_url: 'https://github.com/owner/custom-repo',
    owner: { login: 'owner', avatar_url: '' },
  };

  it('treats subscriptions, read state and customized release sources as retainable data', () => {
    expect(workspaceHasRetainableData(null)).toBe(false);
    expect(workspaceHasRetainableData(emptyAccountWorkspace())).toBe(false);
    expect(workspaceHasRetainableData({ releaseSubscriptions: new Set([1]) })).toBe(true);
    expect(workspaceHasRetainableData({ readReleases: [2] })).toBe(true);
    expect(workspaceHasRetainableData({ readForks: new Set([3]) })).toBe(true);
    expect(workspaceHasRetainableData({
      releaseSourceSettings: { ...defaultReleaseSourceSettings, customReleaseRepos: [customRepo] },
    })).toBe(true);
    // 默认来源设置与空集合仍视为空工作区；syncMode 单独存在也不构成数据。
    expect(workspaceHasRetainableData({ releaseSourceSettings: defaultReleaseSourceSettings })).toBe(false);
    expect(workspaceHasRetainableData({
      syncMode: 'stars-and-lists' as const,
      syncModeConfigured: true,
    })).toBe(false);
  });

  it('keeps live top-level data on logged-out login when it only holds retainable non-list data', () => {
    // ISSUE-1 场景：登录页「保留本地」依赖 setUser → switchAccountWorkspace 的
    // 顶层保留分支；仅含 releaseSubscriptions 的无主缓存不得被空工作区覆盖。
    const current = {
      accountWorkspaces: {},
      releaseSubscriptions: new Set([111, 222]),
    } as unknown as AccountWorkspaceSource & { accountWorkspaces: Record<string, AccountWorkspace> };
    const switched = switchAccountWorkspace(current, null, '42');
    expect(switched.workspace).toBeNull();
  });
});

describe('account workspace capture and restore', () => {
  it('round-trips repository analysis and category data', () => {
    const captured = captureAccountWorkspace(source());
    const restored = applyAccountWorkspace(captured);
    expect(restored.repositories[0].ai_summary).toBe('summary-1');
    expect(restored.releaseSubscriptions.has(1)).toBe(true);
    expect(restored.customCategories).toEqual(captured.customCategories);
    expect(restored.searchResults).toBe(restored.repositories);
  });

  it('applies an empty workspace for a first-time account', () => {
    const restored = applyAccountWorkspace(undefined);
    expect(restored).toMatchObject(applyAccountWorkspace(emptyAccountWorkspace()));
    expect(restored.repositories).toEqual([]);
  });
});

describe('account workspace switching', () => {
  it('keeps the current workspace when the same GitHub id signs in again', () => {
    const current = {
      ...source(),
      accountWorkspaces: {} as Record<string, AccountWorkspace>,
    };
    const result = switchAccountWorkspace(current, '1', '1');
    expect(result.workspace).toBeNull();
    expect(result.accountWorkspaces).toEqual({});
  });

  it('snapshots the previous account and restores the next one', () => {
    const accountA = captureAccountWorkspace(source({ repositories: [repo(1)] }));
    const current = {
      ...source({ repositories: [repo(2)], lastSync: '2026-09-17T00:00:00.000Z' }),
      accountWorkspaces: { '1': accountA },
    };
    const result = switchAccountWorkspace(current, '2', '1');
    expect(result.accountWorkspaces['2']?.repositories[0].id).toBe(2);
    expect(result.workspace?.repositories[0].id).toBe(1);
    expect(result.workspace?.repositories[0].ai_summary).toBe('summary-1');
  });

  it('does not wipe live data when signing in after a backend restore', () => {
    const current = {
      ...source({ repositories: [repo(9)] }),
      accountWorkspaces: {} as Record<string, AccountWorkspace>,
    };
    const result = switchAccountWorkspace(current, null, '9');
    expect(result.workspace).toBeNull();
    expect(result.accountWorkspaces).toEqual({});
  });

  it('restores a parked snapshot when live lists are empty', () => {
    const parked = captureAccountWorkspace(source({ repositories: [repo(1)] }));
    const current = {
      ...source({
        repositories: [],
        lastSync: null,
        customCategories: [],
        categoryOrder: [],
        categoryListIdMap: {},
        // 第 12 轮审计 ISSUE-1：订阅/已读/来源设置也属于可保留数据，
        // 「live 为空」必须把这些字段一并清空才是真正的空工作区。
        releaseSubscriptions: new Set<number>(),
        readReleases: new Set<number>(),
        readForks: new Set<number>(),
        hiddenDefaultCategoryIds: [],
        defaultCategoryOverrides: {},
      }),
      accountWorkspaces: { '1': parked },
    };
    const result = switchAccountWorkspace(current, null, '1');
    expect(result.workspace?.repositories[0].id).toBe(1);
  });

  it('starts a new account from empty instead of inheriting the previous account', () => {
    const current = {
      ...source({ repositories: [repo(1)] }),
      accountWorkspaces: { '1': captureAccountWorkspace(source({ repositories: [repo(1)] })) },
    };
    const result = switchAccountWorkspace(current, '1', '2');
    expect(result.accountWorkspaces['1']?.repositories[0].id).toBe(1);
    expect(result.workspace?.repositories).toEqual([]);
  });

  it('sanitizes persisted account workspace maps', () => {
    expect(normalizeAccountWorkspaces(null)).toEqual({});
    const normalized = normalizeAccountWorkspaces({
      '1': { repositories: [repo(1)], syncMode: 'stars-and-lists', syncModeConfigured: true },
      bad: 'nope',
    });
    expect(normalized['1']?.repositories[0].id).toBe(1);
    expect(normalized['1']?.syncMode).toBe('stars-and-lists');
    expect(normalized.bad).toBeUndefined();
  });
});
