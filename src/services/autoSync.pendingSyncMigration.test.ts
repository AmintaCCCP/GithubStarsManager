import { afterEach, describe, expect, it, vi } from 'vitest';

// loadPendingSyncAccounts 的旧格式迁移在模块加载时执行一次。这里用
// vi.resetModules + 动态导入拿全新实例，并预置 localStorage 验证迁移行为。
const importFresh = async () => {
  vi.resetModules();
  const autoSync = await import('./autoSync');
  // 同一全新注册表里的 backendAdapter 实例（autoSync 绑定的正是它）：
  // 直接置 _backendUrl 模拟「已连接」，hasPendingAccountSync 按当前连接匹配。
  const { backend } = await import('./backendAdapter');
  return {
    autoSync,
    backend: backend as unknown as { _backendUrl: string | null },
  };
};

const PENDING_SYNC_ACCOUNTS_KEY = 'gsm.pendingSyncAccounts';
const BACKEND_URL_STORAGE_KEY = 'github-stars-manager-backend-url';
const LEGACY_PENDING_SYNC_EVALUATED_KEY = 'gsm.pendingSyncLegacyEvaluated';
const MIGRATION_SOURCE_KEY = 'gsm.pendingSyncMigrationSource';

describe('loadPendingSyncAccounts legacy record migration (audit fix)', () => {
  afterEach(() => {
    window.localStorage.removeItem(PENDING_SYNC_ACCOUNTS_KEY);
    window.localStorage.removeItem(BACKEND_URL_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_PENDING_SYNC_EVALUATED_KEY);
    window.localStorage.removeItem(MIGRATION_SOURCE_KEY);
    vi.resetModules();
  });

  it('binds legacy empty-URL records to the persisted backend URL', async () => {
    window.localStorage.setItem(BACKEND_URL_STORAGE_KEY, 'https://persisted.test/api');
    window.localStorage.setItem(PENDING_SYNC_ACCOUNTS_KEY, JSON.stringify([['77']]));

    const { autoSync, backend } = await importFresh();
    backend._backendUrl = 'https://persisted.test/api';
    // 迁移后记录归属持久化后端：复合键查找能命中（补推保护恢复）。
    expect(autoSync.hasPendingAccountSync('77')).toBe(true);
    // 迁移结果立即写回持久化，避免之后切换后端时被重复绑定到新连接。
    expect(JSON.parse(window.localStorage.getItem(PENDING_SYNC_ACCOUNTS_KEY) ?? '[]'))
      .toEqual([['77', 'https://persisted.test/api']]);
  });

  it('keeps legacy records unbound (never auto-pushed) when the persisted URL is unknown', async () => {
    window.localStorage.removeItem(BACKEND_URL_STORAGE_KEY);
    window.localStorage.setItem(PENDING_SYNC_ACCOUNTS_KEY, JSON.stringify([['77']]));

    const { autoSync, backend } = await importFresh();
    backend._backendUrl = 'https://unrelated.test/api';
    // 无法确认原后端：记录保留原样，绝不关联到任何新后端。
    expect(autoSync.hasPendingAccountSync('77')).toBe(false);
    expect(window.localStorage.getItem(PENDING_SYNC_ACCOUNTS_KEY)).toBe(JSON.stringify([['77']]));
  });

  it('keeps legacy records unbound after connecting another backend and restarting (round-13 audit fix)', async () => {
    // 第 13 轮审计修复：首次启动无持久化 URL 时遗留记录保持未归属并写入评估
    // 标记；之后连接后端 B 并重启（persistedUrl 变为 B），记录也绝不能绑定到
    // B——否则「绝不会自动补推到新后端」的约定在重启后失效，账号 77 的本地
    // 修改会被当作 B 的待推内容。
    window.localStorage.removeItem(BACKEND_URL_STORAGE_KEY);
    window.localStorage.setItem(PENDING_SYNC_ACCOUNTS_KEY, JSON.stringify([['77']]));

    // 第一次启动：无可确认的原后端 → 记录保持未归属。
    const firstStart = await importFresh();
    firstStart.backend._backendUrl = 'https://unrelated.test/api';
    expect(firstStart.autoSync.hasPendingAccountSync('77')).toBe(false);
    expect(window.localStorage.getItem(PENDING_SYNC_ACCOUNTS_KEY)).toBe(JSON.stringify([['77']]));

    // 用户连接另一后端 B（持久化 URL 被保存），重新导入模块模拟重启。
    window.localStorage.setItem(BACKEND_URL_STORAGE_KEY, 'https://other.test/api');
    const secondStart = await importFresh();
    secondStart.backend._backendUrl = 'https://other.test/api';
    // 重启后记录仍未归属：hasPendingAccountSync('77') 为 false，存储内容不变。
    expect(secondStart.autoSync.hasPendingAccountSync('77')).toBe(false);
    expect(window.localStorage.getItem(PENDING_SYNC_ACCOUNTS_KEY)).toBe(JSON.stringify([['77']]));

    // 评估标记对一切保持未归属的记录生效（含新格式空 URL 记录）：无法确认
    // 原后端的记录绝不因后续保存的后端 URL 绑定到该后端。
    window.localStorage.setItem(PENDING_SYNC_ACCOUNTS_KEY, JSON.stringify([['88', '']]));
    const thirdStart = await importFresh();
    thirdStart.backend._backendUrl = 'https://other.test/api';
    expect(thirdStart.autoSync.hasPendingAccountSync('88')).toBe(false);
    expect(window.localStorage.getItem(PENDING_SYNC_ACCOUNTS_KEY)).toBe(JSON.stringify([['88', '']]));
  });

  it('merges dirty setting keys when the target composite key already holds a record (auditor fix)', async () => {
    window.localStorage.setItem(BACKEND_URL_STORAGE_KEY, 'https://persisted.test/api');
    // 旧格式记录与新格式记录并存（旧记录未迁移的会话中同账号又产生了失败补推记录）：
    // 重绑到同一复合键时不得覆盖已有记录的脏键保护。
    window.localStorage.setItem(PENDING_SYNC_ACCOUNTS_KEY, JSON.stringify([
      ['77'],
      ['77', 'https://persisted.test/api', ['categoryOrder']],
    ]));

    const { autoSync, backend } = await importFresh();
    backend._backendUrl = 'https://persisted.test/api';
    expect(autoSync.hasPendingAccountSync('77')).toBe(true);
    const persisted = JSON.parse(window.localStorage.getItem(PENDING_SYNC_ACCOUNTS_KEY) ?? '[]') as
      Array<[string, string, string?]>;
    expect(persisted).toHaveLength(1);
    expect(persisted[0][0]).toBe('77');
    expect(persisted[0][1]).toBe('https://persisted.test/api');
    expect(persisted[0][2]).toEqual(['categoryOrder']);
  });

  it('merges dirty setting keys when the dirty-key record is listed first (order independence)', async () => {
    window.localStorage.setItem(BACKEND_URL_STORAGE_KEY, 'https://persisted.test/api');
    // 第 12 轮审计修复：有脏键的记录排在最前——迁移实现若始终保留最后一条
    // 记录，此用例会失败（categoryOrder 脏键保护丢失）。
    window.localStorage.setItem(PENDING_SYNC_ACCOUNTS_KEY, JSON.stringify([
      ['77', 'https://persisted.test/api', ['categoryOrder']],
      ['77'],
    ]));

    const { autoSync, backend } = await importFresh();
    backend._backendUrl = 'https://persisted.test/api';
    expect(autoSync.hasPendingAccountSync('77')).toBe(true);
    const persisted = JSON.parse(window.localStorage.getItem(PENDING_SYNC_ACCOUNTS_KEY) ?? '[]') as
      Array<[string, string, string?]>;
    expect(persisted).toHaveLength(1);
    expect(persisted[0][0]).toBe('77');
    expect(persisted[0][1]).toBe('https://persisted.test/api');
    expect(persisted[0][2]).toEqual(['categoryOrder']);
  });

  it('delays the evaluation marker until the legacy migration write-back succeeds (round-14 [20])', async () => {
    // 原后端 URL 已知 + 迁移写回失败（配额）：评估标记不得提前写入——否则
    // 重启后即使配额恢复也跳过迁移，原后端的待推编辑失去自动恢复。
    window.localStorage.setItem(BACKEND_URL_STORAGE_KEY, 'https://persisted.test/api');
    window.localStorage.setItem(PENDING_SYNC_ACCOUNTS_KEY, JSON.stringify([['77']]));
    // 拦截待推记录键的写入（模块经裸 localStorage 与 window.localStorage 两条
    // 路径访问，两条都要拦截；其余键透传），模拟配额不足的写回失败。
    const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
    const blockPendingSyncWrite = (key: string, value: string) => {
      if (key === PENDING_SYNC_ACCOUNTS_KEY) throw new Error('QuotaExceededError');
      originalSetItem(key, value);
    };
    const setItemSpies = [
      vi.spyOn(window.localStorage, 'setItem').mockImplementation(blockPendingSyncWrite),
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blockPendingSyncWrite),
    ];
    try {
      const firstStart = await importFresh();
      firstStart.backend._backendUrl = 'https://persisted.test/api';
      // 本次会话内绑定已生效（内存），但存储写回失败：标记不得记录评估完成
      expect(window.localStorage.getItem(LEGACY_PENDING_SYNC_EVALUATED_KEY)).toBeNull();
      expect(window.localStorage.getItem(PENDING_SYNC_ACCOUNTS_KEY)).toBe(JSON.stringify([['77']]));
    } finally {
      setItemSpies.forEach((spy) => spy.mockRestore());
    }

    // 配额恢复后的下一次启动：迁移重试成功，写回与标记一并完成
    const secondStart = await importFresh();
    secondStart.backend._backendUrl = 'https://persisted.test/api';
    expect(secondStart.autoSync.hasPendingAccountSync('77')).toBe(true);
    expect(window.localStorage.getItem(LEGACY_PENDING_SYNC_EVALUATED_KEY)).toBe('1');
    expect(JSON.parse(window.localStorage.getItem(PENDING_SYNC_ACCOUNTS_KEY) ?? '[]'))
      .toEqual([['77', 'https://persisted.test/api']]);
  });

  it('never rebinds a legacy record to a backend connected after a failed migration write-back (round-15 [17])', async () => {
    // 第一次启动：原后端 X 已知，但记录写回失败（配额）。
    window.localStorage.setItem(BACKEND_URL_STORAGE_KEY, 'https://origin.test/api');
    window.localStorage.setItem(PENDING_SYNC_ACCOUNTS_KEY, JSON.stringify([['77']]));
    const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
    const blockPendingSyncWrite = (key: string, value: string) => {
      if (key === PENDING_SYNC_ACCOUNTS_KEY) throw new Error('QuotaExceededError');
      originalSetItem(key, value);
    };
    const setItemSpies = [
      vi.spyOn(window.localStorage, 'setItem').mockImplementation(blockPendingSyncWrite),
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blockPendingSyncWrite),
    ];
    try {
      const firstStart = await importFresh();
      firstStart.backend._backendUrl = 'https://origin.test/api';
      // 绑定前先固化迁移来源（写回失败不影响来源键）
      expect(window.localStorage.getItem(MIGRATION_SOURCE_KEY)).toBe('https://origin.test/api');
    } finally {
      setItemSpies.forEach((spy) => spy.mockRestore());
    }

    // 用户随后连接另一后端 Y 并重启：绝不能用 Y 的 URL 绑定账号 77 的旧记录。
    window.localStorage.setItem(BACKEND_URL_STORAGE_KEY, 'https://other.test/api');
    const secondStart = await importFresh();
    secondStart.backend._backendUrl = 'https://other.test/api';
    // 记录按固化来源绑定到 X（不是 Y），当前连接 Y 下不产生任何待推
    expect(secondStart.autoSync.hasPendingAccountSync('77')).toBe(false);
    expect(JSON.parse(window.localStorage.getItem(PENDING_SYNC_ACCOUNTS_KEY) ?? '[]'))
      .toEqual([['77', 'https://origin.test/api']]);
    // 迁移完成：来源键清理
    expect(window.localStorage.getItem(MIGRATION_SOURCE_KEY)).toBeNull();
  });

  it('keeps legacy records unbound when the migration source cannot be persisted (round-15 [17])', async () => {
    window.localStorage.setItem(BACKEND_URL_STORAGE_KEY, 'https://origin.test/api');
    window.localStorage.setItem(PENDING_SYNC_ACCOUNTS_KEY, JSON.stringify([['77']]));
    const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
    const blockSourceWrite = (key: string, value: string) => {
      if (key === MIGRATION_SOURCE_KEY) throw new Error('QuotaExceededError');
      originalSetItem(key, value);
    };
    const setItemSpies = [
      vi.spyOn(window.localStorage, 'setItem').mockImplementation(blockSourceWrite),
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blockSourceWrite),
    ];
    try {
      const firstStart = await importFresh();
      firstStart.backend._backendUrl = 'https://origin.test/api';
      // 无法固化来源：本次启动保持未归属，记录原样保留
      expect(firstStart.autoSync.hasPendingAccountSync('77')).toBe(false);
      expect(window.localStorage.getItem(PENDING_SYNC_ACCOUNTS_KEY)).toBe(JSON.stringify([['77']]));
    } finally {
      setItemSpies.forEach((spy) => spy.mockRestore());
    }

    // 之后连接 Y 并重启：仍未归属，绝不按 Y 猜测绑定
    window.localStorage.setItem(BACKEND_URL_STORAGE_KEY, 'https://other.test/api');
    const secondStart = await importFresh();
    secondStart.backend._backendUrl = 'https://other.test/api';
    expect(secondStart.autoSync.hasPendingAccountSync('77')).toBe(false);
    expect(window.localStorage.getItem(PENDING_SYNC_ACCOUNTS_KEY)).toBe(JSON.stringify([['77']]));
  });

  it('locks the unbound state immediately when the persisted URL is unknown (round-14 [20])', async () => {
    window.localStorage.removeItem(BACKEND_URL_STORAGE_KEY);
    window.localStorage.setItem(PENDING_SYNC_ACCOUNTS_KEY, JSON.stringify([['77']]));

    const { autoSync, backend } = await importFresh();
    backend._backendUrl = 'https://unrelated.test/api';
    // URL 未知：评估标记立即写入（遗留记录锁定为未归属，绝不绑定后续后端）
    expect(window.localStorage.getItem(LEGACY_PENDING_SYNC_EVALUATED_KEY)).toBe('1');
    expect(autoSync.hasPendingAccountSync('77')).toBe(false);
    expect(window.localStorage.getItem(PENDING_SYNC_ACCOUNTS_KEY)).toBe(JSON.stringify([['77']]));
  });
});
