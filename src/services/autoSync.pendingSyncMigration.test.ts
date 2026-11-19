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

describe('loadPendingSyncAccounts legacy record migration (audit fix)', () => {
  afterEach(() => {
    window.localStorage.removeItem(PENDING_SYNC_ACCOUNTS_KEY);
    window.localStorage.removeItem(BACKEND_URL_STORAGE_KEY);
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
});
