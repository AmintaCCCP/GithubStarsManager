
import type { Gist, Repository } from '../../types';

export const areRepositoryRecordsEqual = (a: Repository, b: Repository): boolean => {
  if (a === b) return true;

  const keys = new Set<keyof Repository>([
    ...(Object.keys(a) as Array<keyof Repository>),
    ...(Object.keys(b) as Array<keyof Repository>),
  ]);

  for (const key of keys) {
    if (!Object.is(a[key], b[key])) {
      return false;
    }
  }

  return true;
};

export const replaceRepositoryInList = (
  repositories: Repository[],
  repo: Repository
): { repositories: Repository[]; changed: boolean; found: boolean } => {
  const index = repositories.findIndex((item) => item.id === repo.id);
  if (index === -1) {
    return { repositories, changed: false, found: false };
  }

  if (areRepositoryRecordsEqual(repositories[index], repo)) {
    return { repositories, changed: false, found: true };
  }

  const nextRepositories = repositories.slice();
  nextRepositories[index] = repo;
  return { repositories: nextRepositories, changed: true, found: true };
};

export const areGistRecordsEqual = (a: Gist, b: Gist): boolean => {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
};

export const replaceGistInList = (
  gists: Gist[],
  gist: Gist
): { gists: Gist[]; changed: boolean; found: boolean } => {
  const index = gists.findIndex((item) => item.id === gist.id);
  if (index === -1) {
    return { gists, changed: false, found: false };
  }

  if (areGistRecordsEqual(gists[index], gist)) {
    return { gists, changed: false, found: true };
  }

  const nextGists = gists.slice();
  nextGists[index] = gist;
  return { gists: nextGists, changed: true, found: true };
};
