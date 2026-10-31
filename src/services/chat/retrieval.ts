import type { Repository } from '../../types';
import type { ToolEvidence } from '../../types/repositoryChat';
import { createGitHubApiService } from '../githubApiFactory';
import { createSecureId } from '../../utils/cryptoRandom';

export const MAX_EVIDENCE_EXCERPT_CHARS = 24_000;
/** 小于该长度的文件（代码窗口路径）整文件作为一条证据，避免切片取不全。 */
const WHOLE_DOCUMENT_MAX_CHARS = 24_000;
const README_CANDIDATE = /(^|\/)readme(?:\.[a-z0-9_-]+)?\.(?:md|mdx|markdown|txt)$/i;
export const MARKDOWN_EVIDENCE_PATH = /\.(?:md|mdx|markdown|txt)$/i;
const DOCUMENTATION_MARKDOWN_PATH = /(?:^|\/)(?:docs?|guides?|examples?|architecture|design|reference|adr)(?:\/|$).*\.(?:md|mdx|markdown|txt)$/i;
const LOW_SIGNAL_TEST_PATH = /(^|\/)(?:__tests__|__snapshots__|test|tests|fixtures)(?:\/|$)|\.(?:test|spec)\.[^.]+$|\.snap$/i;
const COMMON_QUERY_TERMS = new Set(['this', 'that', 'with', 'from', 'what', 'how', 'the', 'and', 'for', 'are', 'is', 'repo', 'repository', 'project', 'readme', '实现', '项目', '仓库', '如何', '怎么', '这个', '那个', '一下', '详细']);
export const isCreativeRequest = (question: string): boolean => /(?:公众号|推文|文章|文案|宣传稿|新闻稿|博客|写(?:一篇|个)?(?:文章|推文|文案|宣传稿|新闻稿|博客)|write\s+(?:an?\s+)?(?:article|post|blog)|draft\s+(?:an?\s+)?(?:article|post))/i.test(question);
/**
 * Generates a unique identifier for repository chat turn events and messages.
 *
 * @param prefix - The prefix string for the generated ID.
 * @returns A cryptographically secure unique identifier string.
 */
const createId = (prefix: string): string => createSecureId(prefix);

