import type { EmbeddingConfig, Repository, VectorSearchConfig } from '../types';
import { AIService, isAbortError } from './aiService';
import type { EmbeddingClient, VectorQueryResult, VectorSearchService } from './vectorSearchService';
import {
  buildCrossEncoderDocument,
  deriveRepoKind,
  type CrossEncoderResult,
  type CrossEncoderReranker,
} from './crossEncoderReranker';
import { logger } from './logger';

export interface VectorQueryAnalysis {
  intent: string;
  keywords: string[];
  idealDescription: string;
  facets: {
    artifact: string[];
    action: string[];
    domain: string[];
    platform: string[];
  };
  highPrecisionTerms: string[];
  lowConfidenceFacets: string[];
}

export interface RankedChannel {
  repo: Repository;
  score: number;
  rank: number;
}

export interface FusedCandidate {
  repo: Repository;
  fusedScore: number;
  denseScore: number;
  lexicalScore: number;
  structuredScore: number;
  denseRank: number | null;
  lexicalRank: number | null;
  structuredRank: number | null;
}

export type RelevanceGrade = 0 | 1 | 2;

export type GradedRerankResult =
  | { status: 'complete'; grades: Map<number, RelevanceGrade> }
  | { status: 'empty'; grades: Map<number, RelevanceGrade> }
  | { status: 'invalid'; grades: Map<number, RelevanceGrade> };

export interface VectorSearchPipelineResult {
  repositories: Repository[];
  scoreMap: Map<string, number>;
  diagnostics: {
    analysisUsed: boolean;
    rawDenseCount: number;
    idealDenseCount: number;
    lexicalCount: number;
    structuredCount: number;
    fusedCount: number;
    crossEncoderUsed: boolean;
    crossEncoderPartial: boolean;
    llmStatus: 'complete' | 'empty' | 'invalid' | 'skipped';
    fallback: 'none' | 'cross-encoder' | 'fusion' | 'empty-guard';
    timingsMs: Partial<Record<
      'analysis' | 'rawEmbedding' | 'rawDense' | 'idealEmbedding' | 'idealDense' | 'crossEncoder' | 'llm',
      number
    >>;
  };
}

export const RECALL_TOP_K = 50;
export const LLM_CANDIDATE_LIMIT = 15;
export const RRF_K = 60;
export const RELATIVE_FUSION_CUTOFF = 0.65;

const ANALYSIS_TIMEOUT_MS = 3500;
const EMBEDDING_TIMEOUT_MS = 5000;
const WORKER_TIMEOUT_MS = 4000;
const CROSS_ENCODER_TIMEOUT_MS = 3000;
const LLM_TIMEOUT_MS = 8000;

const ARTIFACT_ALIASES: Record<string, string> = {
  '技能': 'skill',
  skills: 'skill',
  '插件': 'plugin',
  plugins: 'plugin',
  '命令行': 'cli',
  '桌面': 'desktop',
  '网页': 'web',
  '库': 'library',
  '清单': 'awesome-list',
  awesome: 'awesome-list',
  'awesome list': 'awesome-list',
};

function finiteScore(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function abortError(): DOMException {
  return new DOMException('Search aborted', 'AbortError');
}

export function withBudget<T>(
  task: (stageSignal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  outerSignal: AbortSignal,
  timeoutValue: T,
): Promise<T> {
  if (outerSignal.aborted) return Promise.reject(abortError());

  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      outerSignal.removeEventListener('abort', onOuterAbort);
    };
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onOuterAbort = () => {
      controller.abort();
      settle(() => reject(abortError()));
    };
    const timer = setTimeout(() => {
      controller.abort();
      settle(() => resolve(timeoutValue));
    }, timeoutMs);

    outerSignal.addEventListener('abort', onOuterAbort, { once: true });
    let taskPromise: Promise<T>;
    try {
      taskPromise = task(controller.signal);
    } catch (error) {
      settle(() => reject(error));
      return;
    }
    taskPromise.then(
      value => settle(() => resolve(value)),
      error => settle(() => reject(error)),
    );
    // A timed-out task may reject after the budget already resolved.
    void taskPromise.catch(() => undefined);
  });
}

