import { describe, it, expect, vi } from 'vitest';
import { AIAnalysisOptimizer, AnalysisTask } from './aiAnalysisOptimizer';
import type { AIService } from './aiService';
import { AIRequestError } from './aiService';
import type { Repository } from '../types';

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
});