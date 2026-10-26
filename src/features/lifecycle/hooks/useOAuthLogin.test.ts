import { renderHook, waitFor, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticateWithGitHub: vi.fn(),
  syncTokenToBackend: vi.fn(),
  syncBackendData: vi.fn(),
  availabilityListeners: [] as Array<() => void>,
  backend: {
    isAvailable: true,
    backendUrl: 'https://backend.example/api' as string | null,
    backendAuthHeaders: {} as Record<string, string>,
    subscribeAvailability: (listener: () => void) => {
      mocks.availabilityListeners.push(listener);
      return () => {
        mocks.availabilityListeners = mocks.availabilityListeners.filter((l) => l !== listener);
      };
    },
  },
  isElectron: vi.fn(),
  setGitHubToken: vi.fn(),
  setUser: vi.fn(),
  oauthDeviceFlow: vi.fn(),
  oauthDeviceFlowConfig: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock('../../../services/backendAdapter', () => ({ backend: mocks.backend }));
vi.mock('../../../services/electronProxy', () => ({ isElectron: mocks.isElectron }));
vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ setGitHubToken: mocks.setGitHubToken, setUser: mocks.setUser }),
}));
vi.mock('./useLoginActions', () => ({
  useLoginActions: () => ({
    authenticateWithGitHub: mocks.authenticateWithGitHub,
    syncTokenToBackend: mocks.syncTokenToBackend,
    syncBackendData: mocks.syncBackendData,
  }),
}));

import { useOAuthLogin } from './useOAuthLogin';

const user = { id: 7, login: 'octocat', name: 'Octo', avatar_url: '', email: null };

