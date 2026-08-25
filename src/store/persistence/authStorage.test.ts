import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readSessionBackendSecret,
  writeSessionBackendSecret,
} from './authStorage';

const BACKEND_SECRET_SESSION_KEY = 'github-stars-manager-backend-secret';

describe('session backend-secret storage', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes, reads, and clears the session-scoped secret when storage is available', () => {
    writeSessionBackendSecret('session-secret');
    expect(readSessionBackendSecret()).toBe('session-secret');

    writeSessionBackendSecret(null);
    expect(window.sessionStorage.getItem(BACKEND_SECRET_SESSION_KEY)).toBeNull();
  });

  it('falls back safely when browsers block sessionStorage access', () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage is blocked', 'SecurityError');
    });

    expect(readSessionBackendSecret()).toBeNull();
    expect(() => writeSessionBackendSecret('session-secret')).not.toThrow();
    expect(() => writeSessionBackendSecret(null)).not.toThrow();
  });
});
