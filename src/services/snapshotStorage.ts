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
  } catch {
    return null;
  }
}

// Write snapshot to the fixed desktop file path via Electron IPC
export async function writeSnapshotToDesktopFile(snapshot: GithubStarsSnapshot): Promise<{ ok: boolean; path?: string; error?: string }> {
  const w = window as Window & { electronAPI?: { writeSnapshot: (data: GithubStarsSnapshot) => Promise<{ ok: boolean; path?: string; error?: string }> } };
  if (!w.electronAPI) {
    // Not in Electron, fall back to localStorage
    writeSnapshotToLocalStorage(snapshot);
    return { ok: true };
  }
  return w.electronAPI.writeSnapshot(snapshot);
}

// Read snapshot from the fixed desktop file path via Electron IPC
export async function readSnapshotFromDesktopFile(): Promise<{ ok: boolean; data?: GithubStarsSnapshot; path?: string; error?: string }> {
  const w = window as Window & { electronAPI?: { readSnapshot: () => Promise<{ ok: boolean; data?: GithubStarsSnapshot; path?: string; error?: string }> } };
  if (!w.electronAPI) {
    // Not in Electron, fall back to localStorage
    const data = readSnapshotFromLocalStorage();
    return data ? { ok: true, data } : { ok: false, error: 'No snapshot found' };
  }
  return w.electronAPI.readSnapshot();
}

// Get the fixed snapshot file path
export async function getSnapshotPath(): Promise<string> {
  const w = window as Window & { electronAPI?: { getSnapshotPath: () => Promise<string> } };
  if (!w.electronAPI) {
    // Not in Electron, return localStorage key as fallback indicator
    return SNAPSHOT_STORAGE_KEY;
  }
  return w.electronAPI.getSnapshotPath();
}