function buildRepoIndex(repositories: Repository[]): Map<string, Repository> {
  const repoById = new Map<string, Repository>();
  for (const repo of repositories) {
    const id = String(repo.id);
    if (repoById.has(id)) {
      logger.warn('vector-search', 'Duplicate local repository ID ignored', { id });
      continue;
    }
    repoById.set(id, repo);
  }
  return repoById;
}

function hydrateMatches(
  matches: VectorQueryResult[],
  repoById: Map<string, Repository>,
): RankedChannel[] {
  const best = new Map<string, { repo: Repository; score: number }>();
  matches.forEach((match) => {
    const repo = repoById.get(String(match.id));
    if (!repo || !Number.isFinite(match.score) || match.score <= 0) return;
    const id = String(repo.id);
    const previous = best.get(id);
    if (!previous || match.score > previous.score) {
      best.set(id, { repo, score: match.score });
    }
  });
  return [...best.values()]
    .sort((a, b) => b.score - a.score || a.repo.id - b.repo.id)
    .map((item, index) => ({ repo: item.repo, score: item.score, rank: index + 1 }));
}

function normalizeArtifact(value: string): string {
  const normalized = value.trim().toLowerCase();
  return ARTIFACT_ALIASES[normalized] || normalized;
}

function repositorySignalText(repo: Repository): {
  text: string;
  tags: Set<string>;
  highPrecisionText: string;
} {
  const tags = [
    ...(repo.topics || []),
    ...(repo.ai_tags || []),
    ...(repo.custom_tags || []),
    ...(repo.ai_platforms || []),
    repo.language || '',
    repo.custom_category || '',
  ].map(value => value.trim().toLowerCase()).filter(Boolean);
  return {
    text: [
      repo.full_name,
      repo.name,
      repo.description || '',
      repo.ai_summary || '',
      repo.custom_description || '',
      ...tags,
      deriveRepoKind(repo),
    ].join(' ').toLowerCase(),
    tags: new Set(tags),
    highPrecisionText: [
      repo.full_name,
      repo.name,
      ...(repo.topics || []),
      ...(repo.ai_tags || []),
      ...(repo.custom_tags || []),
      repo.custom_category || '',
    ].join(' ').toLowerCase(),
  };
}

export function scoreStructuredSignals(
  repo: Repository,
  analysis: VectorQueryAnalysis | null,
  rawQuery: string,
): number {
  const signals = repositorySignalText(repo);
  const repoKind = deriveRepoKind(repo);
  const lowConfidence = new Set((analysis?.lowConfidenceFacets || []).map(value => value.toLowerCase()));
  let score = 0;

  const facetScore = (facet: keyof VectorQueryAnalysis['facets'], weight: number): number => {
    const multiplier = lowConfidence.has(facet) ? 0.5 : 1;
    return (analysis?.facets[facet] || []).reduce((sum, rawValue) => {
      const normalizedValue = facet === 'artifact' ? normalizeArtifact(rawValue) : rawValue.trim().toLowerCase();
      if (!normalizedValue) return sum;
      if (facet === 'artifact' && repoKind === normalizedValue) return sum + weight;
      if (signals.tags.has(normalizedValue)) return sum + weight;
      return signals.text.includes(normalizedValue) ? sum + weight * 0.5 : sum;
    }, 0) * multiplier;
  };

  score += facetScore('artifact', 2.4);
  score += facetScore('action', 1.2);
  score += facetScore('domain', 1.6);
  score += facetScore('platform', 1.2);

  for (const term of analysis?.highPrecisionTerms || []) {
    const normalized = term.trim().toLowerCase();
    if (!normalized) continue;
    if (signals.highPrecisionText.includes(normalized)) score += 0.9;
    else if (signals.text.includes(normalized)) score += 0.3;
  }

  if (!analysis) {
    for (const term of rawQuery.toLowerCase().split(/\s+/).filter(Boolean)) {
      if (signals.tags.has(term)) score += 0.8;
      else if (repoKind === normalizeArtifact(term)) score += 1.2;
    }
  }

  return finiteScore(score);
}

