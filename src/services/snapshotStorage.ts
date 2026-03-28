import { Category, Repository } from '../types';
import { GithubStarsSnapshot, SNAPSHOT_VERSION } from '../core/snapshotTypes';

export const SNAPSHOT_STORAGE_KEY = 'github-stars-manager:snapshot';

export function buildSnapshot(repositories: Repository[], categories: Category[]): GithubStarsSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    exportedAt: new Date().toISOString(),
    repositories,
    categories,
  };
}

export function writeSnapshotToLocalStorage(snapshot: GithubStarsSnapshot): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
}

export function syncSnapshotToLocalStorage(repositories: Repository[], categories: Category[]): void {
  writeSnapshotToLocalStorage(buildSnapshot(repositories, categories));
}

export function readSnapshotFromLocalStorage(): GithubStarsSnapshot | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(SNAPSHOT_STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as GithubStarsSnapshot;
  } catch (error) {
    console.error('Failed to parse local snapshot:', error);
    return null;
  }
}
