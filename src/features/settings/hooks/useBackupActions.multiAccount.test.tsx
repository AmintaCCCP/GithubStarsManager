import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBackupActions } from './useBackupActions';
import { useAppStore } from '../../../store/useAppStore';
import type { AccountWorkspace, Category, Repository, SavedAccount } from '../../../types';

// 恢复真实 Store：全局 setup.ts 将 ../store/useAppStore mock 成了选择器桩，
// 而多账号备份/恢复测试需要驱动真实的工作区与账号状态。
vi.mock('../../../store/useAppStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../store/useAppStore')>();
  return actual;
});

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  confirm: vi.fn(),
  uploadFile: vi.fn(),
  listFiles: vi.fn(),
  downloadFile: vi.fn(),
  getCurrentUser: vi.fn(),
  hasGhAccountsBridge: vi.fn(() => false),
  syncGhAccountTokensFromState: vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => true),
}));

vi.mock('../../../hooks/useDialog', () => ({
  useDialog: () => ({ toast: mocks.toast, confirm: mocks.confirm }),
}));

vi.mock('../../../services/webdavService', () => ({
  WebDAVService: class {
    uploadFile = mocks.uploadFile;
    listFiles = mocks.listFiles;
    downloadFile = mocks.downloadFile;
    constructor() { /* active config is provided by the store */ }
  },
}));

vi.mock('../../../services/githubApiFactory', () => ({
  createGitHubApiService: () => ({
    getCurrentUser: mocks.getCurrentUser,
  }),
}));

vi.mock('../../../store/persistence/ghAccountSecrets', () => ({
  hasGhAccountsBridge: () => mocks.hasGhAccountsBridge(),
  syncGhAccountTokensFromState: (...args: unknown[]) => mocks.syncGhAccountTokensFromState(...args),
}));

const userA = { id: 1, login: 'alice', name: 'Alice', avatar_url: 'https://x/a.png', email: null };
const userB = { id: 2, login: 'bob', name: 'Bob', avatar_url: 'https://x/b.png', email: null };

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
});

const savedAccount = (id: string, user: typeof userA, token: string): SavedAccount => ({
  accountId: id,
  user,
  githubToken: token,
  addedAt: '2026-01-01T00:00:00.000Z',
  lastUsedAt: '2026-01-01T00:00:00.000Z',
});

const category = (id: string, name: string): Category => ({
  id,
  name,
  icon: 'folder',
  keywords: [],
  isCustom: true,
});

const activeWebDAV = {
  id: 'dav-1',
  name: 'Test',
  url: 'https://dav.example',
  username: 'user',
  password: 'pass',
  path: '/',
  isActive: true,
};

const initialStoreState = useAppStore.getInitialState();

