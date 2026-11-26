import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('../store/useAppStore');

import {
  ACTIVE_PROFILE_KEY,
  PROFILE_CONFLICT_EVENT,
  PROFILES_REGISTRY_KEY,
  consumePendingSeed,
  findConflictingWebdavProfile,
  upsertProfile,
  writePendingSeed,
} from './profileStorage';
import { useAppStore } from '../store/useAppStore';
import { backend } from './backendAdapter';
import {
  resetSyncHashes,
  syncFromBackend,
  syncLocalGitHubTokenToBackend,
  tryRestoreAuthFromBackend,
} from './autoSync';

const mockUser = {
  id: 9001,
  login: 'work-user',
  name: 'Work User',
  avatar_url: 'https://avatars.githubusercontent.com/u/9001',
};

describe('multi-account audit regression fixes (#611)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
    resetSyncHashes();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    localStorage.clear();
    sessionStorage.clear();
  });

  it('writes and consumes PendingProfileSeed once without storing backendApiSecret in localStorage', () => {
    writePendingSeed({
      profileId: 'p_9001',
      user: mockUser as never,
      githubToken: 'test-token-work',
    });

    const consumed = consumePendingSeed('p_9001');
    expect(consumed?.githubToken).toBe('test-token-work');
    expect(consumePendingSeed('p_9001')).toBeNull();
  });

  it('isolates session backend secret per profile so non-default logout never resurrects default secret', async () => {
    localStorage.setItem(ACTIVE_PROFILE_KEY, 'p_work');
    sessionStorage.setItem('github-stars-manager-backend-secret', 'test-val-aaa');

    vi.resetModules();
    const authStorage = await import('../store/persistence/authStorage');

    // Non-default profile does NOT fall back to default's sessionStorage key
    expect(authStorage.readSessionBackendSecret()).toBeNull();

    // Explicit seeding for p_work writes ONLY to p_work's scoped key
    authStorage.writeSessionBackendSecret('test-val-bbb', 'p_work');
    expect(authStorage.readSessionBackendSecret()).toBe('test-val-bbb');
    expect(sessionStorage.getItem('github-stars-manager-backend-secret__p_work')).toBe('test-val-bbb');
    expect(sessionStorage.getItem('github-stars-manager-backend-secret')).toBe('test-val-aaa');

    // Clearing on p_work removes p_work's key and readSessionBackendSecret returns null (not default's secret)
    authStorage.writeSessionBackendSecret(null);
    expect(sessionStorage.getItem('github-stars-manager-backend-secret__p_work')).toBeNull();
    expect(authStorage.readSessionBackendSecret()).toBeNull();
    expect(sessionStorage.getItem('github-stars-manager-backend-secret')).toBe('test-val-aaa');
  });

  it('attaches X-GSM-Profile header in rpcDownloadService when on a non-default profile', async () => {
    localStorage.setItem(ACTIVE_PROFILE_KEY, 'p_work');
    vi.resetModules();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, version: '1.37.0', gid: 'gid-1' }),
    });
    globalThis.fetch = fetchMock;

    await import('../store/useAppStore');
    const { backend: scopedBackend } = await import('./backendAdapter');
    Object.defineProperty(scopedBackend, 'isAvailable', { value: true, configurable: true });
    Object.defineProperty(scopedBackend, 'backendUrl', { value: 'http://localhost:3000/api', configurable: true });

    const { testRpcDownload, sendToRpcDownload } = await import('./rpcDownloadService');

    await testRpcDownload({ enabled: true, host: '127.0.0.1', port: 6800, secret: '' }, 'sec-1');
    await sendToRpcDownload('https://example.com/file.zip', 'file.zip', 'sec-1');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstHeaders = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    const secondHeaders = (fetchMock.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(firstHeaders['X-GSM-Profile']).toBe('p_work');
    expect(firstHeaders['Authorization']).toBe('Bearer sec-1');
    expect(secondHeaders['X-GSM-Profile']).toBe('p_work');
    expect(secondHeaders['Authorization']).toBe('Bearer sec-1');
  });

  it('tryRestoreAuthFromBackend allows restore when backend.authRequired is false without backendApiSecret', async () => {
    useAppStore.setState({ user: null, githubToken: null, backendApiSecret: null, isAuthenticated: false });
    vi.spyOn(backend, 'isAvailable', 'get').mockReturnValue(true);
    vi.spyOn(backend, 'authRequired', 'get').mockReturnValue(false);
    vi.spyOn(backend, 'restoreAuth').mockResolvedValue({ github_token: 'test-token-restored' });

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockUser), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const ok = await tryRestoreAuthFromBackend();
    expect(ok).toBe(true);
    expect(useAppStore.getState().githubToken).toBe('test-token-restored');
    expect(useAppStore.getState().user?.login).toBe('work-user');
  });

  it('syncFromBackend preserves copied local aiConfigs and embeddingConfigs on empty backend bootstrap', async () => {
    const localAI = [{ id: 'ai-1', name: 'OpenAI', apiType: 'openai' as const, baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-1', model: 'gpt-4o', isActive: true }];
    const localEmb = [{ id: 'emb-1', name: 'Emb', apiType: 'openai' as const, baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-2', model: 'text-embedding-3-small', dimensions: 1536, isActive: true }];
    useAppStore.setState({
      user: mockUser as never,
      githubToken: 'test-token-sync',
      aiConfigs: localAI as never,
      embeddingConfigs: localEmb as never,
    });

    vi.spyOn(backend, 'isAvailable', 'get').mockReturnValue(true);
    vi.spyOn(backend, 'fetchRepositories').mockResolvedValue({ repositories: [], total: 0 });
    vi.spyOn(backend, 'fetchReleases').mockResolvedValue({ releases: [], total: 0 });
    vi.spyOn(backend, 'fetchAIConfigs').mockResolvedValue([]);
    vi.spyOn(backend, 'fetchWebDAVConfigs').mockResolvedValue([]);
    vi.spyOn(backend, 'fetchEmbeddingConfigs').mockResolvedValue([]);
    vi.spyOn(backend, 'fetchVectorSearchConfig').mockResolvedValue({ enabled: false, workerUrl: '', authToken: '', embeddingConfigId: '', indexMode: 'readme', readmeMaxChars: 6000 });
    vi.spyOn(backend, 'fetchSettings').mockResolvedValue({});

    // Stub push methods; the bootstrap preserve branches must repair only the
    // preserved slices, never queue a full push.
    const syncReposSpy = vi.spyOn(backend, 'syncRepositories').mockResolvedValue(undefined as never);
    vi.spyOn(backend, 'syncReleases').mockResolvedValue(undefined as never);
    const syncAISpy = vi.spyOn(backend, 'syncAIConfigs').mockResolvedValue(undefined as never);
    vi.spyOn(backend, 'syncWebDAVConfigs').mockResolvedValue(undefined as never);
    const syncEmbSpy = vi.spyOn(backend, 'syncEmbeddingConfigs').mockResolvedValue(undefined as never);
    vi.spyOn(backend, 'syncVectorSearchConfig').mockResolvedValue(undefined as never);
    const syncSettingsSpy = vi.spyOn(backend, 'syncSettings').mockResolvedValue(undefined as never);

    await syncFromBackend();

    expect(useAppStore.getState().aiConfigs).toHaveLength(1);
    expect(useAppStore.getState().embeddingConfigs).toHaveLength(1);
    await vi.waitFor(() => {
      expect(syncAISpy).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'ai-1' })]));
    });
    await vi.waitFor(() => {
      expect(syncEmbSpy).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'emb-1' })]));
    });
    // A full push would also send repositories/settings, including slices whose
    // reads failed in this cycle. The bootstrap preserve must not do that.
    expect(syncReposSpy).not.toHaveBeenCalled();
    expect(syncSettingsSpy).not.toHaveBeenCalled();
  });

  it('syncFromBackend applies empty AI/embedding list on subsequent syncs after initial sync', async () => {
    const localAI = [{ id: 'ai-1', name: 'OpenAI', apiType: 'openai' as const, baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-1', model: 'gpt-4o', isActive: true }];
    const localEmb = [{ id: 'emb-1', name: 'Emb', apiType: 'openai' as const, baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-2', model: 'text-embedding-3-small', dimensions: 1536, isActive: true }];
    useAppStore.setState({
      user: mockUser as never,
      githubToken: 'test-token-sync',
      aiConfigs: localAI as never,
      embeddingConfigs: localEmb as never,
    });

    vi.spyOn(backend, 'isAvailable', 'get').mockReturnValue(true);
    vi.spyOn(backend, 'fetchRepositories').mockResolvedValue({ repositories: [], total: 0 });
    vi.spyOn(backend, 'fetchReleases').mockResolvedValue({ releases: [], total: 0 });
    const fetchAISpy = vi.spyOn(backend, 'fetchAIConfigs').mockResolvedValueOnce(localAI as never).mockResolvedValueOnce([]);
    vi.spyOn(backend, 'fetchWebDAVConfigs').mockResolvedValue([]);
    const fetchEmbSpy = vi.spyOn(backend, 'fetchEmbeddingConfigs').mockResolvedValueOnce(localEmb as never).mockResolvedValueOnce([]);
    vi.spyOn(backend, 'fetchVectorSearchConfig').mockResolvedValue({ enabled: false, workerUrl: '', authToken: '', embeddingConfigId: '', indexMode: 'readme', readmeMaxChars: 6000 });
    vi.spyOn(backend, 'fetchSettings').mockResolvedValue({});

    // First sync populates _lastHash.ai and _lastHash.embedding
    await syncFromBackend();
    expect(useAppStore.getState().aiConfigs).toHaveLength(1);
    expect(useAppStore.getState().embeddingConfigs).toHaveLength(1);

    // Second sync receives [] (another device deleted the last config) -> must clear local
    await syncFromBackend();
    expect(fetchAISpy).toHaveBeenCalledTimes(2);
    expect(fetchEmbSpy).toHaveBeenCalledTimes(2);
    expect(useAppStore.getState().aiConfigs).toHaveLength(0);
    expect(useAppStore.getState().embeddingConfigs).toHaveLength(0);
  });

  it('syncFromBackend does not queue full push when fetchRepositories fails', async () => {
    const localAI = [{ id: 'ai-1', name: 'OpenAI', apiType: 'openai' as const, baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-1', model: 'gpt-4o', isActive: true }];
    useAppStore.setState({
      user: mockUser as never,
      githubToken: 'test-token-sync',
      repositories: [],
      aiConfigs: localAI as never,
    });

    vi.spyOn(backend, 'isAvailable', 'get').mockReturnValue(true);
    vi.spyOn(backend, 'fetchRepositories').mockRejectedValue(new Error('network error'));
    vi.spyOn(backend, 'fetchReleases').mockResolvedValue({ releases: [], total: 0 });
    vi.spyOn(backend, 'fetchAIConfigs').mockResolvedValue([]);
    vi.spyOn(backend, 'fetchWebDAVConfigs').mockResolvedValue([]);
    vi.spyOn(backend, 'fetchEmbeddingConfigs').mockResolvedValue([]);
    vi.spyOn(backend, 'fetchVectorSearchConfig').mockResolvedValue({ enabled: false, workerUrl: '', authToken: '', embeddingConfigId: '', indexMode: 'readme', readmeMaxChars: 6000 });
    vi.spyOn(backend, 'fetchSettings').mockResolvedValue({});
    const syncReposSpy = vi.spyOn(backend, 'syncRepositories').mockResolvedValue(undefined as never);

    await syncFromBackend();

    expect(syncReposSpy).not.toHaveBeenCalled();
  });

  it('syncLocalGitHubTokenToBackend sends profile_meta alongside github_token', async () => {
    useAppStore.setState({ user: mockUser as never, githubToken: 'test-token-sync' });
    vi.spyOn(backend, 'isAvailable', 'get').mockReturnValue(true);
    const syncSettingsSpy = vi.spyOn(backend, 'syncSettings').mockResolvedValue(undefined as never);

    const ok = await syncLocalGitHubTokenToBackend();
    expect(ok).toBe(true);
    expect(syncSettingsSpy).toHaveBeenCalledWith(
      {
        github_token: 'test-token-sync',
        profile_meta: {
          login: 'work-user',
          name: 'Work User',
          avatarUrl: 'https://avatars.githubusercontent.com/u/9001',
        },
      },
      expect.any(AbortSignal),
    );
  });

  it('emits profile conflict event when backend pull contains a conflicting WebDAV target', async () => {
    upsertProfile({
      id: 'p_other',
      login: 'alice',
      webdavTargets: ['https://dav.example.com/backups'],
    });
    expect(findConflictingWebdavProfile('https://dav.example.com', '/backups')).toEqual({
      id: 'p_other',
      login: 'alice',
    });

    useAppStore.setState({ webdavConfigs: [] });
    vi.spyOn(backend, 'isAvailable', 'get').mockReturnValue(true);
    vi.spyOn(backend, 'fetchRepositories').mockResolvedValue({ repositories: [], total: 0 });
    vi.spyOn(backend, 'fetchReleases').mockResolvedValue({ releases: [], total: 0 });
    vi.spyOn(backend, 'fetchAIConfigs').mockResolvedValue([]);
    vi.spyOn(backend, 'fetchWebDAVConfigs').mockResolvedValue([
      { id: 'wd-1', name: 'Shared', url: 'https://dav.example.com', username: 'u', password: 'p', path: '/backups', isActive: true },
    ] as never);
    vi.spyOn(backend, 'fetchEmbeddingConfigs').mockResolvedValue([]);
    vi.spyOn(backend, 'fetchVectorSearchConfig').mockResolvedValue({ enabled: false, workerUrl: '', authToken: '', embeddingConfigId: '', indexMode: 'readme', readmeMaxChars: 6000 });
    vi.spyOn(backend, 'fetchSettings').mockResolvedValue({});

    const events: unknown[] = [];
    const listener = (e: Event) => events.push((e as CustomEvent).detail);
    window.addEventListener(PROFILE_CONFLICT_EVENT, listener);
    try {
      await syncFromBackend();
    } finally {
      window.removeEventListener(PROFILE_CONFLICT_EVENT, listener);
    }

    expect(events).toContainEqual({ kind: 'webdav', conflictingProfile: 'alice' });
    expect(localStorage.getItem(PROFILES_REGISTRY_KEY)).toContain('p_other');
  });
});