type ResearchFocus = 'deployment' | 'usage' | 'architecture' | 'implementation' | 'creative' | 'general';
export type TreeEntry = { path: string; type?: string };
const contentHash = (content: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export const splitOwnerAndRepo = (fullName: string): [string, string] => {
  const [owner, ...rest] = fullName.split('/');
  const repo = rest.join('/');
  if (!owner || !repo) throw new Error('Invalid GitHub repository name');
  return [owner, repo];
};

const sourceUrl = (repository: Repository, sha: string, path: string, lineStart: number, lineEnd: number): string => {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return `https://github.com/${repository.full_name}/blob/${sha}/${encodedPath}#L${lineStart}-L${lineEnd}`;
};

export const makeEvidence = (input: Omit<ToolEvidence, 'id' | 'retrievedAt'>): ToolEvidence => ({
  ...input,
  id: createId('evidence'),
  retrievedAt: new Date().toISOString(),
});

const queryTerms = (question: string): string[] => {
  const normalized = question.toLowerCase();
  const directTerms = normalized
    .replace(/[^\p{L}\p{N}_-]+/gu, ' ')
    .split(/\s+/)
    .filter((term) => term.length >= 2 && !COMMON_QUERY_TERMS.has(term));
  const expandedTerms = [
    /(?:部署|发布|上线|deploy|deployment|hosting)/i.test(normalized) ? ['deploy', 'deployment', 'hosting', 'production'] : [],
    /(?:使用|安装|运行|怎么用|usage|install|quickstart|run)/i.test(normalized) ? ['usage', 'install', 'quickstart', 'getting-started', 'run'] : [],
    /(?:向量|语义|相似|vector|semantic|similar)/i.test(normalized) ? ['vector', 'semantic', 'similar', 'search'] : [],
    /(?:架构|系统|组件|architecture|system|component)/i.test(normalized) ? ['architecture', 'system', 'component', 'design'] : [],
  ].flat();
  return Array.from(new Set([...directTerms, ...expandedTerms])).slice(0, 12);
};

export const detectResearchFocus = (question: string): ResearchFocus => {
  const normalized = question.toLowerCase();
  if (isCreativeRequest(question)) return 'creative';
  if (/(?:部署|发布|上线|生产|容器|docker|deploy|deployment|hosting|production|release|vercel|netlify|railway|render|cloudflare|fly(?:\.io)?|secrets?)/i.test(normalized)) return 'deployment';
  // Architecture requests often ask that each fact “uses” a source. Classify their
  // architecture/data-flow intent before the generic Chinese usage keyword so the
  // agent reads design docs and entrypoints rather than install or uninstall guides.
  if (/(?:架构|系统图|数据流|流程|组件|architecture|diagram|data[\s-]?flow|system|component)/i.test(normalized)) return 'architecture';
  if (/(?:怎么用|使用|安装|开始|教程|运行|启动|usage|install|quickstart|get(?:ting)? started|run)/i.test(normalized)) return 'usage';
  if (/(?:实现|代码|函数|模块|接口|how does|where is|implementation|code|function|module|api)/i.test(normalized)) return 'implementation';
  return 'general';
};

const focusTerms = (focus: ResearchFocus): string[] => ({
  deployment: ['deploy', 'deployment', 'production', 'docker', 'compose', 'release', 'hosting', 'publish', '部署', '发布', '上线'],
  usage: ['install', 'usage', 'quickstart', 'getting started', 'run', 'start', '使用', '安装', '运行', '开始'],
  architecture: ['architecture', 'system', 'component', 'design', '架构', '系统', '组件', '设计'],
  implementation: ['implementation', 'api', 'config', 'service', '实现', '接口', '配置', '服务'],
  creative: ['overview', 'architecture', 'feature', 'capability', 'guide', 'readme', '介绍', '架构', '功能', '能力'],
  general: [],
}[focus]);

const scorePath = (path: string, terms: string[], focus: ResearchFocus): number => {
  const normalized = path.toLowerCase();
  const keywordScore = terms.reduce((score, term) => score + (normalized.includes(term) ? 3 : 0), 0);
  const focusScore = focusTerms(focus).reduce((score, term) => score + (normalized.includes(term) ? 5 : 0), 0);
  const readmeScore = README_CANDIDATE.test(path) ? 5 : 0;
  const rootReadmeScore = /^readme(?:\.[a-z0-9_-]+)?\.(?:md|mdx|markdown|txt)$/i.test(path) ? 20 : 0;
  const sourceScore = /^(?:src|app|packages|server)\//.test(normalized) ? 1 : 0;
  const documentationScore = DOCUMENTATION_MARKDOWN_PATH.test(path) ? 12 : 0;
  const deploymentScore = focus === 'deployment'
    ? (/(?:^|\/)(?:dockerfile|docker-compose(?:\.[^/]+)?|compose(?:\.[^/]+)?|procfile|wrangler\.toml|vercel\.json|netlify\.toml|render\.yaml|fly\.toml)$/i.test(path) ? 20 : 0)
      + (/(?:^|\/)(?:docs?|\.github\/workflows)\/.*(?:deploy|deployment|hosting|production|release|publish)/i.test(path) ? 18 : 0)
      + (/^package\.json$/i.test(path) ? 7 : 0)
    : 0;
  const usageScore = focus === 'usage'
    ? (/(?:^|\/)(?:docs?|guides?)\/.*(?:install|usage|quickstart|getting-started|start)/i.test(path) ? 18 : 0)
    : 0;
  const architectureScore = focus === 'architecture'
    ? (/(?:^|\/)(?:docs?|design)\/.*(?:architecture|design|system|overview)/i.test(path) ? 18 : 0)
    : 0;
  const creativeScore = focus === 'creative'
    ? (/(?:^|\/)(?:docs?|guides?|examples?)\/.*(?:architecture|overview|feature|capabilit|guide|intro|a2a|routing)/i.test(path) ? 22 : 0)
      + (README_CANDIDATE.test(path) ? 10 : 0)
    : 0;
  // Prefer canonical repository documentation over translated mirrors while keeping
  // mirrors available when they are the only relevant files.
  const translatedMirrorPenalty = /(?:^|\/)i18n\//i.test(normalized) ? -45 : 0;
  return keywordScore + focusScore + readmeScore + rootReadmeScore + sourceScore + documentationScore + deploymentScore + usageScore + architectureScore + creativeScore + translatedMirrorPenalty;
};

export const isFileEntry = (entry: TreeEntry) => entry.type === 'blob' || entry.type === 'file' || (!entry.type && entry.path.includes('.'));

export const parseJsonObject = (content: string): Record<string, unknown> | null => {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
};

export const buildEvidenceWindows = (content: string, focus: ResearchFocus, terms: string[]): Array<{ lineStart: number; lineEnd: number; excerpt: string }> => {
  const lines = content.split('\n');
  // 质量优先：小文件整文件作为证据窗口，避免代码切片取不全。
  if (content.length <= WHOLE_DOCUMENT_MAX_CHARS) {
    return [{ lineStart: 1, lineEnd: Math.max(1, lines.length), excerpt: content }];
  }

  const keywords = Array.from(new Set([...terms, ...focusTerms(focus)]));
  const scoredLines = lines.map((line, index) => {
    const normalized = line.toLowerCase();
    const matches = keywords.reduce((score, keyword) => score + (normalized.includes(keyword.toLowerCase()) ? 4 : 0), 0);
    const heading = /^\s{0,3}#{1,6}\s+/.test(line) ? 1 : 0;
    return { index, score: matches + heading };
  }).filter((item) => item.score > 0).sort((left, right) => right.score - left.score || left.index - right.index);

  const windows: Array<{ lineStart: number; lineEnd: number; excerpt: string }> = [];
  for (const candidate of scoredLines) {
    if (windows.length >= 4) break;
    const lineStart = Math.max(1, candidate.index + 1 - 24);
    const lineEnd = Math.min(lines.length, candidate.index + 1 + 60);
    const overlaps = windows.some((window) => lineStart <= window.lineEnd && lineEnd >= window.lineStart);
    if (overlaps) continue;
    const excerpt = lines.slice(lineStart - 1, lineEnd).join('\n').slice(0, MAX_EVIDENCE_EXCERPT_CHARS);
    windows.push({ lineStart, lineEnd, excerpt });
  }

  if (windows.length > 0) return windows.sort((left, right) => left.lineStart - right.lineStart);
  const lineEnd = Math.min(lines.length, 240);
  return [{ lineStart: 1, lineEnd, excerpt: lines.slice(0, lineEnd).join('\n').slice(0, MAX_EVIDENCE_EXCERPT_CHARS) }];
};

export const rankedCandidatePaths = (entries: TreeEntry[], question: string, focus: ResearchFocus): string[] => {
  const terms = queryTerms(question);
  const targetsTests = terms.some((term) => /test|spec|snapshot|测试/.test(term));
  return entries
    .filter((entry) => isFileEntry(entry) && (targetsTests || !LOW_SIGNAL_TEST_PATH.test(entry.path)))
    .map((entry) => ({ path: entry.path, score: scorePath(entry.path, terms, focus) }))
    // Keep canonical documentation and repository configuration available even
    // when the user wording has no matching filename keywords.
    .filter((candidate) => candidate.score > 0 || isDocumentationFirstPath(candidate.path))
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .map((candidate) => candidate.path);
};

/**
 * 把候选清单里同目录、同扩展名且数量超过 threshold 的文件折叠成一行
 * `dir/*.md (N files)`，但保留排名最高的 2 个代表路径，规划器仍可点名读取。
 * 输入保持按得分排序；折叠行的位置跟随其首个代表在原清单中的位置。
 */
export const collapseCandidateDirectories = (paths: string[], options: { threshold?: number } = {}): string[] => {
  const threshold = options.threshold ?? 8;
  const groupOf = (path: string): string => {
    const directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
    const dot = path.lastIndexOf('.');
    const extension = dot > path.lastIndexOf('/') ? path.slice(dot + 1).toLowerCase() : '';
    return `${directory}\u0000${extension}`;
  };
  const sizes = new Map<string, number>();
  for (const path of paths) sizes.set(groupOf(path), (sizes.get(groupOf(path)) ?? 0) + 1);
  const collapsed = new Map<string, boolean>();
  const representatives = new Map<string, number>();
  const output: string[] = [];
  for (const path of paths) {
    const group = groupOf(path);
    if ((sizes.get(group) ?? 0) <= threshold) {
      output.push(path);
      continue;
    }
    if (!collapsed.get(group)) {
      collapsed.set(group, true);
      const [directory, extension] = group.split('\u0000');
      output.push(`${directory}*${extension ? `.${extension}` : ''} (${sizes.get(group)} files)`);
    }
    const count = representatives.get(group) ?? 0;
    if (count < 2) {
      representatives.set(group, count + 1);
      output.push(path);
    }
  }
  return output;
};

export const resolveRepositoryChatHeadSha = async (repository: Repository, githubToken: string, signal?: AbortSignal): Promise<string> => {
  const [owner, repo] = splitOwnerAndRepo(repository.full_name);
  const github = createGitHubApiService(githubToken);
  const meta = await github.getRepositoryMeta(owner, repo, signal);
  return await github.getRepositoryHeadSha(owner, repo, meta.defaultBranch, signal);
};

type InformationScope = 'documentation' | 'code' | 'both';
/** meta 指仓库元信息来源（@meta/releases、@meta/issues），由确定性工具读取。 */
export type RetrievalScope = 'documentation' | 'code' | 'meta';
export type EvidenceNextAction = 'retrieve_more' | 'expand_scope' | 'read_code' | 'answer' | 'stop';

export type AnswerRequirementKind = 'explicit' | 'necessary';

export type AnswerRequirement = {
  id: string;
  kind: AnswerRequirementKind;
  text: string;
};

export type QueryUnderstanding = {
  intent: string;
  entities: string[];
  /** A small LLM-derived semantic expansion, not a mechanical keyword dump. */
  searchConcepts: string[];
  likelyDocumentTopics: string[];
  informationScope: InformationScope;
  /** Only these requirements may block an answer. */
  answerRequirements: AnswerRequirement[];
  /** Helpful context that must never trigger another research round. */
  optionalEnrichment: string[];
  initialTargets: string[];
  target: string;
};

export type RetrievalTarget = {
  path: string;
  sections: string[];
  purpose: string;
  scope: RetrievalScope;
};

export type RetrievalPlan = {
  targets: RetrievalTarget[];
  rationale: string;
};

export type RequirementAssessment = {
  requirementId: string;
  requirement: string;
  kind: AnswerRequirementKind;
  status: 'verified' | 'missing' | 'not_applicable';
  evidence: string[];
};

export type EvidenceGate = {
  sufficient: boolean;
  confidence: number;
  reason: string;
  requirements: RequirementAssessment[];
  missing: string[];
  nextAction: EvidenceNextAction;
  recommendedTargets: RetrievalTarget[];
};

type MarkdownHeading = {
  title: string;
  lineStart: number;
  level: number;
};

export type CachedDocument = {
  path: string;
  content: string;
  headings: MarkdownHeading[];
  linkedDocumentationPaths: string[];
};

export const isRepositoryCodePath = (path: string): boolean => /^(?:src|app|server|packages|lib)\/.+\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|rb|php|cs)$/i.test(path)
  && !LOW_SIGNAL_TEST_PATH.test(path);

