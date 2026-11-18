import { afterEach, describe, expect, it, vi } from 'vitest';
import { Repository } from '../types';
import {
  buildAccountScopedVectorId,
  looksLikeLengthError,
  parseAccountScopedVectorId,
  truncateForRetry,
  embedWithFallback,
  indexAllRepos,
  needsReindex,
  EMBEDDING_FORMAT_VERSION,
  VectorSearchService,
} from './vectorSearchService';

// Minimal mock: only the `.embed` method is used by embedWithFallback.
// Signature mirrors EmbeddingClient.embed; helpers only pass the args they use.
const makeClient = (
  embedImpl: (texts: string[]) => Promise<number[][]>,
) => {
  const embed = vi.fn(embedImpl);
  return { embed } as Parameters<typeof embedWithFallback>[1] & { embed: typeof embed };
};

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

describe('needsReindex', () => {
  // 共享：未索引 / 内容更新 / license 变化 / 格式升级——权威谓词，UI 与 indexAllRepos 共用。
  const indexed = (overrides: Partial<Repository> = {}): Repository => makeRepository(1, {
    vector_indexed_at: '2026-01-10T00:00:00.000Z',
    vector_indexed_license: 'MIT',
    license: 'MIT',
    analyzed_at: '2026-01-04T00:00:00.000Z',
    ...overrides,
  });

  it('needs reindex when a repo was never indexed', () => {
    expect(needsReindex({ ...indexed(), vector_indexed_at: undefined }, false)).toBe(true);
  });

  it('needs reindex when content time is newer than vector_indexed_at', () => {
    expect(needsReindex(indexed({ last_edited: '2026-01-12T00:00:00.000Z' }), false)).toBe(true);
  });

  it('needs reindex when license changed (normalized drift)', () => {
    expect(needsReindex(indexed({ license: 'Apache-2.0' }), false)).toBe(true);
  });

  it('needs reindex when format version changed regardless of content', () => {
    expect(needsReindex(indexed(), true)).toBe(true);
  });

  it('does NOT need reindex when content and license are unchanged', () => {
    expect(needsReindex(indexed(), false)).toBe(false);
  });

  it('treats null vs NOASSERTION sentinel as equal (no reindex)', () => {
    // Both normalize to NO_LICENSE_SENTINEL, so null fingerprint ↔ no-assertion license is a match.
    expect(needsReindex(
      indexed({ vector_indexed_license: null, license: null }),
      false,
    )).toBe(false);
    expect(needsReindex(
      indexed({ vector_indexed_license: null, license: 'NOASSERTION' }),
      false,
    )).toBe(false);
  });
});

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

describe('indexAllRepos partial embedding failure reporting (R5 finding 4)', () => {
  // 回归（CodeRabbit 发现 4）：upsertedCount 回调此前从原始 batch 推算仓库 ID，
  // 当 batch=[repo1,repo2]、embedding=[null,vector2] 时会把「embedding 失败的
  // repo1」报告为已上传——调用方给 repo1 写 vector_indexed_at，增量索引永久
  // 跳过它；真正上传成功的 repo2 反而没有标记。修复后从成功向量列表读取。
  const makePartiallyFailingClient = (vectors: Array<number[] | null>) => ({
    embed: vi.fn(async () => vectors),
  }) as unknown as Parameters<typeof indexAllRepos>[1];

  const captureIndexed = async (vectors: Array<number[] | null>) => {
    const client = makePartiallyFailingClient(vectors);
    const vectorService = makeVectorService();
    const indexedIds: number[] = [];
    const result = await indexAllRepos(
      [makeRepository(1), makeRepository(2), makeRepository(3)],
      client,
      vectorService,
      { indexMode: 'description', onRepoIndexed: (repoId) => indexedIds.push(repoId) },
    );
    return { client, vectorService, indexedIds, result };
  };

  it('does not report the first repo as indexed when its embedding fails', async () => {
    const { vectorService, indexedIds, result } = await captureIndexed([null, vec(2), vec(3)]);

    // 只有 repo2/repo3 被上传并报告；失败的 repo1 绝不能出现在已索引列表
    const upsertedVectorIds = (vectorService.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0].map((v: { id: string }) => v.id);
    expect(upsertedVectorIds).toHaveLength(2);
    expect(indexedIds).toEqual([2, 3]);
    expect(result.indexedRepoIds).toEqual([2, 3]);
    expect(result.indexed).toBe(2);
    expect(result.errors).toBe(1);
  });

  it('does not report middle repos as indexed when their embedding fails', async () => {
    const { indexedIds, result } = await captureIndexed([vec(1), null, vec(3)]);

    // repo1 在失败项之前：仍按构造顺序报告；repo3 在失败项之后：不被错位占用
    expect(indexedIds).toEqual([1, 3]);
    expect(result.indexedRepoIds).toEqual([1, 3]);
    expect(result.indexed).toBe(2);
    expect(result.errors).toBe(1);
  });

  it('keeps the existing report order when every embedding succeeds', async () => {
    const { indexedIds, result } = await captureIndexed([vec(1), vec(2), vec(3)]);

    expect(indexedIds).toEqual([1, 2, 3]);
    expect(result.indexedRepoIds).toEqual([1, 2, 3]);
    expect(result.indexed).toBe(3);
    expect(result.errors).toBe(0);
  });
});

