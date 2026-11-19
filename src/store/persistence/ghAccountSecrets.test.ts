import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type GhAccountsBridge = {
  save: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
};

const setBridge = (bridge: Partial<GhAccountsBridge> | null) => {
  if (!bridge) {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    return;
  }
  (window as unknown as { electronAPI?: unknown }).electronAPI = {
    ghAccounts: {
      save: vi.fn().mockResolvedValue({ success: true }),
      get: vi.fn().mockResolvedValue({ status: 'missing' }),
      clear: vi.fn().mockResolvedValue({ success: true }),
      ...bridge,
    },
  };
};

const getBridgeMock = (): GhAccountsBridge => (
  (window as unknown as { electronAPI: { ghAccounts: GhAccountsBridge } }).electronAPI.ghAccounts
);

// ghAccountSecrets 用模块级状态跟踪「磁盘完整映射是否已确认加载」（R2-B1）。
// 每个用例重置模块注册表拿全新实例，避免用例间加载状态串扰。
const importFresh = async () => {
  vi.resetModules();
  return await import('./ghAccountSecrets');
};

describe('ghAccountSecrets load semantics (R2-B1)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    setBridge(null);
  });

  it('reports unavailable without the electron bridge', async () => {
    setBridge(null);
    const secrets = await importFresh();
    expect(secrets.hasGhAccountsBridge()).toBe(false);
    await expect(secrets.loadGhAccountTokens()).resolves.toEqual({ status: 'unavailable' });
    expect(secrets.isGhAccountTokensFullyLoaded()).toBe(false);
  });

  it('marks the full map as loaded after a successful read (missing file included)', async () => {
    setBridge({ get: vi.fn().mockResolvedValue({ status: 'missing' }) });
    const secrets = await importFresh();
    await expect(secrets.loadGhAccountTokens()).resolves.toEqual({ status: 'loaded', tokens: {} });
    expect(secrets.isGhAccountTokensFullyLoaded()).toBe(true);
  });

  it('keeps the unloaded state when the bridge call fails', async () => {
    setBridge({ get: vi.fn().mockRejectedValue(new Error('IPC handler crashed')) });
    const secrets = await importFresh();
    const result = await secrets.loadGhAccountTokens();
    expect(result.status).toBe('error');
    // 读取失败绝不能被折叠成「磁盘上没有 Token」：加载状态保持未确认。
    expect(secrets.isGhAccountTokensFullyLoaded()).toBe(false);
  });

  it('keeps the unloaded state when the main process reports a read error', async () => {
    setBridge({ get: vi.fn().mockResolvedValue({ status: 'error', error: 'EACCES: gh-accounts.enc' }) });
    const secrets = await importFresh();
    const result = await secrets.loadGhAccountTokens();
    expect(result).toMatchObject({ status: 'error', error: 'EACCES: gh-accounts.enc' });
    expect(secrets.isGhAccountTokensFullyLoaded()).toBe(false);
  });
});

