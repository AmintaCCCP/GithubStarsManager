import type { GitHubApiService, RepositoryFileRead, RepositoryTreeRead } from '../githubApi';
import { repositoryChatCache } from '../repositoryChatCache';
import { MARKDOWN_EVIDENCE_PATH } from './retrieval';

/** Pinned-SHA reads are immutable, so the shared IndexedDB cache can be reused across turns and sessions. */
export const readRepositoryTreeWithCache = async (
  github: GitHubApiService,
  repoFullName: string,
  owner: string,
  repo: string,
  ref: string,
  signal?: AbortSignal,
): Promise<RepositoryTreeRead> => {
  const cached = await repositoryChatCache.getTree(repoFullName, ref);
  if (cached) return cached;
  const tree = await github.getRepositoryTree(owner, repo, ref, signal);
  await repositoryChatCache.putTree(repoFullName, ref, tree);
  return tree;
};

export const readRepositoryFileWithCache = async (
  github: GitHubApiService,
  repoFullName: string,
  owner: string,
  repo: string,
  path: string,
  ref: string,
  signal?: AbortSignal,
): Promise<RepositoryFileRead> => {
  const cached = await repositoryChatCache.getFile(repoFullName, ref, path);
  if (cached) return cached;
  const file = MARKDOWN_EVIDENCE_PATH.test(path)
    ? await github.getRepositoryMarkdownEvidenceFile(owner, repo, path, ref, signal)
    : await github.getRepositoryFile(owner, repo, path, ref, signal);
  await repositoryChatCache.putFile(repoFullName, ref, file);
  return file;
};
