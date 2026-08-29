import type { Release, ReleaseAsset, Repository } from '../types';
import type { ToolEvidence } from '../types/repositoryChat';
import { detectAssetPlatform } from '../utils/releaseAssets';

/**
 * 仓库问答的"元信息来源"工具层：Release 资产与 Issue 搜索。
 *
 * 这类来源没有仓库文件那样的固定 SHA 行号，改用「虚拟路径 + 摘要内行号」
 * 表示：每条 Release / Issue 生成一段行结构已知的 Markdown 摘要作为一条
 * ToolEvidence，path 是 release-v1.2.3.md / issue-1234.md 这类虚拟路径，
 * url 指向真实的 GitHub 页面。引用格式（/path - a-b）与校验阶梯因此完全
 * 复用，唯一差别是证据不带 refSha。
 *
 * 摘要由确定性代码生成（不经过模型），编排循环与工具循环共享本模块。
 */

/** 检索计划中的虚拟 meta 目标路径（scope: 'meta'）。 */
export const META_RELEASES_TARGET = '@meta/releases';
export const META_ISSUES_TARGET = '@meta/issues';
export const META_TARGETS = [META_RELEASES_TARGET, META_ISSUES_TARGET] as const;

export type MetaInfoKind = 'releases' | 'issues';

const MAX_RELEASES = 5;
const MAX_RELEASE_NOTES_CHARS = 4_000;
const MAX_ASSET_LINES = 24;
const MAX_ISSUE_RESULTS = 8;
const MAX_ISSUE_BODY_CHARS = 2_500;
const MAX_ISSUE_COMMENT_CHARS = 1_200;
const MAX_ISSUE_COMMENT_LINES = 8;

const createId = (prefix: string): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

