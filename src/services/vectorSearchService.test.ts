import { describe, expect, it, vi } from 'vitest';
import {
  looksLikeLengthError,
  truncateForRetry,
  embedWithFallback,
} from './vectorSearchService';

// Minimal mock: only the `.embed` method is used by embedWithFallback.
// Signature mirrors EmbeddingClient.embed; helpers only pass the args they use.
const makeClient = (
  embedImpl: (texts: string[]) => Promise<number[][]>,
) => ({ embed: vi.fn(embedImpl) }) as unknown as Parameters<typeof embedWithFallback>[1];

const vec = (n: number) => [n, n + 1, n + 2];

// 硅基流动真实的长度超限 payload（code 20015）
const LENGTH_ERROR = () =>
  new Error('Embedding API error 400: {"code":20015,"message":"The parameter is invalid.","data":null}');

describe('looksLikeLengthError', () => {
  it('detects SiliconFlow 20015 length errors', () => {
    expect(looksLikeLengthError(LENGTH_ERROR())).toBe(true);
  });

  it('detects explicit length/token phrases', () => {
    expect(looksLikeLengthError(new Error('input length exceeds the model maximum'))).toBe(true);
    expect(looksLikeLengthError(new Error('maximum token limit reached'))).toBe(true);
    expect(looksLikeLengthError(new Error('text too long for model'))).toBe(true);
  });

  it('does NOT treat generic 400 / "parameter is invalid" as length errors', () => {
    // 纯 400 状态码不一定是长度问题（可能是配置/参数缺失）
    expect(looksLikeLengthError(new Error('400 Bad Request'))).toBe(false);
    // 只有 "parameter is invalid" 而无 20015 也可能是配置错误
    expect(looksLikeLengthError(new Error('parameter is invalid'))).toBe(false);
  });

  it('rejects non-length errors', () => {
    expect(looksLikeLengthError(new Error('Unauthorized'))).toBe(false);
    expect(looksLikeLengthError(new Error('Internal server error 500'))).toBe(false);
    expect(looksLikeLengthError(new Error('rate limit 429'))).toBe(false);
  });
});

describe('truncateForRetry', () => {
  it('returns text unchanged when within limit', () => {
    expect(truncateForRetry('short', 6000)).toBe('short');
  });

  it('leaves text unchanged when shorter than maxChars', () => {
    const long = 'x'.repeat(1000);
    const result = truncateForRetry(long, 6000);
    // 6000 > 1000, so no truncation needed actually
    expect(result.length).toBe(1000);
  });

  it('truncates oversized text', () => {
    const long = 'x'.repeat(10000);
    const result = truncateForRetry(long, 6000);
    expect(result.length).toBeLessThanOrEqual(6000);
    expect(result.length).toBeGreaterThan(0);
  });

  it('stops halving at 256 floor', () => {
    const long = 'x'.repeat(10000);
    const result = truncateForRetry(long, 256);
    expect(result.length).toBe(256);
  });
});

describe('embedWithFallback', () => {
  it('uses fast batch path on success', async () => {
    const client = makeClient(async (texts) => texts.map((_, i) => vec(i)));
    const result = await embedWithFallback(['a', 'b', 'c'], client, undefined, 6000);
    expect(client.embed).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(3);
    expect(result.every((v) => Array.isArray(v))).toBe(true);
  });

  it('isolates single oversized item on 20015 length error', async () => {
    // Batch call throws 20015; per-item: only the long one fails, short ones succeed.
    const client = makeClient(async (texts) => {
      if (texts.length > 1) {
        // batch path
        throw LENGTH_ERROR();
      }
      const t = texts[0];
      if (t.length > 100) {
        throw LENGTH_ERROR();
      }
      return [vec(t.length)];
    });
    const result = await embedWithFallback(['short', 'x'.repeat(500), 'ok'], client, undefined, 6000);
    // First item succeeds, second oversized fails (null), third succeeds
    expect(result[0]).not.toBeNull();
    expect(result[1]).toBeNull();
    expect(result[2]).not.toBeNull();
  });

  it('does NOT fall back to per-item on generic 400 errors', async () => {
    // 通用 400（非长度类）应整批失败，不降级为逐条
    const client = makeClient(async () => {
      throw new Error('400 Bad Request: model not found');
    });
    await expect(embedWithFallback(['a', 'b'], client, undefined, 6000)).rejects.toThrow('400');
  });

  it('rescues oversized item via truncation retry', async () => {
    // Per-item: full text fails but truncated version succeeds.
    // Models like bge have ~512 token (~2000 char) limits; truncation ladder
    // goes 6000 → 3000 → 1500, so a text that fails at full length but succeeds
    // when under ~2000 chars is rescuable.
    const client = makeClient(async (texts) => {
      if (texts.length > 1) {
        throw LENGTH_ERROR();
      }
      const t = texts[0];
      // Accept only texts under 2000 chars (simulating a 512-token bge limit)
      if (t.length > 2000) {
        throw new Error('too long: input length exceeds maximum token limit');
      }
      return [vec(t.length)];
    });
    // Text longer than retryMaxChars(6000) so truncation actually kicks in
    const longText = 'y'.repeat(10000);
    const result = await embedWithFallback([longText], client, undefined, 6000);
    expect(result[0]).not.toBeNull();
    // Should have retried with a truncated candidate (<=2000 chars)
    expect(client.embed.mock.calls.length).toBeGreaterThan(1);
    // The successful call used a truncated text under 2000 chars
    const lastCallText = client.embed.mock.calls[client.embed.mock.calls.length - 1][0] as string[];
    expect(lastCallText[0].length).toBeLessThanOrEqual(2000);
  });

  it('rethrows non-length errors', async () => {
    const client = makeClient(async () => {
      throw new Error('Internal server error 500');
    });
    await expect(embedWithFallback(['a', 'b'], client, undefined, 6000)).rejects.toThrow('500');
  });

  it('propagates abort', async () => {
    const controller = new AbortController();
    controller.abort();
    const client = makeClient(async () => [vec(1)]);
    await expect(embedWithFallback(['a'], client, controller.signal, 6000)).rejects.toThrow('Aborted');
  });
});
