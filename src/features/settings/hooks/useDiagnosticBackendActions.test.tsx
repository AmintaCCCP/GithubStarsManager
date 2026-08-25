import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogEntry } from '../../../services/logger';
import { useDiagnosticBackendActions } from './useDiagnosticBackendActions';

vi.mock('../../../services/backendAdapter', () => ({
  backend: { isAvailable: true, backendUrl: 'http://backend.test' },
}));

const entry = {
  timestamp: '2026-08-25T00:00:00.000Z',
  level: 'info',
  message: 'Backend is healthy',
} as LogEntry;

describe('useDiagnosticBackendActions', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('backend unavailable')));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('preserves displayed backend logs when a later refresh fails', async () => {
    const { result } = renderHook(() => useDiagnosticBackendActions({ selectedScope: 'frontend' }));
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [entry],
      headers: { get: (name: string) => name === 'X-Log-Count' ? '1' : null },
    } as unknown as Response);

    await act(async () => { await result.current.refresh(); });
    expect(result.current.backendEntries).toEqual([entry]);
    expect(result.current.backendLogCount).toBe(1);

    fetchMock.mockResolvedValueOnce({ ok: false } as Response);
    await act(async () => { await result.current.refresh(); });

    expect(result.current.backendEntries).toEqual([entry]);
    expect(result.current.backendLogCount).toBe(1);
  });
});
