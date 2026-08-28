import type { ToolEvidence } from '../../../types/repositoryChat';

/**
 * 仓库问答引用的统一解析与展示工具。
 * 引用由服务端 formatSourceReference 生成：`/path - 12` 或 `/path - 12-34`。
 */

export interface ParsedCitation {
  path: string;
  lineStart: number;
  lineEnd: number;
}

const CITATION_DASH_PATTERN = /^\/?([^\s`]+?)\s+-\s+(\d+)(?:\s*-\s*(\d+))?$/;
const CITATION_COLON_PATTERN = /^\/?([^\s`]+?):(\d+)(?:-(\d+))?$/;

/** 解析一段行内 code 文本是否为 file:line 引用；路径必须包含 / 或 . 以避免误伤命令。 */
export const parseCitationToken = (raw: string): ParsedCitation | null => {
  const token = raw.trim();
  if (!token || !/[./]/.test(token)) return null;
  // 带协议的 URL（如 https://example.com:8080）与主机:端口不是文件引用，
  // 否则 stripCitationsForCopy 会把常见 URL 行内代码误删。
  if (token.includes('://')) return null;
  const dashMatch = CITATION_DASH_PATTERN.exec(token);
  if (dashMatch) {
    const [, path, start, end] = dashMatch;
    const lineStart = Number(start);
    const lineEnd = Number(end ?? start);
    if (!path || !Number.isFinite(lineStart) || !Number.isFinite(lineEnd)) return null;
    return { path: path.replace(/\/+$/, ''), lineStart, lineEnd: Math.max(lineStart, lineEnd) };
  }
  const colonMatch = CITATION_COLON_PATTERN.exec(token);
  if (colonMatch) {
    const [, path, start, end] = colonMatch;
    // path 段内再出现 ":" 即为 URL/主机:端口形态（如 example.com:8080），排除。
    if (!path || path.includes(':')) return null;
    const lineStart = Number(start);
    const lineEnd = Number(end ?? start);
    if (!Number.isFinite(lineStart) || !Number.isFinite(lineEnd)) return null;
    return { path: path.replace(/\/+$/, ''), lineStart, lineEnd: Math.max(lineStart, lineEnd) };
  }
  return null;
};

const normalizeEvidencePath = (path: string): string => path.replace(/^\/+/, '');

/** 把行内引用匹配到本轮证据：路径精确 + 行区间重叠优先（取最精确区间），其次路径相同，再次路径后缀匹配。 */
export const resolveCitation = (raw: string, evidences: ToolEvidence[]): ToolEvidence | null => {
  const parsed = parseCitationToken(raw);
  if (!parsed || evidences.length === 0) return null;
  const path = normalizeEvidencePath(parsed.path);
  const withPath = evidences.filter((evidence): evidence is ToolEvidence & { path: string } => Boolean(evidence.path));
  const lineSpan = (evidence: ToolEvidence & { path: string }): number => (evidence.lineEnd ?? evidence.lineStart ?? 1) - (evidence.lineStart ?? 1) + 1;
  const overlaps = (evidence: ToolEvidence & { path: string }): boolean => {
    const evidenceStart = evidence.lineStart ?? 1;
    const evidenceEnd = evidence.lineEnd ?? evidenceStart;
    return evidenceStart <= parsed.lineEnd && evidenceEnd >= parsed.lineStart;
  };
  const mostSpecific = (candidates: Array<ToolEvidence & { path: string }>): ToolEvidence | undefined => (
    [...candidates].sort((left, right) => lineSpan(left) - lineSpan(right))[0]
  );
  const samePath = withPath.filter((evidence) => normalizeEvidencePath(evidence.path) === path);
  const suffixMatch = withPath.filter((evidence) => {
    const evidencePath = normalizeEvidencePath(evidence.path);
    return evidencePath !== path && (evidencePath.endsWith(`/${path}`) || path.endsWith(`/${evidencePath}`));
  });
  const candidates = [
    mostSpecific(samePath.filter(overlaps)),
    mostSpecific(samePath),
    mostSpecific(suffixMatch.filter(overlaps)),
    mostSpecific(suffixMatch),
  ];
  return candidates.find((candidate): candidate is ToolEvidence & { path: string } => Boolean(candidate)) ?? null;
};

/** 引用 Badge 的展示文案：path:L12-L34（单行时省略区间）。 */
export const citationBadgeLabel = (path: string, lineStart: number, lineEnd: number): string => {
  const shortPath = path.split('/').pop() || path;
  return lineEnd > lineStart ? `${shortPath}:L${lineStart}-L${lineEnd}` : `${shortPath}:L${lineStart}`;
};

/** 悬浮预览的原文切片（截断到 ~600 字符）。 */
export const citationExcerptPreview = (excerpt: string, maxChars = 600): string => {
  const trimmed = excerpt.trim();
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}…` : trimmed;
};

/** 悬停与点击共用的跳转地址：补齐 #L 锚点（GitHub blob URL 固定 commit SHA）。 */
export const citationAnchorUrl = (evidence: ToolEvidence): string => {
  if (!evidence.path || !evidence.lineStart || /#L\d+/.test(evidence.url)) return evidence.url;
  const lineEnd = evidence.lineEnd && evidence.lineEnd !== evidence.lineStart ? `-L${evidence.lineEnd}` : '';
  return `${evidence.url}#L${evidence.lineStart}${lineEnd}`;
};

/**
 * 复制最终回答时剔除行内引用 code span（`` `/path - 12-34` ``），不影响代码块
 * 与普通行内代码。逐行处理并跟踪围栏代码块状态；删除点两侧的空白合并为一个空格。
 */
export const stripCitationsForCopy = (content: string): string => {
  const lines = content.split('\n');
  let inFence = false;
  const cleaned = lines.map((line) => {
    if (/^\s{0,3}(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;
    return line.replace(/([ \t]?)`([^`\n]+)`([ \t]?)/g, (whole, before: string, token: string, after: string) => {
      if (!parseCitationToken(token)) return whole;
      if (before && after) return ' ';
      return before || after || '';
    }).replace(/[ \t]+$/, '');
  });
  return cleaned.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};