const isDocumentationFirstPath = (path: string): boolean => README_CANDIDATE.test(path)
  || MARKDOWN_EVIDENCE_PATH.test(path)
  || /^(?:package\.json|pyproject\.toml|go\.mod|cargo\.toml|composer\.json)$/i.test(path)
  || /(?:^|\/)(?:dockerfile|docker-compose(?:\.[^/]+)?|compose(?:\.[^/]+)?|wrangler\.toml|vercel\.json|netlify\.toml|render\.yaml|fly\.toml)$/i.test(path)
  || /^\.github\/workflows\/.*\.(?:ya?ml)$/i.test(path);

const documentationPathPriority = (path: string): number => {
  if (/^readme(?:\.[a-z0-9_-]+)?\.(?:md|mdx|markdown|txt)$/i.test(path)) return 0;
  if (DOCUMENTATION_MARKDOWN_PATH.test(path)) return 1;
  if (README_CANDIDATE.test(path)) return 2;
  if (MARKDOWN_EVIDENCE_PATH.test(path)) return 3;
  return 4;
};

// A root README is the documented entry point. Beyond that first source, retain
// rankedCandidatePaths' semantic order rather than replacing it with path order.
export const documentationCandidatesFrom = (rankedPaths: string[]): string[] => {
  const candidates = Array.from(new Set(rankedPaths.filter(isDocumentationFirstPath)));
  return [
    ...candidates.filter((path) => documentationPathPriority(path) === 0),
    ...candidates.filter((path) => documentationPathPriority(path) !== 0),
  ];
};

