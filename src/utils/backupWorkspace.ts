import type { AccountWorkspace, GitHubUser, Repository, SavedAccount } from '../types';
import {
  accountIdKey,
  captureAccountWorkspace,
  emptyAccountWorkspace,
  normalizeAccountWorkspaces,
  type AccountWorkspaceRuntime,
  type AccountWorkspaceSource,
} from '../store/helpers/accountWorkspace';

/**
 * 多账号备份/恢复的共享纯函数（Issue #611 模块 5）。
 * 数据治理面板（本地 JSON）与 WebDAV 备份共用同一套工作区快照、
 * Token 脱敏与跨账号合并语义，避免两套实现漂移。
 */

export const BACKUP_MASKED_SECRET = '***';

export const isRealBackupSecret = (value: unknown): value is string => (
  typeof value === 'string' && value.length > 0 && value !== BACKUP_MASKED_SECRET
);

/**
 * 单条备份仓库记录的最小结构校验（审计修复 C47）：
 * id（有限数字）、name/full_name（非空字符串）、owner.login（非空字符串）。
 * null / 非对象 / 缺失关键字段一律拒绝。
 */
const isValidBackupRepository = (item: unknown): item is Repository => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  const repo = item as Partial<Repository>;
  return (
    typeof repo.id === 'number'
    && Number.isFinite(repo.id)
    && typeof repo.name === 'string'
    && repo.name.length > 0
    && typeof repo.full_name === 'string'
    && repo.full_name.length > 0
    && typeof repo.owner?.login === 'string'
    && repo.owner.login.length > 0
  );
};

/**
 * 备份/恢复路径在首次写入 store 前对 repositories 的逐项校验（审计修复 C47）。
 * 返回值语义：
 * - undefined：备份未提供该字段（保持既有「缺失字段保留本机值」的回退语义）；
 * - Repository[]（可为空数组，显式 [] 仍表示清空）：校验通过的列表；
 * - null：字段存在但含无效条目——调用方必须整体拒绝该工作区，绝不保存
 *   部分有效数据。
 */
export const validateBackupRepositories = (
  value: unknown,
): Repository[] | null | undefined => {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) return null;
  const validated: Repository[] = [];
  for (const item of value) {
    if (!isValidBackupRepository(item)) return null;
    // 第 13 轮审计修复 [93]：备份携带的 vector_indexed_at 是导出时刻所在向量
    // Worker 的索引时间——恢复到本机（可能已切换 Worker/重建索引）后该时间
    // 指向的向量不可假设仍存在。清除后恢复仓库视为未索引，下次增量索引重传
    //（本地 JSON 导入与工作区恢复两路径共用本函数，语义一致）。
    validated.push({ ...item, vector_indexed_at: undefined });
  }
  return validated;
};

/**
 * Gist 列表条目的结构校验（第 13 轮审计修复 [56]）：与导入面板顶层 gists 的
 * 写入前校验同一规则（id 为非空字符串、files 为普通对象）——账号工作区内的
 * accountWorkspaces[*].gists 此前只过数组外壳检查，含 null / 空对象的条目会
 * 进入工作区并写进实时状态与归档快照，消费侧（gistUtils 等）读取条目属性时
 * 抛 TypeError。返回值语义与 validateBackupRepositories 一致。
 */
export const isValidBackupGistEntry = (entry: unknown): boolean => {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  const gist = entry as { id?: unknown; files?: unknown };
  return typeof gist.id === 'string' && gist.id.length > 0
    && !!gist.files && typeof gist.files === 'object' && !Array.isArray(gist.files);
};

export const validateBackupGists = (value: unknown): unknown[] | null | undefined => {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) return null;
  return value.every(isValidBackupGistEntry) ? value : null;
};


/**
 * 构造完整工作区字典：合并已停用账号快照与当前活跃账号的实时状态。
 * 活跃账号快照一律在导出时刻即时合成（captureAccountWorkspace），
 * 不预存副本，避免双份驻留且即刻过期。
 */
export const buildFullWorkspaces = (
  state: AccountWorkspaceSource & { user: GitHubUser | null; accountWorkspaces: Record<string, AccountWorkspace> },
): Record<string, AccountWorkspace> => {
  const currentAccountId = accountIdKey(state.user);
  return {
    ...state.accountWorkspaces,
    ...(currentAccountId ? { [currentAccountId]: captureAccountWorkspace(state) } : {}),
  };
};

