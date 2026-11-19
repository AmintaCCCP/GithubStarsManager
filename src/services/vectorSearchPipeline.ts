import type { EmbeddingConfig, Repository, VectorSearchConfig } from '../types';
import { AIService, isAbortError } from './aiService';
import {
  parseAccountScopedVectorId,
  type EmbeddingClient,
  type VectorQueryResult,
  type VectorSearchService,
} from './vectorSearchService';
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
    denseSkipReason?: DenseQueryScopeResolution['reason'];
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

export const ANALYSIS_TIMEOUT_MS = 3500;
export const EMBEDDING_TIMEOUT_MS = 5000;
export const WORKER_TIMEOUT_MS = 4000;
export const CROSS_ENCODER_TIMEOUT_MS = 3000;
export const LLM_TIMEOUT_MS = 8000;

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
  onTimeout?: () => void,
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
      onTimeout?.();
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

// 会话级去重：buildRepoIndex 每次搜索都会执行，同一重复 id 整个会话只记录一次 debug。
const reportedDuplicateIds = new Set<string>();

function buildRepoIndex(repositories: Repository[]): Map<string, Repository> {
  const repoById = new Map<string, Repository>();
  for (const repo of repositories) {
    const id = String(repo.id);
    if (repoById.has(id)) {
      if (!reportedDuplicateIds.has(id)) {
        reportedDuplicateIds.add(id);
        logger.debug('vector-search', 'Duplicate local repository ID ignored', { id });
      }
      continue;
    }
    repoById.set(id, repo);
  }
  return repoById;
}

/**
 * 查询侧的账号隔离范围（R4 审计修复）：多账号共享同一向量索引，命中必须
 * 按归属账号过滤后才能参与召回，防止其他账号的向量（ai_tags/license 等
 * metadata 与 embedding 内容）经同一仓库 ID 串入当前账号的搜索结果。
 */
export interface VectorAccountIdScope {
  /** 当前活跃账号（GitHub 数值 ID 字符串） */
  accountId: string;
  /**
   * 保留兼容字段（不再据此推断 legacy 归属）。
   */
  multiAccount: boolean;
  /**
   * 仅当独立确认旧无前缀索引专属于当前账号时才传 true；
   * 否则 hydrateMatches 与未就绪索引的降级查询均拒绝无归属 legacy 向量。
   */
  allowLegacyUnscoped?: boolean;
}

export interface DenseQueryScopeResolution {
  skip: boolean;
  accountId?: string;
  /**
   * 跳过原因（R2-C26）：Worker 不支持账号筛选、状态请求失败、或索引确实需要
   * 回填（账号元数据未建立）。调用方按原因给出不同提示，只有回填场景才建议
   * 重建索引。
   */
  reason?: 'worker-unsupported' | 'metadata-index-not-ready' | 'status-failed' | 'needs-backfill';
}

/**
 * 解析稠密向量查询的账号隔离策略：
 * - 无 accountIdScope（旧调用方/测试）时不过滤；
 * - 若 vectorService 提供 getStatus，必须确认 accountScopedCleanup===true（即
 *   Worker 已建立 accountId 元数据索引并回填）后才下发 accountId 过滤；
 * - 索引未就绪时：若未明确确认 allowLegacyUnscoped，则跳过稠密召回（避免
 *   Worker 400 或无过滤召回串入其他账号），否则走无 accountId 的兼容查询。
 *
 * R2-C23 实现选择：绝不以「本机只有一个已保存账号」推断无范围 legacy 向量
 * 的归属（共享索引可能仍有其他设备/旧客户端上传的向量）。单账号的稠密召回
 * 兼容通过 EMBEDDING_FORMAT_VERSION 升级触发的完整重建满足（重建后向量携带
 * accountId 元数据，/status 的 accountScopedCleanup 随之可用）；显式兼容
 * 开关只在索引归属已被独立确认时由调用方传入 allowLegacyUnscoped=true。
 */
