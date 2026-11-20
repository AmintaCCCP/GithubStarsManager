import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitHubUser } from '../../types';

// 控制桌面端加密保存的成功/失败（v19 迁移落盘），验证 partialize 的
// 「加密保存确认后才提交剥除 PAT 的快照」语义（审计修复：保存失败时保留
// 原快照中的 Token 作为可重试状态，而不是被首次持久化永久清除）。
vi.mock('./ghAccountSecrets', () => ({
  hasGhAccountsBridge: vi.fn(() => true),
  hasPendingGhAccountSecretRemovals: vi.fn(() => false),
  getPendingGhAccountSecretRemovalIds: vi.fn((): string[] => []),
  loadGhAccountTokens: vi.fn(async () => ({ status: 'loaded' as const, tokens: {} })),
  saveGhAccountTokens: vi.fn(async () => undefined),
  syncGhAccountTokensFromState: vi.fn(async () => true),
}));

// setup.ts 全局把 store mock 成 hook 选择器；migrate/partialize 需要真实 store。
vi.mock('../useAppStore', async () => await vi.importActual('../useAppStore'));

const { appPersistenceOptions, __resetV19TokenSaveStateForTest } = await import('./options');
const { saveGhAccountTokens, loadGhAccountTokens, getPendingGhAccountSecretRemovalIds } = await import('./ghAccountSecrets');
const { useAppStore } = await import('../useAppStore');

const mirrorUser: GitHubUser = {
  id: 42,
  login: 'octocat',
  name: 'Octocat',
  avatar_url: 'https://example.com/a.png',
  email: null,
};

const savedAccountsWithToken = (token: string) => ({
  '42': {
    accountId: '42',
    user: mirrorUser,
    githubToken: token,
    addedAt: '2026-01-01T00:00:00.000Z',
    lastUsedAt: '2026-01-01T00:00:00.000Z',
  },
});

/** v18 形状的最小快照：带明文 PAT 的 savedAccounts（migrate 的其余分支按缺失跳过）。 */
const v18Snapshot = () => ({
  savedAccounts: savedAccountsWithToken('ghp_legacy_token'),
} as unknown as Parameters<NonNullable<typeof appPersistenceOptions.migrate>>[0]);

/** 用注入的带 Token savedAccounts 调 partialize，返回持久化结果中的账号条目。 */
const persistSavedAccounts = (token: string): Record<string, { githubToken?: string }> => {
  const persisted = appPersistenceOptions.partialize!(
    { ...useAppStore.getState(), savedAccounts: savedAccountsWithToken(token) } as never,
  ) as { savedAccounts?: Record<string, { githubToken?: string }> };
  return persisted.savedAccounts ?? {};
};

const flushMigrationSave = async (): Promise<void> => {
  // pendingMigrationTokenSave 是模块私有 Promise：用宏任务等待其 then/catch 链结算。
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
};

beforeEach(() => {
  // 每个用例模拟一次全新启动：模块级迁移状态清空、mock 复位。
  __resetV19TokenSaveStateForTest();
  window.localStorage.removeItem('github-stars-manager-auth');
  vi.mocked(saveGhAccountTokens).mockReset().mockResolvedValue(undefined);
  vi.mocked(loadGhAccountTokens).mockReset().mockResolvedValue({ status: 'loaded', tokens: {} });
  vi.mocked(getPendingGhAccountSecretRemovalIds).mockReset().mockReturnValue([]);
  useAppStore.setState({
    user: null,
    githubToken: null,
    isAuthenticated: false,
    savedAccounts: {},
  } as never);
});

