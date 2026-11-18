import { describe, expect, it, vi } from 'vitest';
import type { Repository } from '../types';
import { AIService } from './aiService';
import { logger } from './logger';
import type { GradedRerankResult } from './vectorSearchPipeline';
import type { EmbeddingClient, VectorQueryResult, VectorSearchService } from './vectorSearchService';
import {
  applyRelativeCutoff,
  chooseFinalOrder,
  fuseCandidates,
  hydrateMatches,
  orderByCrossEncoder,
  rankStructuredCandidates,
  runVectorSearchPipeline,
  scoreStructuredSignals,
  toSyntheticScoreMap,
  withBudget,
  type FusedCandidate,
  type VectorQueryAnalysis,
} from './vectorSearchPipeline';
import { fixturePath, readFixture } from '../test/fixtureIo';

const makeRepo = (partial: Partial<Repository> & Pick<Repository, 'id' | 'full_name'>): Repository => ({
  name: partial.full_name.split('/')[1] || partial.full_name,
  description: '',
  html_url: `https://github.com/${partial.full_name}`,
  stargazers_count: 1,
  forks_count: 0,
  forks: 0,
  language: 'TypeScript',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  pushed_at: '2026-01-03T00:00:00Z',
  owner: { login: 'owner', avatar_url: '' },
  topics: [],
  ...partial,
});

const analysis: VectorQueryAnalysis = {
  intent: 'find a README skill',
  keywords: ['readme', 'skill'],
  idealDescription: 'An agent skill that improves GitHub README files.',
  facets: {
    artifact: ['skill'],
    action: ['optimize'],
    domain: ['github readme'],
    platform: ['codex'],
  },
  highPrecisionTerms: ['readme', 'skill'],
  lowConfidenceFacets: [],
};

const fusedItem = (
  repo: Repository,
  fusedScore: number,
  lexicalScore = 0,
  structuredScore = 0,
): FusedCandidate => ({
  repo,
  fusedScore,
  denseScore: fusedScore,
  lexicalScore,
  structuredScore,
  denseRank: 1,
  lexicalRank: lexicalScore > 0 ? 1 : null,
  structuredRank: structuredScore > 0 ? 1 : null,
});

