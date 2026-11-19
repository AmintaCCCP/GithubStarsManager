import { describe, expect, it, vi } from 'vitest';
import type { GitHubUser } from '../../types';

// 控制桌面端加密保存的成功/失败（v19 迁移落盘），验证 partialize 的
// 「加密保存确认后才提交剥除 PAT 的快照」语义（审计修复：保存失败时保留
// 原快照中的 Token 作为可重试状态，而不是被首次持久化永久清除）。
vi.mock('./ghAccountSecrets', () => ({
  hasGhAccountsBridge: vi.fn(() => true),
  loadGhAccountTokens: vi.fn(async () => ({ status: 'loaded' as const, tokens: {} })),
  saveGhAccountTokens: vi.fn(async () => undefined),
}));

// setup.ts 全局把 store mock 成 hook 选择器；migrate/partialize 需要真实 store。
vi.mock('../useAppStore', async () => await vi.importActual('../useAppStore'));

const { appPersistenceOptions } = await import('./options');
const { saveGhAccountTokens } = await import('./ghAccountSecrets');
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

describe('v19 token migration persistence contract', () => {
  it('keeps legacy PATs in the persisted snapshot until the encrypted save is confirmed, and records mirror-migrated accounts', async () => {
    // 阶段一：迁移加密保存失败——partialize 必须保留原快照中的 Token
    //（可重试状态），绝不提交剥除后的干净快照。
    vi.mocked(saveGhAccountTokens).mockRejectedValueOnce(new Error('disk full'));
    const failedMigration = appPersistenceOptions.migrate!(v18Snapshot(), 18) as {
      savedAccounts?: Record<string, { githubToken?: string }>;
    };
    await flushMigrationSave();

    // 迁移后的内存态仍按既有语义剥除（Token 由 onRehydrateStorage 失败分支恢复）。
    expect(failedMigration.savedAccounts?.['42']?.githubToken ?? '').toBe('');
    // 但持久化分片保留 Token：保存尚未确认，重启后迁移可重试。
    expect(persistSavedAccounts('ghp_unconfirmed_token')['42']?.githubToken).toBe('ghp_unconfirmed_token');

    // 阶段二：加密保存成功——partialize 恢复 B7 剥除语义，持久化分片不含 PAT。
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
      vi.mocked(saveGhAccountTokens).mockResolvedValueOnce(undefined);
      const migrated = appPersistenceOptions.migrate!({ user: null } as unknown as Parameters<NonNullable<typeof appPersistenceOptions.migrate>>[0], 18) as {
        savedAccounts?: Record<string, { accountId?: string; user?: GitHubUser; githubToken?: string }>;
      };
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
