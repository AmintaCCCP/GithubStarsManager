import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../../../types';
import { useVectorSearchActions, type VectorIndexDraft } from './useVectorSearchActions';
import { useAppStore } from '../../../store/useAppStore';

const mocks = vi.hoisted(() => ({
  useAppStore: vi.fn(),
  needsReindex: vi.fn(),
  indexAllRepos: vi.fn(),
  cleanup: vi.fn(),
  vectorGetStatus: vi.fn(),
  vectorTestConnection: vi.fn(),
  setVectorIndexingState: vi.fn(),
  setVectorSearchConfig: vi.fn(),
  setVectorSearchStatus: vi.fn(),
  updateRepositoriesMetadata: vi.fn(),
}));

vi.mock('../../../store/useAppStore', () => ({
  EMBEDDING_FORMAT_VERSION: 3,
  LEGACY_EMBEDDING_FORMAT_VERSION: 1,
  isKnownEmbeddingFormatVersion: (value: unknown) => value === 1 || value === 2 || value === 3,
  useAppStore: mocks.useAppStore,
}));
vi.mock('../../../services/vectorSearchService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/vectorSearchService')>();
  return {
    // 保留真实的账号隔离向量 ID 编解码工具（runIndex 的 cleanup keepIds 依赖）
    ...actual,
    EMBEDDING_FORMAT_VERSION: 3,
    EmbeddingClient: class {},
    VectorSearchService: class {
      cleanup = mocks.cleanup;
      getStatus = mocks.vectorGetStatus;
      testConnection = mocks.vectorTestConnection;
    },
    indexAllRepos: mocks.indexAllRepos,
    needsReindex: mocks.needsReindex,
    // 与真实实现同构：分析过滤 → 增量 needsReindex → 按 id 首条去重
    selectIndexableRepos: (repos: Repository[], options: { incremental?: boolean; formatVersion?: number; currentFormatVersion?: number } = {}) => {
      let indexable = repos.filter((repo) => repo.analyzed_at && !repo.analysis_failed);
      if (options.incremental) {
        const formatVersionChanged = (options.formatVersion ?? 1) < (options.currentFormatVersion ?? 3);
        indexable = indexable.filter((repo) => mocks.needsReindex(repo, formatVersionChanged));
      }
      const seen = new Set<number>();
      return indexable.filter((repo) => {
        if (seen.has(repo.id)) return false;
        seen.add(repo.id);
        return true;
      });
    },
  };
});
vi.mock('../../../services/githubApi', () => ({ GitHubApiService: class {} }));
vi.mock('../../../utils/licenseFilter', () => ({ normalizeLicense: (value: string | null) => value }));

const repository = {
  id: 1,
  name: 'repository',
  full_name: 'owner/repository',
  owner: { login: 'owner' },
  analyzed_at: '2026-08-25T00:00:00.000Z',
  analysis_failed: false,
  license: null,
} as Repository;

const draft: VectorIndexDraft = {
  apiType: 'openai',
  baseUrl: 'https://example.com/v1',
  apiKey: 'key',
  model: 'text-embedding-3-small',
  dimensions: 1536,
  workerUrl: 'https://worker.example.com',
  authToken: 'worker-token',
  indexMode: 'description',
  readmeMaxChars: 6000,
};

const createStoreState = () => ({
  embeddingConfigs: [{
    id: 'embedding', name: 'Embedding', apiType: 'openai' as const,
    baseUrl: 'https://example.com/v1', apiKey: 'key', model: 'text-embedding-3-small', dimensions: 1536, isActive: true,
  }],
  activeEmbeddingConfig: 'embedding',
  vectorSearchConfig: { embeddingFormatVersion: 1, enabled: true },
  repositories: [repository],
  githubToken: null,
  setVectorSearchStatus: mocks.setVectorSearchStatus,
  setVectorIndexingState: mocks.setVectorIndexingState,
  setVectorSearchConfig: mocks.setVectorSearchConfig,
  updateRepositoriesMetadata: mocks.updateRepositoriesMetadata,
});