describe('useOAuthLogin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.availabilityListeners.splice(0);
    mocks.fetchMock.mockReset();
    globalThis.fetch = mocks.fetchMock as unknown as typeof fetch;
    window.location.hash = '';
    mocks.authenticateWithGitHub.mockResolvedValue(user);
    mocks.syncTokenToBackend.mockResolvedValue({ ok: true });
    mocks.syncBackendData.mockResolvedValue(undefined);
    mocks.backend.isAvailable = true;
    mocks.backend.backendUrl = 'https://backend.example/api';
    mocks.isElectron.mockReturnValue(false);
    mocks.oauthDeviceFlowConfig.mockResolvedValue({ clientId: null });
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('detects web mode only when backend OAuth is enabled', async () => {
    mocks.fetchMock.mockResolvedValue(new Response(JSON.stringify({ enabled: true, clientId: 'cid' }), { status: 200 }));
    const { result } = renderHook(() => useOAuthLogin(vi.fn()));
    await waitFor(() => expect(result.current.mode).toBe('web'));
  });

  it('shows the web button only after backend init settles (late availability flip)', async () => {
    mocks.backend.isAvailable = false;
    const { result } = renderHook(() => useOAuthLogin(vi.fn()));
    // First render: backend still probing — no probe, no button.
    expect(mocks.fetchMock).not.toHaveBeenCalled();
    expect(result.current.mode).toBeNull();

    // backend.init() settles and flips availability; the hook re-detects.
    mocks.backend.isAvailable = true;
    mocks.fetchMock.mockResolvedValue(new Response(JSON.stringify({ enabled: true, clientId: 'cid' }), { status: 200 }));
    act(() => {
      mocks.availabilityListeners.forEach((listener) => listener());
    });
    await waitFor(() => expect(result.current.mode).toBe('web'));
  });

  it('stays null when OAuth is disabled or the probe fails', async () => {
    mocks.fetchMock.mockResolvedValue(new Response(JSON.stringify({ enabled: false, clientId: null }), { status: 200 }));
    const { result } = renderHook(() => useOAuthLogin(vi.fn()));
    await waitFor(() => expect(mocks.fetchMock).toHaveBeenCalledOnce());
    expect(result.current.mode).toBeNull();

    mocks.fetchMock.mockRejectedValue(new Error('boom'));
    const second = renderHook(() => useOAuthLogin(vi.fn()));
    await waitFor(() => expect(mocks.fetchMock).toHaveBeenCalledTimes(2));
    expect(second.result.current.mode).toBeNull();
  });

  it('detects device mode only for Electron without backend and with an injected client_id', async () => {
    mocks.backend.isAvailable = false;
    mocks.isElectron.mockReturnValue(true);
    mocks.oauthDeviceFlowConfig.mockResolvedValue({ clientId: 'device-client-id' });
    (window as unknown as { electronAPI?: unknown }).electronAPI = { oauthDeviceFlow: mocks.oauthDeviceFlow, oauthDeviceFlowConfig: mocks.oauthDeviceFlowConfig };
    const { result } = renderHook(() => useOAuthLogin(vi.fn()));
    await waitFor(() => expect(result.current.mode).toBe('device'));
  });

  it('hides the device entry when no client_id is configured on the desktop', async () => {
    mocks.backend.isAvailable = false;
    mocks.isElectron.mockReturnValue(true);
    (window as unknown as { electronAPI?: unknown }).electronAPI = { oauthDeviceFlow: mocks.oauthDeviceFlow, oauthDeviceFlowConfig: mocks.oauthDeviceFlowConfig };
    const { result } = renderHook(() => useOAuthLogin(vi.fn()));
    await waitFor(() => expect(mocks.oauthDeviceFlowConfig).toHaveBeenCalled());
    expect(result.current.mode).toBeNull();
  });

  it('probes web OAuth for Electron with an available backend', async () => {
    mocks.isElectron.mockReturnValue(true);
    (window as unknown as { electronAPI?: unknown }).electronAPI = { oauthDeviceFlow: mocks.oauthDeviceFlow };
    mocks.fetchMock.mockResolvedValue(new Response(JSON.stringify({ enabled: true, clientId: 'cid' }), { status: 200 }));
    const { result } = renderHook(() => useOAuthLogin(vi.fn()));
    await waitFor(() => expect(result.current.mode).toBe('web'));
  });

  it('keeps a pending ticket when the backend URL has not resolved yet', async () => {
    mocks.backend.backendUrl = null;
    window.location.hash = '#oauth?ticket=tic';
    const { result } = renderHook(() => useOAuthLogin(vi.fn()));
    await act(async () => {
      expect(await result.current.completeFromUrl()).toBe(false);
    });
    // Hash (and the single-use ticket) survives until the backend resolves;
    // only the config probe may have run, never the exchange.
    expect(window.location.hash).toBe('#oauth?ticket=tic');
    expect(mocks.fetchMock.mock.calls.every(([url]) => String(url).endsWith('/oauth/config'))).toBe(true);
    // Backend resolves later → the hook retries the exchange on its own.
    mocks.backend.backendUrl = 'https://backend.example/api';
    mocks.fetchMock.mockImplementation(async () => new Response(JSON.stringify({ githubToken: 'gho_t', user }), { status: 200 }));
    await act(async () => {
      mocks.availabilityListeners.forEach((listener) => listener());
    });
    await waitFor(() => expect(mocks.fetchMock.mock.calls.some(([url]) => String(url).endsWith('/oauth/github/exchange'))).toBe(true));
    expect(mocks.authenticateWithGitHub).toHaveBeenCalledWith('gho_t');
    expect(window.location.hash).toBe('');
  });

  it('completes login from a URL ticket through the shared auth path', async () => {
    window.location.hash = '#oauth?ticket=tic';
    mocks.fetchMock.mockImplementation(async () => new Response(JSON.stringify({ githubToken: 'gho_t', user }), { status: 200 }));
    const onFinished = vi.fn();
    const { result } = renderHook(() => useOAuthLogin(onFinished));

    let completed: boolean | undefined;
    await act(async () => {
      completed = await result.current.completeFromUrl();
    });
    expect(completed).toBe(true);
    expect(mocks.authenticateWithGitHub).toHaveBeenCalledWith('gho_t');
    expect(mocks.setGitHubToken).toHaveBeenCalledWith('gho_t');
    expect(mocks.setUser).toHaveBeenCalledWith(user);
    expect(mocks.syncTokenToBackend).toHaveBeenCalledWith('gho_t');
    expect(onFinished).toHaveBeenCalledWith(user, 'gho_t');
    expect(window.location.hash).toBe('');
  });

  it('surfaces an expired ticket without authenticating', async () => {
    window.location.hash = '#oauth?ticket=tic';
    mocks.fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: 'x' }), { status: 401 }));
    const onFinished = vi.fn();
    const { result } = renderHook(() => useOAuthLogin(onFinished));
    await act(async () => {
      await result.current.completeFromUrl();
    });
    expect(mocks.authenticateWithGitHub).not.toHaveBeenCalled();
    expect(onFinished).not.toHaveBeenCalled();
    expect(result.current.error).toBe('oauth.expired');
  });

  it.each(['state', 'exchange'])('surfaces a failure for #oauth?error=%s and clears the hash', async (errorCode) => {
    window.location.hash = `#oauth?error=${errorCode}`;
    const onFinished = vi.fn();
    const { result } = renderHook(() => useOAuthLogin(onFinished));
    let completed: boolean | undefined;
    await act(async () => {
      completed = await result.current.completeFromUrl();
    });
    expect(completed).toBe(true);
    expect(result.current.error).toBe('oauth.failed');
    expect(onFinished).not.toHaveBeenCalled();
    expect(mocks.authenticateWithGitHub).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('');
  });

  it('device flow IPC rejection surfaces an error instead of unhandled rejection', async () => {
    mocks.isElectron.mockReturnValue(true);
    mocks.oauthDeviceFlow.mockRejectedValue(new Error('ipc crashed'));
    (window as unknown as { electronAPI?: unknown }).electronAPI = { oauthDeviceFlow: mocks.oauthDeviceFlow, oauthDeviceFlowConfig: mocks.oauthDeviceFlowConfig };
    const onFinished = vi.fn();
    const { result } = renderHook(() => useOAuthLogin(onFinished));
    await act(async () => {
      await result.current.startDeviceFlow();
    });
    expect(mocks.authenticateWithGitHub).not.toHaveBeenCalled();
    expect(result.current.error).toBe('oauth.failed');
    expect(result.current.isCompleting).toBe(false);
  });

  it('ignores URLs without an oauth hash', async () => {
    mocks.backend.isAvailable = false;
    const { result } = renderHook(() => useOAuthLogin(vi.fn()));
    let completed: boolean | undefined;
    await act(async () => {
      completed = await result.current.completeFromUrl();
    });
    expect(completed).toBe(false);
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  it('device flow resolves through the same finish path', async () => {
    mocks.isElectron.mockReturnValue(true);
    mocks.oauthDeviceFlow.mockResolvedValue({ success: true, token: 'gho_device' });
    (window as unknown as { electronAPI?: unknown }).electronAPI = { oauthDeviceFlow: mocks.oauthDeviceFlow, oauthDeviceFlowConfig: mocks.oauthDeviceFlowConfig };
    const onFinished = vi.fn();
    const { result } = renderHook(() => useOAuthLogin(onFinished));
    await act(async () => {
      await result.current.startDeviceFlow();
    });
    expect(mocks.authenticateWithGitHub).toHaveBeenCalledWith('gho_device');
    expect(mocks.setGitHubToken).toHaveBeenCalledWith('gho_device');
    expect(mocks.setUser).toHaveBeenCalledWith(user);
    expect(onFinished).toHaveBeenCalledWith(user, 'gho_device');
  });

  it('device flow failure sets an error and skips authentication', async () => {
    mocks.isElectron.mockReturnValue(true);
    mocks.oauthDeviceFlow.mockResolvedValue({ success: false, error: 'denied' });
    (window as unknown as { electronAPI?: unknown }).electronAPI = { oauthDeviceFlow: mocks.oauthDeviceFlow, oauthDeviceFlowConfig: mocks.oauthDeviceFlowConfig };
    const onFinished = vi.fn();
    const { result } = renderHook(() => useOAuthLogin(onFinished));
    await act(async () => {
      await result.current.startDeviceFlow();
    });
    expect(mocks.authenticateWithGitHub).not.toHaveBeenCalled();
    expect(result.current.error).toBe('denied');
  });
});
