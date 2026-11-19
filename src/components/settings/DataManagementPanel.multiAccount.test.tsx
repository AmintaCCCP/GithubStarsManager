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
vi.mock('../../services/electronProxy', () => ({
  clearEncryptedXAuthViaDesktop: vi.fn().mockResolvedValue(undefined),
  clearEncryptedGhAccountsViaDesktop: vi.fn().mockResolvedValue(undefined),
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

  it('exports account attribution when only releaseSubscriptions is selected', async () => {
    const user = userEvent.setup();
    const createObjectURLMock = vi.fn<(blob: Blob) => string>(() => 'blob:mock-url');
    const revokeObjectURLMock = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: createObjectURLMock });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revokeObjectURLMock });

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
  });

  it('replace import of a categories-only export restores categories without wiping other accounts', async () => {
    // 往返：仅导出 customCategories → replace 导入，非当前账号的仓库等
    // 未选数据绝不被裁剪备份的空占位清空
    const user = userEvent.setup();
    const createObjectURLMock = vi.fn<(blob: Blob) => string>(() => 'blob:mock-url');
    const revokeObjectURLMock = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: createObjectURLMock });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revokeObjectURLMock });

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