/** 按 includeKeysInBackup 决定 savedAccounts 的 Token 是明文还是脱敏掩码。 */
export const maskSavedAccountsForBackup = (
  savedAccounts: Record<string, SavedAccount>,
  includeKeys: boolean,
): Record<string, SavedAccount> => (
  Object.fromEntries(
    Object.entries(savedAccounts).map(([id, account]) => [
      id,
      includeKeys
        ? account
        : { ...account, githubToken: account.githubToken ? BACKUP_MASKED_SECRET : '' },
    ]),
  )
);

/**
 * 工作区数组按条目 id 去重合并（merge 模式）：
 * 本地已有条目保留，仅追加本地没有的新条目。
 * 订阅/已读集合字段（readForks、releaseSubscriptions、readReleases）按并集
 * 合并：保留本机状态并恢复备份条目，避免备份中的条目虽然恢复、
 * 其已读/订阅状态却丢失。
 */
export const mergeWorkspacesById = (
  local: AccountWorkspace,
  incoming: AccountWorkspace,
): AccountWorkspace => {
  const mergeList = <T extends { id: unknown }>(localList: T[], incomingList: T[]): T[] => {
    const existingIds = new Set(localList.map(item => String(item?.id)));
    const added: T[] = [];
    for (const item of incomingList) {
      const id = String(item?.id);
      if (existingIds.has(id)) continue;
      existingIds.add(id);
      added.push(item);
    }
    return [...localList, ...added];
  };
  const unionIds = <T>(localIds: T[], incomingIds: T[]): T[] => Array.from(new Set([...localIds, ...incomingIds]));
  return {
    ...local,
    repositories: mergeList(local.repositories, incoming.repositories),
    // 第 13 轮审计修复 [56]：合并模式的 gists 追加前过滤无效条目（null/空
    // 对象）——合并逻辑此前不会过滤，无效条目会被追加进本机 Gist 列表。
    gists: mergeList(local.gists, incoming.gists.filter((gist) => isValidBackupGistEntry(gist))),
    starredGists: mergeList(local.starredGists, incoming.starredGists),
    releases: mergeList(local.releases, incoming.releases),
    forks: mergeList(local.forks, incoming.forks),
    customCategories: mergeList(local.customCategories, incoming.customCategories),
    readForks: unionIds(local.readForks, incoming.readForks),
    releaseSubscriptions: unionIds(local.releaseSubscriptions, incoming.releaseSubscriptions),
    readReleases: unionIds(local.readReleases, incoming.readReleases),
  };
};

/**
 * 分类显示/映射设置合并（R5 审计修复，CodeRabbit 发现 3）：
 * mergeWorkspacesById 只合并列表与 ID 集合（其余字段取本机基座），恢复/归档
 * 的 merge 分支若不显式合并这些字段，备份当前账号工作区新增的分类显示设置
 * 会被整段丢弃。规则与导入面板的分类合并分支一致：
 * - hiddenDefaultCategoryIds / categoryOrder：并集（保留本机 + 恢复备份新增）；
 * - defaultCategoryOverrides / categoryListIdMap：按键合并，备份同键覆盖本机。
 * 返回值展开进合并结果即可，调用方不得再用本机基座的同名字段覆盖。
 */
export const mergeWorkspaceCategorySettings = (
  local: AccountWorkspace,
  incoming: Partial<Pick<AccountWorkspace, 'hiddenDefaultCategoryIds' | 'defaultCategoryOverrides' | 'categoryOrder' | 'categoryListIdMap'>>,
): Pick<AccountWorkspace, 'hiddenDefaultCategoryIds' | 'defaultCategoryOverrides' | 'categoryOrder' | 'categoryListIdMap'> => ({
  hiddenDefaultCategoryIds: Array.from(new Set([
    ...local.hiddenDefaultCategoryIds,
    ...(incoming.hiddenDefaultCategoryIds ?? []),
  ])),
  defaultCategoryOverrides: {
    ...local.defaultCategoryOverrides,
    ...(incoming.defaultCategoryOverrides ?? {}),
  },
  categoryOrder: Array.from(new Set([
    ...local.categoryOrder,
    ...(incoming.categoryOrder ?? []),
  ])),
  categoryListIdMap: {
    ...local.categoryListIdMap,
    ...(incoming.categoryListIdMap ?? {}),
  },
});

/**
 * 按导出数据类型选择裁剪工作区字段（导出隐私边界）。
 * 未选择的数据类型在工作区中以空默认值占位，绝不把未勾选类型的
 * 其他账号仓库/Release/Gist/Fork 等数据写入导出 JSON。
 */
