import type { EmbeddingConfig, Repository, VectorSearchConfig } from '../types';
import { AIService, isAbortError } from './aiService';
import {
  buildCrossEncoderDocument,
  deriveRepoKind,
  type CrossEncoderReranker,
} from './crossEncoderReranker';
import { logger } from './logger';
import {
  ANALYSIS_TIMEOUT_MS,
  EMBEDDING_TIMEOUT_MS,
  RECALL_TOP_K,
  WORKER_TIMEOUT_MS,
  finishRankedCandidates,
  fuseCandidates,
  hydrateMatches,
  rankStructuredCandidates,
  withBudget,
  type VectorQueryAnalysis,
} from './vectorSearchPipeline';
import {
  buildEmbeddingText,
  type EmbeddingClient,
  type VectorQueryResult,
  type VectorSearchService,
} from './vectorSearchService';

const README_TIMEOUT_MS = 5000;
const FACET_NAMES = ['artifact', 'action', 'domain', 'platform'] as const;
const GENERIC_PROFILE_INTENT = 'software repository';

interface DenseOutcome {
  matches: VectorQueryResult[];
  success: boolean;
  error?: string;
}

export interface RunSimilarRepositoryPipelineOptions {
  source: Repository;
  repositories: Repository[];
  vectorConfig: VectorSearchConfig;
  embeddingConfig: EmbeddingConfig;
  aiService: AIService | null;
  embeddingClient: EmbeddingClient;
  vectorService: VectorSearchService;
  crossEncoder: CrossEncoderReranker | null;
  readmeFetcher?: (
    owner: string,
    repo: string,
    signal?: AbortSignal,
  ) => Promise<string>;
  signal: AbortSignal;
}

export interface SimilarRepositoryPipelineResult {
  repositories: Repository[];
  diagnostics: {
    readmeUsed: boolean;
    analysisUsed: boolean;
    exactDenseCount: number;
    profileDenseCount: number;
    lexicalCount: number;
    structuredCount: number;
    fusedCount: number;
    crossEncoderUsed: boolean;
    crossEncoderPartial: boolean;
    ceQueryFallback: boolean;
    profileSource: 'ai' | 'local';
    llmStatus: 'complete' | 'empty' | 'invalid' | 'skipped';
    fallback: 'none' | 'cross-encoder' | 'fusion' | 'empty-guard';
    timingsMs: Record<string, number>;
  };
}

function abortError(): DOMException {
  return new DOMException('Similar repository search aborted', 'AbortError');
}

function uniqueStrings(values: string[], limit: number, lowercase = false): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const rawValue of values) {
    const value = rawValue.trim();
    const key = (lowercase ? value.toLowerCase() : value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
    if (result.length >= limit) break;
  }
  return result;
}

function sourceDomainText(source: Repository): string {
  return [
    source.description || '',
    source.ai_summary || '',
    source.custom_description || '',
    ...(source.topics || []),
    ...(source.ai_tags || []),
    ...(source.custom_tags || []),
    ...(source.ai_platforms || []),
  ].join(' ');
}

function textContainsTerm(text: string, term: string): boolean {
  const normalizedText = text.toLowerCase();
  const normalizedTerm = term.trim().toLowerCase();
  if (!normalizedTerm) return false;
  if ([...normalizedTerm].some(char => char.charCodeAt(0) > 0x7F)) {
    return normalizedText.includes(normalizedTerm);
  }
  const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i').test(normalizedText);
}

function blockedIdentityTerms(source: Repository): string[] {
  const domainText = sourceDomainText(source);
  return uniqueStrings([
    source.full_name,
    ...(textContainsTerm(domainText, source.owner.login) ? [] : [source.owner.login]),
    ...(textContainsTerm(domainText, source.name) ? [] : [source.name]),
  ], 3);
}

function onlyLanguageOrLicense(value: string, source: Repository): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;
  const domainText = sourceDomainText(source);
  const language = (source.language || '').trim().toLowerCase();
  const license = (source.license || '').trim().toLowerCase();
  return (
    (Boolean(language) && normalized === language && !textContainsTerm(domainText, normalized))
    || (Boolean(license) && normalized === license && !textContainsTerm(domainText, normalized))
  );
}