export const cleanModelText = (value: unknown, maximum: number): string | null => (
  typeof value === 'string' && value.trim() ? value.trim().slice(0, maximum) : null
);

export const asStringArray = (value: unknown, maximum: number): string[] => Array.isArray(value)
  ? value.map((item) => cleanModelText(item, 160)).filter((item): item is string => Boolean(item)).slice(0, maximum)
  : [];

export const makeAnswerRequirements = (value: unknown, kind: AnswerRequirementKind, maximum: number): AnswerRequirement[] => {
  const seen = new Set<string>();
  return asStringArray(value, maximum).flatMap((text) => {
    const normalized = text.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
    if (!normalized || seen.has(normalized)) return [];
    seen.add(normalized);
    return [{ id: `${kind}-${seen.size}`, kind, text }];
  });
};

const mergeAnswerRequirements = (explicit: AnswerRequirement[], necessary: AnswerRequirement[], fallback: AnswerRequirement[]): AnswerRequirement[] => {
  const seen = new Set<string>();
  const result: AnswerRequirement[] = [];
  for (const requirement of [...explicit, ...necessary]) {
    const normalized = requirement.text.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(requirement);
  }
  return result.length > 0 ? result : fallback;
};

export const normalizePath = (path: string): string => path.trim().replace(/^\/+/, '').replace(/\\/g, '/');

