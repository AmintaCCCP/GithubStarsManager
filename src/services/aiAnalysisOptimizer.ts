import { Repository } from '../types';
import { AIService } from './aiService';
import { GitHubApiService } from './githubApi';
import { backend } from './backendAdapter';
import { AIRateLimiter, AIRateLimitConfig } from './aiRequestLimiter';
import { isRateLimitedError, getRetryAfterMsFromError } from './aiService';

export interface AnalysisTask {
  repo: Repository;
  readmeContent: string;
  retries: number;
  startTime?: number;
}

export interface AnalysisResult {
  repo: Repository;
  success: boolean;
  summary?: string;
  tags?: string[];
  platforms?: string[];
  category?: string;
  error?: Error;
  duration: number;
}

export interface OptimizerConfig {
  initialConcurrency: number;
  maxConcurrency: number;
  minConcurrency: number;
  targetResponseTime: number;
  batchDelayMs: number;
  maxRetries: number;
  retryDelayBaseMs: number;
  enableAdaptiveConcurrency: boolean;
  /** 共享 AI 请求限流配置；不传则使用默认（熔断开启，RPM/并发不限制） */
  rateLimiter?: AIRateLimitConfig;
}

const DEFAULT_CONFIG: OptimizerConfig = {
  initialConcurrency: 3,
  maxConcurrency: 10,
  minConcurrency: 1,
  targetResponseTime: 5000,
  batchDelayMs: 100,
  maxRetries: 3,
  retryDelayBaseMs: 1000,
  enableAdaptiveConcurrency: true,
  rateLimiter: {
    maxConcurrency: 0,
    requestsPerMinute: 0,
    cooldownThreshold: 3,
    backoffBaseMs: 1000,
    backoffCapMs: 60000,
    maxRetryAfterMs: 60000,
  },
};

export class AIAnalysisOptimizer {
  private config: OptimizerConfig;
  private currentConcurrency: number;
  private responseTimes: number[] = [];
  private aborted = false;
  private paused = false;
  private activeWorkers = 0;
  private shouldExitWorkers = false;
  // 批次级中止信号：所有 worker 的限流等待、AI 请求与重试延迟共用同一信号，
  // 保证 abort() 能立即停下所有仍在阻塞的 worker（而非只停最近一次请求）。
  private readonly batchAbortController = new AbortController();
  private readonly sharedLimiter: AIRateLimiter;

  constructor(config: Partial<OptimizerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.currentConcurrency = this.config.initialConcurrency;
    this.sharedLimiter = new AIRateLimiter(this.config.rateLimiter);
  }

  /** 限流器实例：供外部（请求层 / 测试）复用同一份冷却与统计。 */
  get limiter(): AIRateLimiter {
    return this.sharedLimiter;
  }

