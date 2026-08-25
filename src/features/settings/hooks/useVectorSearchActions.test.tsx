import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../../../types';
import { useVectorSearchActions, type VectorIndexDraft } from './useVectorSearchActions';
import { useAppStore } from '../../../store/useAppStore';

const mocks = vi.hoisted(() => ({
  useAppStore: vi.fn(),
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
  needsReindex: () => false,
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
  vectorSearchConfig: { embeddingFormatVersion: 1 },
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

    expect(mocks.setVectorSearchConfig).not.toHaveBeenCalled();
    expect(mocks.cleanup).toHaveBeenCalledWith(['1'], expect.any(AbortSignal));
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
