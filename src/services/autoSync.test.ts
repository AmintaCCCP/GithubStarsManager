import { describe, expect, it, vi } from 'vitest';

vi.mock('../services/backendAdapter', () => ({
  backend: {
    isAvailable: true,
    fetchRepositories: vi.fn(),
    fetchReleases: vi.fn(),
    fetchAIConfigs: vi.fn(),
    fetchWebDAVConfigs: vi.fn(),
    fetchEmbeddingConfigs: vi.fn(),
    fetchVectorSearchConfig: vi.fn(),
    fetchMcpConfig: vi.fn(),
    fetchSettings: vi.fn(),
  },
}));

vi.mock('../store/useAppStore', () => ({
  useAppStore: {
    getState: () => ({ hasHydrated: false }),
    subscribe: () => () => {},
  },
}));

import { syncFromBackend } from './autoSync';
import { backend } from '../services/backendAdapter';

describe('syncFromBackend hydration gate', () => {
  it('returns early before hydration (prevents empty-overwrite race)', async () => {
    await syncFromBackend();
    expect(backend.fetchRepositories).not.toHaveBeenCalled();
  });
});