export const trimWorkspacesForSelectedTypes = (
  workspaces: Record<string, AccountWorkspace>,
  selectedTypes: string[],
): Record<string, AccountWorkspace> => {
  const includeRepos = selectedTypes.includes('repositories');
  const includeReleases = selectedTypes.includes('releases');
  const includeReleaseSubs = selectedTypes.includes('releaseSubscriptions');
  const includeCategories = selectedTypes.includes('customCategories');
  const empty = emptyAccountWorkspace();
  return Object.fromEntries(
    Object.entries(workspaces).map(([accountId, workspace]) => [
      accountId,
      {
        ...empty,
        ...(includeRepos
          ? {
              repositories: workspace.repositories,
              lastSync: workspace.lastSync,
              gists: workspace.gists,
              starredGists: workspace.starredGists,
              selectedGistCategory: workspace.selectedGistCategory,
              forks: workspace.forks,
              readForks: workspace.readForks,
              syncMode: workspace.syncMode,
              syncModeConfigured: workspace.syncModeConfigured,
            }
          : {}),
        ...(includeReleases ? { releases: workspace.releases } : {}),
        ...(includeReleaseSubs
          ? {
              releaseSubscriptions: workspace.releaseSubscriptions,
              releaseSourceSettings: workspace.releaseSourceSettings,
              readReleases: workspace.readReleases,
            }
          : {}),
        ...(includeCategories
          ? {
              customCategories: workspace.customCategories,
              hiddenDefaultCategoryIds: workspace.hiddenDefaultCategoryIds,
              defaultCategoryOverrides: workspace.defaultCategoryOverrides,
              categoryOrder: workspace.categoryOrder,
              categoryListIdMap: workspace.categoryListIdMap,
            }
          : {}),
      } satisfies AccountWorkspace,
    ]),
  );
};

/**
 * 按导入数据类型选择应用工作区（applyAccountWorkspace 的类型过滤版）。
 * 仅返回所选类型对应的工作区字段补丁，未选择的类型不影响当前状态。
 * 导入面板以备份实际包含的数据类型解析 selectedTypes，因此裁剪备份
 * 中的空字段不会回滚当前实时数据。
 *
 * rawFields（审计修复 C57）：提供原始备份工作区对象时按字段级区分
 * 「未导出字段」与「导出为空」——原始备份缺失的字段不进入补丁（保留
 * 实时值），显式 [] 清空语义保留；缺省时保持旧行为（所选类型的全部
 * 字段都来自备份）。
 */
