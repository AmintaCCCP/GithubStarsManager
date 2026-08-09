import { describe, it, expect } from 'vitest';
import { AIRateLimiter } from './aiRequestLimiter';

describe('AIRateLimiter', () => {
  describe('acquire/release 并发槽', () => {
    it('允许多个并发请求，release 后归还信号', async () => {
      const limiter = new AIRateLimiter({ maxConcurrency: 3 });
      const r1 = await limiter.acquire();
      const r2 = await limiter.acquire();
      expect(limiter.activeRequests).toBe(2);
      r1();
      expect(limiter.activeRequests).toBe(1);
      r2();
      expect(limiter.activeRequests).toBe(0);
    });

    it('超过 maxConcurrency 时阻塞直到信号量释放', async () => {
      const limiter = new AIRateLimiter({ maxConcurrency: 1 });
      const release = await limiter.acquire();
      let acquired = false;
      const pending = limiter.acquire().then(() => { acquired = true; });
      await new Promise(r => setTimeout(r, 50));
      expect(acquired).toBe(false);
      release();
      await pending;
      expect(acquired).toBe(true);
    });
  });

  describe('RPM 滑动窗口', () => {
    it('超过每分钟限额时等待到下个窗口', async () => {
      const limiter = new AIRateLimiter({ requestsPerMinute: 2, rpmWindowMs: 300 });
      const r1 = await limiter.acquire();
      const r2 = await limiter.acquire();
      r1(); r2();

      const startedAt = Date.now();
      await limiter.acquire();
      const waited = Date.now() - startedAt;
      expect(waited).toBeGreaterThanOrEqual(200); // 最早请求约 200ms 后出窗
    });
  });

  describe('429 冷却与熔断', () => {
    it('连续 429 达到阈值后打开熔断', () => {
      const limiter = new AIRateLimiter({ cooldownThreshold: 3, backoffBaseMs: 1000 });
      limiter.notifyRateLimit();
      expect(limiter.getStatus().circuitOpen).toBe(false);
      limiter.notifyRateLimit();
      expect(limiter.getStatus().circuitOpen).toBe(false);
      limiter.notifyRateLimit();
      const status = limiter.getStatus();
      expect(status.circuitOpen).toBe(true);
      expect(status.consecutiveRateLimits).toBe(3);
      expect(status.cooldownRemainingMs).toBeGreaterThan(0);
    });

    it('notifySuccess 清零连续 429 计数', () => {
      const limiter = new AIRateLimiter({ cooldownThreshold: 2 });
      limiter.notifyRateLimit();
      limiter.notifySuccess();
      expect(limiter.getStatus().consecutiveRateLimits).toBe(0);
    });

    it('尊重 Retry-After（带抖动下不小于 75%）', () => {
      const limiter = new AIRateLimiter({ maxRetryAfterMs: 60000 });
      limiter.notifyRateLimit(5000);
      // 等待 = retryAfter（5000）* (0.75~1.25) >= 3750
      expect(limiter.getStatus().cooldownRemainingMs).toBeGreaterThanOrEqual(3750);
      // 且受 backoffCap 约束
      limiter.notifyRateLimit(999999);
      expect(limiter.getStatus().cooldownRemainingMs).toBeLessThanOrEqual(60000);
    });

    it('冷却期间 acquire 阻塞，冷却过后放行', async () => {
      const limiter = new AIRateLimiter({ backoffBaseMs: 100, backoffCapMs: 1000, cooldownThreshold: 1 });
      limiter.notifyRateLimit();
      const before = Date.now();
      const release = await limiter.acquire();
      const waited = Date.now() - before;
      release();
      // 退避 100ms * (0.75~1.25) = 75~125ms；放宽断言
      expect(waited).toBeGreaterThanOrEqual(50);
    });
  });

  describe('中止', () => {
    it('acquire 响应已中止的 signal 抛 AbortError', async () => {
      const limiter = new AIRateLimiter({ requestsPerMinute: 1, rpmWindowMs: 100000 });
      const release = await limiter.acquire();
      release();

      const controller = new AbortController();
      controller.abort();
      await expect(limiter.acquire(controller.signal)).rejects.toThrow('Aborted');
    });
  });

  describe('RPM 与冷却叠加', () => {
    it('取二者中更长的等待', async () => {
      // RPM 窗口 500ms、冷却 400ms -> 最终等待 >= 400ms
      const limiter = new AIRateLimiter({ requestsPerMinute: 1, rpmWindowMs: 500, backoffBaseMs: 400, cooldownThreshold: 1 });
      limiter.notifyRateLimit();
      const start = Date.now();
      const release = await limiter.acquire();
      const waited = Date.now() - start;
      release();
      expect(waited).toBeGreaterThanOrEqual(300);
    });
  });

  it('getStatus 暴露配置值', () => {
    const limiter = new AIRateLimiter({ maxConcurrency: 5, requestsPerMinute: 60, cooldownThreshold: 4 });
    const s = limiter.getStatus();
    expect(s.maxConcurrency).toBe(5);
    expect(s.requestsPerMinute).toBe(60);
    expect(s.circuitOpen).toBe(false);
    expect(s.cooldownRemainingMs).toBe(0);
  });
});