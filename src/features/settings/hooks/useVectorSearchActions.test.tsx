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
vi.mock('../../../services/vectorSearchService', () => ({
  EMBEDDING_FORMAT_VERSION: 3,
  EmbeddingClient: class {},
  VectorSearchService: class {
    cleanup = mocks.cleanup;
    testConnection = vi.fn();
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
}));
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
    mocks.cleanup.mockResolvedValue(undefined);
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
    expect(mocks.cleanup).toHaveBeenNthCalledWith(1, ['1', '2'], expect.any(AbortSignal));
    expect(mocks.cleanup).toHaveBeenNthCalledWith(2, ['1', '2'], expect.any(AbortSignal));
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
    mocks.cleanup.mockImplementation((_ids: string[], signal: AbortSignal) => new Promise<void>((_, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
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
 * - 多账号共享同一向量索引（全局 vector_search_configs、向量 ID 无账号前缀），
 *   /cleanup 会删除 keepIds 之外的全部匹配向量——多账号时必须跳过 cleanup；
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
    mocks.needsReindex.mockReset();
    mocks.needsReindex.mockReturnValue(false);
  });

  const seedTwoAccounts = () => {
    (storeState as { savedAccounts?: Record<string, unknown> }).savedAccounts = {
      '1': { accountId: '1' },
      '2': { accountId: '2' },
    };
  };

  it('skips vector cleanup while the index is shared across multiple accounts', async () => {
    seedTwoAccounts();
    mocks.indexAllRepos.mockResolvedValue({ indexed: 1, skipped: 0, errors: 0, indexedRepoIds: [1] });
    const { result } = renderHook(() => useVectorSearchActions());

    await act(async () => { await result.current.rebuildIndex(draft); });

    // 宁可保留冗余向量，也绝不删除共享索引中其他账号的向量
    expect(mocks.cleanup).not.toHaveBeenCalled();
    // 索引本身照常完成并更新本账号状态
    expect(mocks.setVectorIndexingState).toHaveBeenLastCalledWith(expect.objectContaining({ isIndexing: false }));
    expect(mocks.setVectorSearchStatus).toHaveBeenCalled();
  });

  it('still runs cleanup for a single-account index (control)', async () => {
    mocks.indexAllRepos.mockResolvedValue({ indexed: 1, skipped: 0, errors: 0, indexedRepoIds: [1] });
    const { result } = renderHook(() => useVectorSearchActions());

    await act(async () => { await result.current.rebuildIndex(draft); });

    expect(mocks.cleanup).toHaveBeenCalledWith(['1'], expect.any(AbortSignal));
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
});