export async function resolveDenseQueryAccountScope(
  vectorService: Pick<VectorSearchService, 'query'> & Partial<Pick<VectorSearchService, 'getStatus'>>,
  accountIdScope: VectorAccountIdScope | undefined,
  signal: AbortSignal,
): Promise<DenseQueryScopeResolution> {
  if (!accountIdScope) return { skip: false };
  if (typeof vectorService.getStatus !== 'function') {
    return { skip: false, accountId: accountIdScope.accountId };
  }
  try {
    const status = await withBudget<{ accountScopedCleanup?: boolean } | null>(
      (stageSignal) => vectorService.getStatus!(stageSignal),
      WORKER_TIMEOUT_MS,
      signal,
      null,
    );
    if (status?.accountScopedCleanup === true) {
      return { skip: false, accountId: accountIdScope.accountId };
    }
    if (accountIdScope.allowLegacyUnscoped) {
      return { skip: false };
    }
    // R2-C26：状态探测本身失败（null）与 Worker 明确不支持账号筛选必须区分；
    // 前者提示稍后重试，后者提示部署新版 Worker，只有确认需要回填才提示重建。
    if (!status) {
      return { skip: true, reason: 'status-failed' };
    }
    if (status.accountScopedCleanup === false) {
      return { skip: true, reason: 'metadata-index-not-ready' };
    }
    return { skip: true, reason: 'worker-unsupported' };
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (accountIdScope.allowLegacyUnscoped) return { skip: false };
    // R2-C26：状态请求失败是暂时性错误，不应提示用户重建索引。
    return { skip: true, reason: 'status-failed' };
  }
}