export function normalizeSimilarityAnalysis(
  analysis: VectorQueryAnalysis,
  source: Repository,
  options: { allowEmptyIdeal?: boolean } = {},
): VectorQueryAnalysis | null {
  const blocked = blockedIdentityTerms(source);
  const isBlocked = (value: string) => blocked.some(term => textContainsTerm(value, term));
  const intent = analysis.intent.trim();
  const idealDescription = analysis.idealDescription.trim();
  if (!intent || (!idealDescription && !options.allowEmptyIdeal)) return null;
  if (isBlocked(intent) || (idealDescription && isBlocked(idealDescription))) return null;

  const normalizeValues = (values: string[], limit: number): string[] => uniqueStrings(
    values.filter(value => !isBlocked(value) && !onlyLanguageOrLicense(value, source)),
    limit,
    true,
  );
  const keywords = normalizeValues(analysis.keywords, 12);
  const highPrecisionTerms = normalizeValues(analysis.highPrecisionTerms, 8);
  const facets = {
    artifact: normalizeValues(analysis.facets.artifact, 6),
    action: normalizeValues(analysis.facets.action, 6),
    domain: normalizeValues(analysis.facets.domain, 6),
    platform: normalizeValues(analysis.facets.platform, 6),
  };
  const lowConfidenceFacets = uniqueStrings(
    analysis.lowConfidenceFacets.filter(
      value => FACET_NAMES.includes(value.trim().toLowerCase() as typeof FACET_NAMES[number]),
    ),
    4,
    true,
  );

  return {
    intent: intent.slice(0, 200),
    keywords,
    idealDescription: idealDescription.slice(0, 600),
    facets,
    highPrecisionTerms,
    lowConfidenceFacets,
  };
}

export function buildLocalSimilarityProfile(source: Repository): VectorQueryAnalysis {
  const artifact = deriveRepoKind(source);
  const tags = uniqueStrings([
    ...(source.topics || []),
    ...(source.ai_tags || []),
    ...(source.custom_tags || []),
  ], 12);
  const platforms = uniqueStrings(source.ai_platforms || [], 6);
  const description = [
    source.custom_description,
    source.ai_summary,
    source.description,
  ].find(value => value?.trim())?.trim() || '';
  const raw: VectorQueryAnalysis = {
    intent: description || (artifact ? `${artifact} repository` : 'software repository'),
    keywords: uniqueStrings([...tags, ...platforms, artifact].filter(Boolean), 12, true),
    idealDescription: description,
    facets: {
      artifact: artifact ? [artifact] : [],
      action: [],
      domain: tags.slice(0, 6),
      platform: platforms,
    },
    highPrecisionTerms: artifact ? [artifact] : [],
    lowConfidenceFacets: [],
  };
  const normalized = normalizeSimilarityAnalysis(raw, source, { allowEmptyIdeal: true });
  if (normalized) return normalized;

  const generic: VectorQueryAnalysis = {
    intent: [artifact, ...tags, ...platforms].filter(Boolean).join(' ') || 'software repository',
    keywords: uniqueStrings([...tags, ...platforms, artifact].filter(Boolean), 12, true),
    idealDescription: artifact ? `A peer ${artifact} repository.` : '',
    facets: {
      artifact: artifact ? [artifact] : [],
      action: [],
      domain: tags.slice(0, 6),
      platform: platforms,
    },
    highPrecisionTerms: artifact ? [artifact] : [],
    lowConfidenceFacets: [],
  };
  return normalizeSimilarityAnalysis(generic, source, { allowEmptyIdeal: true }) || {
    intent: GENERIC_PROFILE_INTENT,
    keywords: [],
    idealDescription: '',
    facets: { artifact: [], action: [], domain: [], platform: [] },
    highPrecisionTerms: [],
    lowConfidenceFacets: [],
  };
}

function hasUsableProfile(analysis: VectorQueryAnalysis): boolean {
  return Boolean(
    analysis.keywords.length > 0
    || analysis.highPrecisionTerms.length > 0
    || Object.values(analysis.facets).some(values => values.length > 0),
  );
}

export function buildSimilarityRerankQuery(
  source: Repository,
  analysis: VectorQueryAnalysis | null,
  readmeExcerpt = '',
): string {
  if (!analysis || !hasUsableProfile(analysis)) {
    const metadata = buildCrossEncoderDocument(source).slice(0, 700);
    const readme = readmeExcerpt.trim().replace(/\s+/g, ' ').slice(0, 900);
    return [metadata, readme && `README: ${readme}`].filter(Boolean).join('\n');
  }
  return [
    analysis.intent,
    analysis.idealDescription,
    analysis.keywords.join(' '),
    ...Object.values(analysis.facets).flat(),
  ].filter(Boolean).join('\n').slice(0, 1200);
}

