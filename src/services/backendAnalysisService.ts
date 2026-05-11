import { backend } from './backendAdapter';
import { useAppStore } from '../store/useAppStore';

const STORAGE_KEY = 'gsm:analysis:batches';

interface SavedBatch {
  batchId: string;
  repositoryIds: number[];
}

interface BatchAnalysisOptions {
  repositoryIds: number[];
  configId: string;
  language: string;
  categoryNames: string[];
  onProgress?: (current: number, total: number) => void;
  onComplete?: (completed: number, failed: number) => void;
  onRepoResult?: (repoId: number) => void;
}

function loadSavedBatches(): SavedBatch[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch { /* corrupted */ }
  return [];
}

function saveBatch(batchId: string, repositoryIds: number[]): void {
  const batches = loadSavedBatches();
  batches.push({ batchId, repositoryIds });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(batches));
}

function removeBatch(batchId: string): void {
  const batches = loadSavedBatches().filter(b => b.batchId !== batchId);
  if (batches.length === 0) {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(batches));
  }
}

class BackendAnalysisService {
  private pollingTimeout: ReturnType<typeof setTimeout> | null = null;
  private currentBatchId: string | null = null;
  private _isRunning = false;

  async startBatchAnalysis(options: BatchAnalysisOptions): Promise<void> {
    if (this._isRunning) {
      throw new Error('Analysis already in progress');
    }

    const { repositoryIds, configId, language, categoryNames, onProgress, onComplete, onRepoResult } = options;

    const store = useAppStore.getState();

    this._isRunning = true;

    // Mark all repos as analyzing
    for (const id of repositoryIds) {
      store.setAnalyzingRepository(id, true);
    }
    store.setAnalysisProgress({ current: 0, total: repositoryIds.length });

    try {
      const { batchId } = await backend.startAnalysis(repositoryIds, configId, language, categoryNames);
      this.currentBatchId = batchId;

      // Persist to localStorage for page-refresh recovery
      saveBatch(batchId, repositoryIds);

      return new Promise<void>((resolve) => {
        let lastReportedCount = 0;

        const poll = async (): Promise<void> => {
          // Guard: if a newer batch has replaced this one, silently exit
          if (this.currentBatchId !== batchId) return;

          try {
            const progress = await backend.getAnalysisProgress(batchId);

            // Re-check after await — another batch may have been started
            if (this.currentBatchId !== batchId) return;

            store.setAnalysisProgress({ current: progress.completed + progress.failed, total: progress.total });
            onProgress?.(progress.completed + progress.failed, progress.total);

            if (progress.completed + progress.failed > lastReportedCount) {
              lastReportedCount = progress.completed + progress.failed;
              onRepoResult?.(lastReportedCount);
            }

            if (progress.status === 'completed' || progress.status === 'cancelled' || progress.status === 'failed') {
              this.finishBatch(batchId, repositoryIds);
              removeBatch(batchId);

              if (progress.status === 'completed') {
                try {
                  const repoData = await backend.fetchRepositories();
                  const repoMap = new Map(repoData.repositories.map((r) => [r.id, r]));

                  const currentRepos = useAppStore.getState().repositories;
                  const updatedRepos = currentRepos.map((r) => {
                    const updated = repoMap.get(r.id);
                    if (updated) {
                      return {
                        ...r,
                        ai_summary: updated.ai_summary,
                        ai_tags: updated.ai_tags,
                        ai_platforms: updated.ai_platforms,
                        analyzed_at: updated.analyzed_at,
                        analysis_failed: updated.analysis_failed,
                      };
                    }
                    return r;
                  });
                  useAppStore.getState().setRepositories(updatedRepos);
                } catch {
                  // Refresh failed — UI can resync manually
                }
              }

              onComplete?.(progress.completed, progress.failed);
              resolve();
              return;
            }
          } catch {
            // Poll errors are non-fatal — keep polling
          }

          // Schedule next poll only if still the current batch
          if (this.currentBatchId === batchId) {
            this.pollingTimeout = setTimeout(poll, 2000);
          }
        };

        poll();
      });
    } catch (err) {
      // Start failed — clear all states
      this.finishBatch(null, repositoryIds);
      store.setAnalysisProgress({ current: 0, total: 0 });
      throw err;
    }
  }

