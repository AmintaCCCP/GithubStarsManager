
import type { PersistOptions, PersistStorage } from 'zustand/middleware';
import type { GitHubUser, Repository, SubscriptionChannel } from '../../types';
import { defaultHeaderMenuConfig, defaultReleaseSourceSettings, defaultSubscriptionChannels } from '../../types';
import { defaultRepositoryChatSettings } from '../../types/repositoryChat';
import { logger } from '../../services/logger';
import { normalizeReleaseSourceSettings } from '../../utils/releaseSources';
import { normalizeXTweetFollows } from '../../utils/xTweetFollows';
import { normalizeTelegramFollows } from '../../utils/telegramFollows';
import { normalizeExternalDiscoveryChannels } from '../../utils/discoveryFeeds';
import { accountIdKey, normalizeSavedAccounts } from '../helpers/accountWorkspace';
import type { AppStoreState } from '../types';
import {
  defaultDiscoveryChannels,
  normalizeMcpConfig,
  normalizeRepositoryChatSettings,
  normalizeVectorSearchConfig,
  normalizeVectorSearchStatus,
  PersistedAppState,
} from '../schema';
import { normalizePersistedState } from '../normalizers/persistedState';
import { useAppStore } from '../useAppStore';
import { readLegacyAuthMirrorForDesktopMigration, writeAuthMirror } from './authStorage';
import {
  fillMissingGhAccountTokens,
  getPendingGhAccountSecretRemovalIds,
  hasGhAccountsBridge,
  hasPendingGhAccountSecretRemovals,
  loadGhAccountTokens,
  saveGhAccountTokens,
  type GhAccountTokenMap,
} from './ghAccountSecrets';
import { debouncedPersistStorage } from './storage';
import {
  forgetV19MigrationInputs,
  getV19MigrationInputs,
  hasV19MigrationInputs,
  mergeV19MigrationInputs,
  setV19MigrationInputs,
  __resetV19MigrationInputsForTest,
  type V19MigrationInputMap,
} from './v19MigrationInputs';

/**
 * 记录 v18→v19 迁移阶段发起的桌面端加密凭据保存，供 onRehydrateStorage 等待
 * 落盘完成后再读取 gh-accounts.enc，避免首次升级时读取早于写入导致会话丢失。
 */
let pendingMigrationTokenSave: Promise<{ ok: boolean; tokens: GhAccountTokenMap; error?: unknown }> | null = null;

/**
 * v19 凭据迁移的落盘确认标记（审计修复）：标记为 false 期间，持久化分片中的
 * savedAccounts 由 savedAccountsForShard 决定——运行时新 PAT 一律剥除，仅保留
 * v19MigrationInputs 中「仍未成功落盘」的旧迁移输入（两者分离，未确认绝不等于
 * 可以把新凭据写进明文分片）。加密保存成功（或本次启动无需迁移：Web 构建
 * 剥除即设计、桌面无 Token 可迁移）后置位，恢复 B7/CWE-922 全量剥除语义。
 * 第 12 轮审计 ISSUE-1 修复：确认标记只在迁移输入为空时置位，由迁移保存、
 * 镜像迁移与启动重试各自按账号删除输入后统一收敛，避免「单账号迁移成功」
 * 抹掉其他账号尚未落盘的重试输入。Web 构建（无桥）恒为确认态：PAT 本就不持久化。
 */
let v19TokenSaveConfirmed = !hasGhAccountsBridge();

/**
 * 让本次迁移中已成功写入 safeStorage 的账号退出迁移输入。
 * partialize 随后自然不再回填这些账号的旧 PAT；输入清空时才置确认标记。
 */
const markV19MigrationTokensSaved = (tokens: GhAccountTokenMap | null | undefined): void => {
  if (tokens) forgetV19MigrationInputs(Object.keys(tokens));
  confirmV19TokenSaveIfDrained();
};

/** 置位 v19 落盘确认标记——迁移输入为空（不再有需要跨重启保留的旧 PAT）时才允许。 */
const confirmV19TokenSave = (): boolean => {
  if (hasV19MigrationInputs()) return false;
  v19TokenSaveConfirmed = true;
  return true;
};

const confirmV19TokenSaveIfDrained = (): boolean => confirmV19TokenSave();

/**
 * v19 桌面镜像迁移（第 12 轮审计修复）：旧版本可能在认证镜像遗留明文 PAT
 * （IndexedDB 写入未完成时唯一的凭据副本——migrate 无快照可处理，常规水合的
 * writeAuthMirror 会把它覆写为 null，安全存储为空时桌面会话不可恢复）。
 * merge 在覆写镜像前捕获该凭据，onRehydrateStorage 收尾时迁入 safeStorage
 *（R2-B1 合并写入），确认成功后才按 B7 语义覆写镜像清除明文；失败时镜像
 * 明文保留，下次启动 merge 重新捕获重试。非桌面端不捕获——按设计要求重新授权。
 */
let pendingLegacyMirrorMigration: {
  user: GitHubUser;
  githubToken: string;
  backendApiSecret: string | null;
} | null = null;

/**
 * 捕获仅存于旧认证镜像的桌面端明文 PAT（merge 覆写镜像前调用）：
 * - 仅桌面端且 v19 落盘确认尚未置位时捕获；
 * - 镜像凭据必须带有效 user 身份，且与合并后的登录用户一致（或合并态无用户）；
 * - 合并状态已有该账号凭据（快照携带 PAT）时不捕获——v19 迁移/重试路径
 *   会把它迁入 safeStorage，镜像照常清除。
 */
const captureLegacyMirrorForDesktopMigration = (merged: {
  user: GitHubUser | null;
  githubToken: string | null;
  savedAccounts: Record<string, import('../../types').SavedAccount>;
}): { user: GitHubUser; githubToken: string; backendApiSecret: string | null } | null => {
  if (!hasGhAccountsBridge() || v19TokenSaveConfirmed) return null;
  const legacyMirror = readLegacyAuthMirrorForDesktopMigration();
  const mirrorUser = legacyMirror?.user ?? null;
  const mirrorAccountId = accountIdKey(mirrorUser);
  if (!legacyMirror?.githubToken || !mirrorUser || !mirrorAccountId) return null;
  // 第 13 轮审计修复：设备删除失败后重启的账号同时具有待删标记与旧镜像 PAT——
  // 迁移保存会被 saveGhAccountTokens 视为替换并解除待删标记（旧凭据迁移绝不能
  // 解除删除意图，只有用户显式重新授权才能解除），此处直接不捕获。
  if (getPendingGhAccountSecretRemovalIds().includes(mirrorAccountId)) return null;
  const mergedAccountId = accountIdKey(merged.user);
  if (mergedAccountId && mergedAccountId !== mirrorAccountId) return null;
  const mergedHasToken = (typeof merged.githubToken === 'string' && !!merged.githubToken.trim())
    || !!merged.savedAccounts?.[mirrorAccountId]?.githubToken?.trim();
  if (mergedHasToken) return null;
  return {
    user: mirrorUser,
    githubToken: legacyMirror.githubToken,
    backendApiSecret: legacyMirror.backendApiSecret,
  };
};