describe('vectorSearchPipeline', () => {
  it('withBudget returns the timeout value and aborts the stage signal', async () => {
    vi.useFakeTimers();
    try {
      let stageSignal: AbortSignal | undefined;
      const onTimeout = vi.fn();
      const result = withBudget(
        signal => {
          stageSignal = signal;
          return new Promise<string>(() => undefined);
        },
        100,
        new AbortController().signal,
        'timeout',
        onTimeout,
      );
      await vi.advanceTimersByTimeAsync(100);

      await expect(result).resolves.toBe('timeout');
      expect(stageSignal?.aborted).toBe(true);
      expect(onTimeout).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('withBudget rejects immediately when the outer signal is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(withBudget(
      () => Promise.resolve('late'),
      1000,
      controller.signal,
      'timeout',
    )).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('runs analysis, raw/ideal dense, local recall and returns synthetic scores', async () => {
    const repos = [
      makeRepo({
        id: 1,
        full_name: 'acme/readme-skill',
        description: 'Agent skill to optimize GitHub README files',
        ai_tags: ['skill'],
        stargazers_count: 5,
      }),
      makeRepo({
        id: 2,
        full_name: 'acme/random-tool',
        description: 'Unrelated utility',
        stargazers_count: 500,
      }),
      makeRepo({
        id: 3,
        full_name: 'acme/diagram-skill',
        description: 'Agent skill for architecture diagrams',
        ai_tags: ['skill'],
        stargazers_count: 10,
      }),
    ];
    const embed = vi.fn()
      .mockResolvedValueOnce([[0.1]])
      .mockResolvedValueOnce([[0.2]]);
    const query = vi.fn()
      .mockResolvedValueOnce([{ id: '1', score: 0.9, metadata: {} }])
      .mockResolvedValueOnce([{ id: '1', score: 0.8, metadata: {} }]);
    const aiService = {
      analyzeVectorSearchQuery: vi.fn().mockResolvedValue(analysis),
      rerankRepositoriesGraded: vi.fn(),
    } as unknown as AIService;

    const result = await runVectorSearchPipeline({
      query: 'github readme skill',
      repositories: repos,
      vectorConfig: {
        enabled: true,
        workerUrl: 'https://worker',
        authToken: 'token',
        embeddingConfigId: 'emb',
        indexMode: 'description',
        readmeMaxChars: 6000,
      },
      embeddingConfig: {
        id: 'emb',
        name: 'emb',
        apiType: 'openai-compatible',
        baseUrl: 'https://emb',
        apiKey: 'key',
        model: 'model',
        dimensions: 2,
        isActive: true,
      },
      aiService,
      embeddingClient: { embed } as unknown as EmbeddingClient,
      vectorService: { query } as unknown as VectorSearchService,
      crossEncoder: null,
      signal: new AbortController().signal,
    });

    expect(embed).toHaveBeenNthCalledWith(1, ['github readme skill'], 'query', expect.any(AbortSignal));
    expect(embed).toHaveBeenNthCalledWith(2, [analysis.idealDescription], 'query', expect.any(AbortSignal));
    expect(query).toHaveBeenNthCalledWith(1, [0.1], { topK: 50, threshold: 0.35 }, expect.any(AbortSignal));
    expect(result?.repositories[0].id).toBe(1);
    expect(result?.scoreMap.get('1')).toBe(1);
    expect(result?.diagnostics.analysisUsed).toBe(true);
    expect(result?.diagnostics.rawDenseCount).toBe(1);
    expect(result?.diagnostics.idealDenseCount).toBe(1);
  });

  it('warns and keeps local recall when raw and ideal embedding fail', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      const result = await runVectorSearchPipeline({
        query: 'readme skill',
        repositories: [makeRepo({ id: 1, full_name: 'acme/readme-skill', ai_tags: ['skill'] })],
        vectorConfig: {
          enabled: true,
          workerUrl: 'https://worker',
          authToken: 'token',
          embeddingConfigId: 'emb',
          indexMode: 'description',
          readmeMaxChars: 6000,
        },
        embeddingConfig: {} as never,
        aiService: {
          analyzeVectorSearchQuery: vi.fn().mockResolvedValue(analysis),
          rerankRepositoriesGraded: vi.fn(),
        } as unknown as AIService,
        embeddingClient: { embed: vi.fn().mockRejectedValue(new Error('embed down')) } as unknown as EmbeddingClient,
        vectorService: { query: vi.fn() } as unknown as VectorSearchService,
        crossEncoder: null,
        signal: new AbortController().signal,
      });

      expect(warn).toHaveBeenCalledWith(
        'vector-search',
        expect.stringContaining('Raw embedding'),
        expect.objectContaining({ error: expect.any(Error) }),
      );
      expect(warn).toHaveBeenCalledWith(
        'vector-search',
        expect.stringContaining('Ideal embedding'),
        expect.objectContaining({ error: expect.any(Error) }),
      );
      expect(result?.repositories.map(repo => repo.id)).toEqual([1]);
      expect(result?.diagnostics.rawDenseCount).toBe(0);
    } finally {
      warn.mockRestore();
    }
  });

  it('does not call the LLM when both optional switches are off', async () => {
    const analyze = vi.fn();
    const rerank = vi.fn();
    const result = await runVectorSearchPipeline({
      query: 'readme skill',
      repositories: [makeRepo({ id: 1, full_name: 'acme/readme-skill', ai_tags: ['skill'] })],
      vectorConfig: {
        enabled: true,
        workerUrl: 'https://worker',
        authToken: 'token',
        embeddingConfigId: 'emb',
        indexMode: 'description',
        readmeMaxChars: 6000,
        enableHyDE: false,
        enableReranking: false,
      },
      embeddingConfig: {} as never,
      aiService: {
        analyzeVectorSearchQuery: analyze,
        rerankRepositoriesGraded: rerank,
      } as unknown as AIService,
      embeddingClient: { embed: vi.fn().mockResolvedValue([]) } as unknown as EmbeddingClient,
      vectorService: { query: vi.fn() } as unknown as VectorSearchService,
      crossEncoder: null,
      signal: new AbortController().signal,
    });

    expect(analyze).not.toHaveBeenCalled();
    expect(rerank).not.toHaveBeenCalled();
    expect(result?.repositories.map(repo => repo.id)).toEqual([1]);
  });

  it('keeps query analysis but skips ideal dense when enableHyDE is false', async () => {
    const analyze = vi.fn().mockResolvedValue(analysis);
    const embed = vi.fn().mockResolvedValue([]);
    const result = await runVectorSearchPipeline({
      query: 'readme skill',
      repositories: [makeRepo({ id: 1, full_name: 'acme/readme-skill', ai_tags: ['skill'] })],
      vectorConfig: {
        enabled: true,
        workerUrl: 'https://worker',
        authToken: 'token',
        embeddingConfigId: 'emb',
        indexMode: 'description',
        readmeMaxChars: 6000,
        enableHyDE: false,
        enableReranking: true,
      },
      embeddingConfig: {} as never,
      aiService: {
        analyzeVectorSearchQuery: analyze,
        rerankRepositoriesGraded: vi.fn(),
      } as unknown as AIService,
      embeddingClient: { embed } as unknown as EmbeddingClient,
      vectorService: { query: vi.fn() } as unknown as VectorSearchService,
      crossEncoder: null,
      signal: new AbortController().signal,
    });

    expect(analyze).toHaveBeenCalledTimes(1);
    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed).toHaveBeenCalledWith(['readme skill'], 'query', expect.any(AbortSignal));
    expect(result?.diagnostics.idealDenseCount).toBe(0);
  });

  it('fuses grouped RRF deterministically and keeps one candidate per repository', () => {
    const a = makeRepo({ id: 1, full_name: 'acme/a', stargazers_count: 10 });
    const b = makeRepo({ id: 2, full_name: 'acme/b', stargazers_count: 200 });
    const c = makeRepo({ id: 3, full_name: 'acme/c', stargazers_count: 20 });
    const input = {
      rawMatches: [{ repo: a, score: 0.9, rank: 1 }, { repo: b, score: 0.8, rank: 2 }],
      idealMatches: [{ repo: a, score: 0.7, rank: 1 }],
      lexical: [{ repo: b, score: 3 }, { repo: a, score: 2 }],
      structured: [{ repo: c, score: 2, rank: 1 }],
    };
    const first = fuseCandidates(input);
    const second = fuseCandidates(input);

    expect(first).toEqual(second);
    expect(first.map(item => item.repo.id)).toEqual([1, 2, 3]);
    expect(first[0].denseScore).toBeCloseTo((1 / 61 + 0.9 / 61) / 1.9);
    expect(first[0].fusedScore).toBeGreaterThan(first[1].fusedScore);
  });

  it('deduplicates duplicate IDs within each recall channel', () => {
    const repo = makeRepo({ id: 1, full_name: 'acme/a' });
    const fused = fuseCandidates({
      rawMatches: [
        { repo, score: 0.7, rank: 2 },
        { repo, score: 0.9, rank: 1 },
      ],
      idealMatches: [],
      lexical: [
        { repo, score: 2 },
        { repo, score: 5 },
      ],
      structured: [
        { repo, score: 1, rank: 2 },
        { repo, score: 3, rank: 1 },
      ],
    });

    expect(fused).toHaveLength(1);
    expect(fused[0]).toMatchObject({
      denseRank: 1,
      lexicalRank: 1,
      structuredRank: 1,
      lexicalScore: 1 / 61,
      structuredScore: 1 / 61,
    });
  });

  it('uses structured signals as soft boosts and halves low-confidence facets', () => {
    const repo = makeRepo({
      id: 1,
      full_name: 'acme/readme-skill',
      description: 'Skill for optimizing GitHub README',
      ai_tags: ['skill', 'readme'],
      topics: ['github'],
    });
    const high = scoreStructuredSignals(repo, analysis, 'readme skill');
    const low = scoreStructuredSignals(repo, { ...analysis, lowConfidenceFacets: ['artifact', 'domain'] }, 'readme skill');
    const candidates = rankStructuredCandidates([
      repo,
      makeRepo({ id: 2, full_name: 'acme/unrelated', description: 'A chat client' }),
    ], analysis, 'readme skill');

    expect(high).toBeGreaterThan(0);
    expect(low).toBeGreaterThan(0);
    expect(low).toBeLessThan(high);
    expect(candidates.map(item => item.repo.id)).toEqual([1]);
  });

  it('applies the relative cutoff and always keeps at least five candidates', () => {
    const fused = [100, 90, 80, 70, 60, 20].map((score, index) =>
      fusedItem(makeRepo({ id: index + 1, full_name: `acme/${index}` }), score));

    expect(applyRelativeCutoff(fused, 30).map(item => item.repo.id)).toEqual([1, 2, 3, 4, 5]);
    expect(applyRelativeCutoff(fused, 2).map(item => item.repo.id)).toEqual([1, 2]);
  });

  it('follows the CE/LLM decision matrix without padding low-relevance candidates', () => {
    const repos = [1, 2, 3].map(id => makeRepo({ id, full_name: `acme/${id}` }));
    const ceOrdered = repos.map((repo, index) => fusedItem(repo, 10 - index, 1, 1));
    const fused = [...ceOrdered].reverse();
    const complete = {
      status: 'complete' as const,
      grades: new Map<number, 0 | 1 | 2>([[1, 0], [2, 1], [3, 2]]),
    };

    expect(chooseFinalOrder({
      ceOrdered,
      fused,
      graded: complete,
      topK: 1,
      analysis,
      crossEncoderUsed: true,
    }).map(item => item.repo.id)).toEqual([3]);
    expect(chooseFinalOrder({
      ceOrdered,
      fused,
      graded: { status: 'empty', grades: new Map() },
      topK: 30,
      analysis,
      crossEncoderUsed: true,
    }).map(item => item.repo.id)).toEqual([1, 2, 3]);
    expect(chooseFinalOrder({
      ceOrdered,
      fused: fused.map(item => ({ ...item, lexicalScore: 0, structuredScore: 0 })),
      graded: { status: 'empty', grades: new Map() },
      topK: 30,
      analysis: null,
      crossEncoderUsed: false,
    })).toEqual([]);
  });

  it('builds strictly decreasing synthetic scores for only the final results', () => {
    const repos = [makeRepo({ id: 4, full_name: 'acme/4' }), makeRepo({ id: 9, full_name: 'acme/9' })];
    const scores = toSyntheticScoreMap(repos);
    expect([...scores.entries()]).toEqual([['4', 1], ['9', 0.5]]);
  });

  it('orders by cross-encoder ranks and appends unranked candidates in fusion order', () => {
    const repos = [1, 2, 3].map(id => makeRepo({ id, full_name: `acme/${id}` }));
    const fused = repos.map((repo, index) => fusedItem(repo, 10 - index));

    expect(orderByCrossEncoder(fused, [
      { id: '3', score: 0.9, rank: 1 },
      { id: '1', score: 0.1, rank: 2 },
    ]).map(item => item.repo.id)).toEqual([3, 1, 2]);
  });

  interface AcceptanceCase {
    name: string;
    query: string;
    analysis: VectorQueryAnalysis;
    denseMatches: Array<{ id: string; score: number; full_name: string; description: string; tags: string[] }>;
    llmResponse: string;
    expectedTopIds: string[];
  }
  const acceptanceCases = (readFixture(fixturePath(import.meta.url, '__fixtures__/vector-search-cases.json')) as { cases: AcceptanceCase[] }).cases;

  it.each(acceptanceCases)('runs acceptance case $name end to end through the pipeline', async (item) => {
    const repos = item.denseMatches.map(match => makeRepo({
      id: Number(match.id),
      full_name: match.full_name,
      description: match.description,
      topics: match.tags,
      ai_tags: match.tags,
      stargazers_count: 10,
    }));
    const aiService = {
      analyzeVectorSearchQuery: vi.fn().mockResolvedValue(item.analysis),
      rerankRepositoriesGraded: vi.fn().mockImplementation(async (candidates: Repository[]): Promise<GradedRerankResult | null> => {
        const parser = new AIService({
          id: 'parser',
          name: 'parser',
          apiType: 'openai',
          baseUrl: 'http://localhost:0',
          apiKey: '',
          model: 'gpt-test',
          isActive: true,
        } as never, 'en');
        return parser.parseGradedRerankResult(item.llmResponse, candidates);
      }),
    } as unknown as AIService;

    const result = await runVectorSearchPipeline({
      query: item.query,
      repositories: repos,
      vectorConfig: {
        enabled: true,
        workerUrl: 'https://worker',
        authToken: 'token',
        embeddingConfigId: 'emb',
        indexMode: 'description',
        readmeMaxChars: 6000,
      },
      embeddingConfig: {
        id: 'emb',
        name: 'emb',
        apiType: 'openai-compatible',
        baseUrl: 'https://emb',
        apiKey: 'key',
        model: 'model',
        dimensions: 2,
        isActive: true,
      },
      aiService,
      embeddingClient: { embed: vi.fn().mockResolvedValue([[0.1]]) } as unknown as EmbeddingClient,
      vectorService: {
        query: vi.fn().mockResolvedValue(item.denseMatches.map(match => ({ id: match.id, score: match.score, metadata: {} }))),
      } as unknown as VectorSearchService,
      crossEncoder: null,
      signal: new AbortController().signal,
    });

    const rerankMock = aiService.rerankRepositoriesGraded as ReturnType<typeof vi.fn>;
    if (item.denseMatches.length >= 3) expect(rerankMock).toHaveBeenCalledTimes(1);
    else expect(rerankMock).not.toHaveBeenCalled();
    expect(result?.repositories.map(repo => String(repo.id))).toEqual(item.expectedTopIds);
  });
});

