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

// 分隔符容差：模型会输出 `-`、全角/半角破折号（—–）；行区间后可跟 `、397-481`
// 形式的补充区间（解析时忽略，Badge 只链接第一段）。
const CITATION_DASH_PATTERN = /^(.+?)\s*[-—–]\s+(\d+)(?:\s*-\s*(\d+))?(?:\s*[、,]\s*\d+(?:\s*-\s*\d+)?)*$/;
const CITATION_COLON_PATTERN = /^\/?([^\s`]+?):(\d+)(?:-(\d+))?$/;
/** 常见源码/文档扩展名，用于把 file:line 与 host:port 区分开。 */
const SOURCE_FILE_EXT = /\.(?:md|mdx|markdown|txt|ts|tsx|js|jsx|mjs|cjs|json|ya?ml|toml|sh|bash|zsh|py|go|rs|java|kt|rb|php|cs|html?|css|scss|less|sql|vue|svelte|c|cpp|cc|h|hpp|swift|dart|lua|scala|ex|exs|erl|clj|groovy|ini|cfg|conf|env|properties|gradle|lock)$/i;
/** 无扩展名的仓库特殊文件。 */
const SOURCE_FILE_NAME = /^(?:dockerfile|makefile|license|procfile|jenkinsfile|vagrantfile|cmakelists\.txt)$/i;

const isSourceLikePath = (path: string): boolean => {
  // 仓库绝对路径（/docs/...、/src/...）直接放行。
  if (path.startsWith('/')) return true;
  // 相对路径只认末段有源码/文档扩展名或特殊文件名的形态，
  // 避免 example.com/api:8080、example.com/api - 8080 这类 host:port/URL 被当成引用。
  const lastSegment = path.split('/').pop() ?? path;
  return SOURCE_FILE_EXT.test(lastSegment) || SOURCE_FILE_NAME.test(lastSegment);
};

/** 解析一段行内 code 文本是否为 file:line 引用；路径必须包含 / 或 . 以避免误伤命令。 */
export const parseCitationToken = (raw: string): ParsedCitation | null => {
  // 前缀容差：模型会输出 `/path`、`//path` 甚至是 `/ /path`（斜杠后带空格）。
  const token = raw.trim().replace(/^(?:\/|\s)+/, '/');
  if (!token || !/[./]/.test(token)) return null;
  // 带协议的 URL（如 https://example.com:8080）与主机:端口不是文件引用，
  // 否则 stripCitationsForCopy 会把常见 URL 行内代码误删。
  if (token.includes('://')) return null;
  const dashMatch = CITATION_DASH_PATTERN.exec(token);
  if (dashMatch) {
    const [, rawPath, start, end] = dashMatch;
    // 前导斜杠已在前缀归一化时收拢；这里按相对路径做源文件判定，
    // example.com - 8080 这类 host:port 仍然会被扩展名守卫拒绝。
    const path = rawPath.trim().replace(/^\/+/, '').replace(/\/+$/, '');
    const lineStart = Number(start);
    const lineEnd = Number(end ?? start);
    if (!path || !isSourceLikePath(path) || !Number.isFinite(lineStart) || !Number.isFinite(lineEnd)) return null;
    return { path, lineStart, lineEnd: Math.max(lineStart, lineEnd) };
  }
  const colonMatch = CITATION_COLON_PATTERN.exec(token);
  if (colonMatch) {
    const [, path, start, end] = colonMatch;
    // path 段内再出现 ":" 即为 URL/主机:端口形态（如 example.com:8080），排除。
    if (!path || path.includes(':') || !isSourceLikePath(path)) return null;
    const lineStart = Number(start);
    const lineEnd = Number(end ?? start);
    if (!Number.isFinite(lineStart) || !Number.isFinite(lineEnd)) return null;
    return { path: path.replace(/\/+$/, ''), lineStart, lineEnd: Math.max(lineStart, lineEnd) };
  }
  return null;
};

const normalizeEvidencePath = (path: string): string => path.replace(/^\/+/, '');

/** resolveCitation 的结果：命中的证据 + 引用令牌自身的行范围（Badge 展示与跳转用它）。 */
export interface ResolvedCitation {
  evidence: ToolEvidence;
  path: string;
  lineStart: number;
  lineEnd: number;
}

/** 把行内引用匹配到本轮证据：路径精确 + 行区间重叠优先（取最精确区间），其次路径相同，再次路径后缀匹配。 */
export const resolveCitation = (raw: string, evidences: ToolEvidence[]): ResolvedCitation | null => {
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
  const evidence = candidates.find((candidate): candidate is ToolEvidence & { path: string } => Boolean(candidate));
  if (!evidence) return null;
  // Badge 展示与跳转使用引用令牌自身的行范围，而不是证据窗口的范围。
  return { evidence, path: evidence.path, lineStart: parsed.lineStart, lineEnd: parsed.lineEnd };
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

/** 悬停与点击共用的跳转地址：以给定行号（缺省用证据窗口）覆盖 URL 上已有的 #L 锚点。 */
export const citationAnchorUrl = (evidence: ToolEvidence, lineStart?: number, lineEnd?: number): string => {
  const start = lineStart ?? evidence.lineStart;
  if (!evidence.path || !start) return evidence.url;
  const end = lineEnd ?? evidence.lineEnd ?? start;
  const base = evidence.url.replace(/#.*$/, '');
  const anchor = end > start ? `#L${start}-L${end}` : `#L${start}`;
  return `${base}${anchor}`;
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
