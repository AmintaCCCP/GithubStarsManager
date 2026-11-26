import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTIVE_PROFILE_KEY } from './profileStorage';

describe('BackendAdapter multi-account profilesSupported guard', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    localStorage.clear();
    sessionStorage.clear();
  });

  it('refuses connection for non-default profile when old backend omits profilesSupported', async () => {
    localStorage.setItem(ACTIVE_PROFILE_KEY, 'p_999');

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok', version: '0.9.1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchMock;

    const { backend, getBackendAuthHeaders } = await import('./backendAdapter');
    await backend.init('https://old-server.example.com/api');

    expect(backend.isAvailable).toBe(false);
    expect(backend.profilesSupported).toBe(false);
    expect(backend.profilesUnsupportedWarning).toBe(true);
    expect(getBackendAuthHeaders()['X-GSM-Profile']).toBe('p_999');
  });

  it('connects for non-default profile when backend reports profilesSupported: true and supports profile endpoints', async () => {
    localStorage.setItem(ACTIVE_PROFILE_KEY, 'p_999');

    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'ok', profilesSupported: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/profiles') && (!init?.method || init.method === 'GET')) {
        return new Response(
          JSON.stringify({ profiles: [{ id: 'p_999', login: 'bob' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/profiles/p_888') && init?.method === 'DELETE') {
        return new Response(JSON.stringify({ deleted: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not Found', { status: 404 });
    });
    globalThis.fetch = fetchMock;

    const { backend, getBackendAuthHeaders } = await import('./backendAdapter');
    await backend.init('https://new-server.example.com/api');

    expect(backend.isAvailable).toBe(true);
    expect(backend.profilesSupported).toBe(true);
    expect(backend.profilesUnsupportedWarning).toBe(false);
    expect(getBackendAuthHeaders()['X-GSM-Profile']).toBe('p_999');

    const profiles = await backend.listServerProfiles();
    expect(profiles).toEqual([{ id: 'p_999', login: 'bob' }]);

    const deleted = await backend.deleteServerProfile('p_888');
    expect(deleted).toBe(true);
  });

  it('connects normally for default profile on old backend and sends NO X-GSM-Profile header', async () => {
    // No gsm:active-profile set -> default
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok', version: '0.9.1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchMock;

    const { backend, getBackendAuthHeaders } = await import('./backendAdapter');
    await backend.init('https://old-server.example.com/api');

    expect(backend.isAvailable).toBe(true);
    expect(backend.profilesSupported).toBe(false);
    expect(backend.profilesUnsupportedWarning).toBe(false);
    expect(getBackendAuthHeaders()).not.toHaveProperty('X-GSM-Profile');
  });
});
