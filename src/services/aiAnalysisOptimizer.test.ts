import { describe, it, expect, vi } from 'vitest';
import { AIAnalysisOptimizer, AnalysisTask } from './aiAnalysisOptimizer';
import type { AIService } from './aiService';
import type { GitHubApiService } from './githubApi';
import { AIRequestError } from './aiService';
import type { Repository } from '../types';

vi.mock('../store/useAppStore', () => ({
  useAppStore: { getState: () => ({ routeMode: 'auto' }) },
}));

function makeRepo(id: number): Repository {
  return {
    id,
    name: `repo-${id}`,
    full_name: `acme/repo-${id}`,
    description: null,
    html_url: `https://github.com/acme/repo-${id}`,
    stargazers_count: 0,
    forks_count: 0,
    forks: 0,
    language: 'TypeScript',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-06-01T00:00:00Z',
    pushed_at: '2024-06-01T00:00:00Z',
    owner: { login: 'owner', avatar_url: '' },
    topics: [],
  };
}

function makeTask(id: number): AnalysisTask {
  return { repo: makeRepo(id), readmeContent: '# readme', retries: 0 };
}

describe('AIAnalysisOptimizer 与共享限流器集成', () => {
  it('遭遇 429 时记录到限流器、等待后重试成功，并清零计数', async () => {
    const optimizer = new AIAnalysisOptimizer({
      maxRetries: 2,
      retryDelayBaseMs: 1,
      rateLimiter: {
        maxConcurrency: 0,
        requestsPerMinute: 0,
        cooldownThreshold: 3,
        backoffBaseMs: 10,
        backoffCapMs: 120,
        maxRetryAfterMs: 50,
      },
    });

    const analyze = vi.fn()
      .mockRejectedValueOnce(new AIRequestError('rate limited', 429, 200000))
      .mockResolvedValueOnce({ summary: 'ok', tags: [], platforms: [] });
    const fakeAi = { analyzeRepository: analyze } as unknown as AIService;

    const result = await optimizer.analyzeWithRetry(makeTask(1), fakeAi, []);

    expect(result.success).toBe(true);
    expect(analyze).toHaveBeenCalledTimes(2);
    // 成功后将连续 429 计数复位
    expect(optimizer.limiter.getStatus().consecutiveRateLimits).toBe(0);
  });

  it('连续 429 超过阈值触发熔断，重试耗尽后返回失败', async () => {
    const optimizer = new AIAnalysisOptimizer({
      maxRetries: 2,
      retryDelayBaseMs: 1,
      rateLimiter: {
        maxConcurrency: 0,
        requestsPerMinute: 0,
        cooldownThreshold: 2,
        backoffBaseMs: 5,
        backoffCapMs: 50,
        maxRetryAfterMs: 30,
      },
    });

    const analyze = vi.fn().mockRejectedValue(new AIRequestError('too many requests', 429));
    const fakeAi = { analyzeRepository: analyze } as unknown as AIService;

    const result = await optimizer.analyzeWithRetry(makeTask(2), fakeAi, []);

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(AIRequestError);
    // 3 次调用 >= 阈值 2 => 熔断打开
    expect(optimizer.limiter.getStatus().circuitOpen).toBe(true);
    expect(optimizer.limiter.getStatus().consecutiveRateLimits).toBe(3);
  });

  it('非限流错误不受 RateLimiter 冷却影响', async () => {
    const optimizer = new AIAnalysisOptimizer({
      maxRetries: 1,
      rateLimiter: { maxConcurrency: 0, requestsPerMinute: 0, cooldownThreshold: 2 },
    });

    const analyze = vi.fn()
      .mockRejectedValueOnce(new Error('some server error'))
      .mockResolvedValueOnce({ summary: 'ok', tags: [], platforms: [] });
    const fakeAi = { analyzeRepository: analyze } as unknown as AIService;

    const result = await optimizer.analyzeWithRetry(makeTask(3), fakeAi, []);

    expect(result.success).toBe(true);
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(optimizer.limiter.getStatus().consecutiveRateLimits).toBe(0);
  });

  it('abort() 立即停止阻塞在限流等待与重试延迟中的 worker', async () => {
    const optimizer = new AIAnalysisOptimizer({
      maxRetries: 3,
      retryDelayBaseMs: 10000,
      rateLimiter: {
        maxConcurrency: 0,
        requestsPerMinute: 0,
        cooldownThreshold: 1,
        backoffBaseMs: 10000,
        backoffCapMs: 10000,
        maxRetryAfterMs: 10000,
      },
    });

    const analyze = vi.fn().mockRejectedValue(new AIRequestError('too many requests', 429));
    const fakeAi = { analyzeRepository: analyze } as unknown as AIService;

    // 第一个任务触发 429 后陷入长重试延迟；第二个任务阻塞在限流器 acquire
    const first = optimizer.analyzeWithRetry(makeTask(4), fakeAi, []);
    const second = optimizer.analyzeWithRetry(makeTask(5), fakeAi, []);

    // 给两个任务时间进入阻塞状态，然后中止整个批次
    await new Promise(r => setTimeout(r, 100));
    const start = Date.now();
    optimizer.abort();

    const [r1, r2] = await Promise.all([first, second]);
    const elapsed = Date.now() - start;

    // abort 应立刻穿过冷却等待 / 重试延迟（总时长被设为 10s）
    expect(elapsed).toBeLessThan(500);
    expect(r1.success).toBe(false);
    expect(r1.error?.message).toBe('Analysis aborted');
    expect(r2.success).toBe(false);
    expect(r2.error?.message).toBe('Analysis aborted');
  });

  it('abort() 立即结束流水线，即使 README 请求仍在飞行', async () => {
    const optimizer = new AIAnalysisOptimizer({
      maxRetries: 0,
      rateLimiter: { maxConcurrency: 0, requestsPerMinute: 0 },
    });

    const analyze = vi.fn().mockResolvedValue({ summary: 'ok', tags: [], platforms: [] });
    const fakeAi = { analyzeRepository: analyze } as unknown as AIService;

    // README 拉取在收到 batch 信号中止前一直挂起：验证信号确实被传到了请求 API
    let resolveReadmeStarted = () => {};
    const readmeStarted = new Promise<void>(resolve => {
      resolveReadmeStarted = resolve;
    });
    const readmeAborted = vi.fn();
    const githubApi = {
      getRepositoryReadme: vi.fn((_owner: string, _repo: string, signal?: AbortSignal) => {
        resolveReadmeStarted();
        return new Promise<string>((_resolve, reject) => {
          const onAbort = () => {
            readmeAborted();
            reject(new Error('Aborted'));
          };
          if (!signal) {
            reject(new Error('Missing AbortSignal'));
          } else if (signal.aborted) {
            onAbort();
          } else {
            signal.addEventListener('abort', onAbort, { once: true });
          }
        });
      }),
    } as unknown as GitHubApiService;

    const pending = optimizer.analyzeRepositoriesPipelined(
      [makeRepo(6), makeRepo(7)], githubApi, fakeAi, []);

    // 等 README 请求真正启动后再中止整个批次，避免固定延时与请求启动竞速
    await readmeStarted;
    const start = Date.now();
    optimizer.abort();
    await pending;

    expect(Date.now() - start).toBeLessThan(500);
    expect(githubApi.getRepositoryReadme).toHaveBeenCalled();
    // 断言 README 请求确实收到了中止信号，而非流水线提前返回放任其挂起
    expect(readmeAborted).toHaveBeenCalled();
  });
});