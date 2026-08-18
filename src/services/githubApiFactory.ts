import { useAppStore } from '../store/useAppStore';
import { backend } from './backendAdapter';
import { GitHubApiService } from './githubApi';
import { GitHubListsApiService } from './githubListsApi';

export function createGitHubApiService(token: string): GitHubApiService {
  const api = new GitHubApiService(token);

  if (backend.backendUrl) {
    api.setBackendUrl(backend.backendUrl);
    api.setBackendAuthToken(useAppStore.getState().backendApiSecret || null);
  }

  return api;
}

export function createGitHubListsApiService(token: string): GitHubListsApiService {
  const api = new GitHubListsApiService(token);

  if (backend.backendUrl) {
    api.setBackendUrl(backend.backendUrl);
    api.setBackendAuthToken(useAppStore.getState().backendApiSecret || null);
  }

  return api;
}
