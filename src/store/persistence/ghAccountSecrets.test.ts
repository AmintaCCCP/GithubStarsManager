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
    // 第 12 轮审计修复：初始映射必须已包含待删除账号与另一个账号——否则即使
    // 实现完全忽略 removedAccountIds，断言也会通过。正常加载成功的路径下，
    // 登出删除必须真正从已加载映射中移除该账号。
    setBridge({
      get: vi.fn().mockResolvedValue({
        status: 'loaded',
        tokens: { '42': 'ghp_42_disk', '7': 'ghp_other_account' },
      }),
      save: vi.fn().mockResolvedValue({ success: true }),
    });
    const secrets = await importFresh();

    await secrets.loadGhAccountTokens();
    // 登出账号 42：显式移除列表必须真正删除该账号（其余账号保留）。
    await secrets.saveGhAccountTokens({ '7': 'ghp_other_account' }, ['42']);

    // 已确认完整映射 ⇒ 全量覆写：42 被删除，绝不合并回来。
    expect(getBridgeMock().save).toHaveBeenLastCalledWith({ '7': 'ghp_other_account' });
  });

  it('commits pending-removal cancellation only after the encrypted write is confirmed (round-12 audit fix)', async () => {
    // 删除 42 失败 → 待删标记屏蔽旧 PAT；用户用新 PAT 重新授权 42（替换保存
    // 先失败再成功）。标记取消必须延迟到写入确认：替换失败时旧 PAT 仍被屏蔽，
    // 替换成功后新 PAT 可加载。
    const saveMock = vi.fn()
      .mockResolvedValueOnce({ success: false, error: 'disk busy' })
      .mockResolvedValueOnce({ success: false, error: 'disk busy again' })
      .mockResolvedValue({ success: true });
    setBridge({
      get: vi.fn().mockResolvedValue({
        status: 'loaded',
        tokens: { '42': 'ghp_old_42' },
      }),
      save: saveMock,
    });
    const secrets = await importFresh();
    await secrets.loadGhAccountTokens();

    // 第一次：登出删除 42 失败——待删标记保留并持久化。
    const removalFailed = await secrets.syncGhAccountTokensFromState(
      { user: null, githubToken: null, savedAccounts: {} },
      ['42'],
    );
    expect(removalFailed).toBe(false);
    expect(secrets.hasPendingGhAccountSecretRemovals()).toBe(true);

    // 用户随后用新 PAT 重新授权 42：替换保存也失败。
    const replacementFailed = await secrets.syncGhAccountTokensFromState({
      user: { id: 42 },
      githubToken: 'ghp_new_42',
      savedAccounts: {},
    });
    expect(replacementFailed).toBe(false);
    // 写入失败时待删标记不得被提前取消：旧 PAT 仍被屏蔽（下次启动不回填）。
    expect(secrets.hasPendingGhAccountSecretRemovals()).toBe(true);

    // 替换保存成功后标记才清除：候选映射允许新 PAT 替换旧值。
    const replacementOk = await secrets.syncGhAccountTokensFromState({
      user: { id: 42 },
      githubToken: 'ghp_new_42',
      savedAccounts: {},
    });
    expect(replacementOk).toBe(true);
    expect(secrets.hasPendingGhAccountSecretRemovals()).toBe(false);
    expect(getBridgeMock().save).toHaveBeenLastCalledWith({ '42': 'ghp_new_42' });
  });

  it('treats an explicit removal as authoritative even when the same call supplies a token (round-12 audit)', async () => {
    // 同一次保存既显式删除 42 又携带其 Token 时按删除处理（与第 11 轮及更早
    // 语义一致）：绝不把 Token 写回被删除账号，删除成功后待删标记清除。
    window.localStorage.clear();
    setBridge({
      get: vi.fn().mockResolvedValue({ status: 'loaded', tokens: { '42': 'ghp_disk_token' } }),
      save: vi.fn().mockResolvedValue({ success: true }),
    });
    const secrets = await importFresh();

    await secrets.loadGhAccountTokens();
    await secrets.saveGhAccountTokens({ '42': 'ghp_new_token' }, ['42']);

    expect(getBridgeMock().save).toHaveBeenLastCalledWith({});
    expect(secrets.hasPendingGhAccountSecretRemovals()).toBe(false);
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

  it('never lets an earlier queued save consume a newer logout marker (round-14 audit [8])', async () => {
    // 常规保存先入队（在更早的队列操作之后等待），退出请求在其执行前登记
    // 待删标记。较早的保存开始执行时不得把该标记当作重新授权写回旧 PAT，
    // 也不得清除它——否则进程若在该保存与退出删除之间退出，重启后会回填
    // 已退出账号的旧 PAT。
    window.localStorage.clear();
    let releaseFirstSave!: (value: { success: boolean }) => void;
    const saveMock = vi.fn()
      .mockImplementationOnce(() => new Promise<{ success: boolean }>((resolve) => { releaseFirstSave = resolve; }))
      .mockResolvedValue({ success: true });
    setBridge({
      get: vi.fn().mockResolvedValue({
        status: 'loaded',
        tokens: { '42': 'ghp_42_old', '7': 'ghp_7' },
      }),
      save: saveMock,
    });
    const secrets = await importFresh();
    await secrets.loadGhAccountTokens();

    // 占住队列的保存（bridge.save 挂起）。
    const blocking = secrets.syncGhAccountTokensFromState({
      user: { id: 7 },
      githubToken: 'ghp_7_new',
      savedAccounts: { '7': { githubToken: 'ghp_7_new' } },
    });
    await vi.waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));

    // 常规全量同步入队（仍含 42 的旧 PAT），排队等待；退出请求随后登记标记。
    const earlierSave = secrets.syncGhAccountTokensFromState({
      user: { id: 7 },
      githubToken: 'ghp_7_new',
      savedAccounts: { '7': { githubToken: 'ghp_7_new' }, '42': { githubToken: 'ghp_42_old' } },
    });
    const logout = secrets.syncGhAccountTokensFromState(
      { user: null, githubToken: null, savedAccounts: {} },
      ['42'],
    );
    expect(secrets.hasPendingGhAccountSecretRemovals()).toBe(true);

    releaseFirstSave({ success: true });
    await expect(blocking).resolves.toBe(true);
    await expect(earlierSave).resolves.toBe(true);
    await expect(logout).resolves.toBe(true);

    // 较早的保存绝不能把退出标记当作重新授权：42 的旧 PAT 不得写回磁盘
    //（第 2 次保存是较早的常规同步，载荷不含 42）。
    expect(saveMock).toHaveBeenNthCalledWith(2, { '7': 'ghp_7_new' });
    // 待删标记未被较早的保存清除，由退出请求自己的队列操作完成删除并提交。
    expect(saveMock).toHaveBeenLastCalledWith({ '7': 'ghp_7_new' });
    expect(secrets.hasPendingGhAccountSecretRemovals()).toBe(false);
    // 标记变更已确认持久化（跨重启不再回填）。
    expect(window.localStorage.getItem('gsm.pendingGhAccountRemovals')).toBeNull();
  });

  it('warns instead of silently ignoring a failed removal-marker persist (round-14 audit [7])', async () => {
    // localStorage 写入失败时必须明确上报（标记只在内存，重启后旧 PAT 可能恢复）。
    window.localStorage.clear();
    // 测试环境的 window.localStorage 可能是 Node 实验性全局的拷贝（spyOn 无法
    // 拦截其 setItem），沿用 setup.ts 的 defineProperty 方式整体替换存储；
    // 其余方法显式委托原存储，保证模块初始化读取行为不变。
    const originalStorage = window.localStorage;
    const throwingStorage = {
      getItem: (key: string) => originalStorage.getItem(key),
      setItem: () => {
        throw new Error('quota exceeded');
      },
      removeItem: (key: string) => originalStorage.removeItem(key),
      clear: () => originalStorage.clear(),
      key: (index: number) => originalStorage.key(index),
      get length() {
        return originalStorage.length;
      },
    } as Storage;
    Object.defineProperty(window, 'localStorage', { writable: true, value: throwingStorage });
    try {
      setBridge({
        get: vi.fn().mockResolvedValue({ status: 'loaded', tokens: { '42': 'ghp_42_old' } }),
        save: vi.fn().mockResolvedValue({ success: false, error: 'disk busy' }),
      });
      const secrets = await importFresh();
      // importFresh 重置模块注册表：需在其后取同一实例的 logger 再做 spy。
      const freshLogger = await import('../../services/logger');
      const warnSpy = vi.spyOn(freshLogger.logger, 'warn').mockImplementation(() => {});
      await secrets.loadGhAccountTokens();

      const ok = await secrets.syncGhAccountTokensFromState(
        { user: null, githubToken: null, savedAccounts: {} },
        ['42'],
      );
      expect(ok).toBe(false);
      // 标记仍在内存（屏蔽继续生效），但持久化失败已被明确告警。
      expect(secrets.hasPendingGhAccountSecretRemovals()).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        'store.ghAccountSecrets',
        expect.stringContaining('credential may be restored from disk after restart'),
        expect.objectContaining({ pendingRemovalIds: ['42'] }),
      );
      warnSpy.mockRestore();
    } finally {
      Object.defineProperty(window, 'localStorage', { writable: true, value: originalStorage });
    }
  });

  it('full clear keeps logout markers registered while the clear was in flight (round-15 audit [6])', async () => {
    // 全量清除等待 IPC 期间：普通保存（含 42 的旧 PAT）先入队，退出请求随后
    // 登记待删标记。清除成功只提交其发起时观察到的标记——新登记的退出标记
    // 必须保留，否则随后执行的普通保存会把旧 PAT 写回磁盘，且应用在退出请求
    // 执行前关闭时磁盘上留有旧 PAT 却没有可屏蔽它的标记。
    window.localStorage.clear();
    let releaseClear!: (value: { success: boolean }) => void;
    let releaseSave!: (value: { success: boolean }) => void;
    const clearMock = vi.fn()
      .mockImplementationOnce(() => new Promise<{ success: boolean }>((resolve) => { releaseClear = resolve; }))
      .mockResolvedValue({ success: true });
    const saveMock = vi.fn()
      .mockImplementationOnce(() => new Promise<{ success: boolean }>((resolve) => { releaseSave = resolve; }))
      .mockResolvedValue({ success: true });
    setBridge({
      get: vi.fn().mockResolvedValue({
        status: 'loaded',
        tokens: { '42': 'ghp_42_old', '7': 'ghp_7' },
      }),
      save: saveMock,
      clear: clearMock,
    });
    const secrets = await importFresh();
    await secrets.loadGhAccountTokens();

    // 全量清除入队并在 bridge.clear 上阻塞。
    const clearPromise = secrets.clearGhAccountTokens();
    await vi.waitFor(() => expect(clearMock).toHaveBeenCalledTimes(1));

    // 普通保存入队；退出请求随后登记 42 的待删标记。
    const save = secrets.syncGhAccountTokensFromState({
      user: { id: 7 },
      githubToken: 'ghp_7',
      savedAccounts: { '7': { githubToken: 'ghp_7' }, '42': { githubToken: 'ghp_42_old' } },
    });
    const logout = secrets.syncGhAccountTokensFromState(
      { user: null, githubToken: null, savedAccounts: {} },
      ['42'],
    );
    expect(secrets.hasPendingGhAccountSecretRemovals()).toBe(true);

    releaseClear({ success: true });
    // 清除提交后，排在后面的普通保存开始执行并阻塞：此刻新登记的退出标记
    // 必须仍然存在（清除未移除其发起之后登记的意图）。
    await vi.waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    expect(secrets.hasPendingGhAccountSecretRemovals()).toBe(true);

    releaseSave({ success: true });
    await expect(save).resolves.toBe(true);
    await expect(logout).resolves.toBe(true);
    // 排队在清除之后的普通保存看到退出标记：42 的旧 PAT 不得写回磁盘
    //（两次保存的载荷都不含 42；最后一次是退出请求自己的删除保存）。
    expect(saveMock).toHaveBeenCalledTimes(2);
    expect(saveMock).toHaveBeenNthCalledWith(1, { '7': 'ghp_7' });
    expect(saveMock).toHaveBeenLastCalledWith({ '7': 'ghp_7' });
    // 退出标记由退出请求提交，且已确认持久化。
    expect(secrets.hasPendingGhAccountSecretRemovals()).toBe(false);
    expect(window.localStorage.getItem('gsm.pendingGhAccountRemovals')).toBeNull();
    // 全量清除本身也成功完成（不得因退出请求的并发登记而失败）。
    await expect(clearPromise).resolves.toBeUndefined();
  });

  it('restores persisted removal markers at startup and filters the old disk PAT (round-15 audit [7])', async () => {
    // 第一次启动：登出 42 的加密删除失败——标记已持久化，磁盘旧 PAT 保留。
    window.localStorage.clear();
    let releaseFinalSave!: (value: { success: boolean }) => void;
    const saveMock = vi.fn()
      .mockResolvedValueOnce({ success: false, error: 'disk busy' })
      .mockImplementationOnce(() => new Promise<{ success: boolean }>((resolve) => { releaseFinalSave = resolve; }))
      .mockResolvedValue({ success: true });
    setBridge({
      get: vi.fn().mockResolvedValue({
        status: 'loaded',
        tokens: { '42': 'ghp_42_disk_old', '7': 'ghp_7' },
      }),
      save: saveMock,
    });
    const secrets = await importFresh();
    await secrets.loadGhAccountTokens();
    const removalFailed = await secrets.syncGhAccountTokensFromState(
      { user: null, githubToken: null, savedAccounts: {} },
      ['42'],
    );
    expect(removalFailed).toBe(false);
    expect(secrets.hasPendingGhAccountSecretRemovals()).toBe(true);
    expect(JSON.parse(window.localStorage.getItem('gsm.pendingGhAccountRemovals') ?? '[]')).toEqual(['42']);

    // 重启（重新加载真实模块）：持久化标记必须恢复——否则加载器会把磁盘上
    // 已退出账号的旧 PAT 重新回填会话。
    const restarted = await importFresh();
    expect(restarted.hasPendingGhAccountSecretRemovals()).toBe(true);
    expect(restarted.getPendingGhAccountSecretRemovalIds()).toEqual(['42']);
    const loaded = await restarted.loadGhAccountTokens();
    // 加载结果过滤持久化标记命中的账号（磁盘旧 PAT 不回填）。
    expect(loaded).toEqual({ status: 'loaded', tokens: { '7': 'ghp_7' } });

    // 重启后的下一次保存（重试删除）：磁盘载荷不再包含 42 的旧 PAT；标记只在
    // 加密保存确认成功后清除。
    const finalSave = restarted.syncGhAccountTokensFromState(
      { user: { id: 7 }, githubToken: 'ghp_7', savedAccounts: { '7': { githubToken: 'ghp_7' } } },
      ['42'],
    );
    await vi.waitFor(() => expect(saveMock).toHaveBeenCalledTimes(2));
    // 写入尚未确认：标记仍在（重启后继续屏蔽）。
    expect(restarted.hasPendingGhAccountSecretRemovals()).toBe(true);
    releaseFinalSave({ success: true });
    await expect(finalSave).resolves.toBe(true);
    expect(saveMock).toHaveBeenLastCalledWith({ '7': 'ghp_7' });
    expect(restarted.hasPendingGhAccountSecretRemovals()).toBe(false);
    expect(window.localStorage.getItem('gsm.pendingGhAccountRemovals')).toBeNull();
  });

  it('warns and starts without markers when the persisted marker data is corrupt (round-15 audit [7])', async () => {
    // 损坏数据处理规则：不可解析 ⇒ 明确告警后按无标记启动（不静默丢弃）。
    // 告警发生在模块初始化（启动恢复）阶段：先重置注册表并挂好 logger spy，
    // 再加载被测模块。
    window.localStorage.clear();
    window.localStorage.setItem('gsm.pendingGhAccountRemovals', 'not-json{');
    try {
      setBridge({
        get: vi.fn().mockResolvedValue({ status: 'loaded', tokens: { '42': 'ghp_42_disk_old' } }),
        save: vi.fn().mockResolvedValue({ success: true }),
      });
      vi.resetModules();
      const freshLogger = await import('../../services/logger');
      const warnSpy = vi.spyOn(freshLogger.logger, 'warn').mockImplementation(() => {});
      const secrets = await import('./ghAccountSecrets');
      expect(secrets.hasPendingGhAccountSecretRemovals()).toBe(false);
      const loaded = await secrets.loadGhAccountTokens();
      // 无可恢复标记：磁盘 PAT 照常加载（损坏数据不得改变加载语义）。
      expect(loaded).toEqual({ status: 'loaded', tokens: { '42': 'ghp_42_disk_old' } });
      expect(warnSpy).toHaveBeenCalledWith(
        'store.ghAccountSecrets',
        expect.stringContaining('persisted gh-account removal markers'),
        expect.objectContaining({ error: expect.any(String) }),
      );
      warnSpy.mockRestore();
    } finally {
      window.localStorage.removeItem('gsm.pendingGhAccountRemovals');
    }
  });
});
