import { logger } from './logger';

/**
 * 共享 AI 请求限流器：为批量 AI 分析提供统一的 429/RPM 处理。
 *
 * 设计参考 OpenAI / Anthropic SDK 与成熟 agent 的做法：
 * - Retry-After 优先（合理值内听服务端的等待时长），否则用带抖动的指数退避
 * - 连续 429 触发全局熔断冷却：所有 worker 停手，冷却窗口过后恢复
 * - 并发上限（信号量）与每分钟请求数（RPM，60s 滑动窗口）作为主动准入控制，
 *   值为 0 表示不限制（默认）
 * - 单次 429 也会设置一个短冷却，避免其余 worker 继续冲击已被限流的桶
 */
export interface AIRateLimitConfig {
  /** 并发上限：同时最多几个请求在飞。0 = 不限制 */
  maxConcurrency?: number;
  /** 每分钟请求数上限（60s 滑动窗口）。0 = 不限制 */
  requestsPerMinute?: number;
  /** 触发全局熔断的连续 429 次数。默认 3 */
  cooldownThreshold?: number;
  /** 指数退避基数（ms）。默认 1000 */
  backoffBaseMs?: number;
  /** 退避上限（ms）。默认 60000 */
  backoffCapMs?: number;
  /** 尊重 Retry-After 的上限（ms）。默认 60000 */
  maxRetryAfterMs?: number;
  /** RPM 统计窗口（ms）。默认 60000；主要供测试缩小窗口 */
  rpmWindowMs?: number;
}

const RPM_WINDOW_MS = 60_000;
const WAIT_POLL_MS = 100;

const DEFAULT_CONFIG: Required<AIRateLimitConfig> = {
  maxConcurrency: 0,
  requestsPerMinute: 0,
  cooldownThreshold: 3,
  backoffBaseMs: 1000,
  backoffCapMs: 60000,
  maxRetryAfterMs: 60000,
  rpmWindowMs: RPM_WINDOW_MS,
};

function abortError(): Error {
  const e = new Error('Aborted') as Error & { name: string };
  e.name = 'AbortError';
  return e;
}

export interface AIRateLimitStatus {
  active: number;
  consecutiveRateLimits: number;
  cooldownRemainingMs: number;
  circuitOpen: boolean;
  maxConcurrency: number;
  requestsPerMinute: number;
}

export class AIRateLimiter {
  private readonly config: AIRateLimitConfig;
  private active = 0;
  private requestTimestamps: number[] = [];
  private consecutiveRateLimits = 0;
  private cooldownUntil = 0;

