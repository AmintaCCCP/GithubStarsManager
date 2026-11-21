import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitHubUser } from '../../types';

// 控制桌面端加密保存的成功/失败（v19 迁移落盘），验证 partialize 的
// 「加密保存确认后才提交剥除 PAT 的快照」语义（审计修复：保存失败时保留
// 原快照中的 Token 作为可重试状态，而不是被首次持久化永久清除）。
// 第 13 轮审计修复：迁移保存改走补写语义（fillMissingGhAccountTokens），
// mock 默认按「全部补写成功」返回 settled 映射。
vi.mock('./ghAccountSecrets', () => ({
  hasGhAccountsBridge: vi.fn(() => true),
  hasPendingGhAccountSecretRemovals: vi.fn(() => false),
  getPendingGhAccountSecretRemovalIds: vi.fn((): string[] => []),
  loadGhAccountTokens: vi.fn(async () => ({ status: 'loaded' as const, tokens: {} })),
  saveGhAccountTokens: vi.fn(async () => undefined),
  fillMissingGhAccountTokens: vi.fn(async (tokens: Record<string, string>) => ({ ...tokens })),
  syncGhAccountTokensFromState: vi.fn(async () => true),
}));

// setup.ts 全局把 store mock 成 hook 选择器；migrate/partialize 需要真实 store。
vi.mock('../useAppStore', async () => await vi.importActual('../useAppStore'));