// eslint-disable-next-line no-control-regex -- 控制字符清理与 aiService.sanitizeForPrompt 同规则
const sanitize = (value: string): string => value.replace(/\r\n?/g, '\n').replace(/[\0-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

const truncate = (value: string, maxChars: number): string => {
  const text = sanitize(value);
  return text.length > maxChars ? `${text.slice(0, maxChars)}…[truncated]` : text;
};

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 100 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
};

const formatDate = (value: string): string => {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? value : new Date(time).toISOString().slice(0, 10);
};

const contentHash = (content: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const makeMetaEvidence = (repository: Repository, virtualPath: string, url: string, digest: string): ToolEvidence => ({
  id: createId('evidence'),
  source: 'github',
  repoFullName: repository.full_name,
  path: virtualPath,
  lineStart: 1,
  lineEnd: Math.max(1, digest.split('\n').length),
  url,
  contentHash: contentHash(digest),
  excerpt: digest,
  retrievedAt: new Date().toISOString(),
});

const virtualReleasePath = (tag: string): string => `release-${tag.replace(/[^\w.-]+/g, '-')}.md`;
const virtualIssuePath = (number: number): string => `issue-${number}.md`;

/** 单条 Release 的可引用摘要：发布信息、release notes 与带平台标签的资产清单。 */
export const buildReleaseDigest = (release: Pick<Release, 'tag_name' | 'name' | 'body' | 'published_at' | 'html_url' | 'prerelease' | 'assets'>): string => {
  const lines = [
    `# Release ${release.tag_name}${release.name && release.name !== release.tag_name ? ` — ${release.name}` : ''}`,
    `Published: ${formatDate(release.published_at)} | Prerelease: ${release.prerelease ? 'yes' : 'no'}`,
    `URL: ${release.html_url}`,
    '',
    '## Release notes',
    '',
  ];
  const notes = truncate(release.body ?? '(no release notes)', MAX_RELEASE_NOTES_CHARS);
  if (notes.trim()) lines.push(notes, '');
  const assets = (release.assets ?? []) as ReleaseAsset[];
  if (assets.length > 0) {
    lines.push(`## Assets (${assets.length})`, '');
    for (const asset of assets.slice(0, MAX_ASSET_LINES)) {
      const platform = detectAssetPlatform(asset.name, asset.content_type);
      lines.push(`- ${asset.name} (${formatBytes(asset.size)})${platform ? ` [platform: ${platform}]` : ''} — ${asset.download_count} downloads`);
    }
    if (assets.length > MAX_ASSET_LINES) lines.push(`- …and ${assets.length - MAX_ASSET_LINES} more assets`);
  } else {
    lines.push('## Assets', '', '(no build assets attached)');
  }
  return lines.join('\n');
};

export interface IssueSearchHit {
  number: number;
  title: string;
  state: 'open' | 'closed';
  html_url: string;
  body: string;
  comments: number;
  updated_at: string;
  labels: string[];
}

export interface IssueComment {
  user: string;
  createdAt: string;
  body: string;
}

/** 单条 Issue 的可引用摘要：状态、正文与（可选）评论区摘录。 */
export const buildIssueDigest = (issue: IssueSearchHit, comments: IssueComment[] = []): string => {
  const lines = [
    `# Issue #${issue.number}: ${issue.title}`,
    `State: ${issue.state} | Comments: ${issue.comments} | Updated: ${formatDate(issue.updated_at)}`,
    `URL: ${issue.html_url}`,
    issue.labels.length > 0 ? `Labels: ${issue.labels.join(', ')}` : '',
    '',
    '## Body',
    '',
    truncate(issue.body || '(no description)', MAX_ISSUE_BODY_CHARS),
  ].filter((line) => line !== '');
  if (comments.length > 0) {
    lines.push('', '## Comments');
    for (const comment of comments.slice(0, MAX_ISSUE_COMMENT_LINES)) {
      lines.push('', `- ${comment.user} (${formatDate(comment.createdAt)}): ${truncate(comment.body, MAX_ISSUE_COMMENT_CHARS)}`);
    }
  }
  return lines.join('\n');
};

/** 一批 Release 摘要证据；按规范化后的虚拟路径去重，避免不同 tag 归一化后冲突。 */
export const buildReleasesEvidence = (repository: Repository, releases: Array<Pick<Release, 'tag_name' | 'name' | 'body' | 'published_at' | 'html_url' | 'prerelease' | 'assets'>>): ToolEvidence[] => {
  const seenPaths = new Set<string>();
  return releases.slice(0, MAX_RELEASES).flatMap((release) => {
    const tag = release.tag_name || `unknown-${seenPaths.size + 1}`;
    const virtualPath = virtualReleasePath(tag);
    if (seenPaths.has(virtualPath)) return [];
    seenPaths.add(virtualPath);
    return [makeMetaEvidence(repository, virtualPath, release.html_url, buildReleaseDigest(release))];
  });
};

/** 搜索命中 + 可选的评论摘录（commentThreads 与 Issue.comments 计数字段区分开）。 */
export type IssueHitWithComments = IssueSearchHit & { commentThreads?: IssueComment[] };

/** 一批 Issue 摘要证据（评论已由调用方按需抓取）。 */
export const buildIssuesEvidence = (repository: Repository, issues: IssueHitWithComments[]): ToolEvidence[] => issues
  .slice(0, MAX_ISSUE_RESULTS)
  .map((issue) => makeMetaEvidence(repository, virtualIssuePath(issue.number), issue.html_url, buildIssueDigest(issue, issue.commentThreads ?? [])));

/** 仓库没有任何 Release 时的事实性证据（让"没发过版"成为可引用结论）。 */
export const buildNoReleasesEvidence = (repository: Repository, checkedAt: Date): ToolEvidence => makeMetaEvidence(
  repository,
  'releases-empty.md',
  `https://github.com/${repository.full_name}/releases`,
  [
    `# Releases`,
    `The GitHub API returned no published releases for ${repository.full_name} (checked at ${checkedAt.toISOString()}).`,
  ].join('\n'),
);

/** Issue 搜索无命中时的事实性证据。 */
export const buildNoIssuesEvidence = (repository: Repository, keywords: string[], checkedAt: Date): ToolEvidence => makeMetaEvidence(
  repository,
  'issues-search-empty.md',
  `https://github.com/${repository.full_name}/issues`,
  [
    '# Issue search',
    `No repository issues matched the search keywords: ${keywords.join(', ') || '(none)'} (checked at ${checkedAt.toISOString()}).`,
  ].join('\n'),
);

/**
 * 确定性 meta 意图识别（安全网）：识别"最近更新 / 构建包 / 疑难排查"三类
 * 表述。检索规划器提出 meta 目标是主路径；文档停滞时该信号用于自动解锁，
 * 保证三类场景在 quick 档（仅 2 轮）也能覆盖。
 */
export const detectMetaIntent = (question: string): MetaInfoKind[] => {
  const normalized = question.toLowerCase();
  const kinds: MetaInfoKind[] = [];
  if (/(?:最近|最新|更新了|更新日志|变更|新版本|版本历史|what'?s new|changelog|recent(?:ly)?\s+(?:update|release|change)|latest\s+(?:release|update|version)|release\s+notes?)/i.test(normalized)) kinds.push('releases');
  if (/(?:构建包|安装包|安装文件|安装介质|哪些平台|什么平台|平台.*(?:构建|包|下载)|下载.*(?:包|文件)|binar|artifact|installer|build\s*packages?|prebuilt|download\s+(?:page|link|asset)|which\s+platforms?)/i.test(normalized)) kinds.push('releases');
  if (/(?:报错|出错|错误|异常|崩溃|闪退|无法|失败|遇到.{0,8}问题|疑难|已知问题|bug|crash|broken|error|fail(?:ed|ure)?|not\s+work|issue\s+with|troubleshoot|doesn'?t\s+work)/i.test(normalized)) kinds.push('issues');
  return kinds;
};

/** meta 意图 → 虚拟目标路径。 */
export const metaTargetForKind = (kind: MetaInfoKind): string => (kind === 'releases' ? META_RELEASES_TARGET : META_ISSUES_TARGET);
