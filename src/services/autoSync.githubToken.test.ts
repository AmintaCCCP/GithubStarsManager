import { syncLocalGitHubTokenToBackend } from './autoSync';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { backend } from './backendAdapter';
import { useAppStore } from '../store/useAppStore';

vi.mock('./backendAdapter', () => ({
  backend: {
    isAvailable: true,
    syncSettings: vi.fn(),
  },
}));

vi.mock('../store/useAppStore', () => ({
  useAppStore: {
    getState: vi.fn(),
  },
}));

type MockBackend = {
  isAvailable: boolean;
  syncSettings: ReturnType<typeof vi.fn>;
};

type MockStore = {
  getState: ReturnType<typeof vi.fn>;
};

const mockBackend = backend as unknown as MockBackend;
const mockStore = useAppStore as unknown as MockStore;

describe('syncLocalGitHubTokenToBackend', () => {
  beforeEach(() => {
    mockBackend.isAvailable = true;
    mockBackend.syncSettings.mockReset();
    mockBackend.syncSettings.mockResolvedValue(undefined);
    mockStore.getState.mockReset();
  });

  it('writes an existing local GitHub token to backend settings', async () => {
    mockStore.getState.mockReturnValue({ githubToken: 'ghp-local-token' });

    await expect(syncLocalGitHubTokenToBackend()).resolves.toBe(true);

    expect(mockBackend.syncSettings).toHaveBeenCalledOnce();
    expect(mockBackend.syncSettings).toHaveBeenCalledWith(
      { github_token: 'ghp-local-token' },
      expect.any(AbortSignal),
    );
  });

  it('does not write settings when there is no local token', async () => {
    mockStore.getState.mockReturnValue({ githubToken: null });

    await expect(syncLocalGitHubTokenToBackend()).resolves.toBe(false);

    expect(mockBackend.syncSettings).not.toHaveBeenCalled();
  });

  it('does not write settings when the backend is unavailable', async () => {
    mockBackend.isAvailable = false;
    mockStore.getState.mockReturnValue({ githubToken: 'ghp-local-token' });

    await expect(syncLocalGitHubTokenToBackend()).resolves.toBe(false);

    expect(mockBackend.syncSettings).not.toHaveBeenCalled();
  });

  it('keeps app startup non-blocking when backend token sync fails', async () => {
    mockStore.getState.mockReturnValue({ githubToken: 'ghp-local-token' });
    mockBackend.syncSettings.mockRejectedValue(new Error('backend unavailable'));

    await expect(syncLocalGitHubTokenToBackend()).resolves.toBe(false);
  });

  it('aborts a pending backend token sync after the startup deadline', async () => {
    mockStore.getState.mockReturnValue({ githubToken: 'ghp-local-token' });
    mockBackend.syncSettings.mockImplementation(
      (_settings: Record<string, unknown>, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        }),
    );

    await expect(syncLocalGitHubTokenToBackend(10)).resolves.toBe(false);
    expect(mockBackend.syncSettings).toHaveBeenCalledOnce();
  });
});