  /** 中止整个批次：所有在飞请求、限流等待与重试延迟立即停止。 */
  abort(): void {
    this.aborted = true;
    this.shouldExitWorkers = true;
    this.batchAbortController.abort();
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  isAborted(): boolean {
    return this.aborted;
  }

  isPaused(): boolean {
    return this.paused;
  }

  getCurrentConcurrency(): number {
    return this.currentConcurrency;
  }

  private recordResponseTime(duration: number): void {
    this.responseTimes.push(duration);
    if (this.responseTimes.length > 20) {
      this.responseTimes.shift();
    }

    if (this.config.enableAdaptiveConcurrency && this.responseTimes.length >= 5) {
      this.adjustConcurrency();
    }
  }

  private adjustConcurrency(): void {
    const recentTimes = this.responseTimes.slice(-5);
    const recentAvg = recentTimes.reduce((a, b) => a + b, 0) / recentTimes.length;

    const oldConcurrency = this.currentConcurrency;
    
    if (recentAvg > this.config.targetResponseTime * 1.5) {
      this.currentConcurrency = Math.max(
        this.config.minConcurrency,
        Math.floor(this.currentConcurrency * 0.8)
      );
    } else if (recentAvg < this.config.targetResponseTime * 0.7 && this.currentConcurrency < this.config.maxConcurrency) {
      this.currentConcurrency = Math.min(
        this.config.maxConcurrency,
        this.currentConcurrency + 1
      );
    }
    
    // 如果并发数减少，通知 worker 退出
    if (this.currentConcurrency < oldConcurrency) {
      this.shouldExitWorkers = true;
    }
  }

  /** 可中止的延迟：abort() 后立即放行，调用方依靠 aborted 标记结束批次。 */
  private abortableDelay(ms: number): Promise<void> {
    return new Promise(resolve => {
      const signal = this.batchAbortController.signal;
      if (signal.aborted) {
        resolve();
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        resolve();
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal.addEventListener('abort', onAbort);
    });
  }

  private async waitWhilePaused(): Promise<void> {
    while (this.paused && !this.aborted) {
      await this.abortableDelay(500);
    }
  }

  private calculateRetryDelay(retryCount: number): number {
    const jitter = Math.random() * 500;
    return this.config.retryDelayBaseMs * Math.pow(2, retryCount) + jitter;
  }

  private async fetchReadme(repo: Repository, githubApi: GitHubApiService, signal?: AbortSignal): Promise<string> {
    if (this.aborted || signal?.aborted) return '';
    await this.waitWhilePaused();
    if (this.aborted || signal?.aborted) return '';

    try {
      if (backend.isAvailable) {
        const [owner, name] = repo.full_name.split('/');
        return await backend.getRepositoryReadme(owner, name, signal);
      }
      const [owner, name] = repo.full_name.split('/');
      return await githubApi.getRepositoryReadme(owner, name, signal);
    } catch (error) {
      if (this.aborted || signal?.aborted) return '';
      console.warn(`Failed to fetch README for ${repo.full_name}:`, error);
      return '';
    }
  }

  async prefetchReadmes(
    repos: Repository[],
    githubApi: GitHubApiService,
    onProgress?: (completed: number, total: number) => void
  ): Promise<Map<number, string>> {
    const readmeCache = new Map<number, string>();
    const concurrency = Math.min(10, repos.length);
    const results = new Map<number, { content: string | null; error?: Error }>();

    const fetchReadme = async (repo: Repository): Promise<void> => {
      if (this.aborted || this.batchAbortController.signal.aborted) return;
      await this.waitWhilePaused();
      if (this.aborted || this.batchAbortController.signal.aborted) return;

      try {
        const content = await this.fetchReadme(repo, githubApi, this.batchAbortController.signal);
        results.set(repo.id, { content });
      } catch (error) {
        results.set(repo.id, { content: '', error: error as Error });
      }
    };

    for (let i = 0; i < repos.length; i += concurrency) {
      if (this.aborted) break;

      const batch = repos.slice(i, i + concurrency);
      await Promise.all(batch.map(repo => fetchReadme(repo)));

      if (onProgress) {
        onProgress(Math.min(i + concurrency, repos.length), repos.length);
      }

      if (i + concurrency < repos.length && !this.aborted) {
        await this.abortableDelay(100);
      }
    }

    for (const [repoId, result] of results) {
      readmeCache.set(repoId, result.content || '');
    }

    return readmeCache;
  }

  async analyzeWithRetry(
    task: AnalysisTask,
    aiService: AIService,
    categoryNames: string[],
    categoryHints?: string
  ): Promise<AnalysisResult> {
    const startTime = Date.now();
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      if (this.aborted) {
        return {
          repo: task.repo,
          success: false,
          error: new Error('Analysis aborted'),
          duration: Date.now() - startTime,
        };
      }

      await this.waitWhilePaused();

      if (this.aborted) {
        return {
          repo: task.repo,
          success: false,
          error: new Error('Analysis aborted'),
          duration: Date.now() - startTime,
        };
      }

      try {
        // 通过共享限流器占用一个请求槽：冷却 / RPM 窗口内会自动等待
        const release = await this.sharedLimiter.acquire(this.batchAbortController.signal);
        try {
          // 起算点放在 acquire 之后：限流排队时间不应计入 provider 响应时长，
          // 否则 429 冷却会把「并发调节」误判为 provider 变慢而持续降并发
          const analysisStart = Date.now();
          const analysis = await aiService.analyzeRepository(task.repo, task.readmeContent, categoryNames, categoryHints, this.batchAbortController.signal);
          const analysisDuration = Date.now() - analysisStart;
          this.sharedLimiter.notifySuccess();
          this.recordResponseTime(analysisDuration);
          return {
            repo: task.repo,
            success: true,
            summary: analysis.summary,
            tags: analysis.tags,
            platforms: analysis.platforms,
            duration: Date.now() - startTime,
          };
        } finally {
          release();
        }
      } catch (error) {
        lastError = error as Error;

        if (this.aborted) {
          return {
            repo: task.repo,
            success: false,
            error: new Error('Analysis aborted'),
            duration: Date.now() - startTime,
          };
        }

        // 429 / 限流：记入共享限流器，触发全局冷却并采纳服务端 Retry-After
        if (isRateLimitedError(error)) {
          this.sharedLimiter.notifyRateLimit(getRetryAfterMsFromError(error));
        }

        if (attempt < this.config.maxRetries) {
          // 限流场景下，最短等待到全局冷却结束（含 Retry-After），避免与冷却窗口竞争
          const cooldownWait = this.sharedLimiter.getStatus().cooldownRemainingMs;
          const delayMs = Math.max(this.calculateRetryDelay(attempt), cooldownWait);
          // 可中止的等待：abort() 后立即结束等待，由下一轮循环的 aborted 检查兜底返回
          await this.abortableDelay(delayMs);
        }
      }
    }

    return {
      repo: task.repo,
      success: false,
      error: lastError,
      duration: Date.now() - startTime,
    };
  }

  async analyzeRepositories(
    repos: Repository[],
    readmeCache: Map<number, string>,
    aiService: AIService,
    categoryNames: string[],
    categoryHints?: string,
    onProgress?: (completed: number, total: number, currentConcurrency: number) => void,
    onResult?: (result: AnalysisResult) => void
  ): Promise<AnalysisResult[]> {
    const results: AnalysisResult[] = [];
    const pendingRepos = [...repos];
    const completedCount = { value: 0 };
    const total = repos.length;
    const workerPromises: Promise<void>[] = [];
    let totalWorkersStarted = 0;

    const runTask = async (repo: Repository): Promise<AnalysisResult> => {
      const readmeContent = readmeCache.get(repo.id) || '';
      const task: AnalysisTask = { repo, readmeContent, retries: 0 };
      return this.analyzeWithRetry(task, aiService, categoryNames, categoryHints);
    };

    const worker = async (workerId: number): Promise<void> => {
      this.activeWorkers++;
      try {
        while (pendingRepos.length > 0) {
          if (this.aborted) break;
          if (this.shouldExitWorkers && workerId >= this.currentConcurrency) break;
          
          await this.waitWhilePaused();
          if (this.aborted) break;
          if (this.shouldExitWorkers && workerId >= this.currentConcurrency) break;

          const repo = pendingRepos.shift();
          if (!repo) break;

          try {
            const result = await runTask(repo);
            completedCount.value++;
            results.push(result);

            if (onResult) {
              onResult(result);
            }
            if (onProgress) {
              onProgress(completedCount.value, total, this.activeWorkers);
            }
          } catch {
            completedCount.value++;
          }
        }
      } finally {
        this.activeWorkers--;
      }
    };

    const initialWorkers = Math.min(this.currentConcurrency, repos.length);
    for (let i = 0; i < initialWorkers; i++) {
      workerPromises.push(worker(totalWorkersStarted++));
    }

    const concurrencyMonitor = async (): Promise<void> => {
      while (pendingRepos.length > 0 && !this.aborted) {
        await this.abortableDelay(1000);

        if (this.shouldExitWorkers) {
          this.shouldExitWorkers = false;
          continue;
        }

        if (this.activeWorkers < this.currentConcurrency) {
          workerPromises.push(worker(totalWorkersStarted++));
        }
      }
    };

    workerPromises.push(concurrencyMonitor());
    await Promise.all(workerPromises);

    return results;
  }

  async analyzeRepositoriesPipelined(
    repos: Repository[],
    githubApi: GitHubApiService,
    aiService: AIService,
    categoryNames: string[],
    categoryHints?: string,
    onProgress?: (completed: number, total: number, currentConcurrency: number) => void,
    onResult?: (result: AnalysisResult) => void
  ): Promise<AnalysisResult[]> {
    const results: AnalysisResult[] = [];
    const pendingRepos = [...repos];
    const completedCount = { value: 0 };
    const total = repos.length;
    const workerPromises: Promise<void>[] = [];
    let totalWorkersStarted = 0;

    const readmeCache = new Map<number, string>();
    const readmeFetching = new Map<number, Promise<string>>();

    const prefetchReadme = async (repo: Repository): Promise<string> => {
      if (readmeCache.has(repo.id)) {
        return readmeCache.get(repo.id)!;
      }
      if (readmeFetching.has(repo.id)) {
        return readmeFetching.get(repo.id)!;
      }

      const promise = this.fetchReadme(repo, githubApi, this.batchAbortController.signal).then(content => {
        readmeCache.set(repo.id, content);
        readmeFetching.delete(repo.id);
        return content;
      }).catch(() => {
        readmeCache.set(repo.id, '');
        readmeFetching.delete(repo.id);
        return '';
      });

      readmeFetching.set(repo.id, promise);
      return promise;
    };

    const worker = async (workerId: number): Promise<void> => {
      this.activeWorkers++;
      try {
        while (pendingRepos.length > 0) {
          if (this.aborted) break;
          if (this.shouldExitWorkers && workerId >= this.currentConcurrency) break;
          
          await this.waitWhilePaused();
          if (this.aborted) break;
          if (this.shouldExitWorkers && workerId >= this.currentConcurrency) break;

          const repo = pendingRepos.shift();
          if (!repo) break;

          try {
            const readmeContent = await prefetchReadme(repo);

            const readmePrefetchCount = Math.min(this.currentConcurrency * 2, pendingRepos.length);
            if (pendingRepos.length > 0) {
              for (let i = 0; i < Math.min(readmePrefetchCount, pendingRepos.length); i++) {
                prefetchReadme(pendingRepos[i]);
              }
            }

            const task: AnalysisTask = { repo, readmeContent, retries: 0 };
            const result = await this.analyzeWithRetry(task, aiService, categoryNames, categoryHints);

            completedCount.value++;
            results.push(result);

            if (onResult) {
              onResult(result);
            }
            if (onProgress) {
              onProgress(completedCount.value, total, this.activeWorkers);
            }
          } catch {
            completedCount.value++;
          }
        }
      } finally {
        this.activeWorkers--;
      }
    };

    const initialWorkers = Math.min(this.currentConcurrency, repos.length);
    for (let i = 0; i < initialWorkers; i++) {
      workerPromises.push(worker(totalWorkersStarted++));
    }

    const concurrencyMonitor = async (): Promise<void> => {
      while (pendingRepos.length > 0 && !this.aborted) {
        await this.abortableDelay(1000);

        if (this.shouldExitWorkers) {
          this.shouldExitWorkers = false;
          continue;
        }

        if (this.activeWorkers < this.currentConcurrency) {
          workerPromises.push(worker(totalWorkersStarted++));
        }
      }
    };

    workerPromises.push(concurrencyMonitor());
    await Promise.all(workerPromises);

    return results;
  }

  getStats(): {
    averageResponseTime: number;
    currentConcurrency: number;
    totalRequests: number;
  } {
    const avgTime = this.responseTimes.length > 0
      ? this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length
      : 0;

    return {
      averageResponseTime: Math.round(avgTime),
      currentConcurrency: this.currentConcurrency,
      totalRequests: this.responseTimes.length,
    };
  }
}

export function createOptimizedAIAnalyzer(config?: Partial<OptimizerConfig>): AIAnalysisOptimizer {
  return new AIAnalysisOptimizer(config);
}
