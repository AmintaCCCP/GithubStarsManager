import { describe, expect, it, vi } from 'vitest';
import type { Repository, VectorSearchConfig } from '../types';
import { fixturePath, readFixture } from '../test/fixtureIo';
import { AIService } from './aiService';
import { logger } from './logger';
import {
  buildLocalSimilarityProfile,
  normalizeSimilarityAnalysis,
  runSimilarRepositoryPipeline,
} from './similarRepositoryPipeline';
import type { CrossEncoderReranker } from './crossEncoderReranker';
import type { EmbeddingClient, VectorSearchService } from './vectorSearchService';
import {
  chooseFinalOrder,
  fuseCandidates,
  type FusedCandidate,
  type VectorQueryAnalysis,
} from './vectorSearchPipeline';

const makeRepo = (
  partial: Partial<Repository> & Pick<Repository, 'id' | 'full_name'>,
): Repository => {
  const [owner, name] = partial.full_name.split('/');
  return {
    name: partial.name || name || partial.full_name,
    description: '',
    html_url: `https://github.com/${partial.full_name}`,
    stargazers_count: 1,
    forks_count: 0,
    forks: 0,
    language: 'TypeScript',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    pushed_at: '2026-01-03T00:00:00Z',
    owner: { login: owner || 'owner', avatar_url: '' },
    topics: [],
    ...partial,
  };
};

const vectorConfig: VectorSearchConfig = {
  enabled: true,
  workerUrl: 'https://worker',
  authToken: 'token',
  embeddingConfigId: 'emb',
  indexMode: 'readme',
  readmeMaxChars: 6000,
  searchTopK: 30,
  searchThreshold: 0.2,
  enableHyDE: true,
  enableReranking: true,
};

const embeddingConfig = {
  id: 'emb',
  name: 'emb',
  apiType: 'openai-compatible' as const,
  baseUrl: 'https://emb',
  apiKey: 'key',
  model: 'model',
  dimensions: 2,
  isActive: true,
};

interface SimilarityCase {
  name: string;
  source: Partial<Repository> & Pick<Repository, 'id' | 'full_name'>;
  analysis: VectorQueryAnalysis;
  candidates: Array<Partial<Repository> & Pick<Repository, 'id' | 'full_name'>>;
  exactMatches: Array<{ id: string; score: number }>;
  profileMatches: Array<{ id: string; score: number }>;
  llmResponse: string;
  expectedTopIds: string[];
}

const cases = (readFixture(
  fixturePath(import.meta.url, '__fixtures__/similar-repository-cases.json'),
) as { cases: SimilarityCase[] }).cases;

const parser = new AIService({
  id: 'parser',
  name: 'parser',
  apiType: 'openai',
  baseUrl: 'http://localhost:0',
  apiKey: '',
  model: 'gpt-test',
  isActive: true,
} as never, 'en');

