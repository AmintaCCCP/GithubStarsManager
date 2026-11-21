import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataManagementPanel } from './DataManagementPanel';
import { useAppStore } from '../../store/useAppStore';
import type { AccountWorkspace, Category, Gist, GitHubUser, Repository, SavedAccount } from '../../types';

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
const ghAccountSecretsMocks = vi.hoisted(() => ({
  clearGhAccountTokens: vi.fn().mockResolvedValue(undefined),
  // R12 审计补强：导入提交后等待安全存储写入；用例可挂起/失败该写入验证竞态。
  syncGhAccountTokensFromState: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../services/electronProxy', () => ({
  clearEncryptedXAuthViaDesktop: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../store/persistence/ghAccountSecrets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/persistence/ghAccountSecrets')>();
  return {
    ...actual,
    clearGhAccountTokens: ghAccountSecretsMocks.clearGhAccountTokens,
    syncGhAccountTokensFromState: ghAccountSecretsMocks.syncGhAccountTokensFromState,
  };
});

const stubUrlObjectMethods = () => {
  const originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
  const originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
  const createObjectURLMock = vi.fn<(blob: Blob) => string>(() => 'blob:mock-url');
  const revokeObjectURLMock = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: createObjectURLMock });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revokeObjectURLMock });
  const restore = () => {
    if (originalCreate) {
      Object.defineProperty(URL, 'createObjectURL', originalCreate);
    } else {
      delete (URL as unknown as Record<string, unknown>).createObjectURL;
    }
    if (originalRevoke) {
      Object.defineProperty(URL, 'revokeObjectURL', originalRevoke);
    } else {
      delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
    }
  };
  return { createObjectURLMock, revokeObjectURLMock, restore };
};

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

const gist = (id: string, description: string): Gist => ({
  id,
  description,
  public: true,
  html_url: `https://gist.github.com/${id}`,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  comments: 0,
  owner: { login: 'alice', avatar_url: '' },
  files: {},
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
  ghAccountSecretsMocks.clearGhAccountTokens.mockResolvedValue(undefined);
  ghAccountSecretsMocks.syncGhAccountTokensFromState.mockResolvedValue(true);
  setupStore();
});