describe('indexAllRepos incremental filtering — license change invalidation', () => {
  it('reindexes an indexed repo whose license changed even when content timestamps are unchanged', async () => {
    // Repo was indexed under MIT; its vector_indexed_at is newer than content, so without
    // the license fingerprint check it would be skipped. GitHub sync then changes the
    // license to Apache-2.0 — the incremental predicate must reindex to refresh metadata.
    const repos = [
      makeRepository(1, {
        vector_indexed_at: '2026-01-10T00:00:00.000Z',
        vector_indexed_license: 'MIT',
        license: 'Apache-2.0',
        analyzed_at: '2026-01-04T00:00:00.000Z',
        // No last_edited / newer analyzed_at => content time predates vector_indexed_at.
      }),
    ];

    const client = makeIndexClient();
    const vectorService = makeVectorService();
    const indexedRepoIds: number[] = [];
    const result = await indexAllRepos(repos, client, vectorService, {
      incremental: true,
      formatVersion: EMBEDDING_FORMAT_VERSION,
      currentFormatVersion: EMBEDDING_FORMAT_VERSION,
      indexMode: 'description',
      onRepoIndexed: (repoId) => indexedRepoIds.push(repoId),
    });

    // License differs from the indexed fingerprint => reindex, despite no content-time change.
    expect(indexedRepoIds).toEqual([1]);
    expect(result.indexedRepoIds).toEqual([1]);
  });

  it('treats a null-vs-no-assertion drift as a license change and reindexes', async () => {
    // normalizeLicense collapses both null and 'NOASSERTION' to the sentinel, so an indexed
    // repo whose stored license was null (fingerprint not yet captured) must reindex once to
    // capture the fingerprint, then settle on subsequent runs.
    const repos = [
      makeRepository(1, {
        vector_indexed_at: '2026-01-10T00:00:00.000Z',
        vector_indexed_license: null,
        license: 'MIT',
        analyzed_at: '2026-01-04T00:00:00.000Z',
      }),
    ];

    const client = makeIndexClient();
    const vectorService = makeVectorService();
    const indexedRepoIds: number[] = [];
    const result = await indexAllRepos(repos, client, vectorService, {
      incremental: true,
      formatVersion: EMBEDDING_FORMAT_VERSION,
      currentFormatVersion: EMBEDDING_FORMAT_VERSION,
      indexMode: 'description',
      onRepoIndexed: (repoId) => indexedRepoIds.push(repoId),
    });

    // null fingerprint vs MIT license => mismatch => reindex.
    expect(indexedRepoIds).toEqual([1]);
    expect(result.indexedRepoIds).toEqual([1]);
  });

  it('skips an indexed repo whose license is unchanged', async () => {
    const repos = [
      makeRepository(1, {
        vector_indexed_at: '2026-01-10T00:00:00.000Z',
        vector_indexed_license: 'MIT',
        license: 'MIT',
        analyzed_at: '2026-01-04T00:00:00.000Z',
      }),
    ];

    const client = makeIndexClient();
    const vectorService = makeVectorService();
    const indexedRepoIds: number[] = [];
    const result = await indexAllRepos(repos, client, vectorService, {
      incremental: true,
      formatVersion: EMBEDDING_FORMAT_VERSION,
      currentFormatVersion: EMBEDDING_FORMAT_VERSION,
      indexMode: 'description',
      onRepoIndexed: (repoId) => indexedRepoIds.push(repoId),
    });

    // No content change and license fingerprint matches => nothing to index.
    expect(indexedRepoIds).toEqual([]);
    expect(result.indexedRepoIds).toEqual([]);
    expect(result.indexed).toBe(0);
  });
});