describe('hydrateMatches 账号隔离（R4 审计修复）', () => {
  const repoOne = makeRepo({ id: 1, full_name: 'acme/one' });
  const repoTwo = makeRepo({ id: 2, full_name: 'acme/two' });
  const repoById = new Map([['1', repoOne], ['2', repoTwo]]);

  const match = (id: string, accountId?: string, score = 0.8): VectorQueryResult => ({
    id,
    score,
    metadata: {
      full_name: 'acme/one',
      description: '',
      language: '',
      stars: 1,
      tags: [],
      ...(accountId ? { accountId } : {}),
    },
  });

  it('keeps matches owned by the current account and strips the ID prefix for hydration', () => {
    const ranked = hydrateMatches(
      [match('7:1', '7'), match('7:2', '7', 0.7)],
      repoById,
      { accountIdScope: { accountId: '7', multiAccount: true } },
    );
    expect(ranked.map(item => item.repo.id)).toEqual([1, 2]);
  });

  it('drops matches owned by other accounts even when the repo exists locally', () => {
    // 同一仓库在两个账号列表中都存在：他账号的向量不得经同一 ID 水合进来
    const ranked = hydrateMatches(
      [match('8:1', '8')],
      repoById,
      { accountIdScope: { accountId: '7', multiAccount: true } },
    );
    expect(ranked).toEqual([]);
  });

  it('hides legacy unowned matches in multi-account sessions', () => {
    const ranked = hydrateMatches(
      [match('1'), match('2')],
      repoById,
      { accountIdScope: { accountId: '7', multiAccount: true } },
    );
    expect(ranked).toEqual([]);
  });

  it('keeps legacy unowned matches visible only when legacy ownership is explicitly confirmed', () => {
    const rankedConfirmed = hydrateMatches(
      [match('1')],
      repoById,
      { accountIdScope: { accountId: '7', multiAccount: false, allowLegacyUnscoped: true } },
    );
    expect(rankedConfirmed.map(item => item.repo.id)).toEqual([1]);

    // 仅本机保存单个账号（未确认 legacy 归属）不得召回无归属旧向量
    const rankedUnconfirmed = hydrateMatches(
      [match('1')],
      repoById,
      { accountIdScope: { accountId: '7', multiAccount: false } },
    );
    expect(rankedUnconfirmed).toEqual([]);
  });

  it('rejects prefixed matches whose metadata.accountId conflicts with the prefix', () => {
    const ranked = hydrateMatches(
      [match('7:1', '8')],
      repoById,
      { accountIdScope: { accountId: '7', multiAccount: true } },
    );
    expect(ranked).toEqual([]);
  });

  it('keeps the raw vector id lookup when no scope is provided (C13)', () => {
    const ranked = hydrateMatches(
      [match('8:2', '8', 0.9), match('1', undefined, 0.8)],
      repoById,
    );
    // C13：无归属范围时保留原始向量 ID 查找——账号 8 的「8:2」向量绝不能
    // 先剥前缀命中本地仓库 2 并影响其排名；legacy 无前缀向量照常水合。
    expect(ranked.map(item => item.repo.id)).toEqual([1]);
  });
});
