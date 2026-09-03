import { useAppStore } from '../store/useAppStore';
import { backend } from './backendAdapter';
import { GitHubApiService } from './githubApi';
import { GitHubListsApiService } from './githubListsApi';
import { shouldBypassBackend } from './routeMode';

/**
 * 决定新建的 service 是否应附加后端代理。
 * 仅在后端可用、且当前 routeMode 不为 'browser' 时返回 true。
 * 构造时读取一次 routeMode；切换 routeMode 后已存在的 service 不会热重路由，
 * 新建的 service 才会按当前偏好决定。
 */
function shouldAttachBackend(): boolean {
  return backend.backendUrl != null && !shouldBypassBackend();
}

export function createGitHubApiService(token: string): GitHubApiService {
  const api = new GitHubApiService(token);

  if (shouldAttachBackend()) {
    api.setBackendUrl(backend.backendUrl);
    api.setBackendAuthToken(useAppStore.getState().backendApiSecret || null);
  }

  return api;
}

export function createGitHubListsApiService(token: string): GitHubListsApiService {
  const api = new GitHubListsApiService(token);

  if (shouldAttachBackend()) {
    api.setBackendUrl(backend.backendUrl);
    api.setBackendAuthToken(useAppStore.getState().backendApiSecret || null);
  }

  return api;
}
