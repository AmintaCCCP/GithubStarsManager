/**
 * Batch Repository Intake —— 批量导入的候选模型。
 *
 * 处理流程（roadmap §6 / 开发守则 §6）：
 * ```
 * Paste → Extract → Normalize → Deduplicate → Resolve GitHub metadata
 *       → Enrich with local/Core data → Review → Batch actions
 * ```
 * 本文件描述**前四步**的产物：一个已经归一化为 `owner/repo`、已去重、但仍未联网校验的候选。
 * 「Resolve GitHub metadata」（是否存在、是否私有、是否改名/转移、是否限流）与
 * 「Enrich with local/Core data」（是否已 Star、是否已在 My Apps）由后续阶段填充，
 * 因此 `status` 与 `reason` 的取值域在这里一次性定义完整，避免下一阶段再改模型。
 */
/** 候选来源。第一版只实现 `text` 与 `json`；`clipboard` / `file` 留给后续阶段复用同一模型。 */
export type ImportSource = 'text' | 'json' | 'clipboard' | 'file';

/**
 * 候选状态。
 * - `pending`：归一化成功，尚未联网校验（Extract/Deduplicate 阶段的正常结果）。
 * - `resolved`：已成功解析到 GitHub 元数据（Resolve 阶段填充）。
 * - `duplicate`：同一仓库（或同一无效片段）在本次输入中重复出现，本条是重复项。
 * - `invalid`：看起来像 GitHub 仓库但无法归一化（保留字路径、格式非法等），本阶段即可判定。
 * - `unavailable`：能归一化但解析失败（不存在 / 私有 / 改名 / 限流等），Resolve 阶段填充。
 */
export type ImportCandidateStatus =
  | 'pending'
  | 'resolved'
  | 'duplicate'
  | 'invalid'
  | 'unavailable';

/** 候选是怎么被识别出来的，供预览界面区分可信度。 */
export type ImportCandidateMatchedBy = 'github-url' | 'bare-slug';

/**
 * 识别可信度。
 * - `high`：来自明确包含 `github.com` 的 URL（含 release/issue/tree/blob 等子路径）。
 * - `low`：来自正文里的裸 `owner/repo` 写法。散文里这对词天然有歧义
 *   （`src/utils`、`and/or`、`TCP/IP` 之类），因此一律降级，交由预览阶段由用户确认。
 */
export type ImportCandidateConfidence = 'high' | 'low';

/**
 * 失败原因。
 *
 * 标注了阶段的取值由对应阶段产出，本阶段只产出 `not-a-repository-url` / `malformed-slug`：
 * - Extract 阶段：`not-a-repository-url`、`malformed-slug`
 * - Resolve 阶段：`not-found`、`private-or-inaccessible`、`renamed`、`rate-limited`
 * - Enrich 阶段：`already-exists`
 */
export type ImportFailureReason =
  | 'not-a-repository-url'
  | 'malformed-slug'
  | 'not-found'
  | 'private-or-inaccessible'
  | 'renamed'
  | 'rate-limited'
  | 'already-exists';

/**
 * 一个导入候选。
 *
 * `originalValue` 始终保留原始片段——批量导入的每一步都必须是可回溯的，
 * 用户需要能看到「这条是从哪段文本里识别出来的」。
 */
export interface ImportedRepositoryCandidate {
  /** 归一化后的 `owner/repo`；`invalid` 时为空字符串。 */
  repositoryFullName: string;
  source: ImportSource;
  /** 输入中触发本条候选的原始片段（未修改）。 */
  originalValue: string;
  status: ImportCandidateStatus;
  /** 本地是否已 Star（Enrich 阶段填充；本阶段在调用方提供本地集合时也会填）。 */
  alreadyStarred?: boolean;
  /** `invalid` / `unavailable`，或 Enrich 阶段识别到已存在时有值。 */
  reason?: ImportFailureReason;
  /** 识别来源，附加字段（守则模型之外），用于预览界面区分 URL 与裸写法。 */
  matchedBy?: ImportCandidateMatchedBy;
  /** 识别可信度，附加字段（守则模型之外）。 */
  confidence?: ImportCandidateConfidence;
  /**
   * Resolve 阶段发现仓库被改名/转移时的原始 `owner/repo`。
   * 守则要求显示 `old-owner/repo → new-owner/repo` 且**不得静默修改**，
   * 因此把旧名字单独留在这里，由用户确认后才替换。
   */
  previousFullName?: string;
}

/** 输入层面的问题（与单个候选无关）。 */
export interface RepositoryImportInputError {
  /**
   * `json-parse-failed` 与 `input-too-large` 是致命问题：此时 `candidates` 为空。
   * `too-many-values` 与 `depth-limit-exceeded` 只是截断：`candidates` 仍包含已扫描到的结果。
   */
  code: 'json-parse-failed' | 'input-too-large' | 'too-many-values' | 'depth-limit-exceeded';
  message: string;
}

/** Extract + Normalize + Deduplicate 的结果。 */
export interface RepositoryImportExtractionResult {
  /** 按首次出现顺序排列的候选（含 `invalid` 与 `duplicate`）。 */
  candidates: ImportedRepositoryCandidate[];
  /** 输入整体不合法或被截断时的问题列表；致命问题（见 {@link RepositoryImportInputError}）时 `candidates` 为空。 */
  inputErrors: RepositoryImportInputError[];
  stats: {
    /** 实际扫描过的字符串数量（JSON 递归时是各层字符串值之和）。 */
    scanned: number;
    /** 归一化成功的候选数（不含 duplicates / invalid）。 */
    valid: number;
    duplicates: number;
    invalid: number;
  };
}

/** 提取选项。 */
export interface RepositoryImportExtractionOptions {
  /** 输入类型；`json` 会先做 JSON 解析再递归扫描字符串值。默认 `text`。 */
  source?: ImportSource;
  /**
   * 本地已有仓库的小写 `owner/repo` 集合；提供时用于填充 `alreadyStarred`。
   * 这是纯函数输入，不做任何 IO。
   */
  localRepositoryFullNames?: ReadonlySet<string>;
  /** 输入最大长度（JavaScript 字符串长度），超出则报 `input-too-large` 并放弃扫描。默认 524288。 */
  maxInputLength?: number;
  /** 递归扫描 JSON 时最多处理多少个字符串值，防止病态输入。默认 20000。 */
  maxValues?: number;
  /** JSON 递归最大深度。默认 32。 */
  maxDepth?: number;
}