export function hydrateMatches(
  matches: VectorQueryResult[],
  repoById: Map<string, Repository>,
  options: {
    excludeSource?: Repository;
    excludeForks?: boolean;
    accountIdScope?: VectorAccountIdScope;
  } = {},
): RankedChannel[] {
  const best = new Map<string, { repo: Repository; score: number }>();
  const sourceId = options.excludeSource ? String(options.excludeSource.id) : '';
  const sourceFullName = options.excludeSource?.full_name.trim().toLowerCase() || '';
  matches.forEach((match) => {
    // 向量 ID 带账号前缀（accountId:repoId）：剥离前缀前先核对归属与元数据一致性。
    const { accountId: prefixAccountId, repoId } = parseAccountScopedVectorId(String(match.id));
    const scope = options.accountIdScope;
    let lookupId = String(match.id);
    if (scope) {
      const matchAccountId = match.metadata?.accountId;
      if (prefixAccountId) {
        if (prefixAccountId !== scope.accountId) return;
        if (matchAccountId && matchAccountId !== prefixAccountId) return;
        // 归属已确认：剥离前缀后按本地仓库 ID 查找
        lookupId = repoId;
      } else if (matchAccountId) {
        if (matchAccountId !== scope.accountId) return;
      } else if (!scope.allowLegacyUnscoped) {
        return;
      }
    }
    // 审计修复（C13）：无 accountIdScope 时保留原始向量 ID 查找——绝不能先剥
    // 前缀再跳过归属检查，否则账号 8 的「8:42」向量会命中本地仓库 42 并影响
    // 其排名（带前缀的原始 ID 不在本地索引中，自然无法水合）。
    const repo = repoById.get(lookupId);
    if (!repo || !Number.isFinite(match.score) || match.score <= 0) return;
    const id = String(repo.id);
    if (
      id === sourceId
      || (sourceFullName && repo.full_name.trim().toLowerCase() === sourceFullName)
      || (options.excludeForks && repo.fork === true)
    ) {
      return;
    }
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
  tieBreak?: 'default' | 'similarity';
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

  return [...byId.values()].sort((a, b) => {
    const similarityTieBreak = input.tieBreak === 'similarity'
      ? a.repo.full_name.localeCompare(b.repo.full_name)
      : 0;
    return b.fusedScore - a.fusedScore
      || b.lexicalScore - a.lexicalScore
      || b.structuredScore - a.structuredScore
      || (input.tieBreak === 'similarity'
        ? similarityTieBreak
        : (b.repo.stargazers_count || 0) - (a.repo.stargazers_count || 0))
      || a.repo.id - b.repo.id;
  });
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
  noPositiveGradesPolicy?: 'fallback' | 'empty';
}): FusedCandidate[] {
  const { ceOrdered, fused, graded, analysis, crossEncoderUsed } = options;
  const baseOrder = crossEncoderUsed ? ceOrdered : fused;
  const noPositiveGradesPolicy = options.noPositiveGradesPolicy ?? 'fallback';

  if (graded?.status === 'complete') {
    const ordered = orderByGrades(baseOrder, graded.grades);
    if (ordered.length > 0) return ordered.slice(0, options.topK);
    if (noPositiveGradesPolicy === 'empty') return [];
    if (crossEncoderUsed) return ceOrdered.slice(0, Math.min(options.topK, 10));
    return fused.some(item => hasStrongEvidence(item, analysis))
      ? fused.slice(0, Math.min(5, options.topK))
      : [];
  }

  if (graded?.status === 'empty') {
    if (noPositiveGradesPolicy === 'empty') return [];
    if (crossEncoderUsed) return ceOrdered.slice(0, Math.min(options.topK, 10));
    return fused.some(item => hasStrongEvidence(item, analysis))
      ? fused.slice(0, Math.min(5, options.topK))
      : [];
  }

  if (crossEncoderUsed) return ceOrdered.slice(0, options.topK);
  return applyRelativeCutoff(fused, options.topK);
}

export interface FinishRankedCandidatesOptions {
  fused: FusedCandidate[];
  vectorConfig: VectorSearchConfig;
  signal: AbortSignal;
  analysis: VectorQueryAnalysis | null;
  ceQuery: string;
  crossEncoder: CrossEncoderReranker | null;
  rerankCandidates: ((
    candidates: Repository[],
    query: string,
    analysis: VectorQueryAnalysis | null,
    signal: AbortSignal,
  ) => Promise<GradedRerankResult | null>) | null;
  noPositiveGradesPolicy?: 'fallback' | 'empty';
  onPhase?: (phase: 'reranking') => void;
}

export interface FinishRankedCandidatesResult {
  candidates: FusedCandidate[];
  diagnostics: Pick<
    VectorSearchPipelineResult['diagnostics'],
    'crossEncoderUsed' | 'crossEncoderPartial' | 'llmStatus' | 'fallback'
  > & {
    timingsMs: Pick<
      VectorSearchPipelineResult['diagnostics']['timingsMs'],
      'crossEncoder' | 'llm'
    >;
  };
}

export async function finishRankedCandidates(
  options: FinishRankedCandidatesOptions,
): Promise<FinishRankedCandidatesResult> {
  const { fused, vectorConfig, signal, analysis } = options;
  let crossEncoderUsed = false;
  let crossEncoderPartial = false;
  let ceOrdered = fused;
  const timingsMs: FinishRankedCandidatesResult['diagnostics']['timingsMs'] = {};

  const ceStarted = Date.now();
  const ce = options.crossEncoder?.isAvailable() && vectorConfig.enableReranking !== false
    ? await withBudget(
        stageSignal => options.crossEncoder!.rerank(
          options.ceQuery,
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
    options.rerankCandidates
    && vectorConfig.enableReranking !== false
    && llmCandidates.length >= 3
  ) {
    options.onPhase?.('reranking');
    graded = await withBudget(
      stageSignal => options.rerankCandidates!(
        llmCandidates.map(item => item.repo),
        options.ceQuery,
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

  const candidates = chooseFinalOrder({
    ceOrdered,
    fused,
    graded,
    topK: vectorConfig.searchTopK ?? 30,
    analysis,
    crossEncoderUsed,
    noPositiveGradesPolicy: options.noPositiveGradesPolicy,
  });
  const llmSelected = graded?.status === 'complete'
    && candidates.some(item => (graded.grades.get(item.repo.id) || 0) > 0);
  const fallback: VectorSearchPipelineResult['diagnostics']['fallback'] = candidates.length === 0
    ? 'empty-guard'
    : llmSelected
      ? 'none'
      : crossEncoderUsed
        ? 'cross-encoder'
        : 'fusion';

  return {
    candidates,
    diagnostics: {
      crossEncoderUsed,
      crossEncoderPartial,
      llmStatus,
      fallback,
      timingsMs,
    },
  };
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
  /** 密集召回被跳过时回调（含无候选回退关键词搜索场景），便于界面向用户提示原因。 */
  onDenseSkipped?: (reason: NonNullable<DenseQueryScopeResolution['reason']>) => void;
  /**
   * 账号隔离范围（R4 审计修复）：多账号共享向量索引时按归属账号过滤命中；
   * 缺省（未登录边缘态）不过滤，保持既有行为。
   */
  accountIdScope?: VectorAccountIdScope;
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

  // 审计修复（C14）：共享 /status 检查仅在任一路取得有效查询向量后才启动并
  // 等待（惰性 memo，每次搜索最多决议一次，exact 与 ideal 两路共享结果）；
  // 两路嵌入皆空（关 HyDE 且原始嵌入为空）时直接继续本地召回，绝不等待
  // 最长 4 秒的 Worker 状态超时。
  let denseScopePromise: Promise<DenseQueryScopeResolution> | null = null;
  let denseSkipReason: DenseQueryScopeResolution['reason'] | undefined;
  let denseSkipNotified = false;
  const ensureDenseScope = (): Promise<DenseQueryScopeResolution> => {
    if (!denseScopePromise) {
      denseScopePromise = resolveDenseQueryAccountScope(options.vectorService, options.accountIdScope, signal)
        .then((scope) => {
          if (scope.skip && !denseSkipNotified) {
            denseSkipNotified = true;
            denseSkipReason = scope.reason ?? 'needs-backfill';
            options.onDenseSkipped?.(denseSkipReason);
          }
          return scope;
        });
    }
    return denseScopePromise;
  };

  let rawDenseStarted = 0;
  const rawDensePromise = rawEmbeddingPromise
    .then((vectors) => {
      if (!vectors[0]) return [];
      return ensureDenseScope().then((denseScope) => {
        if (denseScope.skip) return [];
        rawDenseStarted = Date.now();
        return withBudget(
          stageSignal => options.vectorService.query(
            vectors[0],
            {
              topK: RECALL_TOP_K,
              threshold,
              ...(denseScope.accountId ? { accountId: denseScope.accountId } : {}),
            },
            stageSignal,
          ),
          WORKER_TIMEOUT_MS,
          signal,
          [],
        );
      });
    })
    .finally(() => {
      if (rawDenseStarted) timingsMs.rawDense = Date.now() - rawDenseStarted;
    })
    .catch(error => {
      if (isAbortError(error)) throw error;
      logger.warn('vector-search', 'Raw embedding or dense recall failed, continuing without it', { error });
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
        .then(async (vectors) => {
          if (!vectors[0]) return [];
          // C14：仅在该路取得有效查询向量后才启动/等待共享 /status 检查
          const denseScope = await ensureDenseScope();
          if (denseScope.skip) return [];
          const started = Date.now();
          return withBudget(
            stageSignal => options.vectorService.query(
              vectors[0],
              {
                topK: RECALL_TOP_K,
                threshold,
                ...(denseScope.accountId ? { accountId: denseScope.accountId } : {}),
              },
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
          logger.warn('vector-search', 'Ideal embedding or dense recall failed, continuing without it', { error });
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
  const rawMatches = hydrateMatches(rawMatchResults, repoById, { accountIdScope: options.accountIdScope });
  const idealMatches = hydrateMatches(idealMatchResults, repoById, { accountIdScope: options.accountIdScope });
  const lexical = AIService.rankLexicalCandidates(repositories, query, analysis?.keywords ?? [])
    .filter(item => item.score > 0);
  const structured = rankStructuredCandidates(repositories, analysis, query);
  const fused = fuseCandidates({ rawMatches, idealMatches, lexical, structured })
    .slice(0, RECALL_TOP_K);
  if (fused.length === 0) return null;

  const finished = await finishRankedCandidates({
    fused,
    vectorConfig,
    signal,
    analysis,
    ceQuery: query,
    crossEncoder: options.crossEncoder,
    rerankCandidates: options.aiService
      ? (candidates, ignoredQuery, rerankAnalysis, stageSignal) => (
          options.aiService!.rerankRepositoriesGraded(
            candidates,
            ignoredQuery,
            rerankAnalysis,
            stageSignal,
          )
        )
      : null,
    onPhase: options.onPhase,
  });
  timingsMs.crossEncoder = finished.diagnostics.timingsMs.crossEncoder;
  timingsMs.llm = finished.diagnostics.timingsMs.llm;
  const finalCandidates = finished.candidates;
  const finalRepos = finalCandidates.map(item => item.repo);

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
      ...(denseSkipReason ? { denseSkipReason } : {}),
      ...finished.diagnostics,
      timingsMs,
    },
  };
}
