import type { EmbeddingConfig, Repository } from '../types';
import { NO_LICENSE_SENTINEL, normalizeLicense } from '../utils/licenseFilter';

export interface CrossEncoderResult {
  id: string;
  score: number;
  rank: number;
}

const RERANK_MODEL = 'BAAI/bge-reranker-v2-m3';

function isAbortError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'name' in error
    && (error as { name?: unknown }).name === 'AbortError',
  );
}

/** Derive a small, non-persisted repository kind from existing local metadata. */
export function deriveRepoKind(repo: Repository): string {
  const text = [
    repo.full_name,
    repo.name,
    repo.description || '',
    repo.ai_summary || '',
    ...(repo.topics || []),
    ...(repo.ai_tags || []),
    ...(repo.custom_tags || []),
  ].join(' ').toLowerCase();

  if (/\bawesome[\s-]?list\b|awesome-list|清单/.test(text)) return 'awesome-list';
  if (/\bmcp\b/.test(text)) return 'mcp';
  if (/\bskills?\b|技能/.test(text)) return 'skill';
  if (/\bplugins?\b|插件/.test(text)) return 'plugin';
  if (/\bcli\b|command[\s-]?line|命令行/.test(text)) return 'cli';
  if (/\bdesktop\b|桌面/.test(text)) return 'desktop';
  // "库" alone matches 仓库/数据库 and "类库" matches 分类库; only compound
  // kinds mean a code library.
  if (/\blibrar(?:y|ies)\b|\bsdk\b|(?:函数|组件|工具|依赖)库|(?<!分)类库/.test(text)) return 'library';
  if (/\bweb\b|browser|frontend|网页/.test(text)) return 'web';
  return '';
}

export function buildCrossEncoderDocument(repo: Repository): string {
  const tags = [
    ...(repo.topics || []),
    ...(repo.ai_tags || []),
    ...(repo.custom_tags || []),
    ...(repo.ai_platforms || []),
  ];
  const uniqueTags = [...new Set(tags.map(tag => tag.trim()).filter(Boolean))];
  const description = repo.description || '';
  const summary = repo.ai_summary || '';
  const customDescription = repo.custom_description || '';
  const license = normalizeLicense(repo.license);
  const repoKind = deriveRepoKind(repo);
  const parts = [
    repo.full_name,
    description && `Description: ${description}`,
    summary && (!description || !summary.includes(description)) && `Summary: ${summary}`,
    customDescription && `About: ${customDescription}`,
    uniqueTags.length > 0 && `Tags: ${uniqueTags.join(', ')}`,
    repo.language && `Language: ${repo.language}`,
    license !== NO_LICENSE_SENTINEL && `License: ${license}`,
    repoKind && `Kind: ${repoKind}`,
  ].filter((part): part is string => Boolean(part));
  return parts.join('\n').slice(0, 1200);
}

export class CrossEncoderReranker {
  constructor(private config: EmbeddingConfig) {}

  isAvailable(): boolean {
    return this.config.apiType === 'siliconflow'
      && this.config.baseUrl.trim().length > 0
      && this.config.apiKey.trim().length > 0;
  }

  async rerank(
    query: string,
    documents: Array<{ id: string; text: string }>,
    signal?: AbortSignal,
  ): Promise<CrossEncoderResult[] | null> {
    if (!this.isAvailable() || documents.length === 0) return null;
    if (signal?.aborted) throw new DOMException('Cross-encoder request aborted', 'AbortError');

    try {
      const baseUrl = this.config.baseUrl.trim().replace(/\/+$/, '');
      const response = await fetch(`${baseUrl}/v1/rerank`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: RERANK_MODEL,
          query,
          documents: documents.map(document => document.text),
          top_n: 50,
          return_documents: false,
        }),
        signal,
      });
      if (!response.ok) return null;

      const data = await response.json() as { results?: unknown };
      if (!Array.isArray(data.results) || data.results.length === 0) return null;

      const bestByIndex = new Map<number, number>();
      for (const result of data.results) {
        if (!result || typeof result !== 'object') return null;
        const { index, relevance_score: score } = result as { index?: unknown; relevance_score?: unknown };
        if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= documents.length) return null;
        if (typeof score !== 'number' || !Number.isFinite(score)) return null;
        const previous = bestByIndex.get(index as number);
        if (previous === undefined || score > previous) bestByIndex.set(index as number, score);
      }

      const returned = [...bestByIndex.entries()]
        .sort(([indexA, scoreA], [indexB, scoreB]) => scoreB - scoreA || indexA - indexB)
        .map(([index, score]) => ({
          id: documents[index].id,
          score,
          rank: 0,
        }));
      // Rank only the returned candidates; the pipeline appends the rest in
      // fusion order and needs the returned count to flag a partial rerank.
      returned.forEach((result, index) => { result.rank = index + 1; });
      return returned;
    } catch (error) {
      if (isAbortError(error)) throw error;
      return null;
    }
  }
}