let storeState = createStoreState();
const mockUseAppStore = vi.mocked(useAppStore);

describe('useVectorSearchActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState = createStoreState();
    mockUseAppStore.mockImplementation(((selector?: (state: typeof storeState) => unknown) => (
      selector ? selector(storeState) : storeState
    )) as typeof useAppStore);
    Object.assign(mockUseAppStore, { getState: () => storeState });
    // cleanup 范围约定（R5 发现 2）需要活跃账号上下文与新版 Worker 能力探针：
    // 真实重建流程总在已登录会话中执行
    (storeState as { user?: unknown }).user = { id: 1, login: 'me', avatar_url: '' };
    mocks.cleanup.mockResolvedValue(undefined);
    mocks.vectorGetStatus.mockResolvedValue({ success: true, vectorCount: 0, dimensions: 1536, accountScopedCleanup: true });
    mocks.needsReindex.mockReset();
    mocks.needsReindex.mockReturnValue(false);
  });

  it('keeps the embedding format migration pending when indexing has failed repositories', async () => {
    mocks.indexAllRepos.mockResolvedValue({ indexed: 0, skipped: 0, errors: 1, indexedRepoIds: [] });
    const { result } = renderHook(() => useVectorSearchActions());

    await act(async () => { await result.current.rebuildIndex(draft); });

    expect(mocks.setVectorSearchConfig).not.toHaveBeenCalled();
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(mocks.setVectorIndexingState).toHaveBeenLastCalledWith(expect.objectContaining({
      isIndexing: false,
      result: expect.objectContaining({ errors: 1 }),
    }));
  });

  it('keeps the format migration pending when an existing legacy vector is excluded from indexing', async () => {
    storeState.repositories = [
      repository,
      { ...repository, id: 2, analyzed_at: undefined, analysis_failed: true, vector_indexed_at: '2026-08-01T00:00:00.000Z' } as Repository,
    ];
    mocks.indexAllRepos.mockResolvedValue({ indexed: 1, skipped: 1, errors: 0, indexedRepoIds: [1] });
    const { result } = renderHook(() => useVectorSearchActions());

    await act(async () => { await result.current.rebuildIndex(draft); });
    await act(async () => { await result.current.rebuildIndex(draft); });

    expect(mocks.setVectorSearchConfig).not.toHaveBeenCalled();
    const expectedCleanupOptions = { accountPrefix: '1', includeLegacy: true, signal: expect.any(AbortSignal) };
    expect(mocks.cleanup).toHaveBeenNthCalledWith(1, ['1:1', '2', '1:2'], expectedCleanupOptions);
    expect(mocks.cleanup).toHaveBeenNthCalledWith(2, ['1:1', '2', '1:2'], expectedCleanupOptions);
    expect(mocks.updateRepositoriesMetadata).not.toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: 2 }),
    ]));
    expect(mocks.setVectorSearchStatus).toHaveBeenLastCalledWith(expect.objectContaining({ vectorCount: 2 }));
  });

  it('counts unindexed repositories among eligible ones (migration forces all eligible)', () => {
    storeState.repositories = [
      repository,
      { ...repository, id: 2 } as Repository,
      { ...repository, id: 3, analyzed_at: undefined } as Repository,
      { ...repository, id: 4, analyzed_at: '2026-08-25T00:00:00.000Z', analysis_failed: true } as Repository,
    ];
    // formatVersionChanged = true here (fixture embeddingFormatVersion 1 < 3):
    // eligible repos count regardless of per-repo predicate args.
    mocks.needsReindex.mockImplementation((repo: Repository) => repo.id !== 99);
    const { result } = renderHook(() => useVectorSearchActions());
    expect(result.current.unindexedRepoCount).toBe(2);
    expect(result.current.incrementalTargetCount).toBe(2);
  });

  it('excludes up-to-date repositories when no migration is pending', () => {
    storeState.vectorSearchConfig.embeddingFormatVersion = 3;
    storeState.repositories = [repository, { ...repository, id: 2 } as Repository];
    mocks.needsReindex.mockImplementation((repo: Repository) => repo.id === 2);
    const { result } = renderHook(() => useVectorSearchActions());
    expect(result.current.unindexedRepoCount).toBe(1);
    expect(result.current.incrementalTargetCount).toBe(1);
  });

  it('reports zero unindexed repositories when vector search is disabled', () => {
    storeState.vectorSearchConfig.enabled = false;
    mocks.needsReindex.mockReturnValue(true);
    const { result } = renderHook(() => useVectorSearchActions());
    expect(result.current.unindexedRepoCount).toBe(0);
  });

  it('treats an AbortError from cleanup as a cancelled index operation', async () => {
    mocks.indexAllRepos.mockResolvedValue({ indexed: 1, skipped: 0, errors: 0, indexedRepoIds: [1] });
    mocks.cleanup.mockImplementation((_ids: string[], options: { signal: AbortSignal }) => new Promise<void>((_, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const { result } = renderHook(() => useVectorSearchActions());

    let indexing!: Promise<void>;
    act(() => { indexing = result.current.rebuildIndex(draft); });
    await waitFor(() => expect(mocks.cleanup).toHaveBeenCalledTimes(1));
    act(() => { result.current.abortIndexing(); });
    await act(async () => { await indexing; });

    expect(mocks.setVectorIndexingState).toHaveBeenLastCalledWith({ isIndexing: false, phase: null, result: null });
    expect(mocks.setVectorSearchConfig).not.toHaveBeenCalled();
  });
});

/**
 * 账号代次校验回归（Issue #611 审计修复）：
 * - 共享 Worker 索引中可能有其他设备/其他账号上传的向量（R5 发现 2）：
 *   新版 Worker（/status 声明 accountScopedCleanup）按 accountPrefix 只删除
 *   当前账号前缀的向量，legacy 向量仅在本机单账号时清理；旧版 Worker 无法
 *   按账号限定删除范围——一律跳过 cleanup，绝不删除其他账号的数据；
 * - 索引任务切号后不得把共享索引状态/向量状态/格式版本写入新账号。
 */
describe('useVectorSearchActions account switch guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState = createStoreState();
    mockUseAppStore.mockImplementation(((selector?: (state: typeof storeState) => unknown) => (
      selector ? selector(storeState) : storeState
    )) as typeof useAppStore);
    Object.assign(mockUseAppStore, { getState: () => storeState });
    (storeState as { user?: unknown }).user = { id: 1, login: 'me', avatar_url: '' };
    mocks.cleanup.mockResolvedValue(undefined);
    mocks.vectorGetStatus.mockResolvedValue({ success: true, vectorCount: 0, dimensions: 1536, accountScopedCleanup: true });
    mocks.needsReindex.mockReset();
    mocks.needsReindex.mockReturnValue(false);
  });

  const seedTwoAccounts = () => {
    (storeState as { savedAccounts?: Record<string, unknown> }).savedAccounts = {
      '1': { accountId: '1' },
      '2': { accountId: '2' },
    };
  };

  it('scopes vector cleanup to the active account while the index is shared across local accounts (new worker)', async () => {
    seedTwoAccounts();
    mocks.indexAllRepos.mockResolvedValue({ indexed: 1, skipped: 0, errors: 0, indexedRepoIds: [1] });
    const { result } = renderHook(() => useVectorSearchActions());

    await act(async () => { await result.current.rebuildIndex(draft); });

    // R5 审计修复：新版 Worker 按账号前缀删除——本机多账号也不再跳过 cleanup，
    // 但只允许删除当前账号（id=1）前缀的向量；legacy 向量归属不明，绝不删除
    expect(mocks.vectorGetStatus).toHaveBeenCalledTimes(1);
    expect(mocks.cleanup).toHaveBeenCalledWith(['1:1'], {
      accountPrefix: '1',
      includeLegacy: false,
      signal: expect.any(AbortSignal),
    });
    // 索引本身照常完成并更新本账号状态
    expect(mocks.setVectorIndexingState).toHaveBeenLastCalledWith(expect.objectContaining({ isIndexing: false }));
    expect(mocks.setVectorSearchStatus).toHaveBeenCalled();
  });

  it('clears legacy vectors only for a single-account device (identity claim alignment)', async () => {
    mocks.indexAllRepos.mockResolvedValue({ indexed: 1, skipped: 0, errors: 0, indexedRepoIds: [1] });
    const { result } = renderHook(() => useVectorSearchActions());

    await act(async () => { await result.current.rebuildIndex(draft); });

    // 本机单账号：legacy 无前缀向量属于单租户时代的唯一所有者，随重建清理
    expect(mocks.cleanup).toHaveBeenCalledWith(['1:1'], {
      accountPrefix: '1',
      includeLegacy: true,
      signal: expect.any(AbortSignal),
    });
  });

  it('skips vector cleanup when the worker does not advertise account-scoped deletion (old deployment)', async () => {
    // 旧版 Worker 会把 keepIds 之外的全部采样向量物理删除（含其他设备上传的
    // 其他账号向量）：无论本机账号数量，一律跳过
    mocks.vectorGetStatus.mockResolvedValue({ success: true, vectorCount: 0, dimensions: 1536 });
    seedTwoAccounts();
    mocks.indexAllRepos.mockResolvedValue({ indexed: 1, skipped: 0, errors: 0, indexedRepoIds: [1] });
    const { result } = renderHook(() => useVectorSearchActions());

    await act(async () => { await result.current.rebuildIndex(draft); });

    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(mocks.setVectorIndexingState).toHaveBeenLastCalledWith(expect.objectContaining({ isIndexing: false }));
    expect(mocks.setVectorSearchStatus).toHaveBeenCalled();
  });

  it('skips vector cleanup for a single-account device on an old worker too (other devices may hold other accounts)', async () => {
    // R5 发现 2 的原始场景：两台设备各只保存一个账号、指向同一 Worker——
    // 本机账号数量无法发现另一台设备上的账号，旧 Worker 一律不清理
    mocks.vectorGetStatus.mockResolvedValue({ success: true, vectorCount: 0, dimensions: 1536 });
    mocks.indexAllRepos.mockResolvedValue({ indexed: 1, skipped: 0, errors: 0, indexedRepoIds: [1] });
    const { result } = renderHook(() => useVectorSearchActions());

    await act(async () => { await result.current.rebuildIndex(draft); });

    expect(mocks.cleanup).not.toHaveBeenCalled();
  });

  it('skips vector cleanup when the worker status probe fails', async () => {
    mocks.vectorGetStatus.mockRejectedValue(new Error('worker unreachable'));
    mocks.indexAllRepos.mockResolvedValue({ indexed: 1, skipped: 0, errors: 0, indexedRepoIds: [1] });
    const { result } = renderHook(() => useVectorSearchActions());

    await act(async () => { await result.current.rebuildIndex(draft); });

    expect(mocks.cleanup).not.toHaveBeenCalled();
    // 探针失败只影响清理，索引结果照常落盘
    expect(mocks.setVectorIndexingState).toHaveBeenLastCalledWith(expect.objectContaining({
      isIndexing: false,
      result: expect.objectContaining({ indexed: 1 }),
    }));
  });

  it('still runs cleanup for a single-account index (control)', async () => {
    mocks.indexAllRepos.mockResolvedValue({ indexed: 1, skipped: 0, errors: 0, indexedRepoIds: [1] });
    const { result } = renderHook(() => useVectorSearchActions());

    await act(async () => { await result.current.rebuildIndex(draft); });

    // R4 审计修复：keepIds 与索引中的实际向量 ID 形态一致——账号前缀形态
    //（发起账号 id=1 → '1:1'）
    expect(mocks.cleanup).toHaveBeenCalledWith(['1:1'], {
      accountPrefix: '1',
      includeLegacy: true,
      signal: expect.any(AbortSignal),
    });
  });

  it('passes the owning account to indexAllRepos for account-scoped vector IDs (R4)', async () => {
    mocks.indexAllRepos.mockResolvedValue({ indexed: 1, skipped: 0, errors: 0, indexedRepoIds: [1] });
    const { result } = renderHook(() => useVectorSearchActions());

    await act(async () => { await result.current.rebuildIndex(draft); });

    // 账号隔离：向量 ID 以发起账号为前缀、metadata 记录归属（indexAllRepos 侧实现）
    expect(mocks.indexAllRepos).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ accountId: '1' }),
    );
  });

  it('keeps excluded repos in cleanup keepIds in both legacy and account-scoped forms (R4)', async () => {
    // 排除项（已索引但分析缺失/失败）的存量向量可能是 legacy 或前缀形态：
    // cleanup 按 keepIds 之外的 ID 物理删除，漏掉任一形态都会误删向量
    storeState.repositories = [
      repository,
      { ...repository, id: 2, analyzed_at: undefined, analysis_failed: true, vector_indexed_at: '2026-08-01T00:00:00.000Z' } as Repository,
    ];
    mocks.indexAllRepos.mockResolvedValue({ indexed: 1, skipped: 1, errors: 0, indexedRepoIds: [1] });
    const { result } = renderHook(() => useVectorSearchActions());

    await act(async () => { await result.current.rebuildIndex(draft); });

    expect(mocks.cleanup).toHaveBeenCalledWith(['1:1', '2', '1:2'], {
      accountPrefix: '1',
      includeLegacy: true,
      signal: expect.any(AbortSignal),
    });
  });

  it('does not write indexing state into the new account after a mid-task switch', async () => {
    mocks.indexAllRepos.mockImplementation(async () => {
      (storeState as { user?: unknown }).user = { id: 2, login: 'other', avatar_url: '' };
      return { indexed: 1, skipped: 0, errors: 0, indexedRepoIds: [1] };
    });
    const { result } = renderHook(() => useVectorSearchActions());

    await act(async () => { await result.current.rebuildIndex(draft); });

    // 初始 isIndexing:true 之后的所有收尾写入（含 isIndexing:false、
    // vectorSearchStatus、格式版本）都因切号被丢弃
    expect(mocks.setVectorIndexingState).toHaveBeenCalledTimes(1);
    expect(mocks.setVectorIndexingState).toHaveBeenCalledWith({ isIndexing: true, phase: null, phaseDone: 0, phaseTotal: 0, result: null });
    expect(mocks.setVectorSearchStatus).not.toHaveBeenCalled();
    expect(mocks.setVectorSearchConfig).not.toHaveBeenCalled();
  });

  it('supersedes an in-flight index task when a new one starts; the old task writes nothing', async () => {
    // 审计修复回归：仅靠账号 ID 判过期在 A→B→A 切回后会重新匹配，旧任务
    // 得以通过检查并覆盖新任务的运行状态/结果。这里以同账号连续两次
    // rebuildIndex 模拟任务取代：旧任务（已被新任务取消）不得写任何共享状态。
    const resolvers: Array<(value: { indexed: number; skipped: number; errors: number; indexedRepoIds: number[] }) => void> = [];
    mocks.indexAllRepos.mockImplementation((_repos: unknown, _embedding: unknown, _vector: unknown, options: { signal?: AbortSignal }) => (
      new Promise((resolve) => {
        resolvers.push(resolve);
        options.signal?.addEventListener('abort', () => resolve({ indexed: 0, skipped: 0, errors: 1, indexedRepoIds: [] }));
      })
    ));
    const { result } = renderHook(() => useVectorSearchActions());

    let first!: Promise<void>;
    act(() => { first = result.current.rebuildIndex(draft); });
    await act(async () => { await Promise.resolve(); });
    let second!: Promise<void>;
    await act(async () => { second = result.current.rebuildIndex(draft); });
    // 放行两个任务：旧任务已被取代，新任务是当前任务
    await act(async () => {
      resolvers[0]?.({ indexed: 9, skipped: 0, errors: 0, indexedRepoIds: [1] });
      resolvers[1]?.({ indexed: 1, skipped: 0, errors: 0, indexedRepoIds: [1] });
      await first;
      await second;
    });

    // 旧任务的收尾写入全部跳过：result 只由新任务写入一次
    const resultWrites = mocks.setVectorIndexingState.mock.calls.filter(
      (call) => {
        const payload = call[0] as { result?: unknown };
        return payload.result !== undefined && payload.result !== null;
      },
    );
    expect(resultWrites).toHaveLength(1);
    expect((resultWrites[0][0] as { result: { indexed: number } }).result.indexed).toBe(1);
    expect(mocks.setVectorIndexingState).toHaveBeenLastCalledWith(expect.objectContaining({ isIndexing: false }));
    expect(mocks.setVectorSearchStatus).toHaveBeenCalledTimes(1);
    expect(mocks.setVectorSearchConfig).toHaveBeenCalledTimes(1);
  });

  it('still resets the running state when the user cancels the current task (control)', async () => {
    // 取消路径保持既有行为：当前任务被用户取消时 isIndexing 必须复位
    mocks.indexAllRepos.mockImplementation((_repos: unknown, _embedding: unknown, _vector: unknown, options: { signal?: AbortSignal }) => (
      new Promise((resolve) => {
        options.signal?.addEventListener('abort', () => resolve({ indexed: 0, skipped: 0, errors: 1, indexedRepoIds: [] }));
      })
    ));
    const { result } = renderHook(() => useVectorSearchActions());

    let indexing!: Promise<void>;
    act(() => { indexing = result.current.rebuildIndex(draft); });
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.abortIndexing(); });
    await act(async () => { await indexing; });

    expect(mocks.setVectorIndexingState).toHaveBeenLastCalledWith({ isIndexing: false, phase: null, result: null });
    expect(mocks.setVectorSearchStatus).not.toHaveBeenCalled();
  });

  it('writes connection status for the current account after a successful worker test', async () => {
    mocks.vectorTestConnection.mockResolvedValue({ success: true, vectorCount: 5, dimensions: 1536 });
    const { result } = renderHook(() => useVectorSearchActions());

    await act(async () => { await result.current.testWorker({ workerUrl: 'https://worker.example.com', authToken: 'worker-token' }); });

    expect(mocks.setVectorSearchStatus).toHaveBeenCalledWith({ connected: true, vectorCount: 5, dimensions: 1536 });
  });

  it('skips the connection status write when the account switched during the worker test', async () => {
    // 审计修复回归：连接测试等待期间切号后，发起账号 A 的连接状态/向量数量/
    // 维度不得写入当前账号 B 的共享 vectorSearchStatus（runIndex 对同类写入
    // 已有账号保护，testWorker 补齐同一约束）；本地测试结果照常展示
    mocks.vectorTestConnection.mockImplementation(async () => {
      (storeState as { user?: unknown }).user = { id: 2, login: 'other', avatar_url: '' };
      return { success: true, vectorCount: 5, dimensions: 1536 };
    });
    const { result } = renderHook(() => useVectorSearchActions());

    await act(async () => { await result.current.testWorker({ workerUrl: 'https://worker.example.com', authToken: 'worker-token' }); });

    expect(mocks.setVectorSearchStatus).not.toHaveBeenCalled();
  });
});
