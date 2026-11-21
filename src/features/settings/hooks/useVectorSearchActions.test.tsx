import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../../../types';
import { useVectorSearchActions, type VectorIndexDraft } from './useVectorSearchActions';
import { useAppStore } from '../../../store/useAppStore';
import { EMBEDDING_FORMAT_VERSION } from '../../../services/vectorSearchService';

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
  backend: {
    isAvailable: true,
    fetchRepositories: vi.fn(),
  },
}));

// R12（finding 26）：格式版本常量必须来自真实实现，测试替身不再各自硬编码
// （旧替身接受 4 而真实上限是 3，导致「当前版本」用例实际验证了非法版本）。
vi.mock('../../../store/useAppStore', async () => {
  const schema = await import('../../../store/schema');
  const vector = await import('../../../services/vectorSearchService');
  return {
    EMBEDDING_FORMAT_VERSION: vector.EMBEDDING_FORMAT_VERSION,
    LEGACY_EMBEDDING_FORMAT_VERSION: schema.LEGACY_EMBEDDING_FORMAT_VERSION,
    isKnownEmbeddingFormatVersion: schema.isKnownEmbeddingFormatVersion,
    useAppStore: mocks.useAppStore,
  };
});

// 审计修复（R5）：清理删除的授权核对依赖后端权威快照——useVectorSearchActions
// 仅在后端可用且快照核对通过时才执行 cleanup，测试必须提供同一契约。
vi.mock('../../../services/backendAdapter', () => ({ backend: mocks.backend }));
vi.mock('../../../services/vectorSearchService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/vectorSearchService')>();
  return {
    // 保留真实的账号隔离向量 ID 编解码工具（runIndex 的 cleanup keepIds 依赖）
    ...actual,
    EmbeddingClient: class {},
    VectorSearchService: class {
      workerId = 'https://worker.example.com';
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
        const formatVersionChanged = (options.formatVersion ?? 1) < (options.currentFormatVersion ?? actual.EMBEDDING_FORMAT_VERSION);
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
  // R2-C24：清理删除的可验证依据（已完成同步、无加载/同步在途）
  isLoading: false,
  isSyncingStars: false,
  lastSync: '2026-08-25T00:00:00.000Z' as string | null,
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
    mocks.cleanup.mockResolvedValue({ deleted: 0, partial: false });
    mocks.vectorGetStatus.mockResolvedValue({ success: true, vectorCount: 0, dimensions: 1536, accountScopedCleanup: true });
    // R5：后端可用且权威快照与本地一致——默认放行 cleanup 授权核对；
    // 权威列表按实时 store 仓库动态构造（与「完全同步」的后端等价）。
    mocks.backend.isAvailable = true;
    mocks.backend.fetchRepositories.mockImplementation(async () => ({
      repositories: storeState.repositories,
      total: storeState.repositories.length,
    }));
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
    // R12：破坏性清理已停用，上传结果（含排除项）一律保留
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(mocks.updateRepositoriesMetadata).not.toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: 2 }),
    ]));
    expect(mocks.setVectorSearchStatus).toHaveBeenLastCalledWith(expect.objectContaining({ vectorCount: 2 }));
  });

  it('stamps migration backfills with the license of the actually uploaded copy (R12 finding 14)', async () => {
    // 该账号尚未在当前 Worker 完成账号范围迁移：indexAllRepos 忽略增量过滤、
    // 全量补写；打戳候选必须复现同一判定，用实际副本的许可证而不是空值。
    storeState.vectorSearchConfig.embeddingFormatVersion = EMBEDDING_FORMAT_VERSION;
    storeState.repositories = [{
      ...repository,
      id: 1,
      license: 'MIT',
      vector_indexed_at: '2026-08-01T00:00:00.000Z',
      vector_indexed_license: 'Apache-2.0',
    } as Repository];
    mocks.needsReindex.mockReturnValue(false);
    mocks.indexAllRepos.mockImplementation(async (_repos: unknown, _embedding: unknown, _vector: unknown, options: { onRepoIndexed?: (id: number) => void }) => {
      options.onRepoIndexed?.(1);
      return { indexed: 1, skipped: 0, errors: 0, indexedRepoIds: [1] };
    });
    const { result } = renderHook(() => useVectorSearchActions());

    await act(async () => { await result.current.incrementalIndex(draft); });

    expect(mocks.updateRepositoriesMetadata).toHaveBeenCalledWith([
      expect.objectContaining({ id: 1, patch: expect.objectContaining({ vector_indexed_license: 'MIT' }) }),
    ]);
  });

  it('counts unindexed repositories among eligible ones (migration forces all eligible)', () => {
    storeState.repositories = [
      repository,
      { ...repository, id: 2 } as Repository,
      { ...repository, id: 3, analyzed_at: undefined } as Repository,
      { ...repository, id: 4, analyzed_at: '2026-08-25T00:00:00.000Z', analysis_failed: true } as Repository,
    ];
    // fixture 的 embeddingFormatVersion 是 legacy(1) < 当前版本：需要迁移，
    // eligible repos 全部计入（与 needsReindex 的逐仓谓词无关）。
    mocks.needsReindex.mockImplementation((repo: Repository) => repo.id !== 99);
    const { result } = renderHook(() => useVectorSearchActions());
    expect(result.current.unindexedRepoCount).toBe(2);
    expect(result.current.incrementalTargetCount).toBe(2);
  });

  it('excludes up-to-date repositories when no migration is pending', () => {
    storeState.vectorSearchConfig.embeddingFormatVersion = EMBEDDING_FORMAT_VERSION;
    // R13 审计修复（CodeRabbit）：计数与上传路径复用同一迁移判定——登录账号
    // 未完成账号范围迁移（localStorage 无记录）时全部合格仓库计入。本用例
    // 验证「迁移已完成」前提下的逐仓计数：显式登记 (账号, Worker) 迁移记录。
    (storeState.vectorSearchConfig as { workerUrl?: string }).workerUrl = 'https://worker.example.com';
    localStorage.setItem('gsm.vectorAccountScopeMigrationDone', JSON.stringify({ '1': 'https://worker.example.com' }));
    storeState.repositories = [repository, { ...repository, id: 2 } as Repository];
    mocks.needsReindex.mockImplementation((repo: Repository) => repo.id === 2);
    const { result } = renderHook(() => useVectorSearchActions());
    expect(result.current.unindexedRepoCount).toBe(1);
    expect(result.current.incrementalTargetCount).toBe(1);
    localStorage.removeItem('gsm.vectorAccountScopeMigrationDone');
  });

  it('reports zero unindexed repositories when vector search is disabled', () => {
    storeState.vectorSearchConfig.enabled = false;
    mocks.needsReindex.mockReturnValue(true);
    const { result } = renderHook(() => useVectorSearchActions());
    expect(result.current.unindexedRepoCount).toBe(0);
  });

  it('treats an AbortError from an aborted upload as a cancelled index operation', async () => {
    mocks.indexAllRepos.mockImplementation((_repos: unknown, _embedding: unknown, _vector: unknown, options: { signal: AbortSignal }) => (
      new Promise((_, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      })
    ));
    const { result } = renderHook(() => useVectorSearchActions());

    let indexing!: Promise<void>;
    act(() => { indexing = result.current.rebuildIndex(draft); });
    await waitFor(() => expect(mocks.indexAllRepos).toHaveBeenCalledTimes(1));
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
    mocks.cleanup.mockResolvedValue({ deleted: 0, partial: false });
    mocks.vectorGetStatus.mockResolvedValue({ success: true, vectorCount: 0, dimensions: 1536, accountScopedCleanup: true });
    // R5：后端权威快照核对默认通过（与完全同步的后端等价），与外层 describe 一致
    mocks.backend.isAvailable = true;
    mocks.backend.fetchRepositories.mockImplementation(async () => ({
      repositories: storeState.repositories,
      total: storeState.repositories.length,
    }));
    mocks.needsReindex.mockReset();
    mocks.needsReindex.mockReturnValue(false);
  });

  const seedTwoAccounts = () => {
    (storeState as { savedAccounts?: Record<string, unknown> }).savedAccounts = {
      '1': { accountId: '1' },
      '2': { accountId: '2' },
    };
  };

  it('never deletes vectors even when the index is shared across local accounts (R12: destructive cleanup disabled)', async () => {
    seedTwoAccounts();
    mocks.indexAllRepos.mockResolvedValue({ indexed: 1, skipped: 0, errors: 0, indexedRepoIds: [1] });
    const { result } = renderHook(() => useVectorSearchActions());

    await act(async () => { await result.current.rebuildIndex(draft); });

    // R12（CodeRabbit Major）：同账号的其他设备可以绕过本后端向共享 Worker
    // 上传向量，且 Worker 没有可验证的版本条件——keepIds 扫除无法证明安全，
    // 一律跳过删除并保留上传结果（也不再探测 Worker 能力）。
    expect(mocks.vectorGetStatus).not.toHaveBeenCalled();
    expect(mocks.cleanup).not.toHaveBeenCalled();
    // 索引本身照常完成并更新本账号状态
    expect(mocks.setVectorIndexingState).toHaveBeenLastCalledWith(expect.objectContaining({ isIndexing: false }));
    expect(mocks.setVectorSearchStatus).toHaveBeenCalled();
  });

  it('keeps legacy and account-scoped vectors after a full rebuild (R12)', async () => {
    mocks.indexAllRepos.mockResolvedValue({ indexed: 1, skipped: 0, errors: 0, indexedRepoIds: [1] });
    const { result } = renderHook(() => useVectorSearchActions());

    await act(async () => { await result.current.rebuildIndex(draft); });

    // 无前缀 legacy 向量的归属无法由客户端证明（另一台设备可能仍在上传），
    // 删除请求整体停用后它们自然保留。
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(mocks.setVectorIndexingState).toHaveBeenLastCalledWith(expect.objectContaining({ isIndexing: false }));
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

  it('keeps uploads even when the worker would report an error (no status probe, no cleanup)', async () => {
    mocks.vectorGetStatus.mockRejectedValue(new Error('worker unreachable'));
    mocks.indexAllRepos.mockResolvedValue({ indexed: 1, skipped: 0, errors: 0, indexedRepoIds: [1] });
    const { result } = renderHook(() => useVectorSearchActions());

    await act(async () => { await result.current.rebuildIndex(draft); });

    expect(mocks.vectorGetStatus).not.toHaveBeenCalled();
    expect(mocks.cleanup).not.toHaveBeenCalled();
    // 索引结果照常落盘
    expect(mocks.setVectorIndexingState).toHaveBeenLastCalledWith(expect.objectContaining({
      isIndexing: false,
      result: expect.objectContaining({ indexed: 1 }),
    }));
  });

  it('keeps uploads for a single-account index too (R12 control)', async () => {
    mocks.indexAllRepos.mockResolvedValue({ indexed: 1, skipped: 0, errors: 0, indexedRepoIds: [1] });
    const { result } = renderHook(() => useVectorSearchActions());

    await act(async () => { await result.current.rebuildIndex(draft); });

    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(mocks.setVectorSearchStatus).toHaveBeenCalled();
  });

  it('skips vector cleanup when no authoritative starred list is available (R5)', async () => {
    // R5（CodeRabbit Major）：两台设备可以在不启用后端同步的情况下共享同一
    // GitHub 账号与 Worker——本地「起止快照一致 + lastSync」不能替代权威列表，
    // 无法核对时一律跳过删除并保留已上传向量。
    mocks.backend.isAvailable = false;
    mocks.indexAllRepos.mockResolvedValue({ indexed: 1, skipped: 0, errors: 0, indexedRepoIds: [1] });
    const { result } = renderHook(() => useVectorSearchActions());

    await act(async () => { await result.current.rebuildIndex(draft); });

    expect(mocks.backend.fetchRepositories).not.toHaveBeenCalled();
    expect(mocks.cleanup).not.toHaveBeenCalled();
    // 索引本身照常完成并更新本账号状态
    expect(mocks.setVectorIndexingState).toHaveBeenLastCalledWith(expect.objectContaining({
      isIndexing: false,
      result: expect.objectContaining({ indexed: 1 }),
    }));
  });

  it('skips vector cleanup when the backend authoritative snapshot diverges from the local list', async () => {
    // 权威列表与本地列表不一致（另一台设备已加星新仓库）时不执行删除
    mocks.backend.fetchRepositories.mockResolvedValue({
      repositories: [{ id: 1 }, { id: 2 }],
      total: 2,
    });
    mocks.indexAllRepos.mockResolvedValue({ indexed: 1, skipped: 0, errors: 0, indexedRepoIds: [1] });
    const { result } = renderHook(() => useVectorSearchActions());

    await act(async () => { await result.current.rebuildIndex(draft); });

    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(mocks.setVectorIndexingState).toHaveBeenLastCalledWith(expect.objectContaining({
      isIndexing: false,
      result: expect.objectContaining({ indexed: 1 }),
    }));
  });

  it('skips cleanup when the list has no authoritative sync basis (R2-C24)', async () => {
    // 从未成功同步（lastSync 为空）或仍在加载的列表可能只是部分快照：即使
    // 运行前后 ID 集合相等，也不能据此物理删除向量，上传结果必须保留。
    storeState.lastSync = null;
    mocks.indexAllRepos.mockResolvedValue({ indexed: 1, skipped: 0, errors: 0, indexedRepoIds: [1] });
    const { result } = renderHook(() => useVectorSearchActions());

    await act(async () => { await result.current.rebuildIndex(draft); });

    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(mocks.setVectorIndexingState).toHaveBeenLastCalledWith(expect.objectContaining({
      isIndexing: false,
      result: expect.objectContaining({ indexed: 1 }),
    }));
  });

  it('skips cleanup when a star sync is in flight during indexing (R2-C24)', async () => {
    mocks.indexAllRepos.mockImplementation(async () => {
      storeState.isSyncingStars = true;
      return { indexed: 1, skipped: 0, errors: 0, indexedRepoIds: [1] };
    });
    const { result } = renderHook(() => useVectorSearchActions());

    await act(async () => { await result.current.rebuildIndex(draft); });

    expect(mocks.cleanup).not.toHaveBeenCalled();
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

  it('never issues a keepIds sweep that could drop excluded repos (R12)', async () => {
    // 排除项（已索引但分析缺失/失败）的存量向量可能是 legacy 或前缀形态；
    // 删除请求整体停用后它们不再有被 keepIds 扫除的风险。
    storeState.repositories = [
      repository,
      { ...repository, id: 2, analyzed_at: undefined, analysis_failed: true, vector_indexed_at: '2026-08-01T00:00:00.000Z' } as Repository,
    ];
    mocks.indexAllRepos.mockResolvedValue({ indexed: 1, skipped: 1, errors: 0, indexedRepoIds: [1] });
    const { result } = renderHook(() => useVectorSearchActions());

    await act(async () => { await result.current.rebuildIndex(draft); });

    expect(mocks.cleanup).not.toHaveBeenCalled();
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

  it('aborts and writes nothing when A→B→A happens without starting a new index task', async () => {
    const { bumpAccountSessionGeneration } = await import('../../../store/helpers/accountWorkspace');
    mocks.indexAllRepos.mockImplementation(async () => {
      // 模拟 A→B→A 切换（推进会话代次），且期间未启动新索引任务
      (storeState as { user?: unknown }).user = { id: 2, login: 'other', avatar_url: '' };
      bumpAccountSessionGeneration();
      (storeState as { user?: unknown }).user = { id: 1, login: 'me', avatar_url: '' };
      bumpAccountSessionGeneration();
      return { indexed: 1, skipped: 0, errors: 0, indexedRepoIds: [1] };
    });
    const { result } = renderHook(() => useVectorSearchActions());

    await act(async () => { await result.current.rebuildIndex(draft); });

    // 旧任务在收尾检查点因代次变化中止，仅初始 isIndexing:true 写入过一次
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
    const aborts: number[] = [];
    mocks.indexAllRepos.mockImplementation((_repos: unknown, _embedding: unknown, _vector: unknown, options: { signal?: AbortSignal }) => (
      new Promise((resolve) => {
        resolvers.push(resolve);
        // R12（finding 27）：中止只记录、不立即完成——旧任务必须在断言基线
        // 之后才被放行，否则它的收尾写入可能发生在检查范围之外。
        options.signal?.addEventListener('abort', () => { aborts.push(resolvers.length); });
      })
    ));
    const { result } = renderHook(() => useVectorSearchActions());

    let first!: Promise<void>;
    act(() => { first = result.current.rebuildIndex(draft); });
    await act(async () => { await Promise.resolve(); });
    let second!: Promise<void>;
    await act(async () => { second = result.current.rebuildIndex(draft); });
    // 新任务已启动并中止了旧任务，但旧任务仍挂起
    expect(aborts).toHaveLength(1);
    const writesBeforeOldResolves = mocks.setVectorIndexingState.mock.calls.length;
    // 先放行旧任务（新任务仍保持挂起），验证旧任务不得写入任何 isIndexing: false 或结果
    await act(async () => {
      resolvers[0]?.({ indexed: 9, skipped: 0, errors: 0, indexedRepoIds: [1] });
      await first;
    });
    expect(mocks.setVectorIndexingState.mock.calls.slice(writesBeforeOldResolves)).toEqual([]);
    expect(mocks.setVectorSearchStatus).not.toHaveBeenCalled();

    // 再放行新任务，验证最终结果与索引状态均来自新任务
    await act(async () => {
      resolvers[1]?.({ indexed: 1, skipped: 0, errors: 0, indexedRepoIds: [1] });
      await second;
    });

    expect(mocks.setVectorIndexingState).toHaveBeenLastCalledWith(
      expect.objectContaining({ isIndexing: false, result: expect.objectContaining({ indexed: 1 }) }),
    );
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

  it('keeps the existing account vector count on a successful worker test (C50)', async () => {
    // 审计修复（C50）：连接测试的 Worker 总向量数（含所有账号分区的向量）
    // 不写入 vectorSearchStatus.vectorCount——已有账号计数保留，总向量数仅在
    // workerTestResult（测试结果）中可见。
    mocks.vectorTestConnection.mockResolvedValue({ success: true, vectorCount: 5, dimensions: 1536 });
    // 审计修复：URL 之外还必须核对我测令牌与已保存令牌一致——已保存配置
    // 与被测 draft 使用同一 Worker 地址与令牌。
    (storeState as { vectorSearchConfig: { workerUrl?: string; authToken?: string; embeddingFormatVersion?: number } }).vectorSearchConfig = {
      ...storeState.vectorSearchConfig,
      workerUrl: 'https://worker.example.com',
      authToken: 'worker-token',
    };
    (storeState as { vectorSearchStatus?: { connected: boolean; vectorCount: number; dimensions: number } }).vectorSearchStatus = { connected: false, vectorCount: 3, dimensions: 1536 };
    const { result } = renderHook(() => useVectorSearchActions());

    await act(async () => { await result.current.testWorker({ workerUrl: 'https://worker.example.com', authToken: 'worker-token' }); });

    expect(mocks.setVectorSearchStatus).toHaveBeenCalledWith({ connected: true, vectorCount: 3, dimensions: 1536 });
    expect(mocks.setVectorSearchStatus).not.toHaveBeenCalledWith({ connected: true, vectorCount: 5, dimensions: 1536 });

    // 测试未保存的不同 Worker 地址时只写 workerTestResult，不覆盖共享 vectorSearchStatus
    mocks.setVectorSearchStatus.mockClear();
    await act(async () => { await result.current.testWorker({ workerUrl: 'https://other-worker.example.com', authToken: 'worker-token' }); });
    expect(mocks.setVectorSearchStatus).not.toHaveBeenCalled();

    // 审计修复：同一地址但令牌不同（已保存令牌失效、用新令牌测试成功）时，
    // 不得把仍使用旧令牌的已保存配置标成 connected；草稿结果照常独立展示。
    mocks.setVectorSearchStatus.mockClear();
    await act(async () => { await result.current.testWorker({ workerUrl: 'https://worker.example.com', authToken: 'rotated-token' }); });
    expect(mocks.setVectorSearchStatus).not.toHaveBeenCalled();
  });

  it('skips the connection status write when the account switched during the worker test', async () => {
    // 审计修复回归：连接测试等待期间切号后，发起账号 A 的连接状态/向量数量/
    // 维度不得写入当前账号 B 的共享 vectorSearchStatus（runIndex 对同类写入
    // 已有账号保护，testWorker 补齐同一约束）；本地测试结果照常展示。
    // CodeRabbit 审计：先把已保存地址（与令牌）配置成与被测 draft 相同——
    // 否则 sameWorkerIndex 恒为 false，即使移除账号守卫该测试也会通过。
    mocks.vectorTestConnection.mockImplementation(async () => {
      (storeState as { user?: unknown }).user = { id: 2, login: 'other', avatar_url: '' };
      return { success: true, vectorCount: 5, dimensions: 1536 };
    });
    (storeState as { vectorSearchConfig: { workerUrl?: string; authToken?: string; embeddingFormatVersion?: number } }).vectorSearchConfig = {
      ...storeState.vectorSearchConfig,
      workerUrl: 'https://worker.example.com',
      authToken: 'worker-token',
    };
    const { result } = renderHook(() => useVectorSearchActions());

    await act(async () => { await result.current.testWorker({ workerUrl: 'https://worker.example.com', authToken: 'worker-token' }); });

    expect(mocks.setVectorSearchStatus).not.toHaveBeenCalled();
  });
});
