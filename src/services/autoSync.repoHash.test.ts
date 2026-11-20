import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../types';
import { mergeRepositoriesPreservingLocalMetadata, stripLocalRepositoryFields } from '../utils/repositoryMerge';
import { hasActiveSearchFilters } from '../utils/repoSearch';
import { consumePendingAccountSync, forceSyncToBackend, hasPendingAccountSync, markPendingAccountSync, rebindPendingAccountSyncToCurrentBackend, repositoryPayloadHash, resetSyncHashes, startAutoSync, stopAutoSync, syncFromBackend, syncToBackend } from './autoSync';
import { backend } from './backendAdapter';
import { useAppStore } from '../store/useAppStore';

vi.mock('./backendAdapter', () => ({
  backend: {
    isAvailable: true,
    fetchRepositories: vi.fn(),
    fetchReleases: vi.fn(),
    fetchAIConfigs: vi.fn(),
    fetchWebDAVConfigs: vi.fn(),
    fetchEmbeddingConfigs: vi.fn(),
    fetchVectorSearchConfig: vi.fn(),
    fetchSettings: vi.fn(),
    syncRepositories: vi.fn().mockResolvedValue(undefined),
    syncReleases: vi.fn().mockResolvedValue(undefined),
    syncAIConfigs: vi.fn().mockResolvedValue(undefined),
    syncWebDAVConfigs: vi.fn().mockResolvedValue(undefined),
    syncEmbeddingConfigs: vi.fn().mockResolvedValue(undefined),
    syncVectorSearchConfig: vi.fn().mockResolvedValue(undefined),
    syncSettings: vi.fn().mockResolvedValue(undefined),
  },
}));

// src/test/setup.ts replaces the store with a hook-level mock for component
// tests. syncFromBackend drives the real store directly (setRepositories,
// getState), so restore the actual module for this file.
vi.mock('../store/useAppStore', async () => await vi.importActual('../store/useAppStore'));

// Regression for Issue #304: the repos hash committed after a pull must be the
// RAW backend hash. Committing quickHash(merged) instead made the next poll's
// backend hash differ forever (the merge injects client-only metadata such as
// analysis_error / has_fetched_releases that the backend never stores), so
// setRepositories — which used to reset searchResults — fired on every 5s poll
// cycle and unmounted the card whose edit modal was open.
//
// The same loop-breaker applies to the push side: syncToBackend commits the
// hash through stripLocalRepositoryFields, the identical projection the pull
// side uses (repositoryPayloadHash delegates to it), so a successful push and
// the next pull always agree.

const createRepository = (id: number, overrides: Partial<Repository> = {}): Repository => ({
  id,
  name: `repo-${id}`,
  full_name: `owner/repo-${id}`,
  description: 'A test repository',
  html_url: `https://github.com/owner/repo-${id}`,
  stargazers_count: 10,
  forks_count: 1,
  forks: 1,
  language: 'TypeScript',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
  pushed_at: '2026-01-03T00:00:00.000Z',
  owner: {
    login: 'owner',
    avatar_url: 'https://github.com/avatar.png',
  },
  topics: ['test'],
  ...overrides,
});

