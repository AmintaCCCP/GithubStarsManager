import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteMode } from '../types';

const mocks = vi.hoisted(() => ({
  setBackendUrl: vi.fn(),
  setBackendAuthToken: vi.fn(),
  setBackendAccountId: vi.fn(),
  backendUrlGet: vi.fn<() => string | null>(() => null),
  isAvailableGet: vi.fn<() => boolean>(() => false),
  routeMode: 'auto' as RouteMode,
}));

vi.mock('./githubApi', () => ({
  GitHubApiService: class {
    setBackendUrl = mocks.setBackendUrl;
    setBackendAuthToken = mocks.setBackendAuthToken;
    setBackendAccountId = mocks.setBackendAccountId;
  },
}));

vi.mock('./githubListsApi', () => ({
  GitHubListsApiService: class {
    setBackendUrl = mocks.setBackendUrl;
    setBackendAuthToken = mocks.setBackendAuthToken;
    setBackendAccountId = mocks.setBackendAccountId;
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
    // 审计修复（C61）：Store 数据带当前用户——工厂把当前账号 ID 传给
    // setBackendAccountId，请求头 X-GitHub-Account-Id 由该值推导。
    getState: () => ({
      routeMode: mocks.routeMode,
      backendApiSecret: 'secret-value',
      user: { id: 42, login: 'factory-user', name: 'Factory User', avatar_url: '', email: null },
    }),
  },
}));

import { createGitHubApiService, createGitHubListsApiService } from './githubApiFactory';

describe('githubApiFactory routeMode', () => {
  beforeEach(() => {
    mocks.setBackendUrl.mockClear();
    mocks.setBackendAuthToken.mockClear();
    mocks.setBackendAccountId.mockClear();
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
    // 审计修复（C61）：REST 工厂把 Store 当前用户 ID 传给 setBackendAccountId
    expect(mocks.setBackendAccountId).toHaveBeenCalledWith('42');
  });

  it('skips backend URL when routeMode is browser', () => {
    mocks.routeMode = 'browser';
    mocks.backendUrlGet.mockReturnValue('http://backend/api');
    createGitHubApiService('token');
    expect(mocks.setBackendUrl).not.toHaveBeenCalled();
    expect(mocks.setBackendAuthToken).not.toHaveBeenCalled();
  });

  it('direct option skips backend attach even when backend exists', () => {
    mocks.routeMode = 'auto';
    mocks.backendUrlGet.mockReturnValue('http://backend/api');
    createGitHubApiService('token', { direct: true });
    expect(mocks.setBackendUrl).not.toHaveBeenCalled();
    expect(mocks.setBackendAuthToken).not.toHaveBeenCalled();
    // 审计修复（C61）：直连模式不调用账号 setter
    expect(mocks.setBackendAccountId).not.toHaveBeenCalled();
  });

  it('keeps backend routing for the lists factory in auto mode', () => {
    mocks.backendUrlGet.mockReturnValue('http://backend/api');
    createGitHubListsApiService('token');
    expect(mocks.setBackendUrl).toHaveBeenCalledWith('http://backend/api');
    // 审计修复（C61）：Lists 工厂同样把 Store 当前用户 ID 传给 setBackendAccountId
    expect(mocks.setBackendAccountId).toHaveBeenCalledWith('42');
  });

  it('skips backend URL for the lists factory in browser mode', () => {
    mocks.routeMode = 'browser';
    mocks.backendUrlGet.mockReturnValue('http://backend/api');
    createGitHubListsApiService('token');
    expect(mocks.setBackendUrl).not.toHaveBeenCalled();
  });
});
