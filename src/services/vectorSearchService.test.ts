import { describe, expect, it, vi } from 'vitest';
import { Repository } from '../types';
import {
  looksLikeLengthError,
  truncateForRetry,
  embedWithFallback,
  indexAllRepos,
  EMBEDDING_FORMAT_VERSION,
} from './vectorSearchService';

// Minimal mock: only the `.embed` method is used by embedWithFallback.
// Signature mirrors EmbeddingClient.embed; helpers only pass the args they use.
const makeClient = (
  embedImpl: (texts: string[]) => Promise<number[][]>,
) => ({ embed: vi.fn(embedImpl) }) as unknown as Parameters<typeof embedWithFallback>[1];

const vec = (n: number) => [n, n + 1, n + 2];

const makeRepository = (id: number, overrides: Partial<Repository> = {}): Repository => ({
  id,
  name: `repo-${id}`,
  full_name: `owner/repo-${id}`,
  description: `Repository ${id}`,
  html_url: `https://github.com/owner/repo-${id}`,
  stargazers_count: 10,
  forks_count: 1,
  forks: 1,
  language: 'TypeScript',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
  pushed_at: '2026-01-03T00:00:00.000Z',
  owner: {
    login: 'owner',
    avatar_url: 'https://github.com/avatar.png',
  },
  topics: ['test'],
  analyzed_at: '2026-01-04T00:00:00.000Z',
  vector_indexed_at: '2026-01-05T00:00:00.000Z',
  ...overrides,
});

const makeIndexClient = () => ({
  embed: vi.fn(async (texts: string[]) => texts.map((_, i) => vec(i))),
}) as unknown as Parameters<typeof indexAllRepos>[1];

const makeVectorService = () => ({
  upsert: vi.fn(async (vectors: Array<{ id: string }>) => ({ upserted: vectors.length })),
}) as unknown as Parameters<typeof indexAllRepos>[2];

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

  it('truncates oversized text to maxChars', () => {
    const long = 'x'.repeat(10000);
    const result = truncateForRetry(long, 6000);
    expect(result.length).toBe(6000);
  });

  it('stops halving at 256 floor', () => {
    const long = 'x'.repeat(10000);
    const result = truncateForRetry(long, 256);
    expect(result.length).toBe(256);
  });
});

const incrementalFilteringRepos = () => [
  makeRepository(1),
  makeRepository(2, { vector_indexed_at: undefined }),
  makeRepository(3, {
    vector_indexed_at: '2026-01-05T00:00:00.000Z',
    last_edited: '2026-01-06T00:00:00.000Z',
  }),
  makeRepository(4, { analyzed_at: undefined, vector_indexed_at: undefined }),
  makeRepository(5, { analysis_failed: true, vector_indexed_at: undefined }),
];

describe('indexAllRepos incremental filtering', () => {
  // formatVersion / expected：当前版本只索引新增/更新；旧版本或缺省（#234 回归路径）触发全量重建
  it.each([
    { formatVersion: EMBEDDING_FORMAT_VERSION, expected: [2, 3], expectation: 'current format version skips indexed unchanged repos' },
    { formatVersion: EMBEDDING_FORMAT_VERSION - 1, expected: [1, 2, 3], expectation: 'old format version reindexes all indexable repos' },
    { formatVersion: undefined, expected: [1, 2, 3], expectation: 'missing format version is treated as legacy and reindexes all indexable repos' },
  ])('$expectation', async ({ formatVersion, expected }) => {
    const client = makeIndexClient();
    const vectorService = makeVectorService();
    const indexedIds: number[] = [];
    const result = await indexAllRepos(incrementalFilteringRepos(), client, vectorService, {
      incremental: true,
      formatVersion,
      currentFormatVersion: EMBEDDING_FORMAT_VERSION,
      indexMode: 'description',
      onRepoIndexed: (repoId) => indexedIds.push(repoId),
    });

    expect(client.embed).toHaveBeenCalledTimes(1);
    expect(vectorService.upsert).toHaveBeenCalledTimes(1);
    expect(indexedIds).toEqual(expected);
    expect(result.indexedRepoIds).toEqual(expected);
    expect(result.indexed).toBe(expected.length);
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
    // With retryMaxChars=6000 and 10000-char text:
    //   candidate lengths: [10000, 5000, 2500]
    // Model accepts < 2000 chars → only the 3rd candidate (2500) fails too → null.
    // But with retryMaxChars=6000 and 8000-char text:
    //   candidate lengths: [8000, 4000, 2000] → 3rd succeeds.
    const client = makeClient(async (texts) => {
      if (texts.length > 1) throw LENGTH_ERROR();
      const t = texts[0];
      if (t.length > 2000) throw new Error('too long: input length exceeds maximum token limit');
      return [vec(t.length)];
    });
    const longText = 'y'.repeat(8000);
    const result = await embedWithFallback([longText], client, undefined, 6000);
    expect(result[0]).not.toBeNull();
    // 4 calls: 1 batch attempt + 3 per-item candidates [8000, 4000, 2000]
    expect(client.embed.mock.calls.length).toBe(4);
    // Verify per-item candidate lengths (calls 1-3, call 0 is the batch)
    const call1 = client.embed.mock.calls[1][0] as string[];
    const call2 = client.embed.mock.calls[2][0] as string[];
    const call3 = client.embed.mock.calls[3][0] as string[];
    expect(call1[0].length).toBe(8000);  // original
    expect(call2[0].length).toBe(4000);  // firstLimit = min(6000, 8000/2) = 4000
    expect(call3[0].length).toBe(2000);  // secondLimit = max(256, 4000/2) = 2000
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