describe('backend sync hash convergence (Issue #304 loop-breaker)', () => {
  it('merge output differs from the backend payload when local metadata exists', () => {
    const backendRepos = [createRepository(1)];
    const localRepos = [createRepository(1, { vector_indexed_at: '2026-08-01T00:00:00.000Z' })];

    const merged = mergeRepositoriesPreservingLocalMetadata(backendRepos, localRepos);

    // This inequality is exactly why hashing the merged result never converged.
    expect(JSON.stringify(merged)).not.toBe(JSON.stringify(backendRepos));
    // The local-only field survives the merge.
    expect(merged[0].vector_indexed_at).toBe('2026-08-01T00:00:00.000Z');
  });

  it('two consecutive pulls of an unchanged backend hash identically', () => {
    // Mirrors the poll loop: pull → commit hashes.repos → next pull compares
    // against that value. With the raw backend hash committed, the second pull
    // sees no change and skips setRepositories.
    const backendPayload = [createRepository(1, { ai_summary: 'from backend' })];
    const localRepos = [createRepository(1, { ai_summary: 'from backend', ai_tags: ['ai-tag'] })];

    const firstPullHash = JSON.stringify(backendPayload);
    const merged = mergeRepositoriesPreservingLocalMetadata(backendPayload, localRepos);

    // The fix commits the raw backend hash (firstPullHash), not quickHash(merged).
    expect(firstPullHash).not.toBe(JSON.stringify(merged));
  });

  it('merged output is stable across repeated merges of the same inputs', () => {
    const backendRepos = [createRepository(1)];
    const localRepos = [createRepository(1, { subscribed_to_releases: true })];

    const firstMerge = mergeRepositoriesPreservingLocalMetadata(backendRepos, localRepos);
    const secondMerge = mergeRepositoriesPreservingLocalMetadata(backendRepos, localRepos);

    expect(JSON.stringify(secondMerge)).toBe(JSON.stringify(firstMerge));
  });

it('omits client-only fields from both pull and successful-push hashes', () => {
    const backendPayload = [createRepository(1)];
    const localRepositories = [createRepository(1, {
      analysis_error: 'temporary failure detail',
      has_fetched_releases: true,
      last_release_fetch_time: '2026-08-01T00:00:00.000Z',
    })];

    expect(repositoryPayloadHash(localRepositories)).toBe(repositoryPayloadHash(backendPayload));
  });

  it('stripLocalRepositoryFields removes every client-only field (CodeRabbit push-hash fix)', () => {
    const repo = createRepository(1, {
      analysis_error: 'model unavailable',
      has_fetched_releases: true,
      last_release_fetch_time: '2026-08-01T00:00:00.000Z',
      vector_indexed_at: '2026-08-01T00:00:00.000Z',
      ai_summary: 'summary',
    });

    const stripped = stripLocalRepositoryFields([repo]);

    // All client-only fields are gone
    expect(stripped[0].analysis_error).toBeUndefined();
    expect(stripped[0].has_fetched_releases).toBeUndefined();
    expect(stripped[0].last_release_fetch_time).toBeUndefined();
    expect(stripped[0].forks_count).toBeUndefined();
    expect(stripped[0].forks).toBeUndefined();
    // Backend-owned fields survive
    expect(stripped[0].id).toBe(1);
    expect(stripped[0].name).toBe('repo-1');
    expect(stripped[0].stargazers_count).toBe(10);
  });

  it('stripLocalRepositoryFields hash matches the backend pull payload hash (CodeRabbit convergence)', () => {
    // Model what the server actually returns: no forks_count/forks (not stored),
    // no analysis_error / has_fetched_releases (client-only), but vector_indexed_at
    // IS round-tripped (stored + returned by GET /api/repositories).
    const backendPayload = [createRepository(1, {
      forks_count: undefined,
      forks: undefined,
      vector_indexed_at: '2026-08-01T00:00:00.000Z',
    })];
    const localRepos = [createRepository(1, {
      analysis_error: 'model unavailable',
      has_fetched_releases: true,
      vector_indexed_at: '2026-08-01T00:00:00.000Z',
    })];

    // After push, we hash stripLocalRepositoryFields(state.repositories) — the
    // state has client-only fields injected by the merge. After pull, we hash
    // the raw backend payload. These must be equal so the next poll skips the
    // merge.
    const pushHash = JSON.stringify(stripLocalRepositoryFields(localRepos));
    const pullHash = JSON.stringify(backendPayload);

    expect(pushHash).toBe(pullHash);
  });

  it('push and pull fingerprints share the same projection even with analysis_error (CodeRabbit)', () => {
    // analysis_error is client-only: the backend never stores it. The push side
    // hashes the store (which may carry analysis_error) through
    // stripLocalRepositoryFields; the pull side hashes the backend payload
    // through repositoryPayloadHash (which delegates to the same projection).
    // Both must yield the same hash so a repo with a local analysis_error
    // doesn't re-trigger setRepositories forever.
    const backendPayload = [createRepository(1, { forks_count: undefined, forks: undefined })];
    const localRepos = [createRepository(1, { analysis_error: 'model unavailable' })];

    expect(repositoryPayloadHash(localRepos)).toBe(repositoryPayloadHash(backendPayload));
    expect(JSON.stringify(stripLocalRepositoryFields(localRepos))).toBe(JSON.stringify(backendPayload));
  });
});