describe('ghAccountSecrets save semantics (R2-B1)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    setBridge(null);
  });

  it('refuses to overwrite the disk when the pre-save read fails', async () => {
    setBridge({
      get: vi.fn().mockRejectedValue(new Error('IPC handler crashed')),
      save: vi.fn(),
    });
    const secrets = await importFresh();

    await expect(secrets.saveGhAccountTokens({ '42': 'ghp_session_token' }))
      .rejects.toThrow('IPC handler crashed');
    // 读取失败不覆写磁盘：save 一次都不允许发生。
    expect(getBridgeMock().save).not.toHaveBeenCalled();
    expect(secrets.isGhAccountTokensFullyLoaded()).toBe(false);
  });

  it('merges into the disk map before the full map has been loaded', async () => {
    setBridge({
      get: vi.fn().mockResolvedValue({
        status: 'loaded',
        tokens: { '7': 'ghp_other_account' },
      }),
      save: vi.fn().mockResolvedValue({ success: true }),
    });
    const secrets = await importFresh();

    await secrets.saveGhAccountTokens({ '42': 'ghp_session_token' });

    // 合并写入保留磁盘上其他账号的 PAT。
    expect(getBridgeMock().save).toHaveBeenLastCalledWith({
      '7': 'ghp_other_account',
      '42': 'ghp_session_token',
    });
    // 合并成功后完整磁盘状态已确认。
    expect(secrets.isGhAccountTokensFullyLoaded()).toBe(true);
  });

  it('fully overwrites once the full map has been loaded (logout removal works)', async () => {
    setBridge({
      get: vi.fn().mockResolvedValue({ status: 'missing' }),
      save: vi.fn().mockResolvedValue({ success: true }),
    });
    const secrets = await importFresh();

    await secrets.loadGhAccountTokens();
    await secrets.saveGhAccountTokens({ '42': 'ghp_session_token' });

    // 已确认磁盘为空 ⇒ 全量覆写，不会把磁盘上已确认移除的账号合并回来。
    expect(getBridgeMock().save).toHaveBeenLastCalledWith({ '42': 'ghp_session_token' });
  });

  it('drops invalid entries from the payload before writing', async () => {
    setBridge({
      get: vi.fn().mockResolvedValue({ status: 'missing' }),
      save: vi.fn().mockResolvedValue({ success: true }),
    });
    const secrets = await importFresh();

    await secrets.loadGhAccountTokens();
    await secrets.saveGhAccountTokens({
      '42': 'ghp_valid',
      'bad-id': 'ghp_dropped',
      '43': 'bad\ntoken',
    } as Record<string, string>);

    expect(getBridgeMock().save).toHaveBeenLastCalledWith({ '42': 'ghp_valid' });
  });
});