const { appPersistenceOptions, __resetV19TokenSaveStateForTest } = await import('./options');
const { saveGhAccountTokens, loadGhAccountTokens, getPendingGhAccountSecretRemovalIds, fillMissingGhAccountTokens } = await import('./ghAccountSecrets');
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
  vi.mocked(fillMissingGhAccountTokens).mockReset().mockImplementation(async (tokens: Record<string, string>) => ({ ...tokens }));
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
    vi.mocked(fillMissingGhAccountTokens).mockRejectedValueOnce(new Error('disk full'));
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
    // 阶段一的迁移保存已调用过补写 mock：清空调用记录，让下方断言只反映重试。
    vi.mocked(fillMissingGhAccountTokens).mockClear();
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
    // 第 14 轮审计修复：重试对旧迁移输入走补写语义（fillMissingGhAccountTokens），
    // 只有重新授权的运行时 PAT 才走覆盖写入。
    expect(vi.mocked(fillMissingGhAccountTokens)).toHaveBeenLastCalledWith({ '42': 'ghp_legacy_token' });
    // 确认后恢复 B7 剥除语义：持久化分片不含任何明文 PAT。运行时 PAT 传空串
    // 使断言可区分「确认后剥除」与「未确认时回填迁移输入」（第 14 轮 [28]）。
    expect(persistSavedAccounts('')['42']?.githubToken).toBe('');

    // 阶段三：确认态下的后续迁移（新启动）——分片照常剥除，不回退确认门控。
    vi.mocked(saveGhAccountTokens).mockResolvedValueOnce(undefined);
    appPersistenceOptions.migrate!(v18Snapshot(), 18);
    await flushMigrationSave();
    expect(persistSavedAccounts('')['42']?.githubToken).toBe('');
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
      // 把 PAT 交给补写保存时凭据会直接丢失（第 13 轮起迁移走补写语义）。
      expect(vi.mocked(fillMissingGhAccountTokens)).toHaveBeenLastCalledWith({ '42': 'ghp_mirror_token' });
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
    vi.mocked(fillMissingGhAccountTokens).mockRejectedValueOnce(new Error('disk full'));
    appPersistenceOptions.migrate!(v18Snapshot(), 18);
    await flushMigrationSave();
    expect(persistFromState('')['42']?.githubToken).toBe('ghp_legacy_token');

    // 第二次启动：version 已为 19，migrate 不再运行；分片仍带旧 PAT。
    __resetV19TokenSaveStateForTest();
    useAppStore.setState({ user: null, githubToken: null, isAuthenticated: false, savedAccounts: {} } as never);
    mergePersisted({ user: null, savedAccounts: savedAccountsWithToken('ghp_legacy_token') });
    // 第 14 轮审计修复：重试对旧迁移输入走补写语义——失败模拟随之移到
    // fillMissingGhAccountTokens（saveGhAccountTokens 只承载重新授权的运行时 PAT）。
    vi.mocked(fillMissingGhAccountTokens).mockClear();
    vi.mocked(fillMissingGhAccountTokens).mockRejectedValue(new Error('still down'));
    hydrate();
    await flushMigrationSave();
    // 第二次启动重试仍失败：分片必须继续保留旧 PAT（第三次启动的重试输入），
    // 不能被水化收尾的首次持久化剥除。
    expect(persistFromState('ghp_legacy_token')['42']?.githubToken).toBe('ghp_legacy_token');

    // 第三次启动：分片仍带旧 PAT，安全存储恢复后重试成功。
    __resetV19TokenSaveStateForTest();
    useAppStore.setState({ user: null, githubToken: null, isAuthenticated: false, savedAccounts: {} } as never);
    mergePersisted({ user: null, savedAccounts: savedAccountsWithToken('ghp_legacy_token') });
    vi.mocked(fillMissingGhAccountTokens).mockClear();
    vi.mocked(fillMissingGhAccountTokens).mockImplementation(async (tokens: Record<string, string>) => ({ ...tokens }));
    hydrate();
    await flushMigrationSave();
    expect(vi.mocked(fillMissingGhAccountTokens)).toHaveBeenCalledWith({ '42': 'ghp_legacy_token' });
    // 确认后恢复 B7 剥除语义。
    expect(persistFromState('ghp_legacy_token')['42']?.githubToken).toBe('');
  });

  it('B: 未确认态重新授权后分片不回填旧 PAT，启动重试使用新 PAT', async () => {
    vi.mocked(fillMissingGhAccountTokens).mockRejectedValueOnce(new Error('disk full'));
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
    vi.mocked(fillMissingGhAccountTokens).mockRejectedValueOnce(new Error('disk full'));
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

    // 模拟重启：先保存当前分片再清空 store——分片无 PAT ⇒ 迁移输入为空，
    // 重试不会再把旧 PAT 写回；账号 42 的元数据条目必须保留且 Token 为空。
    const retainedShard = persistCurrentState();
    __resetV19TokenSaveStateForTest();
    useAppStore.setState({ user: null, githubToken: null, isAuthenticated: false, savedAccounts: {} } as never);
    mergePersisted({ user: null, savedAccounts: retainedShard });
    // 登出后的重启不得丢账号条目（下拉列表/一键恢复占位依赖元数据），
    // 也不得用空值回退掩盖「条目被整体删除」的回归。
    expect(useAppStore.getState().savedAccounts['42']).toBeDefined();
    expect(useAppStore.getState().savedAccounts['42']?.githubToken ?? '').toBe('');
    vi.mocked(saveGhAccountTokens).mockClear();
    vi.mocked(saveGhAccountTokens).mockResolvedValue(undefined);
    // 第 15 轮审计 [31]：fillMissingGhAccountTokens 在 migrate 阶段已被调用过，
    // hydrate 前先清空调用记录，避免残留调用影响下方逐载荷断言。
    vi.mocked(fillMissingGhAccountTokens).mockClear();
    hydrate();
    await flushMigrationSave();
    // 第 15 轮审计 [31]：逐次检查两个 mock 的每个载荷——整对象比较在旧 PAT 与
    // 其他账号合并传入同一批次时不会失败，无法发现 42 的旧 PAT 被写回。
    for (const [payload] of vi.mocked(saveGhAccountTokens).mock.calls) {
      expect(payload['42']).not.toBe('ghp_legacy_token');
    }
    for (const [payload] of vi.mocked(fillMissingGhAccountTokens).mock.calls) {
      expect(payload['42']).not.toBe('ghp_legacy_token');
    }
  });

  it('D: 多账号快照迁移失败 + 单账号镜像迁移成功时保留其他账号的迁移输入', async () => {
    const mirrorAccountUser: GitHubUser = { ...mirrorUser, id: 43, login: 'mirror-user' };
    const secondUser: GitHubUser = { ...mirrorUser, id: 44, login: 'second-user' };
    window.localStorage.setItem(
      'github-stars-manager-auth',
      JSON.stringify({ user: mirrorAccountUser, githubToken: 'ghp_mirror_token', backendApiSecret: null }),
    );
    try {
      // 快照迁移（42/44/43 多账号）失败；镜像迁移（仅 43）成功。第 13 轮起
      // 迁移保存（快照 + 镜像）走补写语义，失败规则保持一致：多账号一律失败。
      const multiAccountFails = async (tokens: Record<string, string>) => {
        const ids = Object.keys(tokens);
        if (ids.length === 1 && ids[0] === '43') return { ...tokens };
        throw new Error('multi-account save failed');
      };
      vi.mocked(fillMissingGhAccountTokens).mockImplementation(multiAccountFails);
      vi.mocked(saveGhAccountTokens).mockImplementation(async (tokens: Record<string, string>) => {
        await multiAccountFails(tokens);
        return undefined;
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
      expect(vi.mocked(fillMissingGhAccountTokens)).toHaveBeenCalledWith({ '43': 'ghp_mirror_token' });
      const shard = persistCurrentState();
      expect(shard['43']?.githubToken ?? '').toBe('');
      expect(shard['42']?.githubToken).toBe('ghp_token_a');
      expect(shard['44']?.githubToken).toBe('ghp_token_c');
    } finally {
      window.localStorage.removeItem('github-stars-manager-auth');
    }
  });

  it('E: 迁移重试对旧迁移输入走补写，绝不以恢复的旧 PAT 覆盖磁盘新凭据（round-14 [9]）', async () => {
    // 磁盘已有账号 42 的新 PAT；旧分片带 42 的旧 PAT 与 44 的待迁移 PAT。
    // 首次补写遇瞬时故障（44 尚未落盘），失败分支把旧输入恢复进内存；重试
    // 必须继续走补写语义保留磁盘上 42 的新 PAT，并用磁盘确认值恢复会话。
    const diskTokens: Record<string, string> = { '42': 'ghp_disk_new_42' };
    let fillAttempts = 0;
    vi.mocked(fillMissingGhAccountTokens).mockImplementation(async (tokens: Record<string, string>) => {
      fillAttempts += 1;
      if (fillAttempts === 1) throw new Error('transient write failure');
      const settled: Record<string, string> = {};
      for (const [accountId, token] of Object.entries(tokens)) {
        const diskToken = diskTokens[accountId];
        settled[accountId] = typeof diskToken === 'string' && diskToken ? diskToken : token;
      }
      return settled;
    });
    const secondUser: GitHubUser = { ...mirrorUser, id: 44, login: 'second-user' };
    const migrated = appPersistenceOptions.migrate!({
      savedAccounts: {
        ...savedAccountsWithToken('ghp_legacy_42'),
        '44': {
          accountId: '44',
          user: secondUser,
          githubToken: 'ghp_legacy_44',
          addedAt: '2026-01-01T00:00:00.000Z',
          lastUsedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    } as never, 18);
    await flushMigrationSave();

    useAppStore.setState({ user: null, githubToken: null, isAuthenticated: false, savedAccounts: {} } as never);
    mergePersisted(migrated as PersistedShard);
    hydrate();
    await flushMigrationSave();

    // 失败分支已把旧迁移 PAT 回填内存（可重试状态）；重试只走补写——覆盖
    // 写入的 saveGhAccountTokens 绝不能被旧迁移输入触发（否则恢复写入后
    // 会用 42 的旧 PAT 覆盖磁盘上的新 PAT）。
    expect(fillAttempts).toBe(2);
    expect(vi.mocked(fillMissingGhAccountTokens)).toHaveBeenLastCalledWith({
      '42': 'ghp_legacy_42',
      '44': 'ghp_legacy_44',
    });
    expect(vi.mocked(saveGhAccountTokens)).not.toHaveBeenCalled();
    // 会话以磁盘确认值收敛：42 恢复为磁盘上的新 PAT，44 保持新写入的迁移值。
    expect(useAppStore.getState().savedAccounts['42']?.githubToken).toBe('ghp_disk_new_42');
    expect(useAppStore.getState().savedAccounts['44']?.githubToken).toBe('ghp_legacy_44');
    // 确认收敛：确认后分片剥除，不再回填迁移输入。
    const shard = persistCurrentState();
    expect(shard['42']?.githubToken ?? '').toBe('');
    expect(shard['44']?.githubToken ?? '').toBe('');
  });
});