describe('DataManagementPanel multi-account import/export (Issue #611 audit fixes)', () => {
  it('exports workspaces trimmed to selectedTypes: only customCategories leaks no repository data', async () => {
    const user = userEvent.setup();
    const { createObjectURLMock, restore } = stubUrlObjectMethods();
    try {
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
    } finally {
      restore();
    }
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

  it('exports account attribution when only releaseSubscriptions is selected', async () => {
    const user = userEvent.setup();
    const { createObjectURLMock, restore } = stubUrlObjectMethods();
    try {
      render(<DataManagementPanel t={t} />);

      // 反选除 release-subscriptions 之外的所有类型
      const labelsToUncheck = [
        'dataManagementPanel.repositories',
        'dataManagementPanel.releases',
        'dataManagementPanel.ai-configs',
        'dataManagementPanel.webdav-configs',
        'dataManagementPanel.asset-filters',
        'dataManagementPanel.discovery-data',
        'dataManagementPanel.subscription-data',
        'dataManagementPanel.categories',
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

      // 仅导出订阅时也必须带账号归属：否则导入端无法识别跨账号备份
      expect(payload.data.releaseSubscriptions).toEqual([111]);
      expect(payload.data.activeAccountId).toBe('1');
      expect(payload.data.accountWorkspaces).toBeDefined();
      expect(payload.data.savedAccounts).toBeDefined();
      // 工作区按所选类型裁剪：只含订阅/已读字段，不含其他账号仓库
      expect(payload.data.accountWorkspaces['1'].releaseSubscriptions).toEqual([111]);
      expect(payload.data.accountWorkspaces['1'].repositories).toEqual([]);
      expect(payload.data.accountWorkspaces['2'].repositories).toEqual([]);
    } finally {
      restore();
    }
  });

  it('replace import of a categories-only export restores categories without wiping other accounts', async () => {
    // 往返：仅导出 customCategories → replace 导入，非当前账号的仓库等
    // 未选数据绝不被裁剪备份的空占位清空
    const user = userEvent.setup();
    const { createObjectURLMock, restore } = stubUrlObjectMethods();
    try {
      render(<DataManagementPanel t={t} />);
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
      const blob = createObjectURLMock.mock.calls[0][0] as Blob;
      const payload = JSON.parse(await blob.text());
      expect(payload.data.accountWorkspaces['2'].repositories).toEqual([]);

      // 审计修复（C56a）：导出后先修改 Alice/Bob 本地分类，再替换导入——
      // 断言分类恢复为备份值（而非导出后本地值），且 Bob 未选仓库未导入。
      useAppStore.setState({ customCategories: [category('cat-alice-edited', 'Alice Edited')] });
      useAppStore.setState((current) => ({
        accountWorkspaces: {
          ...current.accountWorkspaces,
          '2': {
            ...current.accountWorkspaces['2'],
            customCategories: [category('cat-bob-edited', 'Bob Edited')],
          },
        },
      }));

      const exportedText = await blob.text();
      const exportedFile = new File([exportedText], 'exported-categories.json', { type: 'application/json' });
      const fileInput = screen.getByLabelText('dataManagementPanel.select-file') as HTMLInputElement;
      await user.upload(fileInput, exportedFile);
      await screen.findByRole('dialog');
      await user.click(screen.getByRole('button', { name: 'dataManagementPanel.replace-import' }));

      const state = useAppStore.getState();
      // Alice 分类恢复为备份值（cat-alice），导出后的本地修改被替换
      expect(state.customCategories.map((c: Category) => c.id)).toEqual(['cat-alice']);
      expect(state.customCategories[0].name).toBe('Alice Cat');
      // Bob 未选仓库未导入（实时仍是 bob-ai），Bob 分类恢复为备份值
      expect(state.accountWorkspaces['2']?.repositories.map((r: Repository) => r.ai_summary))
        .toEqual(['bob-ai']);
      expect(state.accountWorkspaces['2']?.customCategories.map((c: Category) => c.id))
        .toEqual(['cat-bob-local']);
      expect(state.accountWorkspaces['2']?.customCategories[0].name).toBe('Bob Local');
    } finally {
      restore();
    }
  });

  it('archives backup-account subscriptions to its workspace on cross-account replace import', async () => {
    const user = userEvent.setup();

    await importBackupAndClick(user, {
      activeAccountId: '2',
      includeKeysInBackup: true,
      accountWorkspaces: {},
      releaseSubscriptions: [999],
      readReleases: [888],
      releaseSourceSettings: {
        enabledSourceIds: ['starred-release-subscription'],
        watchCustomReleaseRepos: [],
        customReleaseRepos: [],
      },
    }, 'dataManagementPanel.replace-import');

    const state = useAppStore.getState();
    // 当前账号的订阅/已读/来源设置不被跨账号备份改写
    expect(Array.from(state.releaseSubscriptions)).toEqual([111]);
    expect(Array.from(state.readReleases)).toEqual([222]);
    // 备份账号工作区持有备份的订阅/已读状态
    expect(state.accountWorkspaces['2']?.releaseSubscriptions).toEqual([999]);
    expect(state.accountWorkspaces['2']?.readReleases).toEqual([888]);
  });

  it('unions backup-account subscriptions into its workspace on cross-account merge import', async () => {
    useAppStore.setState({
      accountWorkspaces: {
        '2': workspaceOf({
          repositories: [repo(2, 'bob-ai')],
          releaseSubscriptions: [555],
          readReleases: [666],
        }),
      },
    });
    const user = userEvent.setup();

    await importBackupAndClick(user, {
      activeAccountId: '2',
      includeKeysInBackup: true,
      accountWorkspaces: {},
      releaseSubscriptions: [999, 555],
      readReleases: [666, 888],
    }, 'dataManagementPanel.merge-import');

    const state = useAppStore.getState();
    // 备份账号工作区按并集合并，保留本机条目并恢复备份条目
    expect(state.accountWorkspaces['2']?.releaseSubscriptions).toEqual([555, 999]);
    expect(state.accountWorkspaces['2']?.readReleases).toEqual([666, 888]);
    // 当前账号实时状态不动
    expect(Array.from(state.releaseSubscriptions)).toEqual([111]);
    expect(Array.from(state.readReleases)).toEqual([222]);
  });

  it('merge import from another account merges stale current-account workspace into live state', async () => {
    // 备份包含当前账号的旧快照：merge 必须以实时快照为基座合并，
    // 绝不能用备份旧快照覆盖实时数据
    useAppStore.setState({
      repositories: [repo(1, 'alice-live-1'), repo(3, 'alice-new-local')],
      accountWorkspaces: {},
    });
    const user = userEvent.setup();

    await importBackupAndClick(user, {
      activeAccountId: '2',
      includeKeysInBackup: true,
      accountWorkspaces: {
        '1': workspaceOf({ repositories: [repo(1, 'stale-alice'), repo(9, 'backup-only-alice')] }),
      },
      repositories: [repo(2, 'bob-top-level')],
    }, 'dataManagementPanel.merge-import');

    const state = useAppStore.getState();
    const summaries = state.repositories.map((r: Repository) => r.ai_summary);
    // 审计修复（C56b）：合并结果按仓库 ID 完整断言 Alice 实时列表——
    // 明确不含备份顶层的 bob-top-level（跨账号顶层数据归档进备份账号
    // 工作区，绝不混入当前账号实时列表）。
    expect(summaries).toEqual(['alice-live-1', 'alice-new-local', 'backup-only-alice']);
    // 实时数据保留（不被备份旧快照 [stale-alice] 回滚）
    expect(summaries).toContain('alice-live-1');
    expect(summaries).toContain('alice-new-local');
    // 备份工作区中当前账号的新增条目并入实时状态
    expect(summaries).toContain('backup-only-alice');
    expect(summaries).not.toContain('stale-alice');
    // 备份顶层数据归档进备份账号工作区
    expect(state.accountWorkspaces['2']?.repositories[0].ai_summary).toBe('bob-top-level');
    // 当前账号工作区快照与合并后的实时状态一致
    expect(state.accountWorkspaces['1']?.repositories.map((r: Repository) => r.ai_summary))
      .toEqual(summaries);
  });

  it('merge import from another account unions current-account release source settings from the backup (R4)', async () => {
    // R4 审计修复回归：mergeWorkspacesById 只合并列表与 ID 集合（其余字段取
    // 本机基座）——备份当前账号工作区的自定义发布来源若不经
    // mergeReleaseSourceSettings 合并，会整段保留本机值而丢失备份来源。
    useAppStore.setState({
      repositories: [repo(1, 'alice-live')],
      accountWorkspaces: {},
      releaseSourceSettings: {
        enabledSourceIds: ['starred-release-subscription'],
        watchCustomReleaseRepos: [],
        customReleaseRepos: [{
          id: 11,
          name: 'local-only',
          full_name: 'local/owner-only',
          html_url: 'https://github.com/local/owner-only',
          owner: { login: 'local', avatar_url: '' },
        }],
      },
    });
    const user = userEvent.setup();

    await importBackupAndClick(user, {
      activeAccountId: '2',
      includeKeysInBackup: true,
      // 顶层带 releaseSubscriptions 键，使 releaseSubscriptions 进入 selectedTypes
      releaseSubscriptions: [],
      accountWorkspaces: {
        '1': workspaceOf({
          releaseSourceSettings: {
            enabledSourceIds: ['starred-release-subscription', 'watch-custom-release', 'custom-release'],
            watchCustomReleaseRepos: [{
              id: 21,
              name: 'watched',
              full_name: 'backup/watched',
              html_url: 'https://github.com/backup/watched',
              owner: { login: 'backup', avatar_url: '' },
            }],
            customReleaseRepos: [{
              id: 22,
              name: 'custom',
              full_name: 'backup/custom',
              html_url: 'https://github.com/backup/custom',
              owner: { login: 'backup', avatar_url: '' },
            }],
          },
        }),
      },
      repositories: [repo(2, 'bob-top-level')],
    }, 'dataManagementPanel.merge-import');

    const state = useAppStore.getState();
    // 备份中的自定义/关注来源并入实时状态，本机已有来源保留
    expect(state.releaseSourceSettings.customReleaseRepos.map((r) => r.full_name))
      .toEqual(expect.arrayContaining(['backup/custom', 'local/owner-only']));
    expect(state.releaseSourceSettings.watchCustomReleaseRepos.map((r) => r.full_name))
      .toContain('backup/watched');
    expect(state.releaseSourceSettings.enabledSourceIds)
      .toEqual(expect.arrayContaining(['watch-custom-release', 'custom-release']));
    // 合并结果同步进当前账号工作区快照（切换/再次导出不丢失）
    const snapshot = state.accountWorkspaces['1']?.releaseSourceSettings;
    expect(snapshot?.customReleaseRepos.map((r) => r.full_name)).toContain('backup/custom');
    // 备份顶层数据仍归档进备份账号工作区（既有合并语义不受影响）
    expect(state.accountWorkspaces['2']?.repositories[0].ai_summary).toBe('bob-top-level');
  });

  it('merge import from another account unions current-account category settings from the backup (R5)', async () => {
    // R5 审计修复回归（CodeRabbit 发现 3）：mergeWorkspacesById 只合并列表与
    // ID 集合——hiddenDefaultCategoryIds、defaultCategoryOverrides、categoryOrder
    // 与 categoryListIdMap 若不按分类合并分支的规则合并，备份当前账号工作区
    // 新增的分类显示设置会整段保留本机值而被丢弃。
    useAppStore.setState({
      repositories: [repo(1, 'alice-live')],
      accountWorkspaces: {},
    });
    const user = userEvent.setup();

    await importBackupAndClick(user, {
      activeAccountId: '2',
      includeKeysInBackup: true,
      // 顶层带 customCategories 键，使分类类型进入 selectedTypes
      customCategories: [],
      accountWorkspaces: {
        '1': workspaceOf({
          hiddenDefaultCategoryIds: ['hidden-backup'],
          categoryOrder: ['cat-backup-order'],
          defaultCategoryOverrides: { 'cat-backup-override': { name: 'Backup Override' } },
          categoryListIdMap: { 'list-2': 'cat-backup' },
        }),
      },
      repositories: [repo(2, 'bob-top-level')],
    }, 'dataManagementPanel.merge-import');

    const state = useAppStore.getState();
    // 本机设置保留，备份新增设置并入实时状态
    expect(state.hiddenDefaultCategoryIds).toEqual(expect.arrayContaining(['hidden-a', 'hidden-backup']));
    expect(state.categoryOrder).toEqual(expect.arrayContaining(['cat-alice', 'cat-backup-order']));
    expect(state.defaultCategoryOverrides['cat-alice']?.name).toBe('Alice Override');
    expect(state.defaultCategoryOverrides['cat-backup-override']?.name).toBe('Backup Override');
    expect(state.categoryListIdMap).toEqual(expect.objectContaining({ 'list-1': 'cat-alice', 'list-2': 'cat-backup' }));
    // 合并结果同步进当前账号工作区快照（切换/再次导出不丢失）
    const snapshot = state.accountWorkspaces['1'];
    expect(snapshot?.hiddenDefaultCategoryIds).toEqual(expect.arrayContaining(['hidden-a', 'hidden-backup']));
    expect(snapshot?.categoryOrder).toEqual(expect.arrayContaining(['cat-alice', 'cat-backup-order']));
    expect(snapshot?.defaultCategoryOverrides['cat-backup-override']?.name).toBe('Backup Override');
    expect(snapshot?.categoryListIdMap).toEqual(expect.objectContaining({ 'list-1': 'cat-alice', 'list-2': 'cat-backup' }));
    // 备份顶层数据仍归档进备份账号工作区（既有合并语义不受影响）
    expect(state.accountWorkspaces['2']?.repositories[0].ai_summary).toBe('bob-top-level');
  });

  it('merge import unions non-active account release and category settings (audit fix)', async () => {
    // 非活跃账号此前只走 mergeWorkspacesById：releaseSourceSettings 与分类
    // 显示/映射设置会整段取本机基座，备份中的新增项被静默丢弃。
    useAppStore.setState({
      repositories: [repo(1, 'alice-live')],
      accountWorkspaces: {
        '3': workspaceOf({
          releaseSourceSettings: {
            enabledSourceIds: ['starred-release-subscription'],
            watchCustomReleaseRepos: [],
            customReleaseRepos: [{
              id: 31,
              name: 'local-3',
              full_name: 'local/only-3',
              html_url: 'https://github.com/local/only-3',
              owner: { login: 'local', avatar_url: '' },
            }],
          },
          hiddenDefaultCategoryIds: ['hidden-local-3'],
        }),
      },
    });
    const user = userEvent.setup();

    await importBackupAndClick(user, {
      activeAccountId: '2',
      includeKeysInBackup: true,
      releaseSubscriptions: [],
      customCategories: [],
      accountWorkspaces: {
        '3': workspaceOf({
          releaseSourceSettings: {
            enabledSourceIds: ['starred-release-subscription', 'custom-release'],
            watchCustomReleaseRepos: [],
            customReleaseRepos: [{
              id: 32,
              name: 'backup-3',
              full_name: 'backup/custom-3',
              html_url: 'https://github.com/backup/custom-3',
              owner: { login: 'backup', avatar_url: '' },
            }],
          },
          hiddenDefaultCategoryIds: ['hidden-backup-3'],
        }),
      },
      repositories: [repo(2, 'bob-top-level')],
    }, 'dataManagementPanel.merge-import');

    const merged = useAppStore.getState().accountWorkspaces['3'];
    expect(merged?.releaseSourceSettings.customReleaseRepos.map((r) => r.full_name))
      .toEqual(expect.arrayContaining(['local/only-3', 'backup/custom-3']));
    expect(merged?.releaseSourceSettings.enabledSourceIds).toContain('custom-release');
    expect(merged?.hiddenDefaultCategoryIds).toEqual(expect.arrayContaining(['hidden-local-3', 'hidden-backup-3']));
  });

  it('same-account merge import restores backup-only gists into live state', async () => {
    const user = userEvent.setup();

    await importBackupAndClick(user, {
      activeAccountId: '1',
      includeKeysInBackup: true,
      accountWorkspaces: {
        '1': workspaceOf({ gists: [gist('gist-backup-new', 'backup gist')] }),
      },
      repositories: [repo(1, 'alice-restored')],
    }, 'dataManagementPanel.merge-import');

    const state = useAppStore.getState();
    // 仅存在于工作区字段中的备份新增 Gist 落回实时状态
    expect(state.gists.map((g: Gist) => g.id)).toContain('gist-backup-new');
    expect(state.gistSearchResults.map((g: Gist) => g.id)).toContain('gist-backup-new');
    // 工作区快照包含合并结果：再次导出不会丢失刚导入的条目
    expect(state.accountWorkspaces['1']?.gists.map((g: Gist) => g.id)).toContain('gist-backup-new');
    // 本地实时仓库条目保留
    expect(state.repositories[0].ai_summary).toBe('alice-live');
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
        expect(ghAccountSecretsMocks.clearGhAccountTokens).toHaveBeenCalledOnce();
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

  it('does not report success when desktop credential clearing fails during delete-all', async () => {
    ghAccountSecretsMocks.clearGhAccountTokens.mockRejectedValueOnce(new Error('safeStorage locked'));
    render(<DataManagementPanel t={t} />);
    fireEvent.click(screen.getByRole('button', { name: 'dataManagementPanel.delete-all-data-2' }));
    fireEvent.change(screen.getByLabelText(/please-enter-your-github-username/), {
      target: { value: 'alice' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'dataManagementPanel.confirm-delete' }));

    // 审计修复（测试覆盖）：不能仅凭令牌清理函数已被调用且成功提示尚未出现
    // 就继续断言——此时拒绝处理（catch）可能仍未完成。先等待删除失败提示
    // 出现，确认失败处理已完成，再断言成功提示未出现。
    await waitFor(() => {
      expect(ghAccountSecretsMocks.clearGhAccountTokens).toHaveBeenCalledOnce();
    });
    await screen.findByText('dataManagementPanel.delete-failed-please-try-again');
    // 审计修复（R12 测试覆盖）：用生产代码实际采用的成功文案键断言提示不存在
    //（deleteAllData 成功路径显示 all-data-deleted-app-will-reload）——检查
    // 从未渲染的键会让失败路径的断言恒真。
    expect(screen.queryByText('dataManagementPanel.all-data-deleted-app-will-reload')).not.toBeInTheDocument();
    // 清理失败时不清空内存态：用户、凭据记录与工作区仍保留（等待用户重试）
    expect(useAppStore.getState().user?.login).toBe('alice');
    expect(Object.keys(useAppStore.getState().savedAccounts)).toEqual(['1']);
    expect(useAppStore.getState().accountWorkspaces['2']).toBeDefined();
  });

  it('re-persists device credentials when delete-all fails after clearing them (R13 finding 92)', async () => {
    // clearGhAccountTokens 成功、后续步骤失败：内存账号与运行时 Token 保留，
    // 但磁盘凭据已被删除且快照不含运行时 Token（重启后无可回填来源）——
    // 失败路径必须按保留在内存中的账号重新落盘凭据，保证磁盘与内存一致。
    const { removePersistedSnapshot } = await import('../../store/persistence/storage');
    vi.mocked(removePersistedSnapshot).mockRejectedValueOnce(new Error('indexeddb locked'));
    try {
      render(<DataManagementPanel t={t} />);
      fireEvent.click(screen.getByRole('button', { name: 'dataManagementPanel.delete-all-data-2' }));
      fireEvent.change(screen.getByLabelText(/please-enter-your-github-username/), {
        target: { value: 'alice' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'dataManagementPanel.confirm-delete' }));

      expect(await screen.findByText('dataManagementPanel.delete-failed-please-try-again')).toBeInTheDocument();
      expect(ghAccountSecretsMocks.clearGhAccountTokens).toHaveBeenCalledOnce();
      // 内存态保留（等待用户重试续清）
      expect(useAppStore.getState().user?.login).toBe('alice');
      expect(useAppStore.getState().savedAccounts['1']?.githubToken).toBe('ghp_a');
      // 磁盘凭据按保留在内存中的账号重新落盘（幂等全量同步恢复机制）
      expect(ghAccountSecretsMocks.syncGhAccountTokensFromState).toHaveBeenCalledWith(expect.objectContaining({
        savedAccounts: expect.objectContaining({
          '1': expect.objectContaining({ githubToken: 'ghp_a' }),
        }),
      }));
    } finally {
      vi.mocked(removePersistedSnapshot).mockReset();
      vi.mocked(removePersistedSnapshot).mockResolvedValue(undefined);
    }
  });

  it('derives import types from raw workspace fields for partial backups (activeAccountId + nested repositories only)', async () => {
    const user = userEvent.setup();

    await importBackupAndClick(user, {
      activeAccountId: '2',
      includeKeysInBackup: true,
      accountWorkspaces: {
        '2': { repositories: [repo(21, 'bob-partial')] },
      },
    }, 'dataManagementPanel.merge-import');

    const state = useAppStore.getState();
    // 部分备份的账号仓库按工作区字段推导出 repositories 类型并恢复（此前
    // resolveImportTypes 返回空数组，仓库被过滤却报告成功）
    expect(state.accountWorkspaces['2']?.repositories.map((r: Repository) => r.ai_summary))
      .toEqual(['bob-ai', 'bob-partial']);
    // 恢复者顶层实时数据不动
    expect(state.repositories[0].ai_summary).toBe('alice-live');
  });

  it('same-account merge import restores top-level gists when backup has no accountWorkspaces', async () => {
    const user = userEvent.setup();

    await importBackupAndClick(user, {
      activeAccountId: '1',
      includeKeysInBackup: true,
      repositories: [],
      gists: [gist('gist-top-level-new', 'legacy gist')],
    }, 'dataManagementPanel.merge-import');

    const state = useAppStore.getState();
    // 旧版单账号备份的顶层 Gist 按 id 并入实时状态（此前只合并仓库，收尾
    // 快照把未恢复的 Gist 丢弃却报告成功）
    expect(state.gists.map((g: Gist) => g.id)).toContain('gist-top-level-new');
    expect(state.gistSearchResults.map((g: Gist) => g.id)).toContain('gist-top-level-new');
    expect(state.accountWorkspaces['1']?.gists.map((g: Gist) => g.id)).toContain('gist-top-level-new');
    // repositories: [] 不清空本机仓库（合并语义保留已有条目）
    expect(state.repositories[0].ai_summary).toBe('alice-live');
  });

  it('imports backups containing channel-grouped discovery and subscription caches', async () => {
    const user = userEvent.setup();

    await importBackupAndClick(user, {
      includeKeysInBackup: true,
      discoveryRepos: {
        trending: [{
          id: 9001,
          name: 'trend-repo',
          full_name: 'x/trend-repo',
          html_url: 'https://github.com/x/trend-repo',
          description: null,
          stargazers_count: 1,
          owner: { login: 'x', avatar_url: '' },
        }],
      },
      subscriptionRepos: {
        'most-stars': [{
          id: 8001,
          name: 'sub-repo',
          full_name: 'x/sub-repo',
          html_url: 'https://github.com/x/sub-repo',
          owner: { login: 'x', avatar_url: '' },
        }],
      },
    }, 'dataManagementPanel.merge-import');

    // 频道映射对象此前被当数组校验整体拒绝——现在按映射对象与其中的仓库
    // 数组分别校验，含缓存的备份（含默认全选导出）可正常导入
    expect(useAppStore.getState().discoveryRepos.trending.some((r) => r.id === 9001)).toBe(true);
    expect(useAppStore.getState().subscriptionRepos['most-stars'].some((r) => r.id === 8001)).toBe(true);
  });

  it('rejects an imported backup PAT whose GitHub identity does not match the target account', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 999, login: 'mallory' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const user = userEvent.setup();
      await importBackupAndClick(user, {
        includeKeysInBackup: true,
        savedAccounts: {
          '3': savedAccount('3', { ...userA, id: 3, login: 'carol' }, 'ghp_carol_token'),
        },
      }, 'dataManagementPanel.merge-import');

      // 身份不匹配：凭据被拒绝（不写入 savedAccounts），条目保留为需重新授权的元数据
      expect(fetchMock).toHaveBeenCalled();
      expect(useAppStore.getState().savedAccounts['3']?.githubToken).toBe('');
      expect(useAppStore.getState().savedAccounts['3']?.user.login).toBe('carol');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('adopts an imported backup PAT after GitHub identity verification matches the account', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 3, login: 'carol' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const user = userEvent.setup();
      await importBackupAndClick(user, {
        includeKeysInBackup: true,
        savedAccounts: {
          '3': savedAccount('3', { ...userA, id: 3, login: 'carol' }, 'ghp_carol_token'),
        },
      }, 'dataManagementPanel.merge-import');

      expect(fetchMock).toHaveBeenCalled();
      expect(useAppStore.getState().savedAccounts['3']?.githubToken).toBe('ghp_carol_token');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // ── R12 审计修复回归 ────────────────────────────────────────────────

  it('derives import types from standalone top-level gists so merge mode restores them (R12)', async () => {
    const user = userEvent.setup();

    await importBackupAndClick(user, {
      activeAccountId: '1',
      includeKeysInBackup: true,
      // 顶层仅有 gists 字段（无 repositories/accountWorkspaces）——别名解析
      // 必须直接读取顶层受支持字段，否则合并会跳过 Gist 却报告成功
      gists: [gist('gist-top-only', 'top-level only gist')],
    }, 'dataManagementPanel.merge-import');

    const state = useAppStore.getState();
    expect(state.gists.map((g: Gist) => g.id)).toContain('gist-top-only');
    expect(state.gistSearchResults.map((g: Gist) => g.id)).toContain('gist-top-only');
    expect(state.accountWorkspaces['1']?.gists.map((g: Gist) => g.id)).toContain('gist-top-only');
  });

  it('rejects imports whose gist list contains invalid entries before any write (R12)', async () => {
    const user = userEvent.setup();
    await importBackupFile(user, {
      activeAccountId: '1',
      includeKeysInBackup: true,
      repositories: [repo(9, 'should-not-be-written')],
      gists: [null],
    });
    await user.click(screen.getByRole('button', { name: 'dataManagementPanel.replace-import' }));

    // 整体拒绝且发生在首次写入前：仓库不被替换（绝不写入部分有效数据）
    expect(await screen.findByText('dataManagementPanel.invalid-backup-file-format')).toBeInTheDocument();
    expect(useAppStore.getState().repositories[0].ai_summary).toBe('alice-live');
    expect(useAppStore.getState().gists).toEqual([]);
  });

  it('dedupes entries with the same id within one backup in merge mode (R12)', async () => {
    const user = userEvent.setup();

    await importBackupAndClick(user, {
      activeAccountId: '1',
      includeKeysInBackup: true,
      gists: [gist('gist-dup', 'first'), gist('gist-dup', 'second')],
    }, 'dataManagementPanel.merge-import');

    const state = useAppStore.getState();
    // 同一备份内重复 ID 仅接受首条；本机已有条目不受影响
    expect(state.gists.filter((g: Gist) => g.id === 'gist-dup')).toHaveLength(1);
    // 审计修复（R13 finding 30）：仅断言数量拦不住「保留第二条」的回归——
    // 两个列表都必须断言保留记录是注释所述的首条（description 为 'first'）
    expect(state.gists.find((g: Gist) => g.id === 'gist-dup')?.description).toBe('first');
    expect(state.gistSearchResults.filter((g: Gist) => g.id === 'gist-dup')).toHaveLength(1);
    expect(state.gistSearchResults.find((g: Gist) => g.id === 'gist-dup')?.description).toBe('first');
  });

  it('aborts import when the session generation changed after the preview opened (same-account credential switch, R12)', async () => {
    const user = userEvent.setup();
    await importBackupFile(user, {
      activeAccountId: '1',
      includeKeysInBackup: true,
      repositories: [repo(9, 'fresh-import')],
    });

    // 同账号更换凭据：会话代次递增但账号 ID 不变——仅核对账号 ID 拦不住
    useAppStore.setState({ savedAccounts: { '1': savedAccount('1', userA, 'ghp_rotated') } });
    expect(useAppStore.getState().switchAccount('1')).toBe(true);

    await user.click(screen.getByRole('button', { name: 'dataManagementPanel.replace-import' }));

    // 审计修复（R14 finding 3）：提示键显式带 settings 命名空间前缀（本组件的
    // t 绑定 app 命名空间且无 fallbackNS），断言随之更新为带前缀键
    expect(await screen.findByText('settings:useBackupActions.account-changed-during-restore')).toBeInTheDocument();
    // 导入被拒绝：实时仓库未被旧预览的替换结果覆盖
    expect(useAppStore.getState().repositories[0].ai_summary).toBe('alice-live');
    expect(useAppStore.getState().repositories.some((r: Repository) => r.id === 9)).toBe(false);
  });

  it('keeps local credentials saved while backup PAT verification was in flight (R12)', async () => {
    // 核对等待期间本机为同账号保存了新 PAT：提交时基于最新 savedAccounts 合并，
    // 本机凭据优先于已验证的备份 PAT
    let resolveVerify: (value: boolean) => void = () => {};
    const fetchMock = vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveVerify = (value: boolean) => resolve({
        ok: value,
        json: async () => ({ id: 3, login: 'carol' }),
      });
    }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const user = userEvent.setup();
      await importBackupFile(user, {
        includeKeysInBackup: true,
        savedAccounts: {
          '3': savedAccount('3', { ...userA, id: 3, login: 'carol' }, 'ghp_carol_backup'),
        },
      });
      const clickPromise = user.click(screen.getByRole('button', { name: 'dataManagementPanel.merge-import' }));

      // 核对挂起期间本机为账号 3 保存新凭据（当前账号仍是 alice，模拟另一入口的保存）
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      useAppStore.setState({
        savedAccounts: {
          ...useAppStore.getState().savedAccounts,
          '3': savedAccount('3', { ...userA, id: 3, login: 'carol' }, 'ghp_carol_local_new'),
        },
      });
      resolveVerify(true);
      await clickPromise;
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

      // 本机在核对期间新增的凭据保留，绝不被核对前的字典快照覆盖
      expect(useAppStore.getState().savedAccounts['3']?.githubToken).toBe('ghp_carol_local_new');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('merges AI/WebDAV configs, categories and asset filters from live state after the PAT check wait (R12 ISSUE-2)', async () => {
    // 等待备份账号 PAT 校验期间，本机新增的四类配置不得被核对前的快照覆盖：
    // merge 提交时必须读取实时 state 再合并（与 finding #8 的仓库/Release 同法）。
    let resolveVerify: (value: boolean) => void = () => {};
    const fetchMock = vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveVerify = (value: boolean) => resolve({
        ok: value,
        json: async () => ({ id: 3, login: 'carol' }),
      });
    }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const user = userEvent.setup();
      await importBackupFile(user, {
        includeKeysInBackup: true,
        savedAccounts: {
          '3': savedAccount('3', { ...userA, id: 3, login: 'carol' }, 'ghp_carol_backup'),
        },
        aiConfigs: [{
          id: 'backup-ai', name: 'Backup AI', baseUrl: 'https://backup.example', apiKey: 'sk-backup', model: 'gpt', isActive: false,
        }],
        webdavConfigs: [{
          id: 'backup-webdav', name: 'Backup WebDAV', url: 'https://dav.example', username: 'u', password: 'p', path: '/', isActive: false,
        }],
        customCategories: [category('backup-cat', 'Backup Category')],
        assetFilters: [{ id: 'backup-filter', name: 'Backup Filter', keywords: ['setup'] }],
      });
      const clickPromise = user.click(screen.getByRole('button', { name: 'dataManagementPanel.merge-import' }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      useAppStore.setState({
        aiConfigs: [...useAppStore.getState().aiConfigs, {
          id: 'local-ai', name: 'Local AI', baseUrl: 'https://local.example', apiKey: 'sk-local', model: 'gpt', isActive: false,
        }],
        webdavConfigs: [...useAppStore.getState().webdavConfigs, {
          id: 'local-webdav', name: 'Local WebDAV', url: 'https://local.example', username: 'u', password: 'p', path: '/', isActive: false,
        }],
        customCategories: [...useAppStore.getState().customCategories, category('local-cat', 'Local Category')],
        assetFilters: [...useAppStore.getState().assetFilters, { id: 'local-filter', name: 'Local Filter', keywords: ['local'] }],
      });
      resolveVerify(true);
      await clickPromise;
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

      const state = useAppStore.getState();
      // 核对期间本机新增项保留，备份项并入
      expect(state.aiConfigs.map(c => c.id)).toEqual(expect.arrayContaining(['local-ai', 'backup-ai']));
      expect(state.webdavConfigs.map(c => c.id)).toEqual(expect.arrayContaining(['local-webdav', 'backup-webdav']));
      expect(state.customCategories.map(c => c.id)).toEqual(expect.arrayContaining(['local-cat', 'backup-cat']));
      expect(state.assetFilters.map(f => f.id)).toEqual(expect.arrayContaining(['local-filter', 'backup-filter']));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reports import failure when the imported credentials cannot be persisted (R12 finding 11)', async () => {
    // gh-accounts.enc 写入失败：导入的已验证 PAT 重启后会丢失——不得报告成功，
    // 已写入内存的数据保留（重新导入可幂等重试）。
    ghAccountSecretsMocks.syncGhAccountTokensFromState.mockResolvedValueOnce(false);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 3, login: 'carol' }),
    }));
    try {
      const user = userEvent.setup();
      await importBackupAndClick(user, {
        includeKeysInBackup: true,
        savedAccounts: {
          '3': savedAccount('3', { ...userA, id: 3, login: 'carol' }, 'ghp_carol_backup'),
        },
      }, 'dataManagementPanel.merge-import');

      expect(await screen.findByText('dataManagementPanel.import-failed-please-try-again')).toBeInTheDocument();
      // 内存中的已验证凭据保留（不因落盘失败回滚），重启前仍可使用
      expect(useAppStore.getState().savedAccounts['3']?.githubToken).toBe('ghp_carol_backup');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('aborts the remaining import writes when the session changes while persisting imported credentials (R12 audit)', async () => {
    // 审计补强：确认导入后等待 gh-accounts.enc 写入期间也可能切号（无界面等待）——
    // 写入完成返回后必须复核会话，绝不再把备份的仓库/工作区写进新会话上下文。
    let resolvePersist: (value: boolean) => void = () => {};
    ghAccountSecretsMocks.syncGhAccountTokensFromState.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => { resolvePersist = resolve; }),
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 3, login: 'carol' }),
    }));
    try {
      const user = userEvent.setup();
      await importBackupFile(user, {
        activeAccountId: '1',
        includeKeysInBackup: true,
        repositories: [repo(77, 'should-not-be-imported')],
        savedAccounts: {
          '3': savedAccount('3', { ...userA, id: 3, login: 'carol' }, 'ghp_carol_backup'),
        },
      });
      const clickPromise = user.click(screen.getByRole('button', { name: 'dataManagementPanel.replace-import' }));
      await waitFor(() => expect(ghAccountSecretsMocks.syncGhAccountTokensFromState).toHaveBeenCalledOnce());

      // 安全存储写入挂起期间同账号换凭据（会话代次递增、账号 ID 不变）
      useAppStore.setState({
        savedAccounts: {
          ...useAppStore.getState().savedAccounts,
          '1': savedAccount('1', userA, 'ghp_rotated'),
        },
      });
      expect(useAppStore.getState().switchAccount('1')).toBe(true);
      resolvePersist(true);
      await clickPromise;

      // 审计修复（R14 finding 3）：同上——提示键显式带 settings 命名空间前缀
      expect(await screen.findByText('settings:useBackupActions.account-changed-during-restore')).toBeInTheDocument();
      // 后续写入（仓库替换）未执行：备份仓库绝不落入新会话
      expect(useAppStore.getState().repositories.some((r: Repository) => r.id === 77)).toBe(false);
      // 实时仓库未被替换
      expect(useAppStore.getState().repositories[0].ai_summary).toBe('alice-live');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