describe('syncFromBackend two-pull loop (Issue #304 end-to-end)', () => {
  const backendPayload = [createRepository(1, { ai_summary: 'from backend' })];
  let originalState: ReturnType<typeof useAppStore.getState>;

  beforeEach(() => {
    originalState = useAppStore.getState();
    vi.mocked(backend.fetchRepositories).mockResolvedValue({ repositories: backendPayload, total: 1 });
    vi.mocked(backend.fetchReleases).mockResolvedValue({ releases: [], total: 0 });
    vi.mocked(backend.fetchAIConfigs).mockResolvedValue([]);
    vi.mocked(backend.fetchWebDAVConfigs).mockResolvedValue([]);
    vi.mocked(backend.fetchEmbeddingConfigs).mockResolvedValue([]);
    vi.mocked(backend.fetchVectorSearchConfig).mockResolvedValue({
      enabled: false,
      workerUrl: '',
      authToken: '',
      embeddingConfigId: '',
      indexMode: 'readme',
      readmeMaxChars: 6000,
    });
    vi.mocked(backend.fetchSettings).mockResolvedValue({});
    resetSyncHashes();
  });

  afterEach(() => {
    useAppStore.setState(originalState);
  });

  it('applies a changed backend payload once; an unchanged second pull is a no-op', async () => {
    // The local repo carries client-only metadata (analysis_error) the backend
    // never stores, so quickHash(merged) — the pre-fix commit value — can never
    // equal the raw backend hash. If the pull side ever reverts to committing
    // quickHash(merged), the second pull below re-applies setRepositories
    // (new repositories reference) and this test fails.
    const localRepo = createRepository(1, { ai_summary: 'from backend', analysis_error: 'stale local error' });
    useAppStore.setState({
      repositories: [localRepo],
      searchResults: [localRepo],
      searchFilters: { ...useAppStore.getState().searchFilters, query: 'repo' },
    });
    const searchResultsBeforePull = useAppStore.getState().searchResults;

    await syncFromBackend(); // pull 1 — payload differs from the initial hash → applied

    const afterFirstPull = useAppStore.getState();
    expect(afterFirstPull.repositories).toHaveLength(1);
    expect(afterFirstPull.repositories[0].ai_summary).toBe('from backend');
    // Local-only metadata survives the merge.
    expect(afterFirstPull.repositories[0].analysis_error).toBe('stale local error');
    // Active search filters: the searchResults reference is preserved so the
    // card being edited stays mounted.
    expect(afterFirstPull.searchResults).toBe(searchResultsBeforePull);

    const repositoriesAfterFirstPull = afterFirstPull.repositories;
    await syncFromBackend(); // pull 2 — identical backend payload

    expect(useAppStore.getState().repositories).toBe(repositoriesAfterFirstPull);
    expect(useAppStore.getState().searchResults).toBe(searchResultsBeforePull);
  });

  it('does not wipe local repositories when the backend returns an empty list', async () => {
    vi.mocked(backend.fetchRepositories).mockResolvedValue({ repositories: [], total: 0 });
    const localRepo = createRepository(1, { ai_summary: 'keep-me' });
    useAppStore.setState({
      repositories: [localRepo],
      searchResults: [localRepo],
    });

    await syncFromBackend();

    expect(useAppStore.getState().repositories).toHaveLength(1);
    expect(useAppStore.getState().repositories[0].ai_summary).toBe('keep-me');
  });

  it('force pull applies backend repositories even when a local debounce is pending', async () => {
    const backendRepos = [createRepository(2, { ai_summary: 'from-backend' })];
    vi.mocked(backend.fetchRepositories).mockResolvedValue({ repositories: backendRepos, total: 1 });
    const localRepo = createRepository(1, { ai_summary: 'local-only' });
    useAppStore.setState({
      repositories: [localRepo],
      searchResults: [localRepo],
    });

    await syncFromBackend({ force: true });

    expect(useAppStore.getState().repositories).toHaveLength(1);
    expect(useAppStore.getState().repositories[0].id).toBe(2);
    expect(useAppStore.getState().repositories[0].ai_summary).toBe('from-backend');
  });

  it('force pull keeps an empty backend list instead of preserving leftover local repos', async () => {
    vi.mocked(backend.fetchRepositories).mockResolvedValue({ repositories: [], total: 0 });
    const localRepo = createRepository(1, { ai_summary: 'local-only' });
    useAppStore.setState({
      repositories: [localRepo],
      searchResults: [localRepo],
    });

    await syncFromBackend({ force: true });

    expect(useAppStore.getState().repositories).toEqual([]);
  });
});

describe('sync defaultCategoryOverrides with backend settings', () => {
  let originalState: ReturnType<typeof useAppStore.getState>;
  let unsubscribe: (() => void) | undefined;

  const stubBackendSlices = () => {
    vi.mocked(backend.fetchRepositories).mockResolvedValue({ repositories: [], total: 0 });
    vi.mocked(backend.fetchReleases).mockResolvedValue({ releases: [], total: 0 });
    vi.mocked(backend.fetchAIConfigs).mockResolvedValue([]);
    vi.mocked(backend.fetchWebDAVConfigs).mockResolvedValue([]);
    vi.mocked(backend.fetchEmbeddingConfigs).mockResolvedValue([]);
    vi.mocked(backend.fetchVectorSearchConfig).mockResolvedValue({
      enabled: false, workerUrl: '', authToken: '', embeddingConfigId: '', indexMode: 'readme', readmeMaxChars: 6000,
    });
  };

  beforeEach(() => {
    originalState = useAppStore.getState();
    stubBackendSlices();
    resetSyncHashes();
    vi.mocked(backend.fetchSettings).mockResolvedValue({});
    vi.mocked(backend.syncSettings).mockClear();
    // 设置推送发生在已登录会话中（R5 审计修复：无账号上下文的空仓库推送会被
    // autoSync 拒绝——服务端会回退 active_account_id 分区，空快照可能清空分区），
    // 测试同样必须提供已登录且仓库非空的会话前提。
    useAppStore.setState({
      user: { id: 1, login: 'alice', name: 'Alice', avatar_url: 'https://x/a.png', email: null },
      githubToken: 'ghp_a',
      isAuthenticated: true,
      repositories: [createRepository(1)],
    });
    useAppStore.setState({ defaultCategoryOverrides: {} });
  });

  afterEach(() => {
    if (unsubscribe) {
      stopAutoSync(unsubscribe);
      unsubscribe = undefined;
    }
    useAppStore.setState(originalState);
  });

  it('applies defaultCategoryOverrides from backend settings', async () => {
    const defaultCategoryOverrides = { web: { name: 'Web Apps', keywords: ['web'] } };
    vi.mocked(backend.fetchSettings).mockResolvedValue({ defaultCategoryOverrides });

    await syncFromBackend();

    expect(useAppStore.getState().defaultCategoryOverrides).toEqual(defaultCategoryOverrides);
  });

  it('pushes defaultCategoryOverrides with the rest of settings', async () => {
    const defaultCategoryOverrides = { ai: { name: 'AI Tools', icon: 'sparkles' } };
    // 完整设置快照仅在该 (账号, 后端) 成功读取过设置后才允许发送（R2-C6/
    // 审计修复）：未读取成功时本地默认值不得整包推送覆盖后端配置。先完成
    // 一次成功拉取对齐，再验证完整载荷携带本次修改的设置。
    await syncFromBackend();
    useAppStore.setState({ defaultCategoryOverrides });

    await syncToBackend();

    expect(vi.mocked(backend.syncSettings)).toHaveBeenCalledWith(
      expect.objectContaining({ defaultCategoryOverrides }),
    );
  });

  it('queues a backend push when defaultCategoryOverrides change locally', async () => {
    vi.useFakeTimers();
    try {
      unsubscribe = startAutoSync();
      vi.mocked(backend.syncSettings).mockClear();
      useAppStore.setState({ defaultCategoryOverrides: { web: { name: 'Web' } } });
      await vi.advanceTimersByTimeAsync(2000);
      expect(vi.mocked(backend.syncSettings)).toHaveBeenCalledWith(
        expect.objectContaining({ defaultCategoryOverrides: { web: { name: 'Web' } } }),
      );
    } finally {
      if (unsubscribe) {
        stopAutoSync(unsubscribe);
        unsubscribe = undefined;
      }
      vi.useRealTimers();
    }
  });
});