describe('v19 token migration persistence contract', () => {
  it('keeps legacy PATs in the persisted snapshot until the encrypted save is confirmed, and records mirror-migrated accounts', async () => {
    // 阶段一：迁移加密保存失败——迁移后的内存态剥除明文（既有语义），但
    // 持久化分片必须保留迁移输入中的旧 PAT（可重试状态）；运行时注入的新 PAT
    // 绝不进入明文分片（第 12 轮审计修复：旧迁移输入与运行时凭据分离）。
    vi.mocked(saveGhAccountTokens).mockRejectedValueOnce(new Error('disk full'));
    const failedMigration = appPersistenceOptions.migrate!(v18Snapshot(), 18) as {
      savedAccounts?: Record<string, { githubToken?: string }>;
    };
    await flushMigrationSave();

    // 迁移后的内存态仍按既有语义剥除（Token 由 onRehydrateStorage 失败分支恢复）。
    expect(failedMigration.savedAccounts?.['42']?.githubToken ?? '').toBe('');
    // ISSUE-1(B)：运行时已有不同的新 PAT 时新值优先——旧迁移输入不得回填，
    // 否则下次启动会用旧 PAT 覆盖刚写入 safeStorage 的新值。
    expect(persistSavedAccounts('ghp_unconfirmed_token')['42']?.githubToken).toBe('');
    // 运行时凭据为空（迁移后内存被剥除、等待失败分支回填）时，分片保留迁移
    // 输入中的旧 PAT（'ghp_legacy_token'）作为跨重启重试输入。
    expect(persistSavedAccounts('')['42']?.githubToken).toBe('ghp_legacy_token');

    // 阶段二（重启重试）：把阶段一分片中的旧 PAT 装回 store，驱动真实的水化
    // 收尾回调（迁移失败分支 → restore → 迁移重试），保存恢复后确认置位。
    vi.mocked(saveGhAccountTokens).mockClear();
    vi.mocked(saveGhAccountTokens).mockResolvedValue(undefined);
    useAppStore.setState({
      savedAccounts: savedAccountsWithToken('ghp_legacy_token'),
      user: mirrorUser,
      githubToken: 'ghp_legacy_token',
    } as never);
    const hydrateCallback = appPersistenceOptions.onRehydrateStorage!(
      useAppStore.getState() as never,
    ) as (state?: unknown, error?: unknown) => void;
    hydrateCallback(undefined, null);
    await flushMigrationSave();
    // 迁移重试把分片中保留的旧 PAT 重新迁入 safeStorage（原 PAT 可取得）。
    expect(vi.mocked(saveGhAccountTokens)).toHaveBeenLastCalledWith({ '42': 'ghp_legacy_token' });
    // 确认后恢复 B7 剥除语义：持久化分片不含任何明文 PAT。
    expect(persistSavedAccounts('ghp_confirmed_token')['42']?.githubToken).toBe('');

    // 阶段三：确认态下的后续迁移（新启动）——分片照常剥除，不回退确认门控。
    vi.mocked(saveGhAccountTokens).mockResolvedValueOnce(undefined);
    appPersistenceOptions.migrate!(v18Snapshot(), 18);
    await flushMigrationSave();
    expect(persistSavedAccounts('ghp_confirmed_token')['42']?.githubToken).toBe('');
  });

  it('creates a savedAccounts entry for mirror-migrated credentials so switchAccount can select the account', () => {
    // 旧认证镜像带明文 PAT，而 v18 快照缺 savedAccounts 条目：迁移必须用镜像
    // user 补录账号记录（否则归一化后 savedAccounts 为空，账号不可切换）。
    window.localStorage.setItem(
      'github-stars-manager-auth',
      JSON.stringify({ user: mirrorUser, githubToken: 'ghp_mirror_token', backendApiSecret: null }),
    );
    try {
      vi.mocked(saveGhAccountTokens).mockClear();
      vi.mocked(saveGhAccountTokens).mockResolvedValueOnce(undefined);
      const migrated = appPersistenceOptions.migrate!({ user: null } as unknown as Parameters<NonNullable<typeof appPersistenceOptions.migrate>>[0], 18) as {
        savedAccounts?: Record<string, { accountId?: string; user?: GitHubUser; githubToken?: string }>;
      };
      // 身份敏感断言：加密存储必须收到镜像中账号 '42' 的明文 PAT——迁移没有
      // 把 PAT 交给 saveGhAccountTokens 时凭据会直接丢失。
      expect(vi.mocked(saveGhAccountTokens)).toHaveBeenLastCalledWith({ '42': 'ghp_mirror_token' });
      const entry = migrated.savedAccounts?.['42'];
      expect(entry).toBeDefined();
      expect(entry?.accountId).toBe('42');
      expect(entry?.user?.login).toBe('octocat');
      // 迁移后的内存态剥除明文 PAT（凭据由 safeStorage/安全存储回填）。
      expect(entry?.githubToken ?? '').toBe('');
    } finally {
      window.localStorage.removeItem('github-stars-manager-auth');
    }
  });
});

/**
 * 第 12 轮审计 ISSUE-1 回归：迁移输入的按账号失效 + 跨重启重试 + 镜像迁移
 * 不越权确认。每个用例用 __resetV19TokenSaveStateForTest 模拟一次全新启动。
 */