  async cancelBatchAnalysis(): Promise<void> {
    if (this.currentBatchId) {
      try {
        await backend.cancelAnalysis(this.currentBatchId);
      } catch {
        // Non-fatal
      }
      // Don't call finishBatch — the poll will detect 'cancelled' and clean up
    }
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  /**
   * Called on app startup to reconnect to any batch that was running
   * when the user last refreshed the page.
   */
  async resumeBatchAnalysis(
    onProgress?: (current: number, total: number) => void,
    onComplete?: () => void,
  ): Promise<void> {
    if (this._isRunning) return;
    if (!backend.isAvailable) return;

    const savedBatches = loadSavedBatches();
    if (savedBatches.length === 0) return;

    // Fetch active batches from backend to see what's still running
    let activeBatches: Array<{ batchId: string; status: string; total: number; completed: number; failed: number; repositoryIds: number[] }> = [];
    try {
      activeBatches = await backend.getActiveBatches();
    } catch {
      // Backend unreachable — keep saved batches for next attempt
      return;
    }

    const activeIds = new Set(activeBatches.map(b => b.batchId));

    // Clean up completed batches from localStorage
    let cleaned = false;
    for (const saved of savedBatches) {
      if (!activeIds.has(saved.batchId)) {
        removeBatch(saved.batchId);
        cleaned = true;
      }
    }
    if (cleaned) {
      // Reload after cleaning
      const remaining = loadSavedBatches();
      if (remaining.length === 0) return;
    }

    // If no active batches on backend, nothing to resume
    if (activeBatches.length === 0) return;

    // Resume the first active batch that we have in localStorage
    // (normally there's only one batch running at a time)
    const remainingSaved = loadSavedBatches();
    for (const active of activeBatches) {
      const saved = remainingSaved.find(s => s.batchId === active.batchId);
      if (!saved) continue;

      // Restore analyzing state for all repositories in this batch
      const store = useAppStore.getState();
      for (const id of saved.repositoryIds) {
        store.setAnalyzingRepository(id, true);
      }
      store.setLoading(true);
      store.setAnalysisProgress({ current: active.completed + active.failed, total: active.total });

      this._isRunning = true;
      this.currentBatchId = active.batchId;

      const poll = async (): Promise<void> => {
        if (this.currentBatchId !== active.batchId) return;

        try {
          const progress = await backend.getAnalysisProgress(active.batchId);
          if (this.currentBatchId !== active.batchId) return;

          store.setAnalysisProgress({ current: progress.completed + progress.failed, total: progress.total });
          onProgress?.(progress.completed + progress.failed, progress.total);

          if (progress.status === 'completed' || progress.status === 'cancelled' || progress.status === 'failed') {
            this.finishBatch(active.batchId, saved.repositoryIds);
            removeBatch(active.batchId);

            if (progress.status === 'completed') {
              try {
                const repoData = await backend.fetchRepositories();
                const repoMap = new Map(repoData.repositories.map((r) => [r.id, r]));
                const currentRepos = useAppStore.getState().repositories;
                const updatedRepos = currentRepos.map((r) => {
                  const updated = repoMap.get(r.id);
                  if (updated) {
                    return {
                      ...r,
                      ai_summary: updated.ai_summary,
                      ai_tags: updated.ai_tags,
                      ai_platforms: updated.ai_platforms,
                      analyzed_at: updated.analyzed_at,
                      analysis_failed: updated.analysis_failed,
                    };
                  }
                  return r;
                });
                useAppStore.getState().setRepositories(updatedRepos);
              } catch {
                // Refresh failed — UI can resync manually
              }
            }

            store.setLoading(false);
            store.setAnalysisProgress({ current: 0, total: 0 });
            onComplete?.();
            return;
          }
        } catch {
          // Poll errors are non-fatal
        }

        if (this.currentBatchId === active.batchId) {
          this.pollingTimeout = setTimeout(poll, 2000);
        }
      };

      poll();
      return; // Only resume one batch
    }
  }

  private finishBatch(batchId: string | null, repositoryIds: number[]): void {
    // Only clean up instance state if this batch is still current
    if (batchId === null || this.currentBatchId === batchId) {
      this._isRunning = false;
      if (this.pollingTimeout !== null) {
        clearTimeout(this.pollingTimeout);
        this.pollingTimeout = null;
      }
      this.currentBatchId = null;
    }

    // Always clear analyzing states for this batch's repos
    const store = useAppStore.getState();
    for (const id of repositoryIds) {
      store.setAnalyzingRepository(id, false);
    }
  }
}

export const backendAnalysis = new BackendAnalysisService();
