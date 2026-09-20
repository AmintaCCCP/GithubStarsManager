/**
 * Batch Repository Intake —— 提取与归一化。
 *
 * 纯函数、无 IO：把粘贴进来的**普通文本 / Markdown / JSON** 归一化为 `owner/repo` 候选，
 * 去重后按首次出现顺序返回。联网校验（仓库是否存在、是否私有、是否改名）属于下一阶段。
 *
 * 归一化覆盖的 GitHub URL 形态（子路径一律丢弃，只留所属仓库）：
 * ```
 * https://github.com/owner/repo            github.com/owner/repo
 * https://www.github.com/owner/repo/       https://github.com/owner/repo.git
 * https://github.com/owner/repo/releases/tag/v1.2.0
 * https://github.com/owner/repo/issues/12  /pull/34  /tree/main/src  /blob/main/a.ts
 * https://github.com/owner/repo/actions|wiki|discussions|commit|compare|stargazers|…
 * ```
 * 以及正文里的裸 `owner/repo`。
 *
 * 刻意不做的事：
 * - 不联网、不猜仓库的真实大小写（GitHub 大小写不敏感，真实大小写由 Resolve 阶段覆盖）。
 * - 不把 `github.com/orgs/…`、`github.com/topics/…`、`github.com/settings/…` 等站点功能路径
 *   当成仓库，而是显式标记 `invalid` 并给出原因，让用户看得见而不是被静默丢弃。
 * - 不对裸 `owner/repo` 假装有把握：散文里 `A/B` 与仓库 slug 天然同形，
 *   因此一律标记 `confidence: 'low'`，由预览阶段交给用户确认。
 */
import type { Repository } from '../types';
import type {
  ImportCandidateConfidence,
  ImportCandidateMatchedBy,
  ImportFailureReason,
  ImportedRepositoryCandidate,
  ImportSource,
  RepositoryImportExtractionOptions,
  RepositoryImportExtractionResult,
} from '../types/repositoryImport';

const DEFAULT_MAX_INPUT_LENGTH = 512 * 1024;
const DEFAULT_MAX_VALUES = 20_000;
const DEFAULT_MAX_DEPTH = 32;

/** GitHub 用户名：字母数字与连字符，且不能以连字符开头，最长 39 字符。 */
const OWNER_PATTERN = /^(?=.{1,39}$)[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
/** GitHub 仓库名：字母数字、`-`、`_`、`.`，最长 100 字符。 */
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * `github.com/<第一段>` 属于站点功能入口而非用户名的保留字。
 * 这些路径下的第二段（`orgs/foo`、`topics/react`）不是仓库，裸写法里同样要拒绝。
 */
const RESERVED_ROOTS = new Set([
  'about', 'account', 'apps', 'blog', 'business', 'careers', 'codespaces', 'collections',
  'contact', 'customer-stories', 'dashboard', 'developer', 'donate', 'education', 'enterprise',
  'events', 'explore', 'features', 'home', 'issues', 'join', 'login', 'logout',
  'marketplace', 'mobile', 'new', 'notifications', 'organizations', 'orgs', 'pages', 'partners',
  'pricing', 'projects', 'pulls', 'readme', 'search', 'security', 'settings', 'site', 'sponsors',
  'stars', 'topics', 'trending', 'users', 'wiki', 'sitemap',
]);

/**
 * 裸 `owner/repo` 的误报抑制之一：常见的**代码目录名**。
 * 本仓库自己的文档里就充满 `src/utils`、`docs/plans` 这类片段，不排除会大量误报。
 */
const CODE_LIKE_DIRECTORIES = new Set([
  'src', 'app', 'lib', 'libs', 'test', 'tests', 'docs', 'doc', 'dist', 'build', 'out',
  'public', 'assets', 'static', 'config', 'configs', 'scripts', 'script', 'node_modules',
  'server', 'client', 'packages', 'package', 'components', 'component', 'hooks', 'hook',
  'utils', 'util', 'pages', 'api', 'apis', 'routes', 'router', 'store', 'stores',
  'styles', 'types', 'features', 'feature', 'examples', 'example', 'fixtures', 'mocks',
  'templates', 'template', 'locales', 'i18n', 'electron', 'cloudflare-worker',
  'versions', 'bin', 'cmd', 'internal', 'pkg', 'vendor', 'third_party',
]);

/** 裸 `owner/repo` 的误报抑制之二：常见文件扩展名（`src/utils.ts`、`docs/guide.md`）。 */
const FILE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'jsonc', 'md', 'mdx', 'txt', 'yml', 'yaml',
  'toml', 'ini', 'cfg', 'conf', 'lock', 'css', 'scss', 'less', 'html', 'htm', 'xml', 'svg',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'py', 'rb', 'php', 'go', 'rs', 'java', 'kt',
  'swift', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'sql',
  'env', 'log', 'map', 'wasm',
]);