export const applyAccountWorkspaceForTypes = (
  workspace: AccountWorkspace,
  selectedTypes: string[],
  rawFields?: Record<string, unknown>,
): Partial<AccountWorkspaceRuntime> => {
  const rawHas = (key: string): boolean => !rawFields || Object.prototype.hasOwnProperty.call(rawFields, key);
  // 第 12 轮审计修复：实时恢复补丁与归档补丁（applyValidatedWorkspaceFields）
  // 共用同一套字段级校验——仅凭字段存在就写入会把无效字段（如备份中的
  // `gists: null` 经归一化得到的 []）当成清空指令，清空当前账号的实时数据，
  // 造成实时状态与归档状态不一致。集合字段必须为真数组（显式 [] 仍表示
  // 清空），映射/设置对象字段必须为普通对象；缺省 rawFields 时保持旧行为
  //（调用方保证 workspace 已按备份字段填充，如 merge 分支）。
  const liveFieldIsArray = (key: string): boolean => !rawFields || rawFieldIsArray(rawFields, key);
  const liveFieldIsObject = (key: string): boolean => !rawFields
    || (Object.prototype.hasOwnProperty.call(rawFields, key) && isPlainObject(rawFields[key]));
  // 第 13 轮审计修复 [94]：实时恢复补丁复用归档恢复的标量判断——仅凭字段存在
  // 就写入会把无效值（如 syncModeConfigured: "false"）写进实时状态，而同一
  // 输入在归档路径会被拒绝，两条路径对同一输入给出不一致结果。rawFields 缺省
  // （merge 分支）保持旧行为；提供时无效值被忽略（保留本机值），合法的 false
  // 与 lastSync: null 仍被接受。
  const liveScalarField = (key: string, isValid: (value: unknown) => boolean): boolean => (
    !rawFields || (Object.prototype.hasOwnProperty.call(rawFields, key) && isValid(rawFields[key]))
  );
  const patch: Partial<AccountWorkspaceRuntime> = {};
  if (selectedTypes.includes('repositories')) {
    const validatedRepositories = rawFields
      ? (rawHas('repositories') ? validateBackupRepositories(rawFields.repositories) : undefined)
      : workspace.repositories;
    if (Array.isArray(validatedRepositories)) {
      patch.repositories = validatedRepositories;
      patch.searchResults = validatedRepositories;
    }
    if (liveScalarField('lastSync', (value) => value === null || typeof value === 'string')) patch.lastSync = workspace.lastSync;
    // 第 13 轮审计修复 [56]：工作区 gists 含无效条目（null/空对象）时跳过该
    // 字段——不得覆盖现有 Gist，也绝不把无效条目写进实时状态；与归档路径
    // （applyValidatedWorkspaceFields）对同一输入保持一致。rawFields 缺省
    // （merge 分支）保持旧行为，由 mergeWorkspacesById 的条目过滤兜底。
    if (liveFieldIsArray('gists') && validateBackupGists(rawFields?.gists) !== null) {
      patch.gists = workspace.gists;
      patch.gistSearchResults = workspace.gists;
    }
    if (liveFieldIsArray('starredGists')) patch.starredGists = workspace.starredGists;
    if (liveScalarField('selectedGistCategory', (value) => typeof value === 'string')) patch.selectedGistCategory = workspace.selectedGistCategory;
    if (liveFieldIsArray('forks')) {
      patch.forks = workspace.forks;
    }
    if (liveFieldIsArray('readForks')) patch.readForks = new Set(workspace.readForks);
    if (liveScalarField('syncMode', (value) => value === 'stars' || value === 'stars-and-lists')) patch.syncMode = workspace.syncMode;
    if (liveScalarField('syncModeConfigured', (value) => typeof value === 'boolean')) patch.syncModeConfigured = workspace.syncModeConfigured;
  }
  if (selectedTypes.includes('releases') && liveFieldIsArray('releases')) {
    patch.releases = workspace.releases;
  }
  if (selectedTypes.includes('releaseSubscriptions')) {
    if (liveFieldIsArray('releaseSubscriptions')) patch.releaseSubscriptions = new Set(workspace.releaseSubscriptions);
    if (liveFieldIsObject('releaseSourceSettings')) patch.releaseSourceSettings = workspace.releaseSourceSettings;
    if (liveFieldIsArray('readReleases')) patch.readReleases = new Set(workspace.readReleases);
  }
  if (selectedTypes.includes('customCategories')) {
    if (liveFieldIsArray('customCategories')) patch.customCategories = workspace.customCategories;
    if (liveFieldIsArray('hiddenDefaultCategoryIds')) patch.hiddenDefaultCategoryIds = workspace.hiddenDefaultCategoryIds;
    if (liveFieldIsArray('categoryOrder')) patch.categoryOrder = workspace.categoryOrder;
    if (liveFieldIsObject('defaultCategoryOverrides')) patch.defaultCategoryOverrides = workspace.defaultCategoryOverrides;
    if (liveFieldIsObject('categoryListIdMap')) patch.categoryListIdMap = workspace.categoryListIdMap;
  }
  return patch;
};

/**
 * replace 模式的工作区字典恢复：逐账号按所选导入数据类型「只替换已选字段」。
 * 已选类型的字段以备份值为准；未选类型的字段保留本机快照——否则
 * 「单类型导出（如仅分类）→ replace 导入」往返会把裁剪备份中的空占位
 * 整体覆盖进工作区，清空非当前账号的仓库/Gist/Fork/订阅等未选数据。
 *
 * 审计修复（C57）：替换补丁依据原始备份中实际存在且有效的字段生成——
 * normalizeAccountWorkspaces 的空默认值无法区分「未导出字段」与「导出为空」，
 * 缺失字段必须保留本机值、显式 [] 才清空。该补丁同时用于更新目标账号快照
 * 与当前账号实时应用（面板侧经 applyAccountWorkspaceForTypes 的 rawFields）。
 */
const isPlainObject = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

/**
 * 备份字段级校验（实时补丁与归档补丁共用，审计修复）：字段存在且为真数组
 * 才视为备份提供的有效值——null/缺失/非数组一律按「未提供」处理（保留本机
 * 值），仅显式 [] 才是清空指令。归一化会把 null 变成空默认值，只凭字段存在
 * 就写入会把无效字段误当清空指令。
 */
const rawFieldIsArray = (
  fields: Record<string, unknown> | undefined,
  key: string,
): boolean => (
  !!fields
  && Object.prototype.hasOwnProperty.call(fields, key)
  && Array.isArray(fields[key])
);

