import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataManagementPanel } from './DataManagementPanel';
import { useAppStore } from '../../store/useAppStore';
import type { AccountWorkspace, Category, GitHubUser, Repository, SavedAccount } from '../../types';

// 恢复真实 Store：全局 setup.ts 将 store mock 成了选择器桩，而多账号
// 导入/导出测试需要驱动真实的工作区与账号状态。
vi.mock('../../store/useAppStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/useAppStore')>();
  return actual;
});

// delete-all 流程涉及的外部存储/服务全部打桩，保证重置路径可确定性执行
vi.mock('../../store/persistence/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/persistence/storage')>();
  return {
    ...actual,
    removePersistedSnapshot: vi.fn().mockResolvedValue(undefined),
  };
});
vi.mock('../../services/weeklyIssuesStorage', () => ({
  weeklyIssuesStorage: { clearAll: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../services/xTweetStorage', () => ({
  xTweetStorage: { clearAll: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../services/telegramStorage', () => ({
  telegramStorage: { clearAll: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../services/xTweetService', () => ({
  abortXTweetSync: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../services/telegramService', () => ({
  abortTelegramSync: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../services/electronProxy', () => ({
  clearEncryptedXAuthViaDesktop: vi.fn().mockResolvedValue(undefined),
}));

const t = (key: string) => key;

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

const category = (id: string, name: string): Category => ({
  id,
  name,
  icon: 'folder',
  keywords: [],
  isCustom: true,
});

const workspaceOf = (overrides: Partial<AccountWorkspace> = {}): AccountWorkspace => ({
  repositories: [],
  lastSync: null,
  gists: [],
  starredGists: [],
  selectedGistCategory: 'all',
  releases: [],
  releaseSubscriptions: [],
  releaseSourceSettings: useAppStore.getState().releaseSourceSettings,
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
  ...overrides,
});

const savedAccount = (id: string, user: GitHubUser, token: string): SavedAccount => ({
  accountId: id,
  user,
  githubToken: token,
  addedAt: '2026-01-01T00:00:00.000Z',
  lastUsedAt: '2026-01-01T00:00:00.000Z',
});

const setupStore = (): void => {
  useAppStore.setState({
    user: userA,
    githubToken: 'ghp_a',
    isAuthenticated: true,
    savedAccounts: {
      '1': savedAccount('1', userA, 'ghp_a'),
    },
    accountWorkspaces: {
      '2': workspaceOf({
        repositories: [repo(2, 'bob-ai')],
        customCategories: [category('cat-bob-local', 'Bob Local')],
      }),
    },
    repositories: [repo(1, 'alice-live')],
    releases: [],
    customCategories: [category('cat-alice', 'Alice Cat')],
    hiddenDefaultCategoryIds: ['hidden-a'],
    categoryOrder: ['cat-alice'],
    defaultCategoryOverrides: { 'cat-alice': { name: 'Alice Override' } },
    categoryListIdMap: { 'list-1': 'cat-alice' },
    gists: [],
    starredGists: [],
    forks: [],
    readForks: new Set<number>(),
    releaseSubscriptions: new Set([111]),
    readReleases: new Set([222]),
    syncMode: 'stars',
    syncModeConfigured: false,
    lastSync: null,
    selectedGistCategory: 'all',
  });
};

const backupPayload = (data: Record<string, unknown>): File => (
  new File(
    [JSON.stringify({ version: '1.1', exportDate: '2026-06-01T00:00:00.000Z', appVersion: '0.4.0', data })],
    'backup.json',
    { type: 'application/json' },
  )
);

const importBackupFile = async (user: ReturnType<typeof userEvent.setup>, data: Record<string, unknown>): Promise<void> => {
  render(<DataManagementPanel t={t} />);
  const input = screen.getByLabelText('dataManagementPanel.select-file') as HTMLInputElement;
  await user.upload(input, backupPayload(data));
  await screen.findByRole('dialog');
};

const importBackupAndClick = async (
  user: ReturnType<typeof userEvent.setup>,
  data: Record<string, unknown>,
  buttonName: string,
): Promise<void> => {
  await importBackupFile(user, data);
  await user.click(screen.getByRole('button', { name: buttonName }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
};

beforeEach(() => {
  vi.clearAllMocks();
  setupStore();
});

describe('DataManagementPanel multi-account import/export (Issue #611 audit fixes)', () => {
  it('exports workspaces trimmed to selectedTypes: only customCategories leaks no repository data', async () => {
    const user = userEvent.setup();
    const createObjectURLMock = vi.fn<(blob: Blob) => string>(() => 'blob:mock-url');
    const revokeObjectURLMock = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: createObjectURLMock });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revokeObjectURLMock });

    render(<DataManagementPanel t={t} />);

    // 反选除 customCategories 之外的所有类型
    const labelsToUncheck = [
      'dataManagementPanel.repositories',
      'dataManagementPanel.releases',
      'dataManagementPanel.ai-configs',
      'dataManagementPanel.webdav-configs',
      'dataManagementPanel.asset-filters',
      'dataManagementPanel.discovery-data',
      'dataManagementPanel.subscription-data',
      'dataManagementPanel.release-subscriptions',
      'dataManagementPanel.search-filters',
      'dataManagementPanel.ui-settings',
    ];
    for (const label of labelsToUncheck) {
      await user.click(screen.getByLabelText(label));
    }

    await user.click(screen.getByRole('button', { name: 'dataManagementPanel.export-selected' }));

    expect(createObjectURLMock).toHaveBeenCalledOnce();
    const blob = createObjectURLMock.mock.calls[0][0] as Blob;
    const payload = JSON.parse(await blob.text());

    // 工作区字段按选择裁剪：其他账号的仓库数据绝不进入导出 JSON
    expect(payload.data.repositories).toBeUndefined();
    expect(payload.data.customCategories).toBeDefined();
    expect(payload.data.accountWorkspaces['2'].repositories).toEqual([]);
    expect(payload.data.accountWorkspaces['2'].customCategories[0].id).toBe('cat-bob-local');
    // 当前账号（实时合成）的仓库同样被裁剪
    expect(payload.data.accountWorkspaces['1'].repositories).toEqual([]);
  });

  it('captures the live workspace when a cross-account replace backup lacks the current account workspace', async () => {
    // 本机旧快照仅含 a1，实时数据已有 a2：旧快照不得回滚实时状态
    useAppStore.setState({
      accountWorkspaces: {
        '1': workspaceOf({ repositories: [repo(1, 'stale-alice')] }),
        '2': workspaceOf({ repositories: [repo(2, 'bob-ai')] }),
      },
      repositories: [repo(1, 'alice-live-1'), repo(3, 'alice-live-2')],
    });
    const user = userEvent.setup();

    await importBackupAndClick(user, {
      activeAccountId: '2',
      includeKeysInBackup: true,
      accountWorkspaces: {
        '2': workspaceOf({ repositories: [repo(2, 'bob-backup')] }),
      },
      repositories: [repo(2, 'bob-top-level')],
    }, 'dataManagementPanel.replace-import');

    const state = useAppStore.getState();
    // 实时数据保留（未被旧快照 [a1] 回滚）
    expect(state.repositories.map((r: Repository) => r.ai_summary)).toEqual(['alice-live-1', 'alice-live-2']);
    // 实时数据被快照保存进工作区字典
    expect(state.accountWorkspaces['1']?.repositories.map((r: Repository) => r.ai_summary))
      .toEqual(['alice-live-1', 'alice-live-2']);
    // 备份数据归档进备份账号工作区
    expect(state.accountWorkspaces['2']?.repositories[0].ai_summary).toBe('bob-top-level');
  });

  it('keeps local tokens when the backup only contains masked saved-account tokens', async () => {
    useAppStore.setState({
      savedAccounts: {
        '1': savedAccount('1', userA, 'ghp_local_a'),
        '2': savedAccount('2', userB, 'ghp_local_b'),
      },
    });
    const user = userEvent.setup();

    await importBackupAndClick(user, {
      includeKeysInBackup: false,
      savedAccounts: {
        '1': savedAccount('1', userA, '***'),
        '2': savedAccount('2', userB, '***'),
        '3': savedAccount('3', { ...userA, id: 3, login: 'carol' }, '***'),
      },
    }, 'dataManagementPanel.replace-import');

    const state = useAppStore.getState();
    // 掩码 Token 不覆盖本机有效 Token
    expect(state.savedAccounts['1']?.githubToken).toBe('ghp_local_a');
    expect(state.savedAccounts['2']?.githubToken).toBe('ghp_local_b');
    // 本机没有 Token 的新账号存空字符串
    expect(state.savedAccounts['3']?.githubToken).toBe('');
  });

  it('merge mode archives top-level backup data by id without clobbering merged local entries', async () => {
    const user = userEvent.setup();

    await importBackupAndClick(user, {
      activeAccountId: '2',
      includeKeysInBackup: true,
      accountWorkspaces: {},
      repositories: [repo(4, 'bob-backup-b2')],
    }, 'dataManagementPanel.merge-import');

    const state = useAppStore.getState();
    // 本机条目保留 + 备份顶层条目并入（不被顶层数组整体覆盖）
    expect(state.accountWorkspaces['2']?.repositories.map((r: Repository) => r.ai_summary))
      .toEqual(['bob-ai', 'bob-backup-b2']);
    // 恢复者顶层实时数据不动
    expect(state.repositories[0].ai_summary).toBe('alice-live');
  });

  it('replace mode does not write cross-account category mappings or display settings to the restorer', async () => {
    const user = userEvent.setup();

    await importBackupAndClick(user, {
      activeAccountId: '2',
      includeKeysInBackup: true,
      accountWorkspaces: {},
      customCategories: [category('cat-bob-backup', 'Bob Backup')],
      hiddenDefaultCategoryIds: ['hidden-b'],
      defaultCategoryOverrides: { 'cat-bob-backup': { name: 'Bob Override' } },
      categoryOrder: ['cat-bob-backup'],
      categoryListIdMap: { 'list-2': 'cat-bob-backup' },
    }, 'dataManagementPanel.replace-import');

    const state = useAppStore.getState();
    // 当前账号的分类映射与显示设置完全不被跨账号导入改写
    expect(state.categoryListIdMap).toEqual({ 'list-1': 'cat-alice' });
    expect(state.hiddenDefaultCategoryIds).toEqual(['hidden-a']);
    expect(state.categoryOrder).toEqual(['cat-alice']);
    expect(state.defaultCategoryOverrides).toEqual({ 'cat-alice': { name: 'Alice Override' } });
    expect(state.customCategories.map((c: Category) => c.id)).toEqual(['cat-alice']);
    // 备份分类归档进备份账号工作区
    expect(state.accountWorkspaces['2']?.customCategories[0].id).toBe('cat-bob-backup');
  });

  it('merge mode keeps category display settings isolated to the backup account workspace', async () => {
    const user = userEvent.setup();

    await importBackupAndClick(user, {
      activeAccountId: '2',
      includeKeysInBackup: true,
      accountWorkspaces: {},
      customCategories: [category('cat-bob-backup', 'Bob Backup')],
      hiddenDefaultCategoryIds: ['hidden-b'],
      defaultCategoryOverrides: { 'cat-bob-backup': { name: 'Bob Override' } },
      categoryOrder: ['cat-bob-backup'],
      categoryListIdMap: { 'list-2': 'cat-bob-backup' },
    }, 'dataManagementPanel.merge-import');

    const state = useAppStore.getState();
    // 当前账号的分类显示设置不被改写
    expect(state.categoryListIdMap).toEqual({ 'list-1': 'cat-alice' });
    expect(state.hiddenDefaultCategoryIds).toEqual(['hidden-a']);
    expect(state.categoryOrder).toEqual(['cat-alice']);
    expect(state.defaultCategoryOverrides).toEqual({ 'cat-alice': { name: 'Alice Override' } });
    // 备份账号工作区持有合并后的分类数据
    expect(state.accountWorkspaces['2']?.customCategories.map((c: Category) => c.id))
      .toEqual(['cat-bob-local', 'cat-bob-backup']);
    expect(state.accountWorkspaces['2']?.categoryOrder).toEqual(['cat-bob-backup']);
    expect(state.accountWorkspaces['2']?.hiddenDefaultCategoryIds).toEqual(['hidden-b']);
    expect(state.accountWorkspaces['2']?.defaultCategoryOverrides['cat-bob-backup']?.name).toBe('Bob Override');
  });

  it('applies workspace-only settings on same-account replace import (syncMode, lastSync)', async () => {
    const user = userEvent.setup();

    await importBackupAndClick(user, {
      activeAccountId: '1',
      includeKeysInBackup: true,
      accountWorkspaces: {
        '1': workspaceOf({
          repositories: [repo(1, 'alice-restored')],
          lastSync: '2026-05-01T00:00:00.000Z',
          syncMode: 'stars-and-lists',
          syncModeConfigured: true,
        }),
      },
      repositories: [repo(1, 'alice-restored')],
    }, 'dataManagementPanel.replace-import');

    const state = useAppStore.getState();
    // 仅存于工作区的设置真正恢复到活跃状态
    expect(state.syncMode).toBe('stars-and-lists');
    expect(state.syncModeConfigured).toBe(true);
    expect(state.lastSync).toBe('2026-05-01T00:00:00.000Z');
    expect(state.repositories[0].ai_summary).toBe('alice-restored');
    // 快照以恢复后的实时状态为准
    expect(state.accountWorkspaces['1']?.syncMode).toBe('stars-and-lists');
  });

  it('clears savedAccounts when deleting all data so tokens are not re-persisted', async () => {
    vi.useFakeTimers();
    try {
      render(<DataManagementPanel t={t} />);
      fireEvent.click(screen.getByRole('button', { name: 'dataManagementPanel.delete-all-data-2' }));
      fireEvent.change(screen.getByLabelText(/please-enter-your-github-username/), {
        target: { value: 'alice' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'dataManagementPanel.confirm-delete' }));

      await vi.waitFor(() => {
        const state = useAppStore.getState();
        expect(state.savedAccounts).toEqual({});
        expect(state.user).toBeNull();
        expect(state.githubToken).toBeNull();
        expect(state.accountWorkspaces).toEqual({});
      });
      // 快进触发（jsdom 不实现的）reload，避免悬挂定时器
      vi.advanceTimersByTime(3000);
    } finally {
      vi.useRealTimers();
    }
  });
});