describe('explicit backend push error reporting', () => {
  beforeEach(() => {
    // 推送前提与生产一致：已登录且本地仓库非空（R5 审计修复后，无账号上下文
    // 的空仓库推送会被 autoSync 拒绝）
    resetSyncHashes();
    useAppStore.setState({
      user: { id: 1, login: 'alice', name: 'Alice', avatar_url: 'https://x/a.png', email: null },
      githubToken: 'ghp_a',
      isAuthenticated: true,
      repositories: [createRepository(1)],
    });
  });

  afterEach(() => {
    resetSyncHashes();
  });

  it('resolves when all backend writes succeed', async () => {
    await expect(forceSyncToBackend()).resolves.toBe(true);
    expect(backend.syncRepositories).toHaveBeenCalled();
  });

  it('reports settled slice failures without rejecting automatic pushes', async () => {
    vi.mocked(backend.syncRepositories).mockRejectedValueOnce(new Error('offline'));
    await expect(syncToBackend()).resolves.toBe(false);
    vi.mocked(backend.syncRepositories).mockRejectedValueOnce(new Error('offline'));
    await expect(forceSyncToBackend()).resolves.toBe(false);
    vi.mocked(backend.syncRepositories).mockRejectedValueOnce(new Error('offline'));
    await expect(forceSyncToBackend({ reportFailures: true })).rejects.toThrow('Failed to sync to backend');
    // Failure must release the push lock, allowing a subsequent successful retry.
    await expect(forceSyncToBackend()).resolves.toBe(true);
  });

  it('reports synchronous adapter exceptions from the outer catch', async () => {
    vi.mocked(backend.syncRepositories).mockImplementationOnce(() => { throw new Error('adapter failed'); });
    await expect(forceSyncToBackend({ reportFailures: true })).rejects.toThrow('Failed to sync to backend');
    await expect(forceSyncToBackend()).resolves.toBe(true);
  });

  it('keeps standalone mode a no-op when no backend is configured', async () => {
    const available = vi.spyOn(backend, 'isAvailable', 'get').mockReturnValue(false);
    try {
      // 无后端即无待推送：按成功返回（与 syncToBackend 的 no-op 语义一致）
      await expect(forceSyncToBackend()).resolves.toBe(true);
      // 显式校验推送（forceVerify）在后端不可用时必须报告「未尝试写入」，
      // 不得把静默跳过报告为成功（审计修复：手动同步调用方要能看到失败）。
      await expect(forceSyncToBackend({ forceVerify: true })).resolves.toBe(false);
      await expect(
        forceSyncToBackend({ forceVerify: true, reportFailures: true }),
      ).rejects.toThrow('Failed to sync to backend');
    } finally {
      available.mockRestore();
    }
  });
});