/**
 * 裸 `owner/repo` 的误报抑制之三：常见英文/技术词组。
 *
 * 这是一个**必然不完整**的启发式——`and/or`、`24/7`、`TCP/IP` 与仓库 slug 同形，
 * 无法靠词表穷尽。因此裸写法一律降级为 `confidence: 'low'`，
 * 最终由预览阶段的用户确认（这正是「Review」环节存在的理由）。
 */
const BARE_SLUG_STOPWORDS = new Set([
  'and', 'or', 'either', 'neither', 'both', 'not', 'with', 'without', 'per', 'vs', 'versus',
  'he', 'she', 'it', 'they', 'we', 'you', 'his', 'her', 'its', 'their', 'our', 'your',
  'tcp', 'udp', 'ip', 'http', 'https', 'ftp', 'ssh', 'dns', 'ssl', 'tls',
  'read', 'write', 'readonly', 'readwrite', 'input', 'output', 'request', 'response',
  'client', 'server', 'frontend', 'backend', 'parent', 'child', 'master', 'slave', 'primary',
  'replica', 'source', 'target', 'left', 'right', 'up', 'down', 'in', 'out', 'on', 'off',
  'before', 'after', 'over', 'under', 'plus', 'minus', 'min', 'max', 'start', 'end', 'open',
  'close', 'true', 'false', 'yes', 'no', 'null', 'none', 'all', 'any', 'km', 'miles',
  'day', 'week', 'month', 'year', 'cost', 'benefit', 'pros', 'cons', 'win', 'loss',
]);