/**
 * 消费 merge 捕获的旧镜像凭据：迁入 safeStorage（R2-B1 合并写入），加密写入
 * 成功后只让该镜像账号退出迁移输入（ISSUE-1(D)：不得顺带确认其他账号的
 * 迁移保存——快照迁移多账号失败时其余 PAT 必须继续留在分片中重试），并覆写
 * 镜像清除明文；失败时镜像明文保留，下次启动重新捕获重试。
 * 返回 null 表示本轮无待迁移镜像凭据。
 */
const consumePendingLegacyMirrorMigrationSave = (): Promise<{ ok: boolean; error?: unknown }> | null => {
  const stash = pendingLegacyMirrorMigration;
  pendingLegacyMirrorMigration = null;
  if (!stash || !hasGhAccountsBridge() || v19TokenSaveConfirmed) return null;
  const stashAccountId = accountIdKey(stash.user);
  if (!stashAccountId) return null;
  // 第 13 轮审计修复：镜像迁移改为补写语义（fillMissingGhAccountTokens）——
  // 磁盘已有该账号的 PAT（新凭据已确认落盘）时保留磁盘值，绝不用尚未刷新的
  // 镜像明文回退；补写结果确认后才清除镜像明文。
  return fillMissingGhAccountTokens({ [stashAccountId]: stash.githubToken })
    .then(() => {
      // 磁盘已确认存在该账号凭据（新写入或已有值）：让镜像账号退出迁移输入。
      // 跳过情形（待删标记）已在捕获入口过滤，不会走到这里。
      markV19MigrationTokensSaved({ [stashAccountId]: stash.githubToken });
      // 加密写入确认成功：按 B7 语义覆写镜像，清除遗留明文 PAT。
      const store = useAppStore.getState();
      writeAuthMirror({
        user: store.user ?? stash.user,
        githubToken: typeof store.githubToken === 'string' ? store.githubToken : null,
        backendApiSecret: typeof store.backendApiSecret === 'string' ? store.backendApiSecret : null,
      });
      return { ok: true as const };
    })
    .catch((err) => ({ ok: false as const, error: err }));
};

/**
 * 审计修复（B7/CWE-922）：持久化分片只保留 savedAccounts 的非敏感元数据
 * （accountId、user、addedAt、lastUsedAt），githubToken 一律剥除（置空串）。
 * PAT 仅存桌面端 safeStorage 加密文件（经 ghAccounts IPC），Web 构建不持久化
 * PAT——切换/恢复该账号时要求重新授权。
 */
const stripSavedAccountTokens = (
  savedAccounts: Record<string, import('../../types').SavedAccount>,
): Record<string, import('../../types').SavedAccount> => {
  let changed = false;
  const next: Record<string, import('../../types').SavedAccount> = {};
  for (const [accountId, account] of Object.entries(savedAccounts ?? {})) {
    if (!account?.githubToken) {
      next[accountId] = account;
      continue;
    }
    changed = true;
    next[accountId] = { ...account, githubToken: '' };
  }
  return changed ? next : savedAccounts;
};

/**
 * partialize 的 savedAccounts 分片内容（第 12 轮审计修复 + ISSUE-1 按账号收敛）：
 * - 确认后：B7/CWE-922 语义——一律剥除，分片不含明文 PAT；
 * - 未确认：运行时凭据（含重新授权的新 PAT）仍然剥除——绝不能因迁移未完成
 *   就把新 PAT 写进明文分片（桌面读取失败后重新授权的场景）；仅把迁移输入
 *   中的旧凭据写回分片，保证迁移保存失败/未确认时未成功迁入 safeStorage 的
 *   旧凭据跨重启仍可重试迁移，而不是被首次持久化永久清除；
 * - 逐账号新旧比较（ISSUE-1(B)）：运行时 savedAccounts 已有非空凭据且与迁移
 *   输入不同时，运行时新值优先——绝不把旧 PAT 回填进分片（否则下次启动会
 *   用它覆盖刚写入 safeStorage 的新 PAT）。运行时值为空（迁移后内存被剥除）
 *   或与输入相同（分片重试输入被重新水合）时才回填。
 */
const savedAccountsForShard = (
  savedAccounts: Record<string, import('../../types').SavedAccount>,
): Record<string, import('../../types').SavedAccount> => {
  const stripped = stripSavedAccountTokens(savedAccounts);
  if (v19TokenSaveConfirmed) return stripped;
  const migrationInputs = getV19MigrationInputs();
  if (!migrationInputs) return stripped;
  // 已显式请求删除（登出/移除）但尚未完成设备删除的账号，绝不回填旧 PAT。
  const pendingRemovalIds = new Set(getPendingGhAccountSecretRemovalIds());
  let changed = false;
  const next: Record<string, import('../../types').SavedAccount> = { ...stripped };
  for (const [accountId, legacyToken] of Object.entries(migrationInputs)) {
    if (pendingRemovalIds.has(accountId)) continue;
    const account = next[accountId];
    if (!account || account.githubToken === legacyToken) continue;
    const runtimeToken = savedAccounts[accountId]?.githubToken?.trim() ?? '';
    // 运行时已有更新凭据：新值优先，旧迁移输入不得回填（也不把新 PAT 写明文分片）。
    if (runtimeToken && runtimeToken !== legacyToken) continue;
    next[accountId] = { ...account, githubToken: legacyToken };
    changed = true;
  }
  return changed ? next : stripped;
};

/**
 * v19 凭据迁移的落盘确认重试（审计修复）：迁移保存失败时持久化分片由
 * savedAccountsForShard 保留迁移输入中的旧 PAT（第 12 轮起运行时新 PAT 一律
 * 剥除），否则未成功保存的凭据会在下一次持久化后永久丢失且迁移不会重跑。
 * 每次桌面端水化收尾时检查内存中尚存的账号凭据：
 * - 无残留 Token：存在待删凭据时先重试应用删除（安全存储恢复后清除旧密文），
 *   然后按「迁移输入为空」收敛确认标记；
 * - 有残留 Token：重试迁入 safeStorage，成功账号逐项退出迁移输入（ISSUE-1：
 *   不能因本次保存成功就无条件确认），输入清空后才恢复剥除语义；失败则保留
 *   分片中的迁移输入与内存 Token，下次启动再次重试。
 * 同时清理已不存在于 savedAccounts 的孤儿迁移输入：账号记录已被移除时，
 * 其旧 PAT 既无法回填也无法用于弹窗恢复，不应无限期阻止确认。
 */