  constructor(config: AIRateLimitConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** 请求开始前调用：等待并占用一个并发槽（含冷却 / RPM / 并发上限等待）。 */
  async acquire(signal?: AbortSignal): Promise<() => void> {
    for (;;) {
      this.assertNotAborted(signal);
      const now = Date.now();
      const wait = this.computeWaitMs(now);
      const max = this.config.maxConcurrency ?? 0;
      // 冷却 / RPM 窗口 / 并发槽全部满足时，同步完成准入：校验与占位之间
      // 不存在 await，单线程下不会与其它并发 acquire 交错，保证原子性。
      if (wait <= 0 && (max === 0 || this.active < max)) {
        this.active++;
        if ((this.config.requestsPerMinute ?? 0) > 0) {
          this.requestTimestamps.push(now);
          this.pruneTimestamps();
        }
        return () => {
          this.active = Math.max(0, this.active - 1);
        };
      }
      await this.sleep(wait > 0 ? wait : WAIT_POLL_MS, signal);
    }
  }

  /** 请求成功返回后调用：清零连续 429 计数。 */
  notifySuccess(): void {
    this.consecutiveRateLimits = 0;
  }

  /**
   * 触发 429 时调用。返回本次应等待的毫秒数（已写入全局冷却）。
   * @param retryAfterMs 服务端返回的 Retry-After（可选，ms）
   */
  notifyRateLimit(retryAfterMs?: number): number {
    this.consecutiveRateLimits++;
    const now = Date.now();

    let retryWait = 0;
    if (typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
      retryWait = Math.min(retryAfterMs, this.config.maxRetryAfterMs ?? DEFAULT_CONFIG.maxRetryAfterMs);
    }

    const attempt = this.consecutiveRateLimits - 1;
    const backoff = Math.min(
      this.config.backoffCapMs ?? DEFAULT_CONFIG.backoffCapMs,
      (this.config.backoffBaseMs ?? DEFAULT_CONFIG.backoffBaseMs) * 2 ** Math.min(attempt, 6)
    );

    // 抖动只作用于本地指数退避；服务端 Retry-After 作为最短等待，绝不被缩短
    const jitteredBackoff = Math.round(backoff * (0.75 + Math.random() * 0.5));
    const waitMs = Math.max(retryWait, jitteredBackoff);
    // 最终等待受退避上限约束，避免单次 Retry-After 造成过长停摆
    const cappedWait = Math.min(this.config.backoffCapMs ?? DEFAULT_CONFIG.backoffCapMs, waitMs);
    this.cooldownUntil = Math.max(this.cooldownUntil, now + cappedWait);

    const threshold = this.config.cooldownThreshold ?? DEFAULT_CONFIG.cooldownThreshold;
    const circuitOpen = this.consecutiveRateLimits >= threshold;
    logger.warn('aiLimiter', 'AI rate limit notified', {
      consecutiveRateLimits: this.consecutiveRateLimits,
      waitMs,
      circuitOpen,
      cooldownMs: Math.max(0, this.cooldownUntil - now),
    });
    return cappedWait;
  }

  getStatus(): AIRateLimitStatus {
    const now = Date.now();
    const threshold = this.config.cooldownThreshold ?? DEFAULT_CONFIG.cooldownThreshold;
    return {
      active: this.active,
      requestsPerMinute: (this.config.requestsPerMinute ?? 0),
      maxConcurrency: (this.config.maxConcurrency ?? 0),
      consecutiveRateLimits: this.consecutiveRateLimits,
      cooldownRemainingMs: Math.max(0, this.cooldownUntil - now),
      circuitOpen: this.consecutiveRateLimits >= threshold,
    };
  }

  /** 仅统计用：当前在飞请求数 */
  get activeRequests(): number {
    return this.active;
  }

  /** 需要等待的毫秒数：最大（冷却剩余，RPM 释放时刻）。 */
  private computeWaitMs(now: number): number {
    let ms = 0;
    if (this.cooldownUntil > now) {
      ms = this.cooldownUntil - now;
    }
    const rpm = this.config.requestsPerMinute ?? 0;
    if (rpm > 0) {
      const windowMs = this.config.rpmWindowMs ?? RPM_WINDOW_MS;
      // 注意：429 之类的失败请求同样计入每分钟请求数（与 OpenAI 文档一致），
      // 因此按「请求开始时间」计数而不是按成功数。
      this.requestTimestamps = this.requestTimestamps.filter((ts) => ts > now - windowMs);
      if (this.requestTimestamps.length >= rpm) {
        const earliest = this.requestTimestamps[0];
        const releaseAt = earliest + windowMs;
        ms = Math.max(ms, releaseAt - now);
      }
    }
    return ms;
  }

  private pruneTimestamps(): void {
    const now = Date.now();
    const windowMs = this.config.rpmWindowMs ?? RPM_WINDOW_MS;
    this.requestTimestamps = this.requestTimestamps.filter((ts) => ts > now - windowMs);
  }

  private assertNotAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw abortError();
    }
  }

  /** 可中止的轮询等待：最多等待 WAIT_POLL_MS，供准入循环按区块重判。 */
  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(abortError());
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, Math.min(ms, WAIT_POLL_MS));
      signal?.addEventListener('abort', onAbort);
      if (signal?.aborted) onAbort();
    });
  }
}