const applyValidatedWorkspaceFields = (
  local: AccountWorkspace,
  rawAccount: Record<string, unknown>,
  incoming: AccountWorkspace,
  selectedTypes: string[],
): AccountWorkspace => {
  const rawHas = (key: string): boolean => Object.prototype.hasOwnProperty.call(rawAccount, key);
  const rawIsArray = (key: string): boolean => rawFieldIsArray(rawAccount, key);
  const rawIsObject = (key: string): boolean => rawHas(key) && isPlainObject(rawAccount[key]);
  const includeRepos = selectedTypes.includes('repositories');
  const includeReleases = selectedTypes.includes('releases');
  const includeReleaseSubs = selectedTypes.includes('releaseSubscriptions');
  const includeCategories = selectedTypes.includes('customCategories');
  // R2-C7：写入 repositories 前逐项校验原始备份值——缺失/null 视为未提供
  //（保留本机值），非数组或含无效条目的数组立即抛错拒绝整个工作区恢复，
  // 绝不部分写入其他字段；显式 [] 仍是有效的清空语义。
  const validatedRepositories = includeRepos && rawHas('repositories')
    ? validateBackupRepositories(rawAccount.repositories)
    : undefined;
  if (validatedRepositories === null) {
    throw new Error('Invalid repositories in backup workspace');
  }
  // 第 13 轮审计修复 [56]：工作区 gists 与 repositories 相同的字段级校验——
  // 字段存在但含无效条目（null/空对象）时按「未提供」处理（保留本机值），
  // 绝不让无效条目进入账号工作区或覆盖现有 Gist；显式 [] 仍是有效清空语义。
  // 与实时路径（applyAccountWorkspaceForTypes）对同一输入保持一致。
  const validatedGists = includeRepos && rawHas('gists')
    ? validateBackupGists(rawAccount.gists)
    : undefined;
  return {
    ...local,
    ...(Array.isArray(validatedRepositories) ? { repositories: validatedRepositories } : {}),
    ...(includeRepos && rawHas('lastSync') && (rawAccount.lastSync === null || typeof rawAccount.lastSync === 'string')
      ? { lastSync: incoming.lastSync }
      : {}),
    ...(includeRepos && Array.isArray(validatedGists) ? { gists: incoming.gists } : {}),
    ...(includeRepos && rawIsArray('starredGists') ? { starredGists: incoming.starredGists } : {}),
    ...(includeRepos && rawHas('selectedGistCategory') && typeof rawAccount.selectedGistCategory === 'string'
      ? { selectedGistCategory: incoming.selectedGistCategory }
      : {}),
    ...(includeRepos && rawIsArray('forks') ? { forks: incoming.forks } : {}),
    ...(includeRepos && rawIsArray('readForks') ? { readForks: incoming.readForks } : {}),
    ...(includeRepos && rawHas('syncMode') && (rawAccount.syncMode === 'stars' || rawAccount.syncMode === 'stars-and-lists')
      ? { syncMode: incoming.syncMode }
      : {}),
    ...(includeRepos && rawHas('syncModeConfigured') && typeof rawAccount.syncModeConfigured === 'boolean'
      ? { syncModeConfigured: incoming.syncModeConfigured }
      : {}),
    ...(includeReleases && rawIsArray('releases') ? { releases: incoming.releases } : {}),
    ...(includeReleaseSubs && rawIsArray('releaseSubscriptions') ? { releaseSubscriptions: incoming.releaseSubscriptions } : {}),
    ...(includeReleaseSubs && rawIsObject('releaseSourceSettings') ? { releaseSourceSettings: incoming.releaseSourceSettings } : {}),
    ...(includeReleaseSubs && rawIsArray('readReleases') ? { readReleases: incoming.readReleases } : {}),
    ...(includeCategories && rawIsArray('customCategories') ? { customCategories: incoming.customCategories } : {}),
    ...(includeCategories && rawIsArray('hiddenDefaultCategoryIds') ? { hiddenDefaultCategoryIds: incoming.hiddenDefaultCategoryIds } : {}),
    ...(includeCategories && rawIsObject('defaultCategoryOverrides') ? { defaultCategoryOverrides: incoming.defaultCategoryOverrides } : {}),
    ...(includeCategories && rawIsArray('categoryOrder') ? { categoryOrder: incoming.categoryOrder } : {}),
    ...(includeCategories && rawIsObject('categoryListIdMap') ? { categoryListIdMap: incoming.categoryListIdMap } : {}),
  } satisfies AccountWorkspace;
};