const setupStore = (): void => {
  // 每个用例先重置真实 Store，确保订阅/已读/分类等字段不会跨用例残留
  useAppStore.setState(initialStoreState, true);
  useAppStore.setState({
    user: userA,
    githubToken: 'ghp_a',
    isAuthenticated: true,
    savedAccounts: {
      '1': savedAccount('1', userA, 'ghp_a'),
      '2': savedAccount('2', userB, 'ghp_b'),
    },
    accountWorkspaces: {
      '2': workspaceOf([repo(2, 'bob-ai')]),
    },
    repositories: [repo(1, 'alice-ai')],
    searchResults: [repo(1, 'alice-ai')],
    gists: [],
    starredGists: [],
    forks: [],
    readForks: new Set<number>(),
    webdavConfigs: [activeWebDAV],
    activeWebDAVConfig: 'dav-1',
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.confirm.mockResolvedValue(true);
  mocks.uploadFile.mockResolvedValue(true);
  mocks.getCurrentUser.mockResolvedValue(userB);
  mocks.hasGhAccountsBridge.mockReturnValue(false);
  mocks.syncGhAccountTokensFromState.mockResolvedValue(true);
  setupStore();
});

describe('useBackupActions multi-account (Issue #611)', () => {
  it('backs up v1.3 with full workspaces and masked tokens when keys are excluded', async () => {
    useAppStore.setState({ includeKeysInBackup: false });
    const { result } = renderHook(() => useBackupActions());

    await act(async () => {
      await result.current.backup();
    });

    expect(mocks.uploadFile).toHaveBeenCalledOnce();
    const payload = JSON.parse(mocks.uploadFile.mock.calls[0][1] as string);
    expect(payload.version).toBe('1.3');
    expect(payload.activeAccountId).toBe('1');
    // 当前账号实时状态合并进工作区字典
    expect(payload.accountWorkspaces['1'].repositories[0].ai_summary).toBe('alice-ai');
    expect(payload.accountWorkspaces['2'].repositories[0].ai_summary).toBe('bob-ai');
    // 未包含密钥时 Token 一律脱敏
    expect(payload.savedAccounts['1'].githubToken).toBe('***');
    expect(payload.savedAccounts['2'].githubToken).toBe('***');
    expect(JSON.stringify(payload)).not.toContain('ghp_');
  });

  it('backs up plaintext tokens when keys are included', async () => {
    useAppStore.setState({ includeKeysInBackup: true });
    const { result } = renderHook(() => useBackupActions());

    await act(async () => {
      await result.current.backup();
    });

    const payload = JSON.parse(mocks.uploadFile.mock.calls[0][1] as string);
    expect(payload.savedAccounts['1'].githubToken).toBe('ghp_a');
    expect(payload.savedAccounts['2'].githubToken).toBe('ghp_b');
  });

  it('restores workspaces and accounts without clobbering local tokens from masked backups', async () => {
    mocks.listFiles.mockResolvedValue(['github-stars-backup-2026-01-01.json']);
    mocks.downloadFile.mockResolvedValue(JSON.stringify({
      version: '1.3',
      includeKeysInBackup: false,
      activeAccountId: '1',
      accountWorkspaces: {
        '2': workspaceOf([repo(2, 'bob-restored')]),
      },
      savedAccounts: {
        '1': savedAccount('1', userA, '***'),
        '2': savedAccount('2', userB, '***'),
      },
      repositories: [repo(1, 'alice-from-backup')],
      releases: [],
      customCategories: [],
    }));

    // 预置仅存在于本机的账号 3 工作区，验证合并保留而非直接替换本机字典
    useAppStore.setState((current) => ({
      accountWorkspaces: {
        ...current.accountWorkspaces,
        '3': workspaceOf([repo(3, 'local-only-charlie')]),
      },
    }));

    const { result } = renderHook(() => useBackupActions());
    await act(async () => {
      await result.current.restore();
    });

    const state = useAppStore.getState();
    // 工作区恢复：备份内容优先，本机独有的其他账号快照保留
    expect(state.accountWorkspaces['2']?.repositories[0].ai_summary).toBe('bob-restored');
    expect(state.accountWorkspaces['3']?.repositories[0].ai_summary).toBe('local-only-charlie');
    // 当前账号按备份内容恢复到顶层并同步工作区快照
    expect(state.accountWorkspaces['1']?.repositories[0].ai_summary).toBe('alice-from-backup');
    // 掩码 Token 不覆盖本机有效 Token
    expect(state.savedAccounts['1']?.githubToken).toBe('ghp_a');
    expect(state.savedAccounts['2']?.githubToken).toBe('ghp_b');
    // 同账号恢复：备份内容按确认对话框语义覆盖当前顶层
    expect(state.repositories[0].ai_summary).toBe('alice-from-backup');
  });

  it('archives top-level backup data into the backup account when restoring across accounts', async () => {
    useAppStore.setState({ savedAccounts: { '1': savedAccount('1', userA, 'ghp_a') } });
    mocks.listFiles.mockResolvedValue(['github-stars-backup-2026-01-01.json']);
    mocks.downloadFile.mockResolvedValue(JSON.stringify({
      version: '1.3',
      includeKeysInBackup: true,
      activeAccountId: '2',
      accountWorkspaces: {
        '1': workspaceOf([repo(1, 'alice-backup')]),
      },
      savedAccounts: {
        '2': savedAccount('2', userB, 'ghp_b_backup'),
      },
      repositories: [repo(2, 'bob-top-level')],
      releases: [],
      customCategories: [],
    }));

    const { result } = renderHook(() => useBackupActions());
    await act(async () => {
      await result.current.restore();
    });

    const state = useAppStore.getState();
    // 备份顶层（bob 的数据）归档进账号 2 工作区
    expect(state.accountWorkspaces['2']?.repositories[0].ai_summary).toBe('bob-top-level');
    // 备份中的 alice 工作区应用到当前顶层
    expect(state.repositories[0].ai_summary).toBe('alice-backup');
    // 登录态不被改变
    expect(state.user?.login).toBe('alice');
    expect(state.isAuthenticated).toBe(true);
  });

  it('parses account ids only from new-format names and recommends by actual backup time (R12 findings 11/23)', async () => {
    // 当前账号 16：旧格式 `...-2026-11-16.json` 不能被当成账号 16 的备份
    useAppStore.setState({
      user: { ...userA, id: 16, login: 'pam' },
      isAuthenticated: true,
      savedAccounts: { '16': savedAccount('16', { ...userA, id: 16, login: 'pam' }, 'ghp_p') },
    });
    mocks.listFiles.mockResolvedValueOnce([
      'github-stars-backup-2026-11-16.json',
      'github-stars-backup-2026-11-20T10-00-00-000Z-2.json',
    ]);
    const { result } = renderHook(() => useBackupActions());
    const listed = await result.current.listBackups();
    // 无账号匹配：按实际时间推荐较新的 11-20 备份，而不是旧的 `-16.json`
    expect(listed.recommended).toBe('github-stars-backup-2026-11-20T10-00-00-000Z-2.json');

    // 同日：新版早晨备份 vs 旧版（时间未知 → 当日结束）→ 旧版视为更晚
    mocks.listFiles.mockResolvedValueOnce([
      'github-stars-backup-2026-11-16T08-00-00-000Z-2.json',
      'github-stars-backup-2026-11-16.json',
    ]);
    const listedSameDay = await result.current.listBackups();
    expect(listedSameDay.recommended).toBe('github-stars-backup-2026-11-16.json');
  });

  it('rejects gist entries whose file values are null (R12 finding 25)', async () => {
    mocks.listFiles.mockResolvedValue(['github-stars-backup-2026-01-01.json']);
    mocks.downloadFile.mockResolvedValue(JSON.stringify({
      version: '1.3',
      includeKeysInBackup: false,
      activeAccountId: '1',
      repositories: [],
      releases: [],
      customCategories: [],
      gists: [{ id: 'g1', files: { 'README.md': null } }],
    }));

    const { result } = renderHook(() => useBackupActions());
    await act(async () => {
      await result.current.restore();
    });

    // 无效 Gist 字段被拒绝并警示（不写入实时状态）
    expect(useAppStore.getState().gists).toEqual([]);
    expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('Gist'), 'warning');
  });

  it('warns about rejected gist payloads when restoring another account archive (R12 finding 22)', async () => {
    mocks.listFiles.mockResolvedValue(['github-stars-backup-2026-01-01.json']);
    mocks.downloadFile.mockResolvedValue(JSON.stringify({
      version: '1.3',
      includeKeysInBackup: false,
      activeAccountId: '2',
      repositories: [repo(2, 'bob-top-level')],
      releases: [],
      customCategories: [],
      gists: [null],
    }));

    const { result } = renderHook(() => useBackupActions());
    await act(async () => {
      await result.current.restore();
    });

    // 跨账号归档：无效顶层 Gist 字段同样在结果提示中警示
    expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('Gist'), 'warning');
  });

  it('keeps a still-available default category selected when restoring an empty custom category list (R12 finding 24)', async () => {
    useAppStore.setState({ selectedCategory: 'ai' });
    mocks.listFiles.mockResolvedValue(['github-stars-backup-2026-01-01.json']);
    mocks.downloadFile.mockResolvedValue(JSON.stringify({
      version: '1.3',
      includeKeysInBackup: false,
      activeAccountId: '1',
      repositories: [repo(1, 'alice-restored')],
      releases: [],
      customCategories: [],
    }));

    const { result } = renderHook(() => useBackupActions());
    await act(async () => {
      await result.current.restore();
    });

    // 默认分类 ai 仍然可用（未隐藏）→ 选择保持不变，不重置为 all
    expect(useAppStore.getState().selectedCategory).toBe('ai');
  });

  it('keeps other parked workspaces intact when restoring a legacy 1.2 backup', async () => {
    mocks.listFiles.mockResolvedValue(['github-stars-backup-2026-01-01.json']);
    mocks.downloadFile.mockResolvedValue(JSON.stringify({
      version: '1.2',
      includeKeysInBackup: false,
      repositories: [repo(1, 'alice-legacy')],
      releases: [],
      customCategories: [],
    }));

    const { result } = renderHook(() => useBackupActions());
    await act(async () => {
      await result.current.restore();
    });

    const state = useAppStore.getState();
    // 旧版单账号备份恢复到当前顶层
    expect(state.repositories[0].ai_summary).toBe('alice-legacy');
    // 当前账号工作区快照被同步更新
    expect(state.accountWorkspaces['1']?.repositories[0].ai_summary).toBe('alice-legacy');
    // 其他账号快照原样保留
    expect(state.accountWorkspaces['2']?.repositories[0].ai_summary).toBe('bob-ai');
  });

  it('aborts the restore when the account switches during the confirm dialog', async () => {
    const stateBefore = useAppStore.getState();
    mocks.confirm.mockImplementation(async () => {
      // 确认等待期间切换到账号 2
      useAppStore.setState({ user: userB });
      return true;
    });
    mocks.listFiles.mockResolvedValue(['github-stars-backup-2026-01-01.json']);
    mocks.downloadFile.mockResolvedValue(JSON.stringify({
      version: '1.2',
      repositories: [repo(2, 'bob-legacy-should-not-apply')],
      releases: [],
      customCategories: [],
    }));

    const { result } = renderHook(() => useBackupActions());
    await act(async () => {
      await result.current.restore();
    });

    const state = useAppStore.getState();
    // 恢复被中止：未发生任何 WebDAV 读取或 Store 写入
    expect(mocks.listFiles).not.toHaveBeenCalled();
    expect(mocks.downloadFile).not.toHaveBeenCalled();
    expect(state.repositories).toEqual(stateBefore.repositories);
    expect(state.accountWorkspaces['2']?.repositories[0].ai_summary).toBe('bob-ai');
    // 错误提示（i18n 键随 useBackupActions.account-changed-during-restore 合入）
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.stringContaining('account changed during restore'),
      'error',
    );
  });

  it('aborts the restore after a real A→B→A switch during download (legacy backup included)', async () => {
    // 审计修复（C48）：下载等待期间用真实 switchAccount 执行 A→B→A（推进实际
    // 会话代次，识别「切出又切回」），不再仅 setState 改 user——验证旧备份不
    // 覆盖重新激活的 A 的工作区。
    mocks.listFiles.mockResolvedValue(['github-stars-backup-2026-01-01.json']);
    mocks.downloadFile.mockImplementation(async () => {
      expect(useAppStore.getState().switchAccount('2')).toBe(true);
      expect(useAppStore.getState().switchAccount('1')).toBe(true);
      return JSON.stringify({
        version: '1.2',
        repositories: [repo(2, 'bob-legacy-should-not-apply')],
        releases: [],
        customCategories: [],
      });
    });

    const { result } = renderHook(() => useBackupActions());
    await act(async () => {
      await result.current.restore();
    });

    const state = useAppStore.getState();
    // 下载完成后、任何写入前中止：重新激活的 A 工作区与 Token 均未被改写
    expect(mocks.downloadFile).toHaveBeenCalledOnce();
    expect(state.user?.id).toBe(1);
    expect(state.repositories[0].ai_summary).toBe('alice-ai');
    expect(state.savedAccounts['1']?.githubToken).toBe('ghp_a');
    // 其他账号快照保留
    expect(state.accountWorkspaces['2']?.repositories[0].ai_summary).toBe('bob-ai');
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.stringContaining('account changed during restore'),
      'error',
    );
  });

  it('does not pollute the restorer top-level subscriptions, read state or categories when restoring across accounts', async () => {
    useAppStore.setState({
      customCategories: [category('cat-alice', 'Alice Cat')],
      hiddenDefaultCategoryIds: ['default-hidden-by-alice'],
      releaseSubscriptions: new Set([111]),
      readReleases: new Set([222]),
    });
    const releaseSourceBefore = useAppStore.getState().releaseSourceSettings;
    mocks.listFiles.mockResolvedValue(['github-stars-backup-2026-01-01.json']);
    mocks.downloadFile.mockResolvedValue(JSON.stringify({
      version: '1.3',
      includeKeysInBackup: true,
      activeAccountId: '2',
      accountWorkspaces: {
        '2': workspaceOf([repo(2, 'bob-backup')]),
      },
      repositories: [repo(2, 'bob-top-level')],
      releases: [],
      customCategories: [category('cat-bob', 'Bob Cat')],
      hiddenDefaultCategoryIds: ['default-hidden-by-bob'],
      releaseSubscriptions: [999],
      readReleases: [888],
    }));

    const { result } = renderHook(() => useBackupActions());
    await act(async () => {
      await result.current.restore();
    });

    const state = useAppStore.getState();
    // 备份顶层（bob 的数据）归档进账号 2 工作区
    expect(state.accountWorkspaces['2']?.repositories[0].ai_summary).toBe('bob-top-level');
    expect(state.accountWorkspaces['2']?.customCategories[0].id).toBe('cat-bob');
    // 恢复者（alice）的顶层订阅/已读/分类完全不被备份顶层数据污染
    expect(state.releaseSubscriptions).toEqual(new Set([111]));
    expect(state.readReleases).toEqual(new Set([222]));
    expect(state.releaseSourceSettings).toBe(releaseSourceBefore);
    expect(state.customCategories.map((c: Category) => c.id)).toEqual(['cat-alice']);
    expect(state.hiddenDefaultCategoryIds).toEqual(['default-hidden-by-alice']);
  });

  it('keeps live data when a cross-account backup lacks the current account workspace', async () => {
    // 本机存有账号 1 的旧快照（仅 a1），实时数据已新增 a2
    useAppStore.setState({
      accountWorkspaces: {
        '1': workspaceOf([repo(1, 'stale-alice')]),
        '2': workspaceOf([repo(2, 'bob-ai')]),
      },
      repositories: [repo(1, 'alice-live-1'), repo(3, 'alice-live-2')],
    });
    mocks.listFiles.mockResolvedValue(['github-stars-backup-2026-01-01.json']);
    mocks.downloadFile.mockResolvedValue(JSON.stringify({
      version: '1.3',
      includeKeysInBackup: true,
      activeAccountId: '2',
      accountWorkspaces: {
        '2': workspaceOf([repo(2, 'bob-backup')]),
      },
      repositories: [repo(2, 'bob-top-level')],
      releases: [],
      customCategories: [],
    }));

    const { result } = renderHook(() => useBackupActions());
    await act(async () => {
      await result.current.restore();
    });

    const state = useAppStore.getState();
    // 备份不含当前账号工作区：实时状态保留，绝不用本机旧快照回滚
    expect(state.repositories.map((r: Repository) => r.ai_summary))
      .toEqual(['alice-live-1', 'alice-live-2']);
    expect(state.accountWorkspaces['1']?.repositories[0].ai_summary).toBe('stale-alice');
    // 备份账号数据正常归档
    expect(state.accountWorkspaces['2']?.repositories[0].ai_summary).toBe('bob-top-level');
  });

  it('applies the full workspace on same-account restore (categoryOrder, overrides, gist tab, lastSync, syncMode)', async () => {
    mocks.listFiles.mockResolvedValue(['github-stars-backup-2026-01-01.json']);
    mocks.downloadFile.mockResolvedValue(JSON.stringify({
      version: '1.3',
      includeKeysInBackup: true,
      activeAccountId: '1',
      accountWorkspaces: {
        '1': {
          ...workspaceOf([repo(1, 'alice-restored')]),
          categoryOrder: ['cat-x'],
          defaultCategoryOverrides: { 'cat-x': { name: 'Override X' } },
          selectedGistCategory: 'mine',
          lastSync: '2026-04-01T00:00:00.000Z',
          syncMode: 'stars-and-lists',
          syncModeConfigured: true,
        },
      },
      repositories: [repo(1, 'alice-restored')],
      releases: [],
      customCategories: [],
    }));

    const { result } = renderHook(() => useBackupActions());
    await act(async () => {
      await result.current.restore();
    });

    const state = useAppStore.getState();
    // 完整工作区字段全部还原为备份值
    expect(state.categoryOrder).toEqual(['cat-x']);
    expect(state.defaultCategoryOverrides['cat-x']?.name).toBe('Override X');
    expect(state.selectedGistCategory).toBe('mine');
    expect(state.lastSync).toBe('2026-04-01T00:00:00.000Z');
    expect(state.syncMode).toBe('stars-and-lists');
    expect(state.syncModeConfigured).toBe(true);
    expect(state.repositories[0].ai_summary).toBe('alice-restored');
    // 恢复后快照以恢复完成的实时状态为准
    expect(state.accountWorkspaces['1']?.categoryOrder).toEqual(['cat-x']);
    expect(state.accountWorkspaces['1']?.lastSync).toBe('2026-04-01T00:00:00.000Z');
  });
});