const retryUnconfirmedV19TokenSave = async (): Promise<void> => {
  if (v19TokenSaveConfirmed || !hasGhAccountsBridge()) return;
  const store = useAppStore.getState();
  // 已请求删除（登出/移除）的账号不得被重试写回：失败删除留下的旧分片值/
  // 陈旧运行时值都不能复活已退出账号（ISSUE-1(C) 的跨重启兜底）。
  const pendingRemovalIds = new Set(getPendingGhAccountSecretRemovalIds());
  if (pendingRemovalIds.size > 0) forgetV19MigrationInputs(pendingRemovalIds);
  const tokens: GhAccountTokenMap = {};
  for (const [accountId, account] of Object.entries(store.savedAccounts ?? {})) {
    if (pendingRemovalIds.has(accountId)) continue;
    if (account?.githubToken?.trim()) tokens[accountId] = account.githubToken;
  }
  const currentAccountId = accountIdKey(store.user);
  const currentToken = typeof store.githubToken === 'string' ? store.githubToken.trim() : '';
  if (currentAccountId && currentToken && !tokens[currentAccountId] && !pendingRemovalIds.has(currentAccountId)) {
    tokens[currentAccountId] = currentToken;
  }
  if (hasV19MigrationInputs()) {
    const liveAccountIds = new Set(Object.keys(store.savedAccounts ?? {}));
    if (currentAccountId) liveAccountIds.add(currentAccountId);
    const orphanedAccountIds = Object.keys(getV19MigrationInputs() ?? {})
      .filter((accountId) => !liveAccountIds.has(accountId));
    if (orphanedAccountIds.length > 0) forgetV19MigrationInputs(orphanedAccountIds);
  }
  if (Object.keys(tokens).length === 0) {
    // 第 12 轮审计修复：没有可回填的 PAT 时仍要重试待删凭据——上一次启动的
    // 删除可能因安全存储暂时不可写而失败，重启后按待删标记过滤该 PAT，空映射
    // 早退会让旧密文永久留在磁盘。存在待删项时发起一次合并保存（即使输入为空
    // 也应用删除）；无待删项才保持无写入行为并收敛确认标记。
    if (hasPendingGhAccountSecretRemovals()) {
      try {
        await saveGhAccountTokens({});
        confirmV19TokenSave();
      } catch (err) {
        logger.warn('store.hydrate', 'v19 pending gh-account removal retry failed; pending removals kept', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }
    confirmV19TokenSave();
    return;
  }
  try {
    // R2-B1 合并写入语义同样适用于重试：只补写确认映射中缺失/最新的条目，
    // 不覆写磁盘上其他账号的 Token。
    await saveGhAccountTokens(tokens);
    // ISSUE-1：只让本次成功写入的账号退出迁移输入；仍有其他账号未落盘时
    // 保持未确认态，分片继续保留它们的旧 PAT 供下次启动重试。
    markV19MigrationTokensSaved(tokens);
  } catch (err) {
    logger.warn('store.hydrate', 'v19 gh-accounts migration retry failed; legacy tokens kept in persisted snapshot', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

/**
 * 第二次及以后启动（version 已为 19，migrate 不再运行）从持久化分片重建迁移
 * 输入：分片 savedAccounts 仍带 PAT 只能说明上次启动的迁移保存未确认。重建后
 * 启动重试与 partialize 都能继续保留/重试这些旧凭据，避免「首次持久化剥除 →
 * 第三次启动永久丢失」的窗口（ISSUE-1(A)）。只读取分片中已有的 PAT。
 */
const seedV19MigrationInputsFromPersistedShard = (persistedState: unknown): void => {
  if (v19TokenSaveConfirmed || !hasGhAccountsBridge()) return;
  const persistedSavedAccounts = (persistedState as { savedAccounts?: unknown } | null | undefined)?.savedAccounts;
  if (!persistedSavedAccounts || typeof persistedSavedAccounts !== 'object' || Array.isArray(persistedSavedAccounts)) {
    return;
  }
  const seeds: V19MigrationInputMap = {};
  const pendingRemovalIds = new Set(getPendingGhAccountSecretRemovalIds());
  for (const [accountId, entry] of Object.entries(persistedSavedAccounts as Record<string, unknown>)) {
    if (pendingRemovalIds.has(accountId)) continue;
    const token = (entry as { githubToken?: unknown } | null | undefined)?.githubToken;
    if (typeof token === 'string' && token.trim()) seeds[accountId] = token;
  }
  mergeV19MigrationInputs(seeds);
};

/**
 * 安全存储读取成功后，用磁盘权威值收敛迁移输入（ISSUE-1(B) 的跨重启兜底）：
 * 磁盘上已有某账号的 Token 说明此前的加密写入已确认，该账号不需要再重试迁移。
 * 若内存里仍留分片中的旧 PAT，先清空条目，再由 restorePersistedAccountTokens
 * 用磁盘值回填——否则启动重试会把旧 PAT 写回去、覆盖已保存的新凭据。
 */
const reconcileLoadedDiskTokensWithMigrationInputs = (diskTokens: GhAccountTokenMap): void => {
  const migrationInputs = getV19MigrationInputs();
  if (!migrationInputs) return;
  const confirmedAccountIds = Object.keys(migrationInputs)
    .filter((accountId) => typeof diskTokens[accountId] === 'string' && !!diskTokens[accountId].trim());
  if (confirmedAccountIds.length === 0) return;
  useAppStore.setState((state) => {
    let changed = false;
    const savedAccounts = { ...state.savedAccounts };
    for (const accountId of confirmedAccountIds) {
      const entry = savedAccounts[accountId];
      if (!entry?.githubToken || entry.githubToken === diskTokens[accountId]) continue;
      savedAccounts[accountId] = { ...entry, githubToken: '' };
      changed = true;
    }
    return changed ? { savedAccounts } : {};
  });
  forgetV19MigrationInputs(confirmedAccountIds);
};

export const appPersistenceOptions: PersistOptions<AppStoreState, PersistedAppState> = {
  name: 'github-stars-manager',
  version: 19,
  storage: debouncedPersistStorage as PersistStorage<PersistedAppState>,
partialize: (state) => ({
  // 持久化用户信息和登录标识。审计修复（B7/CWE-922）：明文 PAT 不再进入
  // 浏览器持久化分片——顶层 githubToken 与 savedAccounts[].githubToken 均剥除，
  // PAT 由桌面端 safeStorage 文件（ghAccounts IPC）承载；isAuthenticated 在
  // 水化时由 normalizePersistedState 按 user+token 重算。
  user: state.user,
  isAuthenticated: state.isAuthenticated,
  accountWorkspaces: state.accountWorkspaces,
  // 审计修复：savedAccounts 的 PAT 剥除语义由 savedAccountsForShard 决定——
  // 确认后分片不含任何明文 PAT（B7/CWE-922）；未确认时运行时新 PAT 仍然剥除
  //（绝不写明文分片），仅保留迁移输入中的旧凭据供重启后重试迁移（第 12 轮）。
  savedAccounts: savedAccountsForShard(state.savedAccounts),

  // 持久化仓库数据
  repositories: state.repositories,
  lastSync: state.lastSync,

  // Theme token（开发守则 §14）：声明式外观偏好
  themeTokens: state.themeTokens,

  // 持久化 Gist 数据
  gists: state.gists,
  starredGists: state.starredGists,
  gistSearchFilters: {
sortBy: state.gistSearchFilters.sortBy,
sortOrder: state.gistSearchFilters.sortOrder,
  },
  selectedGistCategory: state.selectedGistCategory,
  analyzingGistIds: Array.from(state.analyzingGistIds),

  // 持久化AI配置
  aiConfigs: state.aiConfigs,
  activeAIConfig: state.activeAIConfig,
  repositoryChatSettings: state.repositoryChatSettings,

  // 持久化Embedding配置
  embeddingConfigs: state.embeddingConfigs,
  activeEmbeddingConfig: state.activeEmbeddingConfig,

  // 持久化向量搜索配置
  vectorSearchConfig: state.vectorSearchConfig,
  // 持久化向量搜索状态（vectorCount 等，跨重启保留）
  vectorSearchStatus: state.vectorSearchStatus,

  // MCP prefs + bearer token (stable across restarts; only changes on user reset)
  mcpConfig: state.mcpConfig,

  // 持久化WebDAV配置
  webdavConfigs: state.webdavConfigs,
  activeWebDAVConfig: state.activeWebDAVConfig,
  lastBackup: state.lastBackup,

  // 持久化Release订阅、来源和已读状态
  releaseSubscriptions: Array.from(state.releaseSubscriptions),
  releaseSourceSettings: state.releaseSourceSettings,
  readReleases: Array.from(state.readReleases),
  releases: state.releases,

  // 持久化Fork数据
  forks: state.forks,
  readForks: Array.from(state.readForks),

  // 持久化自定义分类
  customCategories: state.customCategories,
  hiddenDefaultCategoryIds: state.hiddenDefaultCategoryIds,
  categoryOrder: state.categoryOrder,
  collapsedSidebarCategoryCount: state.collapsedSidebarCategoryCount,
  categoryMatchMode: state.categoryMatchMode,
  defaultCategoryOverrides: state.defaultCategoryOverrides,

  // 持久化资源过滤器
  assetFilters: state.assetFilters,
  // 卡片可见字段（开发守则 §14）
  repositoryCardFields: state.repositoryCardFields,
  repositoryCardActions: state.repositoryCardActions,
  pluginCustomIcons: state.pluginCustomIcons,

  // Trending 快照（开发守则 §7）：本地榜单历史，不参与任何远端同步
  trendingSnapshots: state.trendingSnapshots,

  // 持久化UI设置
  themeMode: state.themeMode,
  themePresetLight: state.themePresetLight,
  themePresetDark: state.themePresetDark,
  currentView: state.currentView,
  selectedCategory: state.selectedCategory,
  language: state.language,
  translationEngine: state.translationEngine,
  autoTranslateRepoDescription: state.autoTranslateRepoDescription,
  // 更新检查偏好：自动检查开关 + 用户"不再提示"的版本号
  autoUpdateCheckEnabled: state.autoUpdateCheckEnabled,
  updatePromptDismissedVersion: state.updatePromptDismissedVersion,
  isSidebarCollapsed: state.isSidebarCollapsed,
  headerMenuConfig: state.headerMenuConfig,

  // 持久化后端 API Secret（跨会话/跨标签保留，配合修复 #259）。同时保留
  // localStorage 镜像（AUTH_MIRROR_KEY）作为异步 IndexedDB 写入失败时的兜底。
  backendApiSecret: state.backendApiSecret,

  // 持久化同步范围配置（GitHub Lists 同步）
  syncMode: state.syncMode,
  syncModeConfigured: state.syncModeConfigured,
  // 持久化分类 → GitHub List 映射（跨语言稳定身份）
  categoryListIdMap: state.categoryListIdMap,

  // 持久化搜索排序设置
  searchFilters: {
sortBy: state.searchFilters.sortBy,
sortOrder: state.searchFilters.sortOrder,
  },

  // 持久化仓库页面视图设置
  repositoryViewMode: state.repositoryViewMode,
  // 持久化Release页面视图设置
  releaseViewMode: state.releaseViewMode,
  releaseShowMode: state.releaseShowMode,
  releaseLatestMode: state.releaseLatestMode,
  releaseSelectedFilters: state.releaseSelectedFilters,
  releaseSearchQuery: state.releaseSearchQuery,
  releaseExpandedRepositories: Array.from(state.releaseExpandedRepositories),
  includePreRelease: state.includePreRelease,
  includeKeysInBackup: state.includeKeysInBackup,

  // 持久化Fork页面视图设置
  forkViewMode: state.forkViewMode,
  forkSelectedFilters: state.forkSelectedFilters,
  forkSearchQuery: state.forkSearchQuery,
  forkExpandedRepositories: Array.from(state.forkExpandedRepositories),

// 持久化发现设置
discoveryChannels: state.discoveryChannels,
selectedDiscoveryChannel: state.selectedDiscoveryChannel,
// discoveryRepos 不持久化，它是极其庞大的 JSON 对象。
// 在 Electron 41/v8/macOS 上的 IDB partialize 阶段，
// 由于频繁序列化这个可能达数MB的大对象，会触发底层 JIT CHECK assertion failed (brk 0) 导致崩溃。
// 这里的会话级运行时数据都取消持久化：
// discoveryRepos
// discoveryLastRefresh
// discoveryTotalCount
// discoveryHasMore
// discoveryNextPage
discoveryPlatform: state.discoveryPlatform,
discoveryLanguage: state.discoveryLanguage,
discoverySortBy: state.discoverySortBy,
discoverySortOrder: state.discoverySortOrder,
// 仓库搜索模式（关键词/AI 语义）持久化；语义搜索的 phase 进度与空态原因是
// 会话级运行时数据（同 discoveryRepos 理由），不入白名单。
discoverySearchMode: state.discoverySearchMode,
discoverySelectedTopic: state.discoverySelectedTopic,
  weeklyOnlyCollected: state.weeklyOnlyCollected,
  xTweetFollows: state.xTweetFollows,
  // xTweetAuth 仅由桌面端 safeStorage 安全加密存储（Web 模式仅在内存），避免明文 Cookie 写入 IndexedDB/localStorage（CWE-922）。
  // 仅持久化非敏感的 xTweetAuthRevision 用于跨会话请求签名稳定性。
  xTweetAuthRevision: state.xTweetAuthRevision,
  telegramFollows: state.telegramFollows,
// 持久化完整代理配置，包含认证密码，确保重启后无需重新输入。
proxyConfig: {
  enabled: state.proxyConfig.enabled,
  type: state.proxyConfig.type,
  host: state.proxyConfig.host,
  port: state.proxyConfig.port,
  username: state.proxyConfig.username,
  password: state.proxyConfig.password,
},
// 持久化 RPC 下载配置（含密钥，确保重启后不丢失）
rpcDownloadConfig: {
  enabled: state.rpcDownloadConfig.enabled,
  host: state.rpcDownloadConfig.host,
  port: state.rpcDownloadConfig.port,
  secret: state.rpcDownloadConfig.secret,
},
routeMode: state.routeMode,
}),
migrate: (persistedState) => {
  // 版本升级适配处理
  const state = persistedState as PersistedAppState | undefined;

  if (state && !state.releaseSourceSettings) {
console.log('Migrating from old version: initializing releaseSourceSettings');
state.releaseSourceSettings = defaultReleaseSourceSettings;
  } else if (state) {
state.releaseSourceSettings = normalizeReleaseSourceSettings(state.releaseSourceSettings);
  }

  // 从旧版本升级时，确保 categoryOrder 字段存在
  if (state && !Array.isArray(state.categoryOrder)) {
console.log('Migrating from old version: initializing categoryOrder');
state.categoryOrder = [];
  }

  // 从旧版本升级时，确保 collapsedSidebarCategoryCount 字段存在
  if (state && typeof state.collapsedSidebarCategoryCount !== 'number') {
console.log('Migrating from old version: initializing collapsedSidebarCategoryCount');
state.collapsedSidebarCategoryCount = 20;
  }

  // 从旧版本升级时，确保 defaultCategoryOverrides 字段存在
  if (state && typeof state.defaultCategoryOverrides !== 'object') {
console.log('Migrating from old version: initializing defaultCategoryOverrides');
state.defaultCategoryOverrides = {};
  }

  // 从旧版本升级时，确保 vectorSearchStatus 字段存在（vectorCount 等）
  if (state) {
state.vectorSearchStatus = normalizeVectorSearchStatus(state.vectorSearchStatus);
  }

  // Additive: MCP config defaults when missing (upgrade). Old builds ignore this key on downgrade.
  if (state) {
const stateRecord = state as Record<string, unknown>;
stateRecord.mcpConfig = normalizeMcpConfig(stateRecord.mcpConfig);
  }

  // 迁移仓库数据中的旧标记
  if (state && Array.isArray(state.repositories)) {
let migratedCount = 0;
state.repositories = state.repositories.map((repo: Repository) => {
  // 将旧的 '__EMPTY__' 标记转换为空字符串（表示用户明确清空）
  if (repo.custom_description === '__EMPTY__') {
    migratedCount++;
    return { ...repo, custom_description: '' };
  }
  return repo;
});
if (migratedCount > 0) {
  console.log(`Migrated ${migratedCount} repositories: converted '__EMPTY__' to empty string`);
}
  }

  if (state && !state.selectedDiscoveryChannel) {
state.selectedDiscoveryChannel = 'trending';
  }
  if (state && (!state.discoveryChannels || !Array.isArray(state.discoveryChannels))) {
state.discoveryChannels = defaultDiscoveryChannels;
  } else if (state && Array.isArray(state.discoveryChannels)) {
const persistedChannels = state.discoveryChannels as unknown[];
state.discoveryChannels = [...defaultDiscoveryChannels.map((defaultChannel) => {
const persistedChannel = persistedChannels.find((channel) => {
  return (channel as Record<string, unknown>)?.id === defaultChannel.id;
}) as Record<string, unknown> | undefined;

if (!persistedChannel) {
  return defaultChannel;
}

return {
...defaultChannel,
enabled: persistedChannel.enabled !== false,
};
}), ...normalizeExternalDiscoveryChannels(persistedChannels)];
  }
  // 迁移订阅频道（版本 4→5：daily-dev → most-dev，新增 trending，补全 nameEn）
  const defaultChannelsMap = new Map(defaultSubscriptionChannels.map(ch => [ch.id, ch]));
  if (state && !Array.isArray(state.subscriptionChannels)) {
console.log('Migrating: initializing subscription channels');
state.subscriptionChannels = defaultSubscriptionChannels;
  } else if (state && Array.isArray(state.subscriptionChannels)) {
state.subscriptionChannels = state.subscriptionChannels.map((ch: unknown) => {
const chRecord = ch as Record<string, unknown>;
const defaultCh = defaultChannelsMap.get(chRecord.id as string);
if (chRecord.id === 'daily-dev' || chRecord.id === 'most-dev') {
  return { ...chRecord, id: 'most-dev', name: '热门开发者', nameEn: 'Top Developers', icon: '👤' } as unknown as SubscriptionChannel;
}
if (defaultCh) {
  return {
...(chRecord as Partial<SubscriptionChannel>),
name: defaultCh.name, // 始终使用中文名称
nameEn: (chRecord.nameEn as string) || defaultCh.nameEn || (chRecord.name as string) || defaultCh.nameEn,
icon: (chRecord.icon as string) || defaultCh.icon,
description: (chRecord.description as string) || defaultCh.description,
  } as unknown as SubscriptionChannel;
}
return chRecord as unknown as SubscriptionChannel;
});
// 确保 trending 频道存在（如果缺失则添加）
const hasTrending = state.subscriptionChannels.some((ch: SubscriptionChannel) => ch.id === 'trending');
if (!hasTrending) {
console.log('Migrating: adding trending channel');
state.subscriptionChannels.push({
  id: 'trending',
  name: '热门趋势',
  nameEn: 'Trending',
  icon: 'trending',
  description: 'GitHub 上近期最受关注的项目 Top 10',
  enabled: true,
} as SubscriptionChannel);
}
  }
  if (state && !state.discoveryPlatform) {
state.discoveryPlatform = 'All';
  }
  // 版本 6→7：新增 includeKeysInBackup（默认 false，安全优先）
  if (state && typeof state.includeKeysInBackup !== 'boolean') {
console.log('Migrating: initializing includeKeysInBackup to false (security first)');
state.includeKeysInBackup = false;
  }
  if (state && !state.discoveryLanguage) {
state.discoveryLanguage = 'All';
  }
  if (state && !state.discoverySortBy) {
state.discoverySortBy = 'BestMatch';
  }
  if (state && !state.discoverySortOrder) {
state.discoverySortOrder = 'Descending';
  }
  // discoveryIsLoading 不应持久化，migrate 时始终重置防止旧数据格式异常导致 spread 崩溃
  if (state) {
(state as Record<string, unknown>).discoveryIsLoading = {
'trending': false, 'hot-release': false, 'most-popular': false, 'topic': false, 'x-tweet': false, 'telegram': false, 'weekly': false, 'search': false, 'code-search': false,
};
// discoveryScrollPositions 同样不应持久化，重置以避免 stale 滚动位置
(state as Record<string, unknown>).discoveryScrollPositions = {
'trending': 0, 'hot-release': 0, 'most-popular': 0, 'topic': 0, 'x-tweet': 0, 'telegram': 0, 'weekly': 0, 'search': 0, 'code-search': 0,
};
  }

  // v14: 周刊频道过滤器偏好兜底
  if (state && typeof (state as Record<string, unknown>).weeklyOnlyCollected !== 'boolean') {
    (state as Record<string, unknown>).weeklyOnlyCollected = false;
  }

  // v16→v17: 更新检查偏好兜底（自动检查默认开启；"不再提示"版本默认为空）
  if (state) {
    const stateRecord = state as Record<string, unknown>;
    if (typeof stateRecord.autoUpdateCheckEnabled !== 'boolean') {
      stateRecord.autoUpdateCheckEnabled = true;
    }
    if (typeof stateRecord.updatePromptDismissedVersion !== 'string' || !stateRecord.updatePromptDismissedVersion) {
      stateRecord.updatePromptDismissedVersion = null;
    }
  }

  // v14→v15: X 推文频道选项兜底（关注列表默认含 geekbb）
  if (state) {
    const stateRecord = state as Record<string, unknown>;
    stateRecord.xTweetFollows = normalizeXTweetFollows(stateRecord.xTweetFollows);
    // 旧快照可能含明文 xTweetAuth：直接删除（不删除整个快照），内存态置 null；
    // 清理后的快照随下次持久化写回 IndexedDB/localStorage。
    if ('xTweetAuth' in stateRecord) delete stateRecord.xTweetAuth;
    if (typeof stateRecord.xTweetAuthRevision !== 'number' || !Number.isFinite(stateRecord.xTweetAuthRevision)) {
      stateRecord.xTweetAuthRevision = 0;
    }
    (state as Record<string, unknown>).telegramFollows = normalizeTelegramFollows(
      (state as Record<string, unknown>).telegramFollows,
    );
  }

  // v5→v6: 初始化 proxyConfig
  if (state && !(state as Record<string, unknown>).proxyConfig) {
(state as Record<string, unknown>).proxyConfig = { enabled: false, type: 'http', host: '', port: 7890 };
  }

  // 初始化 rpcDownloadConfig
  if (state && !(state as Record<string, unknown>).rpcDownloadConfig) {
(state as Record<string, unknown>).rpcDownloadConfig = { enabled: false, host: '', port: 6800 };
  }

  // v12→v13: 初始化 routeMode（纯本地偏好，缺失或非法时回退 auto，不参与后端/autoSync 同步）
  if (state) {
    const stateRecord = state as Record<string, unknown>;
    if (stateRecord.routeMode !== 'backend' && stateRecord.routeMode !== 'browser') {
      stateRecord.routeMode = 'auto';
    }
  }

  // v8→v9: 初始化 headerMenuConfig
  if (state && !Array.isArray((state as Record<string, unknown>).headerMenuConfig)) {
(state as Record<string, unknown>).headerMenuConfig = defaultHeaderMenuConfig;
  }

  // v9→v10: 初始化 backendApiSecret（旧版仅存 sessionStorage；migrate 前置为 null）
  if (state && typeof (state as Record<string, unknown>).backendApiSecret !== 'string') {
(state as Record<string, unknown>).backendApiSecret = null;
  }

  // v11→v12: 仓库问答设置只存非敏感字段；旧快照使用安全默认值。
  if (state) {
    const stateRecord = state as Record<string, unknown>;
    stateRecord.repositoryChatSettings = normalizeRepositoryChatSettings(
      stateRecord.repositoryChatSettings ?? defaultRepositoryChatSettings,
    );
  }

  // 初始化 embeddingConfigs
  if (state && !Array.isArray((state as Record<string, unknown>).embeddingConfigs)) {
(state as Record<string, unknown>).embeddingConfigs = [];
  }
  if (state && typeof (state as Record<string, unknown>).activeEmbeddingConfig !== 'string') {
(state as Record<string, unknown>).activeEmbeddingConfig = null;
  }

  // 初始化/迁移 vectorSearchConfig
  if (state) {
const stateRecord = state as Record<string, unknown>;
stateRecord.vectorSearchConfig = normalizeVectorSearchConfig(
stateRecord.vectorSearchConfig,
stateRecord.embeddingConfigs
);
stateRecord.mcpConfig = normalizeMcpConfig(stateRecord.mcpConfig);
    }

  // v15→v16: per-GitHub-id workspace snapshots so logout does not wipe local data
  if (state) {
    const stateRecord = state as Record<string, unknown>;
    if (typeof stateRecord.accountWorkspaces !== 'object'
      || stateRecord.accountWorkspaces === null
      || Array.isArray(stateRecord.accountWorkspaces)) {
      stateRecord.accountWorkspaces = {};
    }
  }

  // v17→v18: 初始化 savedAccounts，并将当前已登录账号自动回填进 savedAccounts
  if (state) {
    const stateRecord = state as Record<string, unknown>;
    const normalizedSaved = normalizeSavedAccounts(stateRecord.savedAccounts);
    const existingUser = stateRecord.user as GitHubUser | null | undefined;
    const existingToken = stateRecord.githubToken as string | null | undefined;
    const uid = accountIdKey(existingUser);
    if (uid && existingUser && typeof existingToken === 'string' && existingToken) {
      const now = new Date().toISOString();
      normalizedSaved[uid] = {
        accountId: uid,
        user: existingUser,
        githubToken: existingToken,
        addedAt: normalizedSaved[uid]?.addedAt ?? now,
        lastUsedAt: now,
      };
    }
    stateRecord.savedAccounts = normalizedSaved;
  }

  // v18→v19（审计修复 B7/CWE-922，一次性迁移）：把已持久化的明文 PAT 清出
  // 浏览器状态分片。桌面端先把剥除的 Token 立即迁入 safeStorage 加密文件
  //（gh-accounts.enc，fire-and-forget；写失败则该账号按「需重新授权」处理）；
  // Web 构建不持久化 PAT，重新授权即可恢复。partialize 此后也不再写出 Token，
  // 清理后的分片随水化后的首次持久化自然重写。
  if (state) {
    const stateRecord = state as Record<string, unknown>;
    const legacySaved = normalizeSavedAccounts(stateRecord.savedAccounts);
    const legacyUser = stateRecord.user as GitHubUser | null | undefined;
    const legacyTopToken = typeof stateRecord.githubToken === 'string' ? stateRecord.githubToken : '';
    const legacyTopAccountId = accountIdKey(legacyUser);
    const tokens: GhAccountTokenMap = {};
    // 第 13 轮审计修复：设备删除失败后重启的账号可能同时具有待删标记与旧分片
    // PAT——迁移保存会被视为替换并解除待删标记（旧凭据迁移绝不能解除删除意图，
    // 只有用户显式重新授权才能解除），这类账号不进入迁移输入。
    const pendingRemovalIds = new Set(getPendingGhAccountSecretRemovalIds());
    for (const [accountId, account] of Object.entries(legacySaved)) {
      if (pendingRemovalIds.has(accountId)) continue;
      if (account?.githubToken?.trim()) tokens[accountId] = account.githubToken;
    }
    if (legacyTopAccountId && legacyTopToken.trim() && !tokens[legacyTopAccountId]
      && !pendingRemovalIds.has(legacyTopAccountId)) {
      tokens[legacyTopAccountId] = legacyTopToken;
    }
    // 一次性桌面迁移兜底：旧快照缺 Token 时从旧认证镜像核对同账号 PAT 并迁入 safeStorage，
    // 迁移成功后才清掉镜像中的明文 PAT（非桌面端不回读）。
    let migratedFromMirror: { user: GitHubUser | null; backendApiSecret: string | null } | null = null;
    if (hasGhAccountsBridge()) {
      const legacyMirror = readLegacyAuthMirrorForDesktopMigration();
      const mirrorUser = legacyMirror?.user ?? null;
      const mirrorAccountId = accountIdKey(mirrorUser);
      if (legacyMirror?.githubToken && mirrorAccountId && mirrorUser
        && (!legacyTopAccountId || mirrorAccountId === legacyTopAccountId)
        && !tokens[mirrorAccountId]
        && !pendingRemovalIds.has(mirrorAccountId)) {
        tokens[mirrorAccountId] = legacyMirror.githubToken;
        migratedFromMirror = { user: mirrorUser, backendApiSecret: legacyMirror.backendApiSecret };
        // 审计修复：迁入镜像凭据时同时补录账号记录——旧快照只有 user 而缺
        // githubToken/savedAccounts 时，仅迁 Token 不建条目会让后续归一化看到
        // 顶层 PAT 已为 null 而无法补录，savedAccounts 为空导致 switchAccount
        // 无法选择该账号。用已核对身份的 mirror user 补录缺失条目（已有条目
        // 保持不变），随后按现有流程剥除账号 PAT。
        if (!legacySaved[mirrorAccountId]) {
          const now = new Date().toISOString();
          legacySaved[mirrorAccountId] = {
            accountId: mirrorAccountId,
            user: mirrorUser,
            githubToken: legacyMirror.githubToken,
            addedAt: now,
            lastUsedAt: now,
          };
        }
      }
    }
    if (Object.keys(tokens).length > 0 && hasGhAccountsBridge()) {
      // R2-B1：迁移时磁盘完整映射尚未加载，saveGhAccountTokens 自动先读后写
      // 合并更新——迁移写入的 Token 不会抹掉 gh-accounts.enc 中其他账号已有的 PAT。
      // 保存 Promise 交给 onRehydrateStorage 等待完成后再读盘，防止读早于写。
      const tokensSnapshot = { ...tokens };
      // 第 12 轮审计修复：记录迁移输入——确认前 partialize 把这些旧凭据保留在
      // 分片中作为迁移重试输入（运行时新 PAT 一律剥除，见 savedAccountsForShard）。
      // ISSUE-1：输入按账号维护，保存成功后逐项失效；全部失效时才允许确认。
      setV19MigrationInputs(tokensSnapshot);
      const mirrorToClear = migratedFromMirror;
      // 第 13 轮审计修复：迁移改为补写语义（fillMissingGhAccountTokens）——
      // 磁盘已有该账号 PAT（新凭据已确认落盘、旧分片尚未刷新）时保留磁盘值，
      // 绝不用迁移输入中的旧 PAT 覆盖；补写确认的账号才退出迁移输入。
      pendingMigrationTokenSave = fillMissingGhAccountTokens(tokensSnapshot)
        .then((settledTokens) => {
          // 加密保存确认（或磁盘已有值）：本次落盘的账号退出迁移输入，输入
          // 清空后才允许持久化分片提交剥除 PAT 的干净快照（其他账号的未落盘
          // 输入仍会保留）。
          markV19MigrationTokensSaved(settledTokens);
          if (mirrorToClear) {
            writeAuthMirror({
              user: mirrorToClear.user,
              githubToken: null,
              backendApiSecret: mirrorToClear.backendApiSecret,
            });
          }
          return { ok: true as const, tokens: tokensSnapshot };
        })
        .catch((err) => ({ ok: false as const, tokens: tokensSnapshot, error: err }));
    } else {
      // 无需迁移落盘：Web 构建不持久化 PAT（剥除即设计），桌面无 Token 时
      // 剥除为空操作——直接确认，保持既有剥除语义（迁移输入为空时才置位）。
      confirmV19TokenSave();
    }
    stateRecord.githubToken = null;
    stateRecord.savedAccounts = stripSavedAccountTokens(legacySaved);
  }

  return state as PersistedAppState;
},
merge: (persistedState, currentState) => {
  const normalized = normalizePersistedState(
persistedState as PersistedAppState | undefined,
currentState as AppStoreState
  );

  logger.info('store.hydrate', 'Store rehydrated', {
isAuthenticated: normalized.isAuthenticated,
repositoriesCount: normalized.repositories?.length || 0,
gistsCount: normalized.gists?.length || 0,
lastSync: normalized.lastSync,
language: normalized.language,
webdavConfigsCount: normalized.webdavConfigs?.length || 0,
customCategoriesCount: normalized.customCategories?.length || 0,
  });

  // Keep the synchronous localStorage mirror aligned with the hydrated
  // auth state (covers restores that came from IndexedDB or the mirror).
  const merged = {
...currentState,
...normalized,
  };
  // ISSUE-1(C) 跨重启兜底：存在尚未完成的显式删除请求时，陈旧分片里残留的
  // 账号 Token 不得进入运行时会话（否则登录页仍可一键恢复已退出账号）。
  const pendingRemovalIds = getPendingGhAccountSecretRemovalIds();
  if (pendingRemovalIds.length > 0 && merged.savedAccounts) {
    const savedAccounts = { ...merged.savedAccounts };
    let changed = false;
    for (const accountId of pendingRemovalIds) {
      const entry = savedAccounts[accountId];
      if (!entry?.githubToken) continue;
      savedAccounts[accountId] = { ...entry, githubToken: '' };
      changed = true;
    }
    if (changed) merged.savedAccounts = savedAccounts;
  }
  // ISSUE-1(A)：第二次及以后启动 migrate 不再运行，模块级迁移输入为空。若持久化
  // 分片中的 savedAccounts 仍带 PAT（只能说明上次启动的迁移保存未确认），把它们
  // 重新收进迁移输入——启动重试失败或安全存储读取失败时，水化收尾的持久化仍会
  // 保留这些旧 PAT，第三次启动可以继续重试，而不是被首次持久化永久剥除。
  // 读取的是分片里已经存在的 PAT，不新增任何明文写入来源。
  seedV19MigrationInputsFromPersistedShard(persistedState);
  // 第 12 轮审计修复（桌面镜像迁移）：覆写镜像前先捕获仅存于旧镜像的明文 PAT
  //（桌面端、v19 落盘尚未确认、身份一致、合并状态无该账号凭据）。捕获成功时
  // 不覆写镜像——旧 PAT 在加密写入确认前必须保留（可跨重启重试）；确认成功后
  // 由消费路径按 B7 语义覆写清除。非桌面端/无待迁移凭据时照常覆写镜像。
  pendingLegacyMirrorMigration = captureLegacyMirrorForDesktopMigration(merged);
  if (!pendingLegacyMirrorMigration) {
    writeAuthMirror({
user: merged.user ?? null,
githubToken: typeof merged.githubToken === 'string' ? merged.githubToken : null,
backendApiSecret: typeof merged.backendApiSecret === 'string' ? merged.backendApiSecret : null,
    });
  }

  return merged;
},
onRehydrateStorage: (state) => {
  const hydrationStart = Date.now();
  return (_rehydratedState, error) => {
const elapsedMs = Date.now() - hydrationStart;
if (error) {
  logger.errorFromError('store.hydrate', 'Store hydration failed', error, { elapsedMs });
} else {
  logger.info('store.hydrate', 'Store hydration complete', { elapsedMs });
}
// 审计修复（B7）：桌面端水化后先从 safeStorage 加密文件回填账号 Token，
// 再宣布 hydration 完成——避免 isAuthenticated 短暂为 false 导致登录页闪现。
// Web 构建（无 IPC 桥）直接完成：PAT 未持久化，按需重新授权。
// 审计修复（R2-B1）：读取失败（桥异常/主进程 error）与「磁盘上没有 Token」
// 是两回事——失败时保持「未加载」状态（saveGhAccountTokens 此后自动合并
// 写入，绝不覆写磁盘上其他账号的 PAT），只有确认加载到完整映射才回填。
const finishHydration = () => state.setHasHydrated(true);
if (error || !hasGhAccountsBridge()) {
  finishHydration();
  return;
}
const migrationSave = pendingMigrationTokenSave;
pendingMigrationTokenSave = null;
// 第 12 轮审计修复：merge 捕获的旧镜像 PAT 先迁入 safeStorage（R2-B1 合并
// 写入），确认成功后（已置确认标记并清除镜像明文）再读盘回填会话；失败时
// 镜像明文保留，下次启动 merge 重新捕获重试，其余账号的回填不受影响。
const mirrorMigrationSave = consumePendingLegacyMirrorMigrationSave();
const settleMirrorMigration = async (): Promise<void> => {
  if (!mirrorMigrationSave) return;
  const mirrorResult = await mirrorMigrationSave;
  if (!mirrorResult.ok) {
    logger.warn('store.hydrate', 'Legacy auth-mirror token migration into gh-accounts failed; mirror plaintext kept for next-start retry', {
      error: mirrorResult.error instanceof Error ? mirrorResult.error.message : String(mirrorResult.error),
    });
  }
};
(migrationSave ?? Promise.resolve(null))
  .then(async (migrationResult) => {
    if (migrationResult && !migrationResult.ok) {
      logger.warn('store.hydrate', 'v19 gh-accounts migration save failed; restoring migrated tokens in memory', {
        error: migrationResult.error instanceof Error ? migrationResult.error.message : String(migrationResult.error),
      });
      // 显式恢复分支：迁移落盘失败时不按成功路径读盘，先把迁移出的 Token 回填到内存保持本次会话可用
      if (Object.keys(migrationResult.tokens).length > 0) {
        const { restorePersistedAccountTokens } = useAppStore.getState();
        restorePersistedAccountTokens(migrationResult.tokens);
      }
      // 第 12 轮：镜像迁移独立于快照迁移——失败路径同样尝试迁入。
      await settleMirrorMigration();
      // 迁移保存失败后立即重试一次：瞬时故障可自愈；仍失败则保留可重试状态
      //（持久化分片由 savedAccountsForShard 保留迁移输入，下次启动再次重试）。
      await retryUnconfirmedV19TokenSave();
      return;
    }
    await settleMirrorMigration();
    const result = await loadGhAccountTokens();
    if (result.status === 'error') {
      logger.warn('store.hydrate', 'gh-accounts secure storage read failed; tokens not restored', {
        error: result.error,
      });
      // ISSUE-1(A)：读取失败不能跳过重试——分片重建的迁移输入必须仍有重试机会
      //（写入内部会先读后写，读取仍失败则保留输入，绝不剥除分片中的旧 PAT）。
      await retryUnconfirmedV19TokenSave();
      return;
    }
    if (result.status === 'loaded' && Object.keys(result.tokens).length > 0) {
      // 磁盘已有确认写入的账号：先让位于磁盘值，再回填/重试（ISSUE-1(B)）。
      reconcileLoadedDiskTokensWithMigrationInputs(result.tokens);
      // 惰性访问 store（模块初始化环规避，同 accountWorkspace 的做法）
      const { restorePersistedAccountTokens } = useAppStore.getState();
      restorePersistedAccountTokens(result.tokens);
    }
    // 迁移成功路径的确认标记已在保存成功的 then 中置位；本次启动无需迁移时
    // 由 retry 检查收敛（快照无 Token 即确认，仍有残留 Token 则重试迁入）。
    await retryUnconfirmedV19TokenSave();
  })
  .catch(() => undefined)
  .finally(() => finishHydration());
  };
},
};

/**
 * 仅供测试：把 v19 迁移的模块级状态复位为「一次全新应用启动」的初始值
 *（桌面未确认、无迁移输入、无待结算的迁移 Promise）。
 */
export const __resetV19TokenSaveStateForTest = (): void => {
  v19TokenSaveConfirmed = !hasGhAccountsBridge();
  pendingMigrationTokenSave = null;
  pendingLegacyMirrorMigration = null;
  __resetV19MigrationInputsForTest();
};
