import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBackendAvailability } from './useBackendAvailability';

const mocks = vi.hoisted(() => ({
  backend: { isAvailable: false },
}));

vi.mock('../../../services/backendAdapter', () => ({ backend: mocks.backend }));

describe('useBackendAvailability', () => {
  beforeEach(() => {
    mocks.backend.isAvailable = false;
  });

  it('returns false when the backend is unavailable', () => {
    const { result } = renderHook(() => useBackendAvailability());
    expect(result.current).toBe(false);
  });

  it('returns true when the backend is available', () => {
    mocks.backend.isAvailable = true;
    const { result } = renderHook(() => useBackendAvailability());
    expect(result.current).toBe(true);
  });
});