describe('indexAllRepos duplicate id handling', () => {
  it('indexes duplicate ids only once in full mode (first record wins)', async () => {
    const repos = [
      makeRepository(1, { description: 'first' }),
      makeRepository(1, { description: 'second' }),
    ];
    const embed = vi.fn(async (texts: string[]) => texts.map((_, i) => vec(i)));
    const indexClient = { embed } as unknown as Parameters<typeof indexAllRepos>[1];
    const vectorService = makeVectorService();
    const indexedIds: number[] = [];
    const result = await indexAllRepos(repos, indexClient, vectorService, {
      indexMode: 'description',
      onRepoIndexed: (repoId) => indexedIds.push(repoId),
    });

    expect(vectorService.upsert).toHaveBeenCalledTimes(1);
    const uploaded = (vectorService.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{ metadata: { description: string } }>;
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0].metadata.description).toBe('first');
    const embeddedText = embed.mock.calls.flatMap(([texts]) => texts).join('\n');
    expect(embeddedText).toContain('first');
    expect(embeddedText).not.toContain('second');
    expect(indexedIds).toEqual([1]);
    expect(result.indexedRepoIds).toEqual([1]);
    expect(result.skipped).toBe(1);
  });

  it('lets an updated duplicate survive incremental filtering instead of being shadowed by an unchanged duplicate', async () => {
    // 同一 id 出现两条记录：首条已索引且未变化，第二条是更新后的副本。
    // 去重必须发生在增量过滤之后，否则未变化的首条会遮蔽需要重索引的第二条。
    const repos = [
      makeRepository(1, { vector_indexed_at: '2026-01-10T00:00:00.000Z' }),
      makeRepository(1, { vector_indexed_at: undefined, updated_at: '2026-01-12T00:00:00.000Z' }),
    ];
    const vectorService = makeVectorService();
    const indexedIds: number[] = [];
    const result = await indexAllRepos(repos, makeIndexClient(), vectorService, {
      incremental: true,
      formatVersion: EMBEDDING_FORMAT_VERSION,
      currentFormatVersion: EMBEDDING_FORMAT_VERSION,
      indexMode: 'description',
      onRepoIndexed: (repoId) => indexedIds.push(repoId),
    });

    expect(indexedIds).toEqual([1]);
    expect(result.indexedRepoIds).toEqual([1]);
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

describe('indexAllRepos 账号隔离向量 ID（R4 审计修复）', () => {
  const scopedRepos = (): Repository[] => [
    makeRepository(1, { ai_tags: ['tag-a'] }),
    makeRepository(2),
  ];

  const makeVectorServiceWithMock = () => {
    const upsert = vi.fn(async (vectors: Array<{ id: string }>) => ({ upserted: vectors.length }));
    return {
      upsert,
      service: { upsert } as unknown as Parameters<typeof indexAllRepos>[2],
    };
  };

  it('prefixes vector IDs with the owning account and records it in metadata', async () => {
    const { upsert, service } = makeVectorServiceWithMock();
    await indexAllRepos(scopedRepos(), makeIndexClient(), service, { accountId: '42' });

    const upserted = upsert.mock.calls[0][0] as Array<{ id: string; metadata: { accountId?: string } }>;
    // 账号隔离：多账号共享索引时同仓库向量不再互相覆盖
    expect(upserted.map((v) => v.id)).toEqual(['42:1', '42:2']);
    expect(upserted[0].metadata.accountId).toBe('42');
    expect(upserted[1].metadata.accountId).toBe('42');
  });

  it('falls back to legacy unprefixed IDs when no owning account is available', async () => {
    const { upsert, service } = makeVectorServiceWithMock();
    await indexAllRepos(scopedRepos(), makeIndexClient(), service, {});

    const upserted = upsert.mock.calls[0][0] as Array<{ id: string; metadata: { accountId?: string } }>;
    expect(upserted.map((v) => v.id)).toEqual(['1', '2']);
    expect(upserted[0].metadata.accountId).toBeUndefined();
  });

  it('reports numeric repo ids to onRepoIndexed for account-prefixed vectors', async () => {
    const { service } = makeVectorServiceWithMock();
    const onRepoIndexed = vi.fn();
    const result = await indexAllRepos(scopedRepos(), makeIndexClient(), service, {
      accountId: '42',
      onRepoIndexed,
    });

    // 向量 ID 带账号前缀后不得按 parseInt(id) 解析（前缀非数字会得到 NaN）
    expect(onRepoIndexed).toHaveBeenCalledWith(1);
    expect(onRepoIndexed).toHaveBeenCalledWith(2);
    expect(result.indexedRepoIds).toEqual([1, 2]);
  });
});

describe('账号隔离向量 ID 编解码（R4 审计修复）', () => {
  it('builds prefixed IDs for known accounts and legacy IDs otherwise', () => {
    expect(buildAccountScopedVectorId('42', 7)).toBe('42:7');
    expect(buildAccountScopedVectorId('42', '7')).toBe('42:7');
    expect(buildAccountScopedVectorId(null, 7)).toBe('7');
    expect(buildAccountScopedVectorId(undefined, 7)).toBe('7');
  });

  it('parses scoped IDs and treats legacy IDs as unowned', () => {
    expect(parseAccountScopedVectorId('42:7')).toEqual({ accountId: '42', repoId: '7' });
    expect(parseAccountScopedVectorId('7')).toEqual({ accountId: null, repoId: '7' });
    // 非数字前缀不是账号前缀（防垃圾字符串污染归属）
    expect(parseAccountScopedVectorId('owner:7')).toEqual({ accountId: null, repoId: 'owner:7' });
  });
});

describe('VectorSearchService.cleanup 账号范围参数（R5 发现 2）', () => {
  const stubFetch = (capture: (url: string, init: RequestInit) => void) => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      capture(String(url), init ?? {});
      return new Response(JSON.stringify({ success: true, deleted: 0 }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends accountPrefix and includeLegacy in the request body', async () => {
    let capturedBody = '';
    stubFetch((_url, init) => { capturedBody = String(init.body); });
    const service = new VectorSearchService({ workerUrl: 'https://worker.example.com/', authToken: 't' });

    await service.cleanup(['1:1', '42'], { accountPrefix: '1', includeLegacy: true });

    expect(JSON.parse(capturedBody)).toEqual({ keepIds: ['1:1', '42'], accountPrefix: '1', includeLegacy: true });
  });

  it('forwards an explicit includeLegacy=false instead of dropping it', async () => {
    let capturedBody = '';
    stubFetch((_url, init) => { capturedBody = String(init.body); });
    const service = new VectorSearchService({ workerUrl: 'https://worker.example.com/', authToken: 't' });

    await service.cleanup(['1'], { accountPrefix: null, includeLegacy: false });

    // 显式 false 必须写入：省略会被 Worker 当成旧版无范围请求
    expect(JSON.parse(capturedBody)).toEqual({ keepIds: ['1'], includeLegacy: false });
  });

  it('keeps the legacy (keepIds, signal) call signature working', async () => {
    let capturedBody = '';
    let capturedSignal: AbortSignal | null | undefined;
    stubFetch((_url, init) => {
      capturedBody = String(init.body);
      capturedSignal = init.signal;
    });
    const service = new VectorSearchService({ workerUrl: 'https://worker.example.com/', authToken: 't' });
    const controller = new AbortController();

    await service.cleanup(['1'], controller.signal);

    expect(JSON.parse(capturedBody)).toEqual({ keepIds: ['1'] });
    expect(capturedSignal).toBe(controller.signal);
  });

  it('surfaces worker failures as errors (contract unchanged)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, error: 'boom' }), { status: 500 })));
    const service = new VectorSearchService({ workerUrl: 'https://worker.example.com/', authToken: 't' });

    await expect(service.cleanup(['1'], { accountPrefix: '1' })).rejects.toThrow('boom');
  });
});