describe('destructive push safeguards (Issue #611)', () => {
  const adapter = backend as unknown as { backendUrl?: string };

  beforeEach(() => {
    resetSyncHashes();
    // 推送基线按「后端 + 账号」记录，没有后端上下文时不产生可证明的基线。
    adapter.backendUrl = 'http://backend-a';
    useAppStore.setState({
      user: { id: 1, login: 'alice', name: 'Alice', avatar_url: 'https://x/a.png', email: null },
      githubToken: 'ghp_a',
      isAuthenticated: true,
      repositories: [createRepository(1), createRepository(2)],
    });
  });

  afterEach(() => {
    resetSyncHashes();
    vi.mocked(backend.fetchRepositories).mockReset();
    delete adapter.backendUrl;
  });

  it('does not resurrect repositories the user deleted locally (restart with a fresh module instance)', async () => {
    vi.mocked(backend.fetchRepositories).mockResolvedValue({
      repositories: [createRepository(1), createRepository(2)],
      total: 2,
    });
    await forceSyncToBackend();
    // 第 12 轮审计修复：重启场景用全新模块实例验证——resetSyncHashes() 不会
    // 清空内存中的删除基线，仅靠它无法发现「基线只存内存、持久化写入/读取
    // 失效」的回归。第一次推送必须已把基线写入持久化存储。
    expect(window.localStorage.getItem('gsm.pushedRepoIdsV2'))
      .toContain('http://backend-a|1');

    // Simulate a restart: reload autoSync so every in-memory structure —
    // including the deletion baseline — is rebuilt from persisted storage.
    vi.resetModules();
    const freshAutoSync = await import('./autoSync');
    const freshBackend = (await import('./backendAdapter')).backend as typeof backend;
    const freshStore = (await import('../store/useAppStore')).useAppStore;
    // 等待新 store 实例的持久化水化结算后再播种状态，防止异步水化合并覆盖。
    if (!freshStore.persist.hasHydrated()) {
      await new Promise<void>((resolve) => {
        const unsubscribe = freshStore.persist.onFinishHydration(() => resolve());
        if (freshStore.persist.hasHydrated()) {
          unsubscribe();
          resolve();
        }
      });
    }
    freshStore.setState({
      user: { id: 1, login: 'alice', name: 'Alice', avatar_url: 'https://x/a.png', email: null },
      githubToken: 'ghp_a',
      isAuthenticated: true,
      repositories: [createRepository(1)],
    });
    vi.mocked(freshBackend.fetchRepositories).mockResolvedValue({
      repositories: [createRepository(1), createRepository(2)],
      total: 2,
    });

    // The remote still holds repo 2, but the user deleted it locally. The
    // fresh module instance must recover the deletion baseline from persisted
    // storage and keep repo 2 out of the payload.
    await freshAutoSync.forceSyncToBackend();

    const pushed = vi.mocked(freshBackend.syncRepositories).mock.calls.at(-1)?.[0] ?? [];
    expect(pushed.map((repo) => repo.id)).toEqual([1]);
    expect(freshStore.getState().repositories.map((repo) => repo.id)).toEqual([1]);
  });

  it('defers a destructive push when the remote snapshot is incomplete', async () => {
    vi.mocked(backend.fetchRepositories).mockResolvedValue({ repositories: [createRepository(1)], total: 5 });
    vi.mocked(backend.syncRepositories).mockClear();

    await forceSyncToBackend();

    expect(vi.mocked(backend.syncRepositories)).not.toHaveBeenCalled();

    // 严格调用方（reportFailures）必须收到失败：推送被推迟时绝不能静默报告成功。
    await expect(
      forceSyncToBackend({ reportFailures: true, forceVerify: true }),
    ).rejects.toThrow('Failed to sync to backend');
    expect(vi.mocked(backend.syncRepositories)).not.toHaveBeenCalled();
  });

  it('binds a pending account sync to the backend that queued it', () => {
    const accountId = 'pending-backend-binding';
    adapter.backendUrl = 'http://backend-a';
    markPendingAccountSync(accountId);
    expect(hasPendingAccountSync(accountId)).toBe(true);

    adapter.backendUrl = 'http://backend-b';
    expect(hasPendingAccountSync(accountId)).toBe(false);
    expect(consumePendingAccountSync(accountId)).toBe(false);

    adapter.backendUrl = 'http://backend-a';
    expect(consumePendingAccountSync(accountId)).toBe(true);
  });

  it('does not use another backend baseline to infer deletions', async () => {
    vi.mocked(backend.fetchRepositories).mockResolvedValue({
      repositories: [createRepository(1), createRepository(2)],
      total: 2,
    });
    await forceSyncToBackend();

    // Restart, then connect to a different backend that still has repo 2.
    resetSyncHashes();
    adapter.backendUrl = 'http://backend-b';
    useAppStore.setState({ repositories: [createRepository(1)] });
    vi.mocked(backend.syncRepositories).mockClear();

    await forceSyncToBackend();

    // X's baseline must not mark repo 2 as "deleted locally" on Y.
    const pushed = vi.mocked(backend.syncRepositories).mock.calls.at(-1)?.[0] ?? [];
    expect(pushed.map((repo) => repo.id)).toEqual([1, 2]);
  });

  it('rebinds only restore-window markers registered on the origin backend (C1)', () => {
    const accountId = 'rebind-after-rollback';
    adapter.backendUrl = 'http://window-origin';
    markPendingAccountSync(accountId);
    adapter.backendUrl = 'http://unrelated';
    markPendingAccountSync(accountId);

    // 切换失败、连接回滚到另一个后端：同一账号在来源后端的记录被重绑到目标后端，
    // 来源后端不再有标记，无关后端上的同账号标记完整保留。
    adapter.backendUrl = 'http://original';
    expect(hasPendingAccountSync(accountId)).toBe(false);
    rebindPendingAccountSyncToCurrentBackend(accountId, 'http://window-origin');
    expect(hasPendingAccountSync(accountId)).toBe(true);
    adapter.backendUrl = 'http://window-origin';
    expect(hasPendingAccountSync(accountId)).toBe(false);
    adapter.backendUrl = 'http://unrelated';
    expect(hasPendingAccountSync(accountId)).toBe(true);
  });

  // 审计修复（C2）：409 SNAPSHOT_CONFLICT 重试环路——冲突后重新 GET 对账，
  // 第二次 PUT 携带服务端新 revision，载荷 = 服务端状态 ∪ 本地修改 − 本地明确删除。
  it('re-reconciles with a fresh revision after a 409 snapshot conflict (C2 retry loop)', async () => {
    vi.mocked(backend.syncRepositories).mockClear();
    const conflict = Object.assign(new Error('Repository snapshot has changed'), {
      statusCode: 409,
      code: 'SNAPSHOT_CONFLICT',
    });
    // GET 序列（含 A20x 契约的 revision 字段）：
    // 1) 基线推送观察空分区（rev 5）→ 基线 {1,2}；
    // 2) 冲突尝试 1：其他设备已写入 repo 2/3，服务端快照 rev 7；
    // 3) 冲突后重新 GET：服务端新 revision 8。
    vi.mocked(backend.fetchRepositories)
      .mockResolvedValueOnce({ repositories: [], total: 0, revision: 5 })
      .mockResolvedValueOnce({ repositories: [createRepository(2), createRepository(3)], total: 2, revision: 7 })
      .mockResolvedValueOnce({ repositories: [createRepository(2), createRepository(3), createRepository(4)], total: 3, revision: 8 });
    vi.mocked(backend.syncRepositories)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce(undefined);

    await forceSyncToBackend();
    // 本地明确删除 repo 2（经推送基线记录；本 describe 无订阅器，会话删除集合不参与）
    useAppStore.setState({ repositories: [createRepository(1)] });

    // 冲突 → 重新对账 → 第二次 PUT 成功
    await expect(forceSyncToBackend({ reportFailures: true })).resolves.toBe(true);

    const calls = vi.mocked(backend.syncRepositories).mock.calls;
    // 基线推送：载荷 [1,2]、expectedRevision = 首次 GET 的 rev 5
    expect((calls[0][0] as Repository[]).map(repo => repo.id)).toEqual([1, 2]);
    expect(calls[0][1]).toMatchObject({ expectedRevision: 5 });
    // 冲突尝试：载荷 = 本地 [1] ∪ 服务端保留 [3]——repo 2 已本地删除绝不复活，
    // 远端新增的 repo 3 在载荷中且未被删除
    expect((calls[1][0] as Repository[]).map(repo => repo.id)).toEqual([1, 3]);
    expect(calls[1][1]).toMatchObject({ expectedRevision: 7 });
    // 重新对账后的第二次 PUT：合并 revision 8 新增的 repo 4 且不恢复已删除的 repo 2
    expect((calls[2][0] as Repository[]).map(repo => repo.id)).toEqual([1, 3, 4]);
    expect(calls[2][1]).toMatchObject({ expectedRevision: 8 });
    expect(vi.mocked(backend.syncRepositories)).toHaveBeenCalledTimes(3);
  });

  // 审计修复（C2）：409 重试有界——连续 3 次冲突后放弃：reportFailures 调用方
  // 收到失败、不发第四次 PUT；待推状态保留，下一次推送重新对账成功送达完整载荷。
  it('gives up after three 409 conflicts and keeps the edit retryable (C2 retry bound)', async () => {
    vi.mocked(backend.syncRepositories).mockClear();
    // 独立后端：不继承前序用例在 http://backend-a 上的推送基线
    adapter.backendUrl = 'http://backend-conflict';
    const conflict = Object.assign(new Error('Repository snapshot has changed'), {
      statusCode: 409,
      code: 'SNAPSHOT_CONFLICT',
    });
    // 服务端恒定 rev 9（含其他设备的 repo 3）；三次 PUT 全部冲突
    vi.mocked(backend.fetchRepositories)
      .mockResolvedValue({ repositories: [createRepository(3)], total: 1, revision: 9 });
    vi.mocked(backend.syncRepositories).mockRejectedValue(conflict);

    await expect(forceSyncToBackend({ reportFailures: true })).rejects.toThrow('Failed to sync to backend');

    const calls = vi.mocked(backend.syncRepositories).mock.calls;
    // 有界重试：恰好 3 次 PUT（第三次后不再发第四次），全部携带
    // expectedRevision = 9 与合并载荷（服务端保留的 repo 3 不被本地快照删除）
    expect(calls).toHaveLength(3);
    for (const [payload, options] of calls) {
      expect((payload as Repository[]).map(repo => repo.id)).toEqual([1, 2, 3]);
      expect(options).toEqual(expect.objectContaining({ expectedRevision: 9, backendUrl: 'http://backend-conflict' }));
    }

    // 待推状态保留：下一次推送重新 GET 对账成功，送达完整合并载荷
    vi.mocked(backend.syncRepositories).mockReset().mockResolvedValue(undefined);
    await expect(forceSyncToBackend()).resolves.toBe(true);
    const retryCalls = vi.mocked(backend.syncRepositories).mock.calls;
    expect(retryCalls).toHaveLength(1);
    expect((retryCalls[0][0] as Repository[]).map(repo => repo.id)).toEqual([1, 2, 3]);
    expect(retryCalls[0][1]).toEqual(expect.objectContaining({ expectedRevision: 9, backendUrl: 'http://backend-conflict' }));
  });
});

