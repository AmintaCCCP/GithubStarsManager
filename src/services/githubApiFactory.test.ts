import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setBackendUrl: vi.fn(),
  setBackendAuthToken: vi.fn(),
  backendUrlGet: vi.fn<() => string | null>(() => null),
  isAvailableGet: vi.fn<() => boolean>(() => false),
  routeMode: 'auto' as 'auto' | 'backend' | 'browser',
}));

vi.mock('./githubApi', () => ({
  GitHubApiService: class {
    setBackendUrl = mocks.setBackendUrl;
    setBackendAuthToken = mocks.setBackendAuthToken;
  },
}));

vi.mock('./githubListsApi', () => ({
  GitHubListsApiService: class {
    setBackendUrl = mocks.setBackendUrl;
    setBackendAuthToken = mocks.setBackendAuthToken;
  },
}));

vi.mock('./backendAdapter', () => ({
  backend: {
    get backendUrl() { return mocks.backendUrlGet(); },
    get isAvailable() { return mocks.isAvailableGet(); },
  },
}));

vi.mock('../store/useAppStore', () => ({
  useAppStore: {
    getState: () => ({ routeMode: mocks.routeMode, backendApiSecret: 'secret-value' }),
  },
}));

import { createGitHubApiService, createGitHubListsApiService } from './githubApiFactory';

describe('githubApiFactory routeMode', () => {
  beforeEach(() => {
    mocks.setBackendUrl.mockClear();
    mocks.setBackendAuthToken.mockClear();
    mocks.routeMode = 'auto';
    mocks.backendUrlGet.mockReturnValue(null);
    mocks.isAvailableGet.mockReturnValue(false);
  });

  it('does not set backend URL when backend is absent (auto)', () => {
    mocks.backendUrlGet.mockReturnValue(null);
    createGitHubApiService('token');
    expect(mocks.setBackendUrl).not.toHaveBeenCalled();
  });

  it('sets backend URL when backend exists in auto mode', () => {
    mocks.backendUrlGet.mockReturnValue('http://backend/api');
    createGitHubApiService('token');
    expect(mocks.setBackendUrl).toHaveBeenCalledWith('http://backend/api');
    expect(mocks.setBackendAuthToken).toHaveBeenCalledWith('secret-value');
  });

  it('skips backend URL when routeMode is browser', () => {
    mocks.routeMode = 'browser';
    mocks.backendUrlGet.mockReturnValue('http://backend/api');
    createGitHubApiService('token');
    expect(mocks.setBackendUrl).not.toHaveBeenCalled();
    expect(mocks.setBackendAuthToken).not.toHaveBeenCalled();
  });

  it('keeps backend routing for the lists factory in auto mode', () => {
    mocks.backendUrlGet.mockReturnValue('http://backend/api');
    createGitHubListsApiService('token');
    expect(mocks.setBackendUrl).toHaveBeenCalledWith('http://backend/api');
  });

  it('skips backend URL for the lists factory in browser mode', () => {
    mocks.routeMode = 'browser';
    mocks.backendUrlGet.mockReturnValue('http://backend/api');
    createGitHubListsApiService('token');
    expect(mocks.setBackendUrl).not.toHaveBeenCalled();
  });
});
