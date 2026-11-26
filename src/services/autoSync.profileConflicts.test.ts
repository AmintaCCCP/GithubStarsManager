import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSyncHashes, syncFromBackend } from './autoSync';
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

// syncFromBackend drives the real store directly; keep the actual module.
vi.mock('../store/useAppStore', async () => await vi.importActual('../store/useAppStore'));

const OTHER_PROFILE_WEBDAV_TARGET = 'https://dav.example.com/root/gsm';
const OTHER_PROFILE_VECTOR_URL = 'https://vec.bob.workers.dev';
const LOCAL_TOKEN = 'dummy-token-local';
const LOCAL_WEBDAV_PASSWORD = 'dummy-password-local';
const REMOTE_WEBDAV_PASSWORD = 'dummy-password-remote';
const REMOTE_TOKEN = 'dummy-token-remote';

const baseVectorConfig = {
  enabled: true,
  workerUrl: 'https://vec.local.workers.dev',
  authToken: LOCAL_TOKEN,
  embeddingConfigId: 'emb_local',
  indexMode: 'readme' as const,
  readmeMaxChars: 6000,
  searchThreshold: 0.35,
  searchTopK: 30,
  enableHyDE: true,
  enableReranking: true,
};

describe('syncFromBackend profile conflict isolation', () => {
  let originalState: ReturnType<typeof useAppStore.getState>;

  beforeEach(() => {
    originalState = useAppStore.getState();
    resetSyncHashes();
    window.localStorage.clear();
    window.localStorage.setItem(
      'gsm:profiles',
      JSON.stringify([
        {
          id: 'p_222',
          login: 'bob',
          webdavTargets: [OTHER_PROFILE_WEBDAV_TARGET],
          vectorWorkerUrl: OTHER_PROFILE_VECTOR_URL,
        },
      ]),
    );

    vi.mocked(backend.fetchRepositories).mockResolvedValue({ repositories: [], total: 0 });
    vi.mocked(backend.fetchReleases).mockResolvedValue({ releases: [], total: 0 });
    vi.mocked(backend.fetchAIConfigs).mockResolvedValue([]);
    vi.mocked(backend.fetchEmbeddingConfigs).mockResolvedValue([]);
    vi.mocked(backend.fetchWebDAVConfigs).mockResolvedValue([]);
    vi.mocked(backend.fetchVectorSearchConfig).mockResolvedValue({ ...baseVectorConfig });
    vi.mocked(backend.fetchSettings).mockResolvedValue({});
  });

  afterEach(() => {
    useAppStore.setState(originalState);
    window.localStorage.clear();
  });

  it('drops a pulled WebDAV config that targets another profile', async () => {
    useAppStore.setState({
      webdavConfigs: [
        { id: 'w_local', name: 'local', url: 'https://dav.example.com', path: '/mine', username: '', password: LOCAL_WEBDAV_PASSWORD, isActive: false },
      ],
    });
    vi.mocked(backend.fetchWebDAVConfigs).mockResolvedValue([
      { id: 'w_remote', name: 'remote', url: 'https://dav.example.com', path: '/root/gsm', username: '', password: REMOTE_WEBDAV_PASSWORD, isActive: false },
      { id: 'w_ok', name: 'ok', url: 'https://dav.example.com', path: '/own', username: '', password: '', isActive: false },
    ]);

    await syncFromBackend();

    const ids = useAppStore.getState().webdavConfigs.map((cfg) => cfg.id);
    expect(ids).toEqual(['w_ok']);
  });

  it('keeps the local config for the same id instead of the conflicting pulled one', async () => {
    useAppStore.setState({
      webdavConfigs: [
        { id: 'w_remote', name: 'local', url: 'https://dav.example.com', path: '/mine', username: '', password: LOCAL_WEBDAV_PASSWORD, isActive: false },
      ],
    });
    vi.mocked(backend.fetchWebDAVConfigs).mockResolvedValue([
      { id: 'w_remote', name: 'remote', url: 'https://dav.example.com', path: '/root/gsm', username: '', password: REMOTE_WEBDAV_PASSWORD, isActive: false },
    ]);

    await syncFromBackend();

    const [kept] = useAppStore.getState().webdavConfigs;
    expect(kept.path).toBe('/mine');
    expect(kept.password).toBe(LOCAL_WEBDAV_PASSWORD);
  });

  it('clears an active WebDAV selection that points at a dropped config', async () => {
    useAppStore.setState({ webdavConfigs: [] });
    vi.mocked(backend.fetchWebDAVConfigs).mockResolvedValue([
      { id: 'w_remote', name: 'remote', url: 'https://dav.example.com', path: '/root/gsm', username: '', password: REMOTE_WEBDAV_PASSWORD, isActive: false },
    ]);
    vi.mocked(backend.fetchSettings).mockResolvedValue({ activeWebDAVConfig: 'w_remote' });

    await syncFromBackend();

    expect(useAppStore.getState().webdavConfigs).toHaveLength(0);
    expect(useAppStore.getState().activeWebDAVConfig).toBeNull();
  });

  it('repairs only the AI slice on an empty backend bootstrap instead of a full push', async () => {
    // The embedding read failed: a full push would send the local (empty)
    // embedding list and delete the remote configs.
    vi.mocked(backend.fetchEmbeddingConfigs).mockRejectedValue(new Error('embedding read failed'));
    useAppStore.setState({
      aiConfigs: [
        { id: 'ai_local', name: 'local', baseUrl: 'https://api.example.com', apiKey: LOCAL_TOKEN, model: 'm', isActive: true },
      ],
    });

    await syncFromBackend();

    await vi.waitFor(() => {
      expect(backend.syncAIConfigs).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ id: 'ai_local' })]),
      );
    });
    expect(backend.syncRepositories).not.toHaveBeenCalled();
    expect(backend.syncEmbeddingConfigs).not.toHaveBeenCalled();
  });

  it('repairs only the Vector slice when another slice failed to load', async () => {
    vi.mocked(backend.fetchAIConfigs).mockRejectedValue(new Error('ai read failed'));
    useAppStore.setState({
      vectorSearchConfig: { ...baseVectorConfig, workerUrl: 'https://vec.alice.workers.dev' },
    });
    vi.mocked(backend.fetchVectorSearchConfig).mockResolvedValue({
      ...baseVectorConfig,
      workerUrl: OTHER_PROFILE_VECTOR_URL,
    });

    await syncFromBackend();
    await vi.waitFor(() => expect(backend.syncVectorSearchConfig).toHaveBeenCalled());

    expect(backend.syncAIConfigs).not.toHaveBeenCalled();
  });

  it('repairs the backend with the merged config (pulled URL + preserved token)', async () => {
    const localToken = 'token-local-2';
    useAppStore.setState({
      vectorSearchConfig: {
        ...baseVectorConfig,
        workerUrl: 'https://vec.alice.workers.dev',
        authToken: localToken,
      },
    });
    vi.mocked(backend.fetchVectorSearchConfig).mockResolvedValue({
      ...baseVectorConfig,
      workerUrl: 'https://vec.new.workers.dev',
      authToken: '',
    });

    await syncFromBackend();

    const config = useAppStore.getState().vectorSearchConfig;
    expect(config.workerUrl).toBe('https://vec.new.workers.dev');
    expect(config.authToken).toBe(localToken);
    await vi.waitFor(() => {
      expect(backend.syncVectorSearchConfig).toHaveBeenCalledWith(
        expect.objectContaining({ workerUrl: 'https://vec.new.workers.dev', authToken: localToken }),
      );
    });
  });

  it('keeps the local Vector config when the pulled Worker URL belongs to another profile', async () => {
    useAppStore.setState({
      vectorSearchConfig: { ...baseVectorConfig, workerUrl: 'https://vec.alice.workers.dev' },
    });
    vi.mocked(backend.fetchVectorSearchConfig).mockResolvedValue({
      ...baseVectorConfig,
      workerUrl: OTHER_PROFILE_VECTOR_URL,
      authToken: REMOTE_TOKEN,
    });

    await syncFromBackend();

    const config = useAppStore.getState().vectorSearchConfig;
    expect(config.workerUrl).toBe('https://vec.alice.workers.dev');
    expect(config.authToken).toBe(LOCAL_TOKEN);
  });
});
