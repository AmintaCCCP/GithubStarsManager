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

  it('passes an explicit accountId through for the lists factory instead of the store user (round-12 audit fix)', () => {
    // 显式 accountId 不得回退到 Store 用户 '42'——工厂若忽略 options.accountId，
    // 显式账号的 Lists 写入会被错误归属到当前登录账号。
    mocks.backendUrlGet.mockReturnValue('http://backend/api');
    createGitHubListsApiService('token', { accountId: '17' });
    // 第 13 轮审计修复 [24]：断言完整调用列表仅含一次 '17'——工厂若先设置
    // 其他值再覆盖为 '17'，测试应同时检查最终选值与绑定顺序。
    expect(mocks.setBackendAccountId.mock.calls).toEqual([['17']]);
  });

  it('passes an explicit null accountId through for the lists factory', () => {
    // 显式 null（无归属账号）同样按原样传递，不回退到 Store 用户。
    mocks.backendUrlGet.mockReturnValue('http://backend/api');
    createGitHubListsApiService('token', { accountId: null });
    // 完整调用列表仅含一次 null（选值 + 绑定顺序，第 13 轮审计修复 [24]）。
    expect(mocks.setBackendAccountId.mock.calls).toEqual([[null]]);
  });

  it('skips backend URL for the lists factory in browser mode', () => {
    mocks.routeMode = 'browser';
    mocks.backendUrlGet.mockReturnValue('http://backend/api');
    createGitHubListsApiService('token');
    expect(mocks.setBackendUrl).not.toHaveBeenCalled();
  });
});