export function rankStructuredCandidates(
  repositories: Repository[],
  analysis: VectorQueryAnalysis | null,
  rawQuery: string,
): RankedChannel[] {
  return repositories
    .map(repo => ({ repo, score: scoreStructuredSignals(repo, analysis, rawQuery) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.repo.id - b.repo.id)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

export function fuseCandidates(input: {
  rawMatches: RankedChannel[];
  idealMatches: RankedChannel[];
  lexical: Array<{ repo: Repository; score: number }>;
  structured: RankedChannel[];
}): FusedCandidate[] {
  const byId = new Map<string, FusedCandidate>();
  const dedupeRanked = (items: RankedChannel[]): RankedChannel[] => {
    const best = new Map<string, RankedChannel>();
    for (const item of items) {
      if (!Number.isFinite(item.score) || item.score <= 0) continue;
      const id = String(item.repo.id);
      const previous = best.get(id);
      if (!previous || item.score > previous.score || (item.score === previous.score && item.rank < previous.rank)) {
        best.set(id, item);
      }
    }
    return [...best.values()]
      .sort((a, b) => b.score - a.score || a.repo.id - b.repo.id)
      .map((item, index) => ({ ...item, rank: index + 1 }));
  };
  const addChannel = (
    channel: RankedChannel[],
    kind: 'raw' | 'ideal' | 'lexical' | 'structured',
  ) => {
    for (const item of channel) {
      const id = String(item.repo.id);
      let candidate = byId.get(id);
      if (!candidate) {
        candidate = {
          repo: item.repo,
          fusedScore: 0,
          denseScore: 0,
          lexicalScore: 0,
          structuredScore: 0,
          denseRank: null,
          lexicalRank: null,
          structuredRank: null,
        };
        byId.set(id, candidate);
      }
      if (kind === 'raw') candidate.denseRank = item.rank;
      else if (kind === 'ideal') candidate.denseRank = candidate.denseRank ?? item.rank;
      else if (kind === 'lexical') {
        candidate.lexicalRank = item.rank;
      } else {
        candidate.structuredRank = item.rank;
      }
    }
  };

  const rawMatches = dedupeRanked(input.rawMatches);
  const idealMatches = dedupeRanked(input.idealMatches);
  addChannel(rawMatches, 'raw');
  addChannel(idealMatches, 'ideal');
  const lexicalRanks = dedupeRanked(input.lexical.map((item, index) => ({
    repo: item.repo,
    score: item.score,
    rank: index + 1,
  })));
  addChannel(lexicalRanks, 'lexical');
  addChannel(dedupeRanked(input.structured), 'structured');

  const rawById = new Map(rawMatches.map(item => [String(item.repo.id), item]));
  const idealById = new Map(idealMatches.map(item => [String(item.repo.id), item]));
  const hasIdeal = idealMatches.length > 0 ? 1 : 0;
  for (const [id, candidate] of byId) {
    const raw = rawById.get(id);
    const ideal = idealById.get(id);
    const rawScore = raw ? 1 / (RRF_K + raw.rank) : 0;
    const idealScore = ideal ? 1 / (RRF_K + ideal.rank) : 0;
    candidate.denseRank = raw?.rank ?? ideal?.rank ?? null;
    candidate.denseScore = (rawScore + 0.9 * idealScore) / (1 + 0.9 * hasIdeal);
    candidate.lexicalScore = candidate.lexicalRank ? 1 / (RRF_K + candidate.lexicalRank) : 0;
    candidate.structuredScore = candidate.structuredRank ? 1 / (RRF_K + candidate.structuredRank) : 0;
    candidate.fusedScore = finiteScore(
      candidate.denseScore + 0.55 * candidate.lexicalScore + 0.25 * candidate.structuredScore,
    );
  }

  return [...byId.values()].sort((a, b) =>
    b.fusedScore - a.fusedScore
    || b.lexicalScore - a.lexicalScore
    || b.structuredScore - a.structuredScore
    || (b.repo.stargazers_count || 0) - (a.repo.stargazers_count || 0)
    || a.repo.id - b.repo.id);
}

export function applyRelativeCutoff(fused: FusedCandidate[], topK: number): FusedCandidate[] {
  if (fused.length === 0) return [];
  const cutoff = fused[0].fusedScore * RELATIVE_FUSION_CUTOFF;
  const filtered = fused.filter(item => item.fusedScore >= cutoff).slice(0, topK);
  const minimum = Math.min(5, fused.length);
  return filtered.length >= minimum ? filtered : fused.slice(0, Math.min(minimum, topK));
}

function hasStrongEvidence(item: FusedCandidate, analysis: VectorQueryAnalysis | null): boolean {
  if (item.lexicalScore > 0 && item.structuredScore > 0) return true;
  const signals = repositorySignalText(item.repo);
  return (analysis?.highPrecisionTerms || []).some(term => {
    const normalized = term.trim().toLowerCase();
    return Boolean(normalized) && signals.highPrecisionText.includes(normalized);
  });
}

function orderByGrades(
  ordered: FusedCandidate[],
  grades: Map<number, RelevanceGrade>,
): FusedCandidate[] {
  const rankById = new Map(ordered.map((item, index) => [String(item.repo.id), index]));
  return ordered
    .filter(item => (grades.get(item.repo.id) || 0) > 0)
    .sort((a, b) =>
      (grades.get(b.repo.id) || 0) - (grades.get(a.repo.id) || 0)
      || (rankById.get(String(a.repo.id)) || 0) - (rankById.get(String(b.repo.id)) || 0));
}

export function chooseFinalOrder(options: {
  ceOrdered: FusedCandidate[];
  fused: FusedCandidate[];
  graded: GradedRerankResult | null;
  topK: number;
  analysis: VectorQueryAnalysis | null;
  crossEncoderUsed: boolean;
}): FusedCandidate[] {
  const { ceOrdered, fused, graded, analysis, crossEncoderUsed } = options;
  const baseOrder = crossEncoderUsed ? ceOrdered : fused;

  if (graded?.status === 'complete') {
    const ordered = orderByGrades(baseOrder, graded.grades);
    if (ordered.length > 0) return ordered.slice(0, options.topK);
    if (crossEncoderUsed) return ceOrdered.slice(0, Math.min(options.topK, 10));
    return fused.some(item => hasStrongEvidence(item, analysis))
      ? fused.slice(0, Math.min(5, options.topK))
      : [];
  }

  if (graded?.status === 'empty') {
    if (crossEncoderUsed) return ceOrdered.slice(0, Math.min(options.topK, 10));
    return fused.some(item => hasStrongEvidence(item, analysis))
      ? fused.slice(0, Math.min(5, options.topK))
      : [];
  }

  if (crossEncoderUsed) return ceOrdered.slice(0, options.topK);
  return applyRelativeCutoff(fused, options.topK);
}

export function toSyntheticScoreMap(repositories: Repository[]): Map<string, number> {
  const total = repositories.length;
  return new Map(repositories.map((repo, index) => [String(repo.id), (total - index) / total]));
}

export function orderByCrossEncoder(
  fused: FusedCandidate[],
  results: CrossEncoderResult[],
): FusedCandidate[] {
  const byId = new Map(fused.map(item => [String(item.repo.id), item]));
  const ordered: FusedCandidate[] = [];
  const seen = new Set<string>();
  for (const result of [...results].sort((a, b) => a.rank - b.rank)) {
    const item = byId.get(String(result.id));
    if (!item || seen.has(String(item.repo.id))) continue;
    seen.add(String(item.repo.id));
    ordered.push(item);
  }
  for (const item of fused) {
    if (!seen.has(String(item.repo.id))) ordered.push(item);
  }
  return ordered;
}

export interface RunVectorSearchPipelineOptions {
  query: string;
  repositories: Repository[];
  vectorConfig: VectorSearchConfig;
  embeddingConfig: EmbeddingConfig;
  aiService: AIService | null;
  embeddingClient: EmbeddingClient;
  vectorService: VectorSearchService;
  crossEncoder: CrossEncoderReranker | null;
  signal: AbortSignal;
  onPhase?: (phase: 'analyzing' | 'embedding' | 'recalling' | 'reranking') => void;
}

export async function runVectorSearchPipeline(
  options: RunVectorSearchPipelineOptions,
): Promise<VectorSearchPipelineResult | null> {
  const { query, repositories, vectorConfig, signal } = options;
  if (!query.trim()) return null;

  const timingsMs: VectorSearchPipelineResult['diagnostics']['timingsMs'] = {};
  const threshold = vectorConfig.searchThreshold ?? 0.35;
  const analysisEnabled = Boolean(
    options.aiService
    && (vectorConfig.enableHyDE !== false || vectorConfig.enableReranking !== false),
  );

  if (analysisEnabled) options.onPhase?.('analyzing');
  const analysisStarted = Date.now();
  const analysisPromise = analysisEnabled
    ? withBudget(
        stageSignal => options.aiService!.analyzeVectorSearchQuery(query, stageSignal),
        ANALYSIS_TIMEOUT_MS,
        signal,
        null,
      ).catch(error => {
        if (isAbortError(error)) throw error;
        logger.warn('vector-search', 'Query analysis failed, continuing without analysis', { error });
        return null;
      })
    : Promise.resolve(null);

  options.onPhase?.('embedding');
  const rawEmbeddingStarted = Date.now();
  const rawEmbeddingPromise = withBudget(
    stageSignal => options.embeddingClient.embed([query], 'query', stageSignal),
    EMBEDDING_TIMEOUT_MS,
    signal,
    [],
  ).finally(() => {
    timingsMs.rawEmbedding = Date.now() - rawEmbeddingStarted;
  });

  let rawDenseStarted = 0;
  const rawDensePromise = rawEmbeddingPromise
    .then(vectors => {
      if (!vectors[0]) return [];
      rawDenseStarted = Date.now();
      return withBudget(
        stageSignal => options.vectorService.query(
          vectors[0],
          { topK: RECALL_TOP_K, threshold },
          stageSignal,
        ),
        WORKER_TIMEOUT_MS,
        signal,
        [],
      );
    })
    .finally(() => {
      if (rawDenseStarted) timingsMs.rawDense = Date.now() - rawDenseStarted;
    })
    .catch(error => {
      if (isAbortError(error)) throw error;
      return [];
    });
  // Analysis may reject first on cancellation; keep the in-flight dense promise handled.
  void rawDensePromise.catch(() => undefined);

  const analysis = await analysisPromise;
  timingsMs.analysis = Date.now() - analysisStarted;

  let idealEmbeddingStarted = 0;
  const idealDensePromise = analysis?.idealDescription && vectorConfig.enableHyDE !== false
    ? (() => {
        idealEmbeddingStarted = Date.now();
        return withBudget(
          stageSignal => options.embeddingClient.embed(
            [analysis.idealDescription],
            'query',
            stageSignal,
          ),
          EMBEDDING_TIMEOUT_MS,
          signal,
          [],
        ).finally(() => {
          timingsMs.idealEmbedding = Date.now() - idealEmbeddingStarted;
        });
      })()
        .then(vectors => {
          if (!vectors[0]) return [];
          const started = Date.now();
          return withBudget(
            stageSignal => options.vectorService.query(
              vectors[0],
              { topK: RECALL_TOP_K, threshold },
              stageSignal,
            ),
            WORKER_TIMEOUT_MS,
            signal,
            [],
          ).finally(() => {
            timingsMs.idealDense = Date.now() - started;
          });
        })
        .catch(error => {
          if (isAbortError(error)) throw error;
          return [];
        })
    : Promise.resolve([]);

  const [rawMatchResults, idealMatchResults] = await Promise.all([
    rawDensePromise,
    idealDensePromise,
  ]);
  if (signal.aborted) throw abortError();

  options.onPhase?.('recalling');
  const repoById = buildRepoIndex(repositories);
  const rawMatches = hydrateMatches(rawMatchResults, repoById);
  const idealMatches = hydrateMatches(idealMatchResults, repoById);
  const lexical = AIService.rankLexicalCandidates(repositories, query, analysis?.keywords ?? [])
    .filter(item => item.score > 0);
  const structured = rankStructuredCandidates(repositories, analysis, query);
  const fused = fuseCandidates({ rawMatches, idealMatches, lexical, structured })
    .slice(0, RECALL_TOP_K);
  if (fused.length === 0) return null;

  let crossEncoderUsed = false;
  let crossEncoderPartial = false;
  let ceOrdered = fused;
  const ceStarted = Date.now();
  const ce = options.crossEncoder?.isAvailable() && vectorConfig.enableReranking !== false
    ? await withBudget(
        stageSignal => options.crossEncoder!.rerank(
          query,
          fused.map(item => ({
            id: String(item.repo.id),
            text: buildCrossEncoderDocument(item.repo),
          })),
          stageSignal,
        ),
        CROSS_ENCODER_TIMEOUT_MS,
        signal,
        null,
      ).catch(error => {
        if (isAbortError(error)) throw error;
        logger.warn('vector-search', 'Cross-encoder rerank failed, continuing with fusion order', { error });
        return null;
      })
    : null;
  timingsMs.crossEncoder = Date.now() - ceStarted;
  if (ce && ce.length > 0) {
    crossEncoderUsed = true;
    crossEncoderPartial = ce.length < fused.length;
    ceOrdered = orderByCrossEncoder(fused, ce);
  }

  const llmCandidates = ceOrdered.slice(0, LLM_CANDIDATE_LIMIT);
  let graded: GradedRerankResult | null = null;
  let llmStatus: VectorSearchPipelineResult['diagnostics']['llmStatus'] = 'skipped';
  const llmStarted = Date.now();
  if (
    options.aiService
    && vectorConfig.enableReranking !== false
    && llmCandidates.length >= 3
  ) {
    options.onPhase?.('reranking');
    graded = await withBudget(
      stageSignal => options.aiService!.rerankRepositoriesGraded(
        llmCandidates.map(item => item.repo),
        query,
        analysis,
        stageSignal,
      ),
      LLM_TIMEOUT_MS,
      signal,
      null,
    ).catch(error => {
      if (isAbortError(error)) throw error;
      logger.warn('vector-search', 'Graded LLM rerank failed, continuing with CE/fusion order', { error });
      return null;
    });
    llmStatus = graded?.status ?? 'invalid';
  }
  timingsMs.llm = Date.now() - llmStarted;
  if (signal.aborted) throw abortError();

  const finalCandidates = chooseFinalOrder({
    ceOrdered,
    fused,
    graded,
    topK: vectorConfig.searchTopK ?? 30,
    analysis,
    crossEncoderUsed,
  });
  const finalRepos = finalCandidates.map(item => item.repo);
  const llmSelected = graded?.status === 'complete'
    && finalCandidates.some(item => (graded.grades.get(item.repo.id) || 0) > 0);
  const fallback: VectorSearchPipelineResult['diagnostics']['fallback'] = finalRepos.length === 0
    ? 'empty-guard'
    : llmSelected
      ? 'none'
      : crossEncoderUsed
        ? 'cross-encoder'
        : 'fusion';

  return {
    repositories: finalRepos,
    scoreMap: toSyntheticScoreMap(finalRepos),
    diagnostics: {
      analysisUsed: Boolean(analysis),
      rawDenseCount: rawMatches.length,
      idealDenseCount: idealMatches.length,
      lexicalCount: lexical.length,
      structuredCount: structured.length,
      fusedCount: fused.length,
      crossEncoderUsed,
      crossEncoderPartial,
      llmStatus,
      fallback,
      timingsMs,
    },
  };
}