export const parseQueryUnderstanding = (content: string, fallback: QueryUnderstanding, allowedPaths: Set<string>): QueryUnderstanding => {
  const parsed = parseJsonObject(content);
  if (!parsed) return fallback;
  const scope = parsed.information_scope;
  const initialTargets = asStringArray(parsed.initial_targets, 4)
    .map(normalizePath)
    .filter((path) => allowedPaths.has(path));
  const explicitRequirements = makeAnswerRequirements(parsed.explicit_requirements, 'explicit', 4);
  const necessaryRequirements = makeAnswerRequirements(parsed.necessary_requirements, 'necessary', 4);
  // expected_answer is accepted only as a legacy alias and treated as explicit,
  // never as permission to infer further completion criteria.
  const legacyRequirements = explicitRequirements.length === 0 && necessaryRequirements.length === 0
    ? makeAnswerRequirements(parsed.expected_answer, 'explicit', 6)
    : [];
  return {
    intent: cleanModelText(parsed.intent, 80) ?? fallback.intent,
    entities: asStringArray(parsed.entities, 8),
    searchConcepts: asStringArray(parsed.search_concepts, 8),
    likelyDocumentTopics: asStringArray(parsed.likely_document_topics, 8),
    informationScope: scope === 'documentation' || scope === 'code' || scope === 'both' ? scope : fallback.informationScope,
    answerRequirements: mergeAnswerRequirements(explicitRequirements, necessaryRequirements, legacyRequirements.length > 0 ? legacyRequirements : fallback.answerRequirements),
    optionalEnrichment: asStringArray(parsed.optional_enrichment, 6),
    initialTargets: initialTargets.length > 0 ? initialTargets : fallback.initialTargets,
    target: cleanModelText(parsed.target, 240) ?? fallback.target,
  };
};

const normalizeScope = (value: unknown, fallback: RetrievalScope): RetrievalScope => value === 'code' ? 'code' : value === 'documentation' ? 'documentation' : value === 'meta' ? 'meta' : fallback;

export const parseRetrievalTargets = (value: unknown, allowedDocumentation: Set<string>, allowedCode: Set<string>, allowedMeta: Set<string>, fallbackScope: RetrievalScope): RetrievalTarget[] => {
  if (!Array.isArray(value)) return [];
  const targets: RetrievalTarget[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const candidate = item as Record<string, unknown>;
    const path = cleanModelText(candidate.path, 260);
    if (!path) continue;
    const normalizedPath = normalizePath(path);
    const scope = normalizeScope(candidate.scope, fallbackScope);
    const allowed = scope === 'code' ? allowedCode : scope === 'meta' ? allowedMeta : allowedDocumentation;
    if (!allowed.has(normalizedPath)) continue;
    targets.push({
      path: normalizedPath,
      sections: asStringArray(candidate.sections, 6),
      purpose: cleanModelText(candidate.purpose, 180) ?? '',
      scope,
    });
  }
  return targets.slice(0, 4);
};