describe('similarRepositoryPipeline', () => {
  it.each(cases)('$name', async (item) => {
    const source = makeRepo(item.source);
    const repositories = item.candidates.map(makeRepo);
    const embed = vi.fn()
      .mockResolvedValueOnce([[0.1]])
      .mockResolvedValueOnce([[0.2]]);
    const query = vi.fn()
      .mockResolvedValueOnce(item.exactMatches.map(match => ({ ...match, metadata: {} })))
      .mockResolvedValueOnce(item.profileMatches.map(match => ({ ...match, metadata: {} })));
    const aiService = {
      analyzeSimilarRepositorySource: vi.fn().mockResolvedValue(item.analysis),
      rerankSimilarRepositoriesGraded: vi.fn().mockImplementation(async (
        _source: Repository,
        candidates: Repository[],
      ) => parser.parseGradedRerankResult(item.llmResponse, candidates)),
    } as unknown as AIService;
    const readmeFetcher = vi.fn().mockResolvedValue(
      '# README marker\nA source README used to mirror the indexed representation.',
    );

    const result = await runSimilarRepositoryPipeline({
      source,
      repositories,
      vectorConfig,
      embeddingConfig,
      aiService,
      embeddingClient: { embed } as unknown as EmbeddingClient,
      vectorService: { query } as unknown as VectorSearchService,
      crossEncoder: null,
      readmeFetcher,
      signal: new AbortController().signal,
    });

    expect(readmeFetcher).toHaveBeenCalledWith(
      source.owner.login,
      source.name,
      expect.any(AbortSignal),
    );
    expect(embed).toHaveBeenNthCalledWith(
      1,
      [expect.stringContaining('README marker')],
      'query',
      expect.any(AbortSignal),
    );
    expect(result.repositories.map(repo => String(repo.id))).toEqual(item.expectedTopIds);
    expect(result.repositories[0]?.id).toBe(Number(item.expectedTopIds[0]));
    expect(result.diagnostics.fusedCount).toBeGreaterThan(0);
  });

  it('drops source, same-full-name variants and forks while collapsing duplicate and stale IDs', async () => {
    const source = makeRepo({ id: 1, full_name: 'acme/source' });
    const duplicate = makeRepo({ id: 3, full_name: 'peer/duplicate' });
    const fork = makeRepo({ id: 4, full_name: 'peer/fork', fork: true });
    const sameName = makeRepo({ id: 5, full_name: 'ACME/SOURCE' });
    const brandVariant = makeRepo({ id: 6, full_name: 'acme/source-pro' });
    const valid = makeRepo({ id: 2, full_name: 'peer/valid' });
    const query = vi.fn().mockResolvedValue([
      { id: '1', score: 1, metadata: {} },
      { id: '3', score: 0.9, metadata: {} },
      { id: '3', score: 0.8, metadata: {} },
      { id: '4', score: 0.95, metadata: {} },
      { id: '5', score: 0.94, metadata: {} },
      { id: '6', score: 0.93, metadata: {} },
      { id: '999', score: 0.99, metadata: {} },
      { id: '2', score: 0.7, metadata: {} },
    ]);

    const result = await runSimilarRepositoryPipeline({
      source,
      repositories: [source, duplicate, fork, sameName, brandVariant, valid],
      vectorConfig: { ...vectorConfig, enableHyDE: false },
      embeddingConfig,
      aiService: null,
      embeddingClient: { embed: vi.fn().mockResolvedValue([[0.1]]) } as unknown as EmbeddingClient,
      vectorService: { query } as unknown as VectorSearchService,
      crossEncoder: null,
      signal: new AbortController().signal,
    });

    expect(result.repositories.map(repo => repo.id)).toEqual([3, 2]);
    expect(result.repositories.filter(repo => repo.id === 3)).toHaveLength(1);
    expect(result.repositories.some(repo => repo.id === brandVariant.id)).toBe(false);
  });

  it('uses README context for cross-encoder when the local profile has no domain evidence', async () => {
    const source = makeRepo({ id: 1, full_name: 'owner/empty', description: '' });
    const repositories = [
      makeRepo({ id: 2, full_name: 'peer/first' }),
      makeRepo({ id: 3, full_name: 'peer/second' }),
    ];
    const crossEncoder = {
      isAvailable: vi.fn(() => true),
      rerank: vi.fn(async () => [
        { id: '3', score: 1, rank: 1 },
        { id: '2', score: 0.5, rank: 2 },
      ]),
    } as unknown as CrossEncoderReranker;

    const result = await runSimilarRepositoryPipeline({
      source,
      repositories,
      vectorConfig: { ...vectorConfig, enableHyDE: false },
      embeddingConfig,
      aiService: null,
      embeddingClient: { embed: vi.fn().mockResolvedValue([[0.1]]) } as unknown as EmbeddingClient,
      vectorService: {
        query: vi.fn().mockResolvedValue([
          { id: '2', score: 0.9, metadata: {} },
          { id: '3', score: 0.8, metadata: {} },
        ]),
      } as unknown as VectorSearchService,
      crossEncoder,
      readmeFetcher: vi.fn().mockResolvedValue('# Terminal file browser\nManage files from a TUI.'),
      signal: new AbortController().signal,
    });

    expect(crossEncoder.rerank).toHaveBeenCalledWith(
      expect.stringContaining('Terminal file browser'),
      expect.any(Array),
      expect.any(AbortSignal),
    );
    expect(crossEncoder.rerank).not.toHaveBeenCalledWith(
      expect.stringContaining('software repository'),
      expect.any(Array),
      expect.any(AbortSignal),
    );
    expect(result.diagnostics.ceQueryFallback).toBe(true);
    expect(result.repositories.map(repo => repo.id)).toEqual([3, 2]);
  });

  it('does not trust a generic AI profile without structured domain evidence', async () => {
    const source = makeRepo({ id: 1, full_name: 'owner/empty', description: '' });
    const rerank = vi.fn();
    const aiService = {
      analyzeSimilarRepositorySource: vi.fn().mockResolvedValue({
        intent: 'A generic software project',
        idealDescription: 'A peer software repository.',
        keywords: [],
        facets: { artifact: [], action: [], domain: [], platform: [] },
        highPrecisionTerms: [],
        lowConfidenceFacets: [],
      }),
      rerankSimilarRepositoriesGraded: rerank,
    } as unknown as AIService;
    const crossEncoder = {
      isAvailable: vi.fn(() => true),
      rerank: vi.fn(async () => [
        { id: '3', score: 1, rank: 1 },
        { id: '2', score: 0.5, rank: 2 },
        { id: '4', score: 0.25, rank: 3 },
      ]),
    } as unknown as CrossEncoderReranker;

    const result = await runSimilarRepositoryPipeline({
      source,
      repositories: [
        makeRepo({ id: 2, full_name: 'peer/first' }),
        makeRepo({ id: 3, full_name: 'peer/second' }),
        makeRepo({ id: 4, full_name: 'peer/third' }),
      ],
      vectorConfig,
      embeddingConfig,
      aiService,
      embeddingClient: { embed: vi.fn().mockResolvedValue([[0.1]]) } as unknown as EmbeddingClient,
      vectorService: {
        query: vi.fn().mockResolvedValue([
          { id: '2', score: 0.9, metadata: {} },
          { id: '3', score: 0.8, metadata: {} },
          { id: '4', score: 0.7, metadata: {} },
        ]),
      } as unknown as VectorSearchService,
      crossEncoder,
      readmeFetcher: vi.fn().mockResolvedValue('# Terminal file browser'),
      signal: new AbortController().signal,
    });

    expect(result.diagnostics.profileSource).toBe('ai');
    expect(result.diagnostics.ceQueryFallback).toBe(true);
    expect(result.diagnostics.profileDenseCount).toBe(0);
    expect(rerank).not.toHaveBeenCalled();
    expect(crossEncoder.rerank).toHaveBeenCalledWith(
      expect.stringContaining('Terminal file browser'),
      expect.any(Array),
      expect.any(AbortSignal),
    );
  });

  it('normalizes brand and language leakage from AI and local profiles', () => {
    const source = makeRepo(cases[4].source);
    expect(normalizeSimilarityAnalysis(cases[4].analysis, source)).toBeNull();

    const local = buildLocalSimilarityProfile(source);
    const profileText = JSON.stringify(local);
    expect(profileText).not.toContain(source.full_name);
    expect(profileText).not.toContain(source.name);
    expect(local.keywords).not.toContain(source.language?.toLowerCase());
    expect(local.keywords).toContain('skill');
  });

  it('disables popularity in similarity lexical scoring and uses stable non-star ties', () => {
    const lowStars = makeRepo({
      id: 10,
      full_name: 'peer/readme-skill',
      description: 'Agent skill for README',
      stargazers_count: 1,
    });
    const highStars = makeRepo({
      id: 11,
      full_name: 'other/readme-skill',
      description: 'Agent skill for README',
      stargazers_count: 1_000_000,
    });
    const withoutPopularity = AIService.rankLexicalCandidates(
      [lowStars, highStars],
      'readme skill',
      [],
      { includePopularity: false },
    );
    expect(withoutPopularity[0].score).toBe(withoutPopularity[1].score);

    const a = makeRepo({ id: 1, full_name: 'a/peer', stargazers_count: 1 });
    const b = makeRepo({ id: 2, full_name: 'z/peer', stargazers_count: 999999 });
    const fillers = Array.from(
      { length: 48 },
      (_, index) => makeRepo({ id: 100 + index, full_name: `filler/${index}` }),
    );
    const rawOrder = [...fillers];
    rawOrder.splice(3, 0, a);
    rawOrder.splice(9, 0, b);
    const rawMatches = rawOrder.map((repo, index) => ({
      repo,
      score: 1000 - index,
      rank: index + 1,
    }));
    const idealOrder = [...fillers];
    idealOrder.splice(23, 0, b);
    idealOrder.splice(35, 0, a);
    const idealMatches = idealOrder.map((repo, index) => ({
      repo,
      score: 1000 - index,
      rank: index + 1,
    }));
    const fusedInput = {
      rawMatches,
      idealMatches,
      lexical: [],
      structured: [],
    };
    const defaultOrder = fuseCandidates(fusedInput)
      .filter(item => item.repo === a || item.repo === b)
      .map(item => item.repo.full_name);
    const similarityOrder = fuseCandidates({ ...fusedInput, tieBreak: 'similarity' })
      .filter(item => item.repo === a || item.repo === b)
      .map(item => item.repo.full_name);
    expect(defaultOrder).toEqual(['z/peer', 'a/peer']);
    expect(similarityOrder).toEqual(['a/peer', 'z/peer']);
  });

  it('returns an explicit empty state for all-zero and empty grades in similarity mode', () => {
    const repos = [1, 2, 3].map(id => makeRepo({ id, full_name: `peer/${id}` }));
    const fused: FusedCandidate[] = repos.map((repo, index) => ({
      repo,
      fusedScore: 10 - index,
      denseScore: 10 - index,
      lexicalScore: 1,
      structuredScore: 1,
      denseRank: index + 1,
      lexicalRank: index + 1,
      structuredRank: index + 1,
    }));

    for (const graded of [
      { status: 'complete' as const, grades: new Map(repos.map(repo => [repo.id, 0 as const])) },
      { status: 'empty' as const, grades: new Map<number, 0 | 1 | 2>() },
    ]) {
      expect(chooseFinalOrder({
        ceOrdered: fused,
        fused,
        graded,
        topK: 30,
        analysis: null,
        crossEncoderUsed: true,
        noPositiveGradesPolicy: 'empty',
      })).toEqual([]);
      expect(chooseFinalOrder({
        ceOrdered: fused,
        fused,
        graded,
        topK: 30,
        analysis: null,
        crossEncoderUsed: true,
      }).length).toBeGreaterThan(0);
    }
  });

  it('falls back to local recall when optional retrieval stages fail', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      const source = makeRepo({
        id: 1,
        full_name: 'acme/readme-skill',
        description: 'Agent skill for GitHub README',
        topics: ['readme', 'skill'],
        ai_tags: ['skill'],
      });
      const candidate = makeRepo({
        id: 2,
        full_name: 'peer/readme-skill',
        description: 'Agent skill for GitHub README',
        topics: ['readme', 'skill'],
        ai_tags: ['skill'],
      });
      const embed = vi.fn()
        .mockRejectedValueOnce(new Error('exact embedding 500'))
        .mockRejectedValueOnce(new Error('profile embedding 500'));
      const result = await runSimilarRepositoryPipeline({
        source,
        repositories: [source, candidate],
        vectorConfig,
        embeddingConfig,
        aiService: {
          analyzeSimilarRepositorySource: vi.fn().mockRejectedValue(new Error('invalid JSON')),
          rerankSimilarRepositoriesGraded: vi.fn(),
        } as unknown as AIService,
        embeddingClient: { embed } as unknown as EmbeddingClient,
        vectorService: { query: vi.fn() } as unknown as VectorSearchService,
        crossEncoder: null,
        signal: new AbortController().signal,
      });

      expect(result.repositories.map(repo => repo.id)).toEqual([2]);
      expect(result.diagnostics.profileSource).toBe('local');
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('throws only when every dense channel fails and local recall is empty', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      await expect(runSimilarRepositoryPipeline({
        source: makeRepo({ id: 1, full_name: 'acme/source' }),
        repositories: [makeRepo({ id: 2, full_name: 'peer/unrelated', description: 'Chess engine' })],
        vectorConfig,
        embeddingConfig,
        aiService: null,
        embeddingClient: { embed: vi.fn().mockRejectedValue(new Error('embedding down')) } as unknown as EmbeddingClient,
        vectorService: { query: vi.fn() } as unknown as VectorSearchService,
        crossEncoder: null,
        signal: new AbortController().signal,
      })).rejects.toThrow('embedding down');
    } finally {
      warn.mockRestore();
    }
  });

  it('propagates README abort instead of disguising it as metadata fallback', async () => {
    await expect(runSimilarRepositoryPipeline({
      source: makeRepo(cases[0].source),
      repositories: cases[0].candidates.map(makeRepo),
      vectorConfig,
      embeddingConfig,
      aiService: null,
      embeddingClient: { embed: vi.fn() } as unknown as EmbeddingClient,
      vectorService: { query: vi.fn() } as unknown as VectorSearchService,
      crossEncoder: null,
      readmeFetcher: vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')),
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