describe('v19 migration cross-restart lifecycle (ISSUE-1)', () => {
  type PersistedShard = { user?: GitHubUser | null; savedAccounts?: Record<string, unknown> };

  const persistFromState = (token: string): Record<string, { githubToken?: string }> => {
    const persisted = appPersistenceOptions.partialize!(
      { ...useAppStore.getState(), savedAccounts: savedAccountsWithToken(token) } as never,
    ) as { savedAccounts?: Record<string, { githubToken?: string }> };
    return persisted.savedAccounts ?? {};
  };

  const persistCurrentState = (): Record<string, { githubToken?: string }> => {
    const persisted = appPersistenceOptions.partialize!(
      { ...useAppStore.getState() } as never,
    ) as { savedAccounts?: Record<string, { githubToken?: string }> };
    return persisted.savedAccounts ?? {};
  };

  const mergePersisted = (persisted: PersistedShard): void => {
    const merged = appPersistenceOptions.merge!(
      persisted as never,
      useAppStore.getState() as never,
    );
    useAppStore.setState(merged as never);
  };

  const hydrate = (): void => {
    const callback = appPersistenceOptions.onRehydrateStorage!(
      useAppStore.getState() as never,
    ) as (state?: unknown, error?: unknown) => void;
    callback(undefined, null);
  };

  it('A: 跨两次启动保存失败后分片仍保留旧 PAT，第三次启动仍可重试并最终迁移', async () => {
    // 第一次启动：v18 → v19 迁移保存失败，分片保留旧 PAT。
    vi.mocked(saveGhAccountTokens).mockRejectedValueOnce(new Error('disk full'));
    appPersistenceOptions.migrate!(v18Snapshot(), 18);
    await flushMigrationSave();
    expect(persistFromState('')['42']?.githubToken).toBe('ghp_legacy_token');

    // 第二次启动：version 已为 19，migrate 不再运行；分片仍带旧 PAT。
    __resetV19TokenSaveStateForTest();
    useAppStore.setState({ user: null, githubToken: null, isAuthenticated: false, savedAccounts: {} } as never);
    mergePersisted({ user: null, savedAccounts: savedAccountsWithToken('ghp_legacy_token') });
    vi.mocked(saveGhAccountTokens).mockClear();
    vi.mocked(saveGhAccountTokens).mockRejectedValue(new Error('still down'));
    hydrate();
    await flushMigrationSave();
    // 第二次启动重试仍失败：分片必须继续保留旧 PAT（第三次启动的重试输入），
    // 不能被水化收尾的首次持久化剥除。
    expect(persistFromState('ghp_legacy_token')['42']?.githubToken).toBe('ghp_legacy_token');

    // 第三次启动：分片仍带旧 PAT，安全存储恢复后重试成功。
    __resetV19TokenSaveStateForTest();
    useAppStore.setState({ user: null, githubToken: null, isAuthenticated: false, savedAccounts: {} } as never);
    mergePersisted({ user: null, savedAccounts: savedAccountsWithToken('ghp_legacy_token') });
    vi.mocked(saveGhAccountTokens).mockClear();
    vi.mocked(saveGhAccountTokens).mockResolvedValue(undefined);
    hydrate();
    await flushMigrationSave();
    expect(vi.mocked(saveGhAccountTokens)).toHaveBeenCalledWith({ '42': 'ghp_legacy_token' });
    // 确认后恢复 B7 剥除语义。
    expect(persistFromState('ghp_legacy_token')['42']?.githubToken).toBe('');
  });

  it('B: 未确认态重新授权后分片不回填旧 PAT，启动重试使用新 PAT', async () => {
    vi.mocked(saveGhAccountTokens).mockRejectedValueOnce(new Error('disk full'));
    appPersistenceOptions.migrate!(v18Snapshot(), 18);
    await flushMigrationSave();

    // 同会话重新授权：运行时出现新 PAT，旧迁移输入不得覆盖分片值。
    expect(persistFromState('ghp_new_token')['42']?.githubToken).toBe('');

    useAppStore.setState({
      user: mirrorUser,
      githubToken: 'ghp_new_token',
      isAuthenticated: true,
      savedAccounts: savedAccountsWithToken('ghp_new_token'),
    } as never);
    vi.mocked(saveGhAccountTokens).mockClear();
    vi.mocked(saveGhAccountTokens).mockResolvedValue(undefined);
    hydrate();
    await flushMigrationSave();
    // 启动重试只写新 PAT；旧 PAT 已被新值取代，绝不再回写覆盖。
    expect(vi.mocked(saveGhAccountTokens)).toHaveBeenLastCalledWith({ '42': 'ghp_new_token' });
    expect(vi.mocked(saveGhAccountTokens)).not.toHaveBeenCalledWith({ '42': 'ghp_legacy_token' });
    expect(persistFromState('ghp_new_token')['42']?.githubToken).toBe('');
  });

  it('C: 未确认态登出后分片不再含该账号 PAT，重启后无法一键恢复', async () => {
    vi.mocked(saveGhAccountTokens).mockRejectedValueOnce(new Error('disk full'));
    appPersistenceOptions.migrate!(v18Snapshot(), 18);
    await flushMigrationSave();

    useAppStore.setState({
      user: mirrorUser,
      githubToken: 'ghp_legacy_token',
      isAuthenticated: true,
      savedAccounts: savedAccountsWithToken('ghp_legacy_token'),
    } as never);
    expect(useAppStore.getState().logout()).toBe(true);
    // 登出即让迁移输入失效：分片保留账号元数据但 Token 为空。
    expect(persistCurrentState()['42']?.githubToken ?? '').toBe('');

    // ISSUE-1(C) 跨重启兜底：即使分片写入是陈旧的（仍带旧 PAT）且设备删除
    // 尚未完成（待删标记存在），merge 也不得把旧 PAT 装回运行时或迁移输入。
    vi.mocked(getPendingGhAccountSecretRemovalIds).mockReturnValue(['42']);
    useAppStore.setState({ user: null, githubToken: null, isAuthenticated: false, savedAccounts: {} } as never);
    mergePersisted({ user: null, savedAccounts: savedAccountsWithToken('ghp_legacy_token') });
    expect(useAppStore.getState().savedAccounts['42']?.githubToken ?? '').toBe('');
    expect(persistCurrentState()['42']?.githubToken ?? '').toBe('');
    vi.mocked(getPendingGhAccountSecretRemovalIds).mockReturnValue([]);

    // 模拟重启：分片无 PAT ⇒ 迁移输入为空，重试不会再把旧 PAT 写回。
    __resetV19TokenSaveStateForTest();
    useAppStore.setState({ user: null, githubToken: null, isAuthenticated: false, savedAccounts: {} } as never);
    mergePersisted({ user: null, savedAccounts: persistCurrentState() });
    vi.mocked(saveGhAccountTokens).mockClear();
    vi.mocked(saveGhAccountTokens).mockResolvedValue(undefined);
    hydrate();
    await flushMigrationSave();
    expect(vi.mocked(saveGhAccountTokens)).not.toHaveBeenCalledWith({ '42': 'ghp_legacy_token' });
  });

  it('D: 多账号快照迁移失败 + 单账号镜像迁移成功时保留其他账号的迁移输入', async () => {
    const mirrorAccountUser: GitHubUser = { ...mirrorUser, id: 43, login: 'mirror-user' };
    const secondUser: GitHubUser = { ...mirrorUser, id: 44, login: 'second-user' };
    window.localStorage.setItem(
      'github-stars-manager-auth',
      JSON.stringify({ user: mirrorAccountUser, githubToken: 'ghp_mirror_token', backendApiSecret: null }),
    );
    try {
      // 快照迁移（42/44/43 多账号）失败；镜像迁移（仅 43）成功。
      vi.mocked(saveGhAccountTokens).mockImplementation(async (tokens: Record<string, string>) => {
        const ids = Object.keys(tokens);
        if (ids.length === 1 && ids[0] === '43') return;
        throw new Error('multi-account save failed');
      });
      const migrated = appPersistenceOptions.migrate!({
        user: null,
        savedAccounts: {
          ...savedAccountsWithToken('ghp_token_a'),
          '44': {
            accountId: '44',
            user: secondUser,
            githubToken: 'ghp_token_c',
            addedAt: '2026-01-01T00:00:00.000Z',
            lastUsedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      } as never, 18);
      await flushMigrationSave();

      useAppStore.setState({ user: null, githubToken: null, isAuthenticated: false, savedAccounts: {} } as never);
      mergePersisted(migrated as PersistedShard);
      vi.mocked(saveGhAccountTokens).mockClear();
      hydrate();
      await flushMigrationSave();

      // 镜像账号 43 已成功落盘并退出迁移输入；42/44 的重试输入必须保留。
      expect(vi.mocked(saveGhAccountTokens)).toHaveBeenCalledWith({ '43': 'ghp_mirror_token' });
      const shard = persistCurrentState();
      expect(shard['43']?.githubToken ?? '').toBe('');
      expect(shard['42']?.githubToken).toBe('ghp_token_a');
      expect(shard['44']?.githubToken).toBe('ghp_token_c');
    } finally {
      window.localStorage.removeItem('github-stars-manager-auth');
    }
  });
});