export const parseRetrievalPlan = (content: string, allowedDocumentation: Set<string>, allowedCode: Set<string>, allowedMeta: Set<string>, fallbackScope: RetrievalScope): RetrievalPlan | null => {
  const parsed = parseJsonObject(content);
  if (!parsed) return null;
  const targets = parseRetrievalTargets(parsed.targets, allowedDocumentation, allowedCode, allowedMeta, fallbackScope);
  return targets.length > 0
    ? { targets, rationale: cleanModelText(parsed.rationale, 260) ?? '' }
    : null;
};

export const makeMarkdownHeadings = (content: string): MarkdownHeading[] => content.split('\n').flatMap((line, index) => {
  const match = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
  return match ? [{ title: match[2].trim(), lineStart: index + 1, level: match[1].length }] : [];
});

export const linkedDocumentationPaths = (content: string, sourcePath: string, documentationSet: Set<string>): string[] => {
  const directory = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/') + 1) : '';
  const linked: string[] = [];
  for (const match of content.matchAll(/\[[^\]]*\]\(([^)#?]+)(?:#[^)]+)?\)/g)) {
    const raw = match[1].trim();
    if (!raw || /^(?:https?:|mailto:|#)/i.test(raw)) continue;
    const resolved = normalizePath(raw.startsWith('/') ? raw.slice(1) : `${directory}${raw.replace(/^\.\//, '')}`);
    if (documentationSet.has(resolved) && !linked.includes(resolved)) linked.push(resolved);
  }
  return linked.slice(0, 12);
};

const collapseHeadingText = (value: string): string => value
  .toLowerCase()
  .replace(/[`*_~#]/g, '')
  .replace(/\s+/g, ' ')
  .replace(/[：:，,。.（）()[\]{}'"！!？?、|/\\-]/g, '')
  .trim();

export const evidenceSearchTerms = (question: string, extras: string[]): string[] => {
  const tokens = [...extras, question]
    .join(' ')
    .split(/[^\p{L}\p{N}_@.-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !/^\d+$/.test(token));
  return Array.from(new Set(tokens.map((token) => token.toLocaleLowerCase())));
};

/** Headingless files cannot be cited through section matching, so use question terms. */
export const citableSegmentsForDocument = (
  document: CachedDocument,
  requestedSections: string[],
  searchTerms: string[],
): Array<{ lineStart: number; lineEnd: number; excerpt: string; label?: string }> => {
  if (document.headings.length > 0) return sectionSegments(document, requestedSections);
  return buildEvidenceWindows(document.content, 'implementation', searchTerms);
};

export const sectionSegments = (document: CachedDocument, requestedSections: string[]): Array<{ lineStart: number; lineEnd: number; excerpt: string; label: string }> => {
  const lines = document.content.split('\n');
  const normalizedRequested = requestedSections.map((section) => collapseHeadingText(section)).filter(Boolean);
  // 归一化容错匹配：大小写、空白与常见标点差异不再导致章节匹配失败。
  const selected = document.headings.filter((heading) => {
    if (normalizedRequested.length === 0) return false;
    const title = collapseHeadingText(heading.title);
    return normalizedRequested.some((requested) => title === requested || title.includes(requested) || requested.includes(title));
  });
  const unique = Array.from(new Map(selected.map((heading) => [heading.lineStart, heading])).values()).slice(0, 6);
  return unique.map((heading) => {
    const next = document.headings.find((candidate) => candidate.lineStart > heading.lineStart && candidate.level <= heading.level);
    const lineEnd = Math.max(heading.lineStart, (next?.lineStart ?? lines.length + 1) - 1);
    return {
      lineStart: heading.lineStart,
      lineEnd,
      excerpt: lines.slice(heading.lineStart - 1, lineEnd).join('\n').slice(0, MAX_EVIDENCE_EXCERPT_CHARS),
      label: heading.title,
    };
  });
};

export const evidenceFromSegments = (repository: Repository, sourceRefSha: string, document: CachedDocument, segments: Array<{ lineStart: number; lineEnd: number; excerpt: string }>): ToolEvidence[] => segments.map((segment) => makeEvidence({
  source: 'github',
  repoFullName: repository.full_name,
  refSha: sourceRefSha,
  path: document.path,
  lineStart: segment.lineStart,
  lineEnd: segment.lineEnd,
  url: sourceUrl(repository, sourceRefSha, document.path, segment.lineStart, segment.lineEnd),
  contentHash: contentHash(document.content),
  excerpt: segment.excerpt,
}));

