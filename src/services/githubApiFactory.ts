import { useAppStore } from '../store/useAppStore';
import { backend } from './backendAdapter';
import { GitHubApiService } from './githubApi';

export function createGitHubApiService(token: string): GitHubApiService {
  const api = new GitHubApiService(token);

  if (backend.backendUrl) {
    api.setBackendUrl(backend.backendUrl);
    api.setBackendAuthToken(useAppStore.getState().backendApiSecret || null);
  }

  return api;
}