describe('hasActiveSearchFilters (Issue #304 searchResults guard)', () => {
  const baseFilters = (): import('../types').SearchFilters => ({
    query: '',
    languages: [],
    tags: [],
    platforms: [],
    licenses: [],
    sortBy: 'stars',
    sortOrder: 'desc',
  });

  it('treats a non-empty query as active', () => {
    expect(hasActiveSearchFilters({ ...baseFilters(), query: 'react' })).toBe(true);
  });

  it('treats default sort as inactive and a changed sort as active', () => {
    expect(hasActiveSearchFilters(baseFilters())).toBe(false);
    expect(hasActiveSearchFilters({ ...baseFilters(), sortBy: 'updated' })).toBe(true);
  });

  it('treats facet selections as active', () => {
    expect(hasActiveSearchFilters({ ...baseFilters(), languages: ['TypeScript'] })).toBe(true);
    expect(hasActiveSearchFilters({ ...baseFilters(), licenses: ['MIT'] })).toBe(true);
  });

  it('treats a license-only selection as active (CodeRabbit)', () => {
    expect(hasActiveSearchFilters({ ...baseFilters(), licenses: ['MIT'] })).toBe(true);
  });
});


describe('backend pushes requested during another sync', () => {
  let originalState: ReturnType<typeof useAppStore.getState>;
  let unsubscribe: () => void;
  const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
  };

  beforeEach(() => {
    originalState = useAppStore.getState();
    vi.mocked(backend.syncRepositories).mockReset().mockResolvedValue(undefined);
    vi.mocked(backend.fetchRepositories).mockResolvedValue({ repositories: [], total: 0 });
    vi.mocked(backend.fetchReleases).mockResolvedValue({ releases: [], total: 0 });
    vi.mocked(backend.fetchAIConfigs).mockResolvedValue([]);
    vi.mocked(backend.fetchWebDAVConfigs).mockResolvedValue([]);
    vi.mocked(backend.fetchEmbeddingConfigs).mockResolvedValue([]);
    vi.mocked(backend.fetchSettings).mockResolvedValue({});
    resetSyncHashes();
    useAppStore.setState({ repositories: [createRepository(1)] });
    unsubscribe = startAutoSync();
  });

  afterEach(() => {
    stopAutoSync(unsubscribe);
    useAppStore.setState(originalState);
  });

  it('waits for the push queued behind a pull and reports its failure', async () => {
    const fetch = deferred<{ repositories: Repository[]; total: number }>();
    vi.mocked(backend.fetchRepositories).mockReturnValueOnce(fetch.promise);
    const pull = syncFromBackend();
    useAppStore.getState().addRepository(createRepository(2));
    vi.mocked(backend.syncRepositories).mockRejectedValue(new Error('offline'));
    let settled = false;
    const forced = forceSyncToBackend({ reportFailures: true });
    const outcome = forced.then(() => { settled = true; return ''; }, error => {
      settled = true;
      return (error as Error).message;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    fetch.resolve({ repositories: [createRepository(1)], total: 1 });
    await pull;
    expect(await outcome).toBe('Failed to sync to backend');
    expect(useAppStore.getState().repositories.map(repo => repo.full_name)).toContain('owner/repo-2');
    // A20x：全量推送携带 GET 记录的 expectedRevision（测试桩无 revision → null）
    expect(backend.syncRepositories).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ full_name: 'owner/repo-2' })]),
      expect.objectContaining({ expectedRevision: null }),
    );
    vi.mocked(backend.syncRepositories).mockResolvedValue(undefined);
    await expect(forceSyncToBackend()).resolves.toBe(true);
  });

  // 仓库分片未变化时不再重复发送 isFullSync 快照：在途快照已包含编辑时，
  // 排队中的补推被安全跳过（只推送一次最新快照）。
  it('pushes the latest snapshot once and skips the redundant queued push', async () => {
    const first = deferred<void>();
    vi.mocked(backend.syncRepositories).mockReturnValueOnce(first.promise);
    const initialPush = syncToBackend();
    useAppStore.getState().addRepository(createRepository(2));
    const forced = forceSyncToBackend({ reportFailures: true });
    first.resolve();
    await forced;
    await initialPush;
    expect(backend.syncRepositories).toHaveBeenCalledTimes(1);
    expect(vi.mocked(backend.syncRepositories).mock.calls[0][0]).toEqual(
      expect.arrayContaining([expect.objectContaining({ full_name: 'owner/repo-2' })]),
    );
  });

  // 审计修复（C59）：A20x 合并推送下「首份载荷已发出后新增的仓库」必须有
  // 第二份载荷送达，绝不因快照去重丢失编辑。
  it('sends the new repository in a second payload after the first snapshot already went out (C59)', async () => {
    // 首份 PUT 在途：此刻 addRepository 尚未发生，首份载荷只含旧仓库
    const putGate = deferred<void>();
    vi.mocked(backend.syncRepositories).mockReturnValueOnce(putGate.promise);
    const initialPush = syncToBackend();
    await vi.waitFor(() => expect(vi.mocked(backend.syncRepositories)).toHaveBeenCalledTimes(1));
    const firstPayload = vi.mocked(backend.syncRepositories).mock.calls[0][0] as Repository[];
    expect(firstPayload.map(repo => repo.full_name)).toEqual(['owner/repo-1']);

    // 首份载荷已收到后再编辑：放行首份写入，排空循环送出包含新仓库的第二份
    useAppStore.getState().addRepository(createRepository(2));
    putGate.resolve();
    await initialPush;

    await vi.waitFor(() => expect(vi.mocked(backend.syncRepositories)).toHaveBeenCalledTimes(2));
    const secondPayload = vi.mocked(backend.syncRepositories).mock.calls[1][0] as Repository[];
    expect(secondPayload.map(repo => repo.full_name)).toEqual(['owner/repo-1', 'owner/repo-2']);
  });

  it('rejects a strict caller and keeps the edit retryable when the second write fails (C59)', async () => {
    const firstPutGate = deferred<void>();
    vi.mocked(backend.syncRepositories)
      .mockReturnValueOnce(firstPutGate.promise)
      .mockRejectedValueOnce(new Error('offline'));
    const initialPush = syncToBackend();
    await vi.waitFor(() => expect(vi.mocked(backend.syncRepositories)).toHaveBeenCalledTimes(1));

    // 首份载荷仍在途时编辑并启动严格推送：排队等待第二份写入
    useAppStore.getState().addRepository(createRepository(2));
    const strictPush = forceSyncToBackend({ reportFailures: true });
    const strictOutcome = expect(strictPush).rejects.toThrow('Failed to sync to backend');

    // 放行首份 PUT、拒绝第二份 PUT：严格调用方必须收到拒绝而非首份写入的成功
    firstPutGate.resolve();
    await initialPush;
    await strictOutcome;

    // 编辑可重试：恢复写入后再次严格同步成功，且载荷包含此前丢失的新仓库
    vi.mocked(backend.syncRepositories).mockResolvedValue(undefined);
    await expect(forceSyncToBackend()).resolves.toBe(true);
    const payloads = vi.mocked(backend.syncRepositories).mock.calls.map(call => call[0] as Repository[]);
    expect(payloads.at(-1)!.map(repo => repo.full_name)).toEqual(['owner/repo-1', 'owner/repo-2']);
  });

  it('keeps remotely arrived repositories when local edits queue a push after the pull', async () => {
    const fetch = deferred<{ repositories: Repository[]; total: number }>();
    vi.mocked(backend.fetchRepositories).mockReturnValueOnce(fetch.promise);
    const pull = syncFromBackend();
    useAppStore.getState().addRepository(createRepository(2));
    fetch.resolve({ repositories: [createRepository(1), createRepository(3)], total: 2 });
    await pull;

    const fullNames = useAppStore.getState().repositories.map(repo => repo.full_name);
    expect(fullNames).toContain('owner/repo-2');
    expect(fullNames).toContain('owner/repo-3');

    await syncToBackend();
    const pushedCalls = vi.mocked(backend.syncRepositories).mock.calls;
    const pushed = pushedCalls[pushedCalls.length - 1][0];
    const pushedNames = pushed.map(repo => repo.full_name);
    expect(pushedNames).toContain('owner/repo-2');
    expect(pushedNames).toContain('owner/repo-3');
  });

  it('does not resurrect repositories deleted locally during the pull', async () => {
    const fetch = deferred<{ repositories: Repository[]; total: number }>();
    vi.mocked(backend.fetchRepositories).mockReturnValueOnce(fetch.promise);
    const pull = syncFromBackend();
    useAppStore.getState().deleteRepository(createRepository(1).id);
    fetch.resolve({ repositories: [createRepository(1), createRepository(3)], total: 2 });
    await pull;

    const fullNames = useAppStore.getState().repositories.map(repo => repo.full_name);
    expect(fullNames).not.toContain('owner/repo-1');
    expect(fullNames).toContain('owner/repo-3');
  });

  it('does not queue a push when the repositories fetch fails during local edits', async () => {
    vi.mocked(backend.fetchRepositories).mockRejectedValueOnce(new Error('offline'));
    const pull = syncFromBackend();
    useAppStore.getState().addRepository(createRepository(2));
    await pull;

    expect(backend.syncRepositories).not.toHaveBeenCalled();
    expect(useAppStore.getState().repositories.map(repo => repo.full_name)).toContain('owner/repo-2');
  });

  it('treats a successful empty repository list as valid when local edits queue a push', async () => {
    const fetch = deferred<{ repositories: Repository[]; total: number }>();
    vi.mocked(backend.fetchRepositories).mockReturnValueOnce(fetch.promise);
    const pull = syncFromBackend();
    useAppStore.getState().addRepository(createRepository(2));
    fetch.resolve({ repositories: [], total: 0 });
    await pull;

    await vi.waitFor(() => expect(backend.syncRepositories).toHaveBeenCalled());
    const pushedCalls = vi.mocked(backend.syncRepositories).mock.calls;
    const pushed = pushedCalls[pushedCalls.length - 1][0];
    expect(pushed.map(repo => repo.full_name)).toContain('owner/repo-2');
    expect(useAppStore.getState().repositories.map(repo => repo.full_name)).toContain('owner/repo-2');
  });
});
