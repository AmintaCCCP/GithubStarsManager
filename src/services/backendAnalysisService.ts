import { backend } from './backendAdapter';
import { useAppStore } from '../store/useAppStore';

interface BatchAnalysisOptions {
  repositoryIds: number[];
  configId: string;
  language: string;
  categoryNames: string[];
  onProgress?: (current: number, total: number) => void;
  onComplete?: (completed: number, failed: number) => void;
  onRepoResult?: (repoId: number) => void;
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