export const replaceWorkspacesForSelectedTypes = (
  localWorkspaces: Record<string, AccountWorkspace>,
  backupWorkspaces: Record<string, unknown>,
  selectedTypes: string[],
): Record<string, AccountWorkspace> => {
  const raw = (backupWorkspaces && typeof backupWorkspaces === 'object' && !Array.isArray(backupWorkspaces)
    ? backupWorkspaces
    : {}) as Record<string, Record<string, unknown> | undefined>;
  const normalized = normalizeAccountWorkspaces(backupWorkspaces);
  const merged = { ...localWorkspaces };
  for (const [accountId, incoming] of Object.entries(normalized)) {
    const rawAccount = raw[accountId] ?? {};
    const local = merged[accountId] ?? emptyAccountWorkspace();
    merged[accountId] = applyValidatedWorkspaceFields(local, rawAccount, incoming, selectedTypes);
  }
  return merged;
};

const ALL_WORKSPACE_BACKUP_TYPES = ['repositories', 'releases', 'releaseSubscriptions', 'customCategories'];

/**
 * 合并备份工作区：更新备份中存在的账号，保留本机独有的其他账号工作区。
 * preferLive=true（备份创建）：活跃账号的实时状态优先于可能过期的快照；
 * preferLive=false（恢复）：按备份中实际提供的有效字段覆盖对应账号（未提供的字段保留本机值，
 * 显式 [] 仍清空），本机独有的其他账号快照保留。
 */
export const mergeBackupWorkspaces = (
  localWorkspaces: Record<string, AccountWorkspace>,
  backupWorkspaces: Record<string, unknown>,
  liveAccountId: string | null,
  liveSnapshot: AccountWorkspace | null,
  preferLive: boolean,
): Record<string, AccountWorkspace> => {
  const raw = (backupWorkspaces && typeof backupWorkspaces === 'object' && !Array.isArray(backupWorkspaces)
    ? backupWorkspaces
    : {}) as Record<string, Record<string, unknown> | undefined>;
  const normalized = normalizeAccountWorkspaces(backupWorkspaces);
  const merged: Record<string, AccountWorkspace> = { ...localWorkspaces };
  for (const [accountId, incoming] of Object.entries(normalized)) {
    const existing = merged[accountId] ?? emptyAccountWorkspace();
    merged[accountId] = applyValidatedWorkspaceFields(
      existing,
      raw[accountId] ?? {},
      incoming,
      ALL_WORKSPACE_BACKUP_TYPES,
    );
  }
  if (preferLive && liveAccountId && liveSnapshot) {
    merged[liveAccountId] = liveSnapshot;
  }
  return merged;
};

/**
 * 掩码检测可能作用于未经校验的导入数据（备份 JSON 可以是任意形状）：
 * 条目可能为 null/非对象，属性访问必须可选，否则导入预览会因
 * `config.apiKey` 之类的读取抛错（审计修复），用户看不到正常的文件错误提示。
 */
const entryHasMaskedSecret = (entry: unknown, key: string): boolean => (
  typeof entry === 'object' && entry !== null
  && (entry as Record<string, unknown>)[key] === BACKUP_MASKED_SECRET
);

/** 检测备份载荷中是否存在脱敏掩码（提示用户部分密钥未包含）。 */
export const hasMaskedBackupSecrets = (
  data: {
    aiConfigs?: Array<{ apiKey?: unknown }>;
    webdavConfigs?: Array<{ password?: unknown }>;
    proxyConfig?: { password?: unknown };
    rpcDownloadConfig?: { secret?: unknown };
    backendApiSecret?: unknown;
    savedAccounts?: Record<string, SavedAccount>;
  },
): boolean => (
  !!(
    (Array.isArray(data.aiConfigs) && data.aiConfigs.some(config => entryHasMaskedSecret(config, 'apiKey')))
    || (Array.isArray(data.webdavConfigs) && data.webdavConfigs.some(config => entryHasMaskedSecret(config, 'password')))
    || entryHasMaskedSecret(data.proxyConfig, 'password')
    || entryHasMaskedSecret(data.rpcDownloadConfig, 'secret')
    || data.backendApiSecret === BACKUP_MASKED_SECRET
    || (data.savedAccounts !== null
      && typeof data.savedAccounts === 'object'
      && Object.values(data.savedAccounts).some(account => entryHasMaskedSecret(account, 'githubToken')))
  )
);