describe('syncGhAccountTokensFromState (R2-B1)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    setBridge(null);
  });

  it('is a no-op without the electron bridge', async () => {
    setBridge(null);
    const secrets = await importFresh();
    secrets.syncGhAccountTokensFromState({
      user: { id: 42 },
      githubToken: 'ghp_session_token',
      savedAccounts: {},
    });
    expect(secrets.isGhAccountTokensFullyLoaded()).toBe(false);
  });

  it('falls back to the top-level token for the current account', async () => {
    setBridge({
      get: vi.fn().mockResolvedValue({ status: 'missing' }),
      save: vi.fn().mockResolvedValue({ success: true }),
    });
    const secrets = await importFresh();
    await secrets.loadGhAccountTokens();

    secrets.syncGhAccountTokensFromState({
      user: { id: 42 },
      githubToken: 'ghp_session_token',
      savedAccounts: {},
    });
    await vi.waitFor(() => expect(getBridgeMock().save).toHaveBeenCalled());

    expect(getBridgeMock().save).toHaveBeenLastCalledWith({ '42': 'ghp_session_token' });
  });

  it('degrades to a merge when the hydration read previously failed', async () => {
    // 模拟水化读取失败：加载状态保持未确认，后续同步降级为合并写入。
    setBridge({
      get: vi.fn()
        .mockRejectedValueOnce(new Error('IPC handler crashed'))
        .mockResolvedValue({ status: 'loaded', tokens: { '7': 'ghp_other_account' } }),
      save: vi.fn().mockResolvedValue({ success: true }),
    });
    const secrets = await importFresh();

    const failed = await secrets.loadGhAccountTokens();
    expect(failed.status).toBe('error');
    expect(secrets.isGhAccountTokensFullyLoaded()).toBe(false);

    secrets.syncGhAccountTokensFromState({
      user: { id: 42 },
      githubToken: 'ghp_session_token',
      savedAccounts: {},
    });
    await vi.waitFor(() => expect(getBridgeMock().save).toHaveBeenCalled());

    // 合并更新：磁盘上其他账号的 Token 保留，绝不因一次读取失败被抹掉。
    expect(getBridgeMock().save).toHaveBeenLastCalledWith({
      '7': 'ghp_other_account',
      '42': 'ghp_session_token',
    });
  });

  it('keeps other accounts on disk after a failed hydration read, a merge write, then logout', async () => {
    // 自审计回归：读取失败 → 合并写入（Store 里没有账号 7） → 登出账号 42。
    // 登出必须只删 42，绝不能以 Store 派生的映射把磁盘上的 7 一起覆写掉。
    setBridge({
      get: vi.fn()
        .mockRejectedValueOnce(new Error('IPC handler crashed'))
        .mockResolvedValue({ status: 'loaded', tokens: { '7': 'ghp_other_account' } }),
      save: vi.fn().mockResolvedValue({ success: true }),
    });
    const secrets = await importFresh();

    await secrets.loadGhAccountTokens();
    secrets.syncGhAccountTokensFromState({
      user: { id: 42 },
      githubToken: 'ghp_session_token',
      savedAccounts: {},
    });
    await vi.waitFor(() => expect(getBridgeMock().save).toHaveBeenCalledTimes(1));

    // 登出：Store 不再持有 42 的 Token，并且显式移除 42。
    secrets.syncGhAccountTokensFromState({
      user: null,
      githubToken: null,
      savedAccounts: {},
    }, ['42']);
    await vi.waitFor(() => expect(getBridgeMock().save).toHaveBeenCalledTimes(2));

    expect(getBridgeMock().save).toHaveBeenLastCalledWith({ '7': 'ghp_other_account' });
  });

  it('serializes concurrent saves so a second sync never resurrects a deleted PAT', async () => {
    let releaseFirstSave!: (value: { success: boolean }) => void;
    const saveMock = vi.fn()
      .mockImplementationOnce(() => new Promise<{ success: boolean }>((resolve) => { releaseFirstSave = resolve; }))
      .mockResolvedValue({ success: true });
    setBridge({
      get: vi.fn().mockResolvedValue({
        status: 'loaded',
        tokens: { '42': 'ghp_42', '7': 'ghp_7' },
      }),
      save: saveMock,
    });
    const secrets = await importFresh();
    await secrets.loadGhAccountTokens();

    // 首次同步删除账号 42（bridge.save 尚未返回）
    const first = secrets.syncGhAccountTokensFromState({
      user: { id: 7 },
      githubToken: 'ghp_7',
      savedAccounts: { '7': { githubToken: 'ghp_7' } },
    }, ['42']);

    // 在首次保存未完成期间触发第二次同步更新账号 7
    const second = secrets.syncGhAccountTokensFromState({
      user: { id: 7 },
      githubToken: 'ghp_7_updated',
      savedAccounts: { '7': { githubToken: 'ghp_7_updated' } },
    });

    await vi.waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    expect(saveMock).toHaveBeenNthCalledWith(1, { '7': 'ghp_7' });

    releaseFirstSave({ success: true });
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);

    // 最终保存绝不能从过期的 knownDiskTokens 基底恢复已删除的账号 42
    expect(saveMock).toHaveBeenCalledTimes(2);
    expect(saveMock).toHaveBeenNthCalledWith(2, { '7': 'ghp_7_updated' });
  });

  it('retains pending removals when a save fails and applies them on the next save', async () => {
    const saveMock = vi.fn()
      .mockResolvedValueOnce({ success: false, error: 'disk busy' })
      .mockResolvedValueOnce({ success: true });
    setBridge({
      get: vi.fn().mockResolvedValue({
        status: 'loaded',
        tokens: { '42': 'ghp_42', '7': 'ghp_7' },
      }),
      save: saveMock,
    });
    const secrets = await importFresh();
    await secrets.loadGhAccountTokens();

    const firstOk = await secrets.syncGhAccountTokensFromState({
      user: { id: 7 },
      githubToken: 'ghp_7',
      savedAccounts: { '7': { githubToken: 'ghp_7' } },
    }, ['42']);
    expect(firstOk).toBe(false);
    expect(secrets.hasPendingGhAccountSecretRemovals()).toBe(true);

    // 下一次同步即使未重复传 removedAccountIds，也会继续应用先前失败的删除
    const secondOk = await secrets.syncGhAccountTokensFromState({
      user: { id: 7 },
      githubToken: 'ghp_7_next',
      savedAccounts: { '7': { githubToken: 'ghp_7_next' } },
    });
    expect(secondOk).toBe(true);
    expect(secrets.hasPendingGhAccountSecretRemovals()).toBe(false);
    expect(saveMock).toHaveBeenLastCalledWith({ '7': 'ghp_7_next' });
  });
});