function buildSimilarityLexicalQuery(analysis: VectorQueryAnalysis): string {
  if (analysis.keywords.length > 0) return analysis.keywords.join(' ');
  return [...analysis.facets.artifact, ...analysis.facets.domain, ...analysis.facets.platform].join(' ');
}

function compactRepoName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isSameOwnerBrandVariant(source: Repository, candidate: Repository): boolean {
  if (source.owner.login.toLowerCase() !== candidate.owner.login.toLowerCase()) return false;
  const sourceName = compactRepoName(source.name);
  const candidateName = compactRepoName(candidate.name);
  return sourceName.length >= 5
    && candidateName.length > sourceName.length
    && candidateName.startsWith(sourceName);
}

function buildEligibleRepositories(
  repositories: Repository[],
  source: Repository,
): Repository[] {
  const sourceFullName = source.full_name.trim().toLowerCase();
  const seen = new Set<string>();
  return repositories.filter(repo => {
    const id = String(repo.id);
    if (
      id === String(source.id)
      || repo.full_name.trim().toLowerCase() === sourceFullName
      || repo.fork === true
      || isSameOwnerBrandVariant(source, repo)
      || seen.has(id)
    ) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message.slice(0, 240)
    : 'Unknown retrieval error';
}

export async function runSimilarRepositoryPipeline(
  options: RunSimilarRepositoryPipelineOptions,
): Promise<SimilarRepositoryPipelineResult> {
  const { source, repositories, vectorConfig, signal } = options;
  if (signal.aborted) throw abortError();

  const timingsMs: Record<string, number> = {};
  const threshold = vectorConfig.searchThreshold ?? 0.35;
  const localProfile = buildLocalSimilarityProfile(source);
  let readme = '';
  let readmeUsed = false;

  if (vectorConfig.indexMode === 'readme' && options.readmeFetcher) {
    const [owner, repo] = source.full_name.split('/');
    if (owner && repo) {
      const started = Date.now();
      let timedOut = false;
      try {
        const fetched = await withBudget(
          stageSignal => options.readmeFetcher!(owner, repo, stageSignal),
          README_TIMEOUT_MS,
          signal,
          '',
          () => { timedOut = true; },
        );
        readme = fetched.trim();
        readmeUsed = Boolean(readme);
        if (timedOut) logger.warn('vector-search', 'Source README fetch timed out; using metadata');
      } catch (error) {
        if (isAbortError(error) || signal.aborted) throw abortError();
        logger.warn('vector-search', 'Source README fetch failed; using metadata', { error });
      } finally {
        timingsMs.readme = Date.now() - started;
      }
    }
  }
  if (signal.aborted) throw abortError();

  const exactText = buildEmbeddingText(
    source,
    readme,
    vectorConfig.readmeMaxChars ?? 6000,
  );
  const recallDense = async (text: string, prefix: 'exact' | 'profile'): Promise<DenseOutcome> => {
    if (!text.trim()) {
      return { matches: [], success: false, error: `${prefix} query text is empty` };
    }
    let embeddingTimedOut = false;
    const embeddingStarted = Date.now();
    try {
      const vectors = await withBudget(
        stageSignal => options.embeddingClient.embed([text], 'query', stageSignal),
        EMBEDDING_TIMEOUT_MS,
        signal,
        [],
        () => { embeddingTimedOut = true; },
      );
      timingsMs[`${prefix}Embedding`] = Date.now() - embeddingStarted;
      if (embeddingTimedOut) {
        return { matches: [], success: false, error: `${prefix} embedding timed out` };
      }
      if (!vectors[0]) {
        return { matches: [], success: false, error: `${prefix} embedding returned no vector` };
      }

      let workerTimedOut = false;
      const workerStarted = Date.now();
      const matches = await withBudget(
        stageSignal => options.vectorService.query(
          vectors[0],
          { topK: RECALL_TOP_K, threshold },
          stageSignal,
        ),
        WORKER_TIMEOUT_MS,
        signal,
        [],
        () => { workerTimedOut = true; },
      );
      timingsMs[`${prefix}Dense`] = Date.now() - workerStarted;
      if (workerTimedOut) {
        return { matches: [], success: false, error: `${prefix} vector query timed out` };
      }
      return { matches, success: true };
    } catch (error) {
      if (isAbortError(error) || signal.aborted) throw abortError();
      logger.warn('vector-search', `${prefix} dense recall failed, continuing`, { error });
      return { matches: [], success: false, error: safeErrorMessage(error) };
    }
  };

  const exactPromise = recallDense(exactText, 'exact');
  void exactPromise.catch(() => undefined);
  const analysisEnabled = Boolean(
    options.aiService
    && (vectorConfig.enableHyDE !== false || vectorConfig.enableReranking !== false),
  );
  const analysisStarted = Date.now();
  const analysisPromise = analysisEnabled
    ? withBudget(
        stageSignal => options.aiService!.analyzeSimilarRepositorySource(
          source,
          readme.slice(0, 3000),
          stageSignal,
        ),
        ANALYSIS_TIMEOUT_MS,
        signal,
        null,
      ).catch(error => {
        if (isAbortError(error) || signal.aborted) throw abortError();
        logger.warn('vector-search', 'Similar source analysis failed; using local profile', { error });
        return null;
      })
    : Promise.resolve(null);

  const rawAnalysis = await analysisPromise;
  timingsMs.analysis = Date.now() - analysisStarted;
  const aiProfile = rawAnalysis
    ? normalizeSimilarityAnalysis(rawAnalysis, source)
    : null;
  const profile = aiProfile || localProfile;
  const profileSource = aiProfile ? 'ai' : 'local';

  const profilePromise = hasUsableProfile(profile)
    && profile.idealDescription
    && vectorConfig.enableHyDE !== false
    ? recallDense(profile.idealDescription, 'profile')
    : Promise.resolve<DenseOutcome>({ matches: [], success: false });
  const [exactOutcome, profileOutcome] = await Promise.all([exactPromise, profilePromise]);
  if (signal.aborted) throw abortError();

  const eligibleRepositories = buildEligibleRepositories(repositories, source);
  const repoById = new Map(eligibleRepositories.map(repo => [String(repo.id), repo]));
  const rawMatches = hydrateMatches(
    exactOutcome.matches,
    repoById,
    { excludeSource: source, excludeForks: true },
  );
  const profileMatches = hydrateMatches(
    profileOutcome.matches,
    repoById,
    { excludeSource: source, excludeForks: true },
  );
  const similarityQueryText = buildSimilarityLexicalQuery(profile);
  const lexical = AIService.rankLexicalCandidates(
    eligibleRepositories,
    similarityQueryText,
    profile.keywords,
    { includePopularity: false },
  ).filter(item => item.score > 0);
  const structured = rankStructuredCandidates(
    eligibleRepositories,
    profile,
    similarityQueryText,
  );
  const fused = fuseCandidates({
    rawMatches,
    idealMatches: profileMatches,
    lexical,
    structured,
    tieBreak: 'similarity',
  }).slice(0, RECALL_TOP_K);

  if (
    fused.length === 0
    && !exactOutcome.success
    && !profileOutcome.success
    && lexical.length === 0
    && structured.length === 0
  ) {
    throw new Error(
      exactOutcome.error || profileOutcome.error || 'Similar repository retrieval failed',
    );
  }

  const profileUsable = hasUsableProfile(profile);
  const ceQueryFallback = !profileUsable;
  const ceQuery = buildSimilarityRerankQuery(
    source,
    profileUsable ? profile : null,
    readme,
  );
  const finished = await finishRankedCandidates({
    fused,
    vectorConfig,
    signal,
    analysis: profileUsable ? profile : null,
    ceQuery,
    crossEncoder: options.crossEncoder,
    rerankCandidates: profileUsable
      && options.aiService
      && vectorConfig.enableReranking !== false
      ? (candidates, _query, rerankAnalysis, stageSignal) => (
          options.aiService!.rerankSimilarRepositoriesGraded(
            source,
            candidates,
            rerankAnalysis,
            stageSignal,
          )
        )
      : null,
    noPositiveGradesPolicy: 'empty',
  });
  Object.assign(timingsMs, finished.diagnostics.timingsMs);

  return {
    repositories: finished.candidates.map(item => item.repo),
    diagnostics: {
      readmeUsed,
      analysisUsed: Boolean(aiProfile),
      exactDenseCount: rawMatches.length,
      profileDenseCount: profileMatches.length,
      lexicalCount: lexical.length,
      structuredCount: structured.length,
      fusedCount: fused.length,
      crossEncoderUsed: finished.diagnostics.crossEncoderUsed,
      crossEncoderPartial: finished.diagnostics.crossEncoderPartial,
      ceQueryFallback,
      profileSource: profileSource as 'ai' | 'local',
      llmStatus: finished.diagnostics.llmStatus,
      fallback: finished.diagnostics.fallback,
      timingsMs,
    },
  };
}