/** 先匹配完整 URL，再用 `URL.hostname` 精确判定是否为 GitHub。 */
const ABSOLUTE_URL_PATTERN = /https?:\/\/[^\s<>()[\]{}"'`,;:|*~]+/gi;

/** 无 scheme 的 `github.com/owner/repo`；不允许从更长域名或路径中间开始匹配。 */
const SCHEMELESS_GITHUB_URL_PATTERN =
  /(?<![A-Za-z0-9./-])(?:www\.)?github\.com\/([^\s<>()[\]{}"'`,;:|*~]*)/gi;

/**
 * 匹配正文里的裸 `owner/repo`。
 * 前后用否定环视排除「更长路径的一部分」：`a/b/c` 里 `a/b` 与 `b/c` 都不会命中。
 */
const BARE_SLUG_PATTERN =
  /(?<![A-Za-z0-9._/-])([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})(?![A-Za-z0-9_/-])/g;

/** URL 尾部常见的标点/包裹字符（`owner/repo.`、`owner/repo,`）。括号与引号已被捕获组排除。 */
function trimUrlTail(value: string): string {
  return value.replace(/[.,;:!?]+$/, '');
}

/** 取扩展名（小写）；没有扩展名返回空串。`.git` 视为后缀而非扩展名，单独处理。 */
function extensionOf(segment: string): string {
  const index = segment.lastIndexOf('.');
  if (index <= 0 || index === segment.length - 1) return '';
  return segment.slice(index + 1).toLowerCase();
}

/**
 * 校验并归一化 `owner/repo`。
 *
 * @param owner 用户名段。
 * @param repo 仓库名段（可带 `.git` 后缀，会被去掉）。
 * @returns 归一化后的 `owner/repo`（保留原大小写），或 null 表示不合法。
 */
export function normalizeRepositoryFullName(owner: string, repo: string): string | null {
  const cleanRepo = repo.toLowerCase().endsWith('.git') ? repo.slice(0, -4) : repo;
  if (!OWNER_PATTERN.test(owner)) return null;
  if (!REPO_PATTERN.test(cleanRepo)) return null;
  // 纯点号（`.`、`..`）不是合法仓库名
  if (/^\.+$/.test(cleanRepo)) return null;
  return `${owner}/${cleanRepo}`;
}

/**
 * 从 GitHub URL 的路径部分解析所属仓库（release / issue / PR / tree / blob 等子路径一律丢弃）。
 *
 * @param url `github.com/` 之后的完整片段，可带 query / fragment / 尾部标点。
 * @returns 归一化结果，或失败原因。
 */
export function resolveRepositoryFromGitHubUrl(
  url: string,
): { repositoryFullName: string } | { reason: ImportFailureReason } {
  const withoutQuery = url.split(/[?#]/)[0];

  // 尾部标点通常是句子标点（`…/repo.`），但也可能属于路径本身（`owner/..` 会被整段吃掉）。
  // 因此先按「去尾部标点」解析；只有当段数因此不足两段时，才用未去标点的原串重试。
  for (const candidate of [trimUrlTail(withoutQuery), withoutQuery]) {
    const segments = candidate.split('/').filter(Boolean);
    if (segments.length === 0) continue;

    // 第一段是站点保留字 → 功能页，不是仓库
    if (RESERVED_ROOTS.has(segments[0].toLowerCase())) {
      return { reason: 'not-a-repository-url' };
    }
    // `github.com/<owner>` 是用户/组织主页，没有仓库名；换用未去标点的原串再试一次
    if (segments.length < 2) continue;

    const fullName = normalizeRepositoryFullName(segments[0], segments[1]);
    return fullName ? { repositoryFullName: fullName } : { reason: 'malformed-slug' };
  }

  return { reason: 'not-a-repository-url' };
}

/**
 * 判断裸 `owner/repo` 是否值得作为候选。
 * 命中任一抑制规则即拒绝——宁可漏报，也不要往预览里塞噪声。
 */
export function isPlausibleBareSlug(owner: string, repo: string): boolean {
  if (!OWNER_PATTERN.test(owner) || !REPO_PATTERN.test(repo)) return false;
  if (/^\.+$/.test(repo)) return false;
  // 单字符段在散文里几乎必然是 `I/O`、`N/A` 这类噪声，不是仓库
  if (owner.length < 2 || repo.length < 2) return false;

  const ownerLower = owner.toLowerCase();
  const repoLower = repo.toLowerCase();
  if (RESERVED_ROOTS.has(ownerLower)) return false;
  if (BARE_SLUG_STOPWORDS.has(ownerLower) || BARE_SLUG_STOPWORDS.has(repoLower)) return false;
  if (CODE_LIKE_DIRECTORIES.has(ownerLower) || CODE_LIKE_DIRECTORIES.has(repoLower)) return false;

  const extension = extensionOf(repo);
  if (extension && extension !== 'git' && FILE_EXTENSIONS.has(extension)) return false;
  return true;
}

/** 移除与开头 Markdown 下划线数量相同的闭合定界符。 */
function trimMarkdownUnderscoreDelimiter(text: string, matchStart: number, path: string): string {
  let delimiterLength = 0;
  for (let index = matchStart - 1; index >= 0 && text[index] === '_'; index -= 1) {
    delimiterLength += 1;
  }
  const delimiter = '_'.repeat(delimiterLength);
  return delimiterLength > 0 && path.endsWith(delimiter)
    ? path.slice(0, -delimiterLength)
    : path;
}

/** 把完整 URL 和无 scheme GitHub URL 替换为等长空白，避免路径段被重复扫描。 */
function maskUrls(text: string): string {
  return text
    .replace(ABSOLUTE_URL_PATTERN, (match) => ' '.repeat(match.length))
    .replace(SCHEMELESS_GITHUB_URL_PATTERN, (match) => ' '.repeat(match.length));
}

/** 递归收集 JSON 里的字符串值（只取值，不取键名）。返回收集是否被上限截断。 */
function collectJsonStrings(
  value: unknown,
  out: string[],
  limit: number,
  depth: number,
  maxDepth: number,
): 'ok' | 'value-limit' | 'depth-limit' {
  if (typeof value === 'string') {
    if (out.length >= limit) return 'value-limit';
    out.push(value);
    return 'ok';
  }
  if (value === null || typeof value !== 'object') return 'ok';
  if (depth >= maxDepth) return 'depth-limit';

  const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  let result: 'ok' | 'value-limit' | 'depth-limit' = 'ok';
  for (const child of children) {
    const childResult = collectJsonStrings(child, out, limit, depth + 1, maxDepth);
    if (childResult === 'value-limit') return 'value-limit';
    if (childResult === 'depth-limit') result = 'depth-limit';
  }
  return result;
}

/** 去重键：合法的按仓库名（大小写不敏感），非法的按原始片段，避免同一片段重复报错。 */
function dedupeKey(candidate: ImportedRepositoryCandidate): string {
  return candidate.repositoryFullName
    ? candidate.repositoryFullName.toLowerCase()
    : `invalid:${candidate.originalValue.trim().toLowerCase()}`;
}

/**
 * 从粘贴内容提取仓库候选。
 *
 * @param raw 原始输入（文本 / Markdown / JSON 字符串）。
 * @param options 提取选项；`source: 'json'` 时先解析 JSON 再递归扫描字符串值。
 */
export function extractRepositoryCandidates(
  raw: string,
  options: RepositoryImportExtractionOptions = {},
): RepositoryImportExtractionResult {
  const source: ImportSource = options.source ?? 'text';
  const maxInputLength = options.maxInputLength ?? DEFAULT_MAX_INPUT_LENGTH;
  const maxValues = options.maxValues ?? DEFAULT_MAX_VALUES;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const local = options.localRepositoryFullNames;

  if (raw.length > maxInputLength) {
    return {
      candidates: [],
      inputErrors: [
        {
          code: 'input-too-large',
          message: `Input exceeds the ${maxInputLength} character limit`,
        },
      ],
      stats: { scanned: 0, valid: 0, duplicates: 0, invalid: 0 },
    };
  }

  const inputErrors: RepositoryImportExtractionResult['inputErrors'] = [];
  // 第一版只实现 text / json；clipboard 与 file 复用同一套提取逻辑。
  let strings: string[];
  if (source === 'json') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return {
        candidates: [],
        inputErrors: [
          {
            code: 'json-parse-failed',
            message: error instanceof Error ? error.message : 'Invalid JSON',
          },
        ],
        stats: { scanned: 0, valid: 0, duplicates: 0, invalid: 0 },
      };
    }
    strings = [];
    const collected = collectJsonStrings(parsed, strings, maxValues, 0, maxDepth);
    if (collected === 'value-limit') {
      inputErrors.push({
        code: 'too-many-values',
        message: `JSON contains more than ${maxValues} string values; extraction stopped early`,
      });
    } else if (collected === 'depth-limit') {
      inputErrors.push({
        code: 'depth-limit-exceeded',
        message: `JSON nesting exceeds ${maxDepth} levels; deeper values were skipped`,
      });
    }
  } else {
    strings = [raw];
  }

  const candidates: ImportedRepositoryCandidate[] = [];
  const seen = new Map<string, ImportedRepositoryCandidate>();

  /** 记录候选；同一键重复出现时追加 `duplicate`，并保持首次出现的顺序。 */
  const push = (
    repositoryFullName: string,
    originalValue: string,
    status: ImportedRepositoryCandidate['status'],
    extra: {
      reason?: ImportFailureReason;
      matchedBy?: ImportCandidateMatchedBy;
      confidence?: ImportCandidateConfidence;
    } = {},
  ) => {
    const draft: ImportedRepositoryCandidate = {
      repositoryFullName,
      source,
      originalValue,
      status,
      ...extra,
    };
    if (status === 'pending' && local?.has(repositoryFullName.toLowerCase())) {
      draft.alreadyStarred = true;
    }
    const existing = seen.get(dedupeKey(draft));
    if (existing) {
      if (existing.confidence === 'low' && draft.confidence === 'high') {
        existing.confidence = 'high';
        existing.matchedBy = 'github-url';
      }
      candidates.push({ ...draft, status: 'duplicate' });
      return;
    }
    seen.set(dedupeKey(draft), draft);
    candidates.push(draft);
  };

  for (const text of strings) {
    // 两类匹配要按**输入位置**合并排序后再去重：先扫完所有 URL 再扫裸写法会让
    // `owner/repo` 这类靠前的片段被排到后面，预览列表的顺序将不再反映用户粘贴的顺序。
    // 屏蔽操作等长替换，因此两边拿到的 index 可以直接比较。
    const found: Array<{
      index: number;
      repositoryFullName: string;
      originalValue: string;
      status: ImportedRepositoryCandidate['status'];
      matchedBy: ImportCandidateMatchedBy;
      reason?: ImportFailureReason;
    }> = [];

    for (const match of text.matchAll(ABSOLUTE_URL_PATTERN)) {
      let url: URL;
      try {
        url = new URL(match[0]);
      } catch {
        continue;
      }
      const hostname = url.hostname.toLowerCase();
      if (hostname !== 'github.com' && hostname !== 'www.github.com') continue;
      const matchStart = match.index ?? 0;
      const path = trimMarkdownUnderscoreDelimiter(text, matchStart, url.pathname.slice(1));
      const parsed = resolveRepositoryFromGitHubUrl(path);
      const resolved = 'repositoryFullName' in parsed;
      found.push({
        index: matchStart,
        repositoryFullName: resolved ? parsed.repositoryFullName : '',
        originalValue: match[0],
        status: resolved ? 'pending' : 'invalid',
        matchedBy: 'github-url',
        reason: resolved ? undefined : parsed.reason,
      });
    }

    const withoutAbsoluteUrls = text.replace(
      ABSOLUTE_URL_PATTERN,
      (match) => ' '.repeat(match.length),
    );
    for (const match of withoutAbsoluteUrls.matchAll(SCHEMELESS_GITHUB_URL_PATTERN)) {
      const matchStart = match.index ?? 0;
      const path = trimMarkdownUnderscoreDelimiter(text, matchStart, match[1]);
      const parsed = resolveRepositoryFromGitHubUrl(path);
      const resolved = 'repositoryFullName' in parsed;
      found.push({
        index: matchStart,
        repositoryFullName: resolved ? parsed.repositoryFullName : '',
        originalValue: text.slice(matchStart, matchStart + match[0].length),
        status: resolved ? 'pending' : 'invalid',
        matchedBy: 'github-url',
        reason: resolved ? undefined : parsed.reason,
      });
    }

    // URL 已经被消费过，屏蔽掉它们的路径段再找裸写法，避免 `releases/tag` 之类被误当成 slug。
    for (const match of maskUrls(text).matchAll(BARE_SLUG_PATTERN)) {
      const [, owner, repo] = match;
      const trimmedRepo = repo.replace(/[.;:!?]+$/, '');
      if (!isPlausibleBareSlug(owner, trimmedRepo)) continue;
      const fullName = normalizeRepositoryFullName(owner, trimmedRepo);
      if (!fullName) continue;
      found.push({
        index: match.index ?? 0,
        repositoryFullName: fullName,
        originalValue: match[0],
        status: 'pending',
        matchedBy: 'bare-slug',
      });
    }

    found.sort((left, right) => left.index - right.index);

    for (const entry of found) {
      push(entry.repositoryFullName, entry.originalValue, entry.status, {
        reason: entry.reason,
        matchedBy: entry.matchedBy,
        confidence: entry.matchedBy === 'github-url' ? 'high' : 'low',
      });
    }
  }

  return {
    candidates,
    inputErrors,
    stats: {
      scanned: strings.length,
      valid: candidates.filter((candidate) => candidate.status === 'pending').length,
      duplicates: candidates.filter((candidate) => candidate.status === 'duplicate').length,
      invalid: candidates.filter((candidate) => candidate.status === 'invalid').length,
    },
  };
}

/**
 * 便捷入口：从已同步的仓库推导本地小写 `owner/repo` 集合，供 `alreadyStarred` 标记复用。
 * 保持纯函数语义——提取阶段不读 store。预览阶段可再叠加 My Apps 关联等本地数据。
 */
export function toLocalRepositoryNameSet(
  repositories: readonly Pick<Repository, 'full_name'>[] | undefined,
): Set<string> {
  return new Set((repositories ?? []).map((repository) => repository.full_name.toLowerCase()));
}
