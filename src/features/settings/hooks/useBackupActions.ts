
import { useT } from '../../../i18n/useT';
import { useCallback, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { AIConfig, Repository, WebDAVConfig } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import {
  accountIdKey,
  applyAccountWorkspace,
  captureAccountWorkspace,
  emptyAccountWorkspace,
  getAccountSessionGeneration,
  normalizeAccountWorkspaces,
  normalizeSavedAccounts,
} from '../../../store/helpers/accountWorkspace';
import {
  isRealBackupSecret,
  maskSavedAccountsForBackup,
  mergeBackupWorkspaces as mergeAccountWorkspacesForBackup,
  replaceWorkspacesForSelectedTypes,
  validateBackupRepositories,
} from '../../../utils/backupWorkspace';
import { useDialog } from '../../../hooks/useDialog';
import { normalizeReleaseSourceSettings } from '../../../utils/releaseSources';
import { WebDAVService } from '../../../services/webdavService';
import { createGitHubApiService } from '../../../services/githubApiFactory';
import {
  hasGhAccountsBridge,
  syncGhAccountTokensFromState,
} from '../../../store/persistence/ghAccountSecrets';

export interface RestoreBackupOptions {
  /** 列举备份时绑定的账号 ID（用于检测 listBackups 期间切号）。 */
  expectedAccountId?: string | null;
  /** 列举备份时绑定的会话代次（用于检测切出又切回同一账号）。 */
  expectedGeneration?: number;
  /** 列举备份时使用的 WebDAV 配置（固定从同一配置下载，防止配置切换下载同名文件）。 */
  config?: WebDAVConfig;
}

export interface BackupActions {
  activeConfig: WebDAVConfig | undefined;
  isBackingUp: boolean;
  isRestoring: boolean;
  backup: () => Promise<void>;
  /**
   * 从指定备份文件恢复（审计修复 C46）。备份文件由 UI 先经 listBackups
   * 列出供用户选择；不传 backupFile 时保持旧行为（下载排序后最新备份，
   * 兼容既有程序化调用）。
   */
  restore: (backupFile?: string, options?: RestoreBackupOptions) => Promise<void>;
  /**
   * 列出 WebDAV 上可恢复的备份文件（审计修复 C46）。recommended 为包含
   * 当前账号工作区的最新备份（文件名以 `-{当前账号ID}.json` 结尾；未登录
   * 时推荐 `local` 标记的最新备份）；无匹配时推荐最新的其他备份。
   */
  listBackups: () => Promise<{ files: string[]; recommended: string | null }>;
}

/**
 * Owns WebDAV backup and restore orchestration. The payload deliberately keeps
 * the existing key-masking rules, including proxy password and RPC secret.
 */
export const useBackupActions = (): BackupActions => {
  const t = useT('settings');
  const state = useAppStore(useShallow((store) => ({
    repositories: store.repositories,
    releases: store.releases,
    customCategories: store.customCategories,
    hiddenDefaultCategoryIds: store.hiddenDefaultCategoryIds,
    aiConfigs: store.aiConfigs,
    webdavConfigs: store.webdavConfigs,
    activeWebDAVConfig: store.activeWebDAVConfig,
    proxyConfig: store.proxyConfig,
    rpcDownloadConfig: store.rpcDownloadConfig,
    routeMode: store.routeMode,
    backendApiSecret: store.backendApiSecret,
    includeKeysInBackup: store.includeKeysInBackup,
    setLastBackup: store.setLastBackup,
    setRepositories: store.setRepositories,
    setReleases: store.setReleases,
    addCustomCategory: store.addCustomCategory,
    deleteCustomCategory: store.deleteCustomCategory,
    hideDefaultCategory: store.hideDefaultCategory,
    showDefaultCategory: store.showDefaultCategory,
    addAIConfig: store.addAIConfig,
    updateAIConfig: store.updateAIConfig,
    deleteAIConfig: store.deleteAIConfig,
    addWebDAVConfig: store.addWebDAVConfig,
    updateWebDAVConfig: store.updateWebDAVConfig,
    deleteWebDAVConfig: store.deleteWebDAVConfig,
    setProxyConfig: store.setProxyConfig,
    setRpcDownloadConfig: store.setRpcDownloadConfig,
    setRouteMode: store.setRouteMode,
    setBackendApiSecret: store.setBackendApiSecret,
    setReleaseSourceSettings: store.setReleaseSourceSettings,
  })));
  const { toast, confirm } = useDialog();
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const activeConfig = useMemo(
    () => state.webdavConfigs.find((config) => config.id === state.activeWebDAVConfig),
    [state.activeWebDAVConfig, state.webdavConfigs],
  );

  const backup = useCallback(async () => {
    if (!activeConfig) {
      toast(t('useBackupActions.please-configure-and-activate-webdav-service-fir'), 'error');
      return;
    }
    setIsBackingUp(true);
    try {
      const backupData = {
        repositories: state.repositories,
        releases: state.releases,
        gists: useAppStore.getState().gists,
        starredGists: useAppStore.getState().starredGists,
        forks: useAppStore.getState().forks,
        readForks: Array.from(useAppStore.getState().readForks),
        categoryOrder: useAppStore.getState().categoryOrder,
        defaultCategoryOverrides: useAppStore.getState().defaultCategoryOverrides,
        categoryListIdMap: useAppStore.getState().categoryListIdMap,
        syncMode: useAppStore.getState().syncMode,
        syncModeConfigured: useAppStore.getState().syncModeConfigured,
        customCategories: state.customCategories,
        hiddenDefaultCategoryIds: state.hiddenDefaultCategoryIds,
        aiConfigs: state.aiConfigs.map((config) => ({
          ...config,
          apiKey: state.includeKeysInBackup ? config.apiKey : (config.apiKey ? '***' : ''),
        })),
        webdavConfigs: state.webdavConfigs.map((config) => ({
          ...config,
          password: state.includeKeysInBackup ? config.password : (config.password ? '***' : ''),
        })),
        proxyConfig: {
          ...state.proxyConfig,
          password: state.includeKeysInBackup ? state.proxyConfig.password : (state.proxyConfig.password ? '***' : ''),
        },
        rpcDownloadConfig: {
          ...state.rpcDownloadConfig,
          secret: state.includeKeysInBackup ? state.rpcDownloadConfig.secret : (state.rpcDownloadConfig.secret ? '***' : ''),
        },
        routeMode: state.routeMode,
        backendApiSecret: state.includeKeysInBackup ? state.backendApiSecret : (state.backendApiSecret ? '***' : null),
        releaseSubscriptions: Array.from(useAppStore.getState().releaseSubscriptions),
        releaseSourceSettings: useAppStore.getState().releaseSourceSettings,
        readReleases: Array.from(useAppStore.getState().readReleases),
        includeKeysInBackup: state.includeKeysInBackup,
        // 多账号备份（Issue #611）：活跃账号 ID + 全账号工作区 + 已保存账号列表
        activeAccountId: accountIdKey(useAppStore.getState().user),
        accountWorkspaces: mergeAccountWorkspacesForBackup(
          useAppStore.getState().accountWorkspaces,
          useAppStore.getState().accountWorkspaces,
          accountIdKey(useAppStore.getState().user),
          captureAccountWorkspace(useAppStore.getState()),
          true,
        ),
        savedAccounts: maskSavedAccountsForBackup(useAppStore.getState().savedAccounts, state.includeKeysInBackup),
        exportedAt: new Date().toISOString(),
        version: '1.3',
      };
      const accountTag = accountIdKey(useAppStore.getState().user) ?? 'local';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `github-stars-backup-${timestamp}-${accountTag}.json`;
      const success = await new WebDAVService(activeConfig).uploadFile(filename, JSON.stringify(backupData, null, 2));
      if (success) {
        state.setLastBackup(new Date().toISOString());
        toast(t('useBackupActions.data-backup-successful'), 'success');
      } else {
        console.error('Backup failed: uploadFile returned falsy');
        toast(t('useBackupActions.data-backup-failed'), 'error');
      }
    } catch (error) {
      console.error('Backup failed:', error);
      toast(`${t('useBackupActions.backup-failed')}: ${(error as Error).message}`, 'error');
    } finally {
      setIsBackingUp(false);
    }
  }, [activeConfig, state, t, toast]);

  const listBackups = useCallback(async (): Promise<{ files: string[]; recommended: string | null }> => {
    if (!activeConfig) return { files: [], recommended: null };
    const service = new WebDAVService(activeConfig);
    const files = await service.listFiles();
    const backupFiles = files.filter((file) => file.startsWith('github-stars-backup-')).sort();
    // 审计修复（C46）：默认推荐包含当前账号工作区的最新备份——备份文件名
    // 以 `-{账号ID}.json`（或未登录时的 `-local.json`）结尾。
    const accountTag = accountIdKey(useAppStore.getState().user) ?? 'local';
    const accountBackups = backupFiles.filter((file) => file.endsWith(`-${accountTag}.json`));
    const recommended = accountBackups.at(-1) ?? backupFiles.at(-1) ?? null;
    return { files: backupFiles, recommended };
  }, [activeConfig]);

  const restore = useCallback(async (backupFile?: string, options?: RestoreBackupOptions) => {
    const targetConfig = options?.config ?? activeConfig;
    if (!targetConfig) {
      toast(t('useBackupActions.please-configure-and-activate-webdav-service-fir'), 'error');
      return;
    }
    // 恢复流程在 listBackups()/confirm()/listFiles()/downloadFile() 处异步等待，
    // 期间账号可能被切换。优先使用列举时传入的账号与会话代次快照，确保 listBackups
    // 期间切号（包括切出又切回同一账号）也会中止恢复。
    const restoreAccountId = options?.expectedAccountId !== undefined
      ? options.expectedAccountId
      : accountIdKey(useAppStore.getState().user);
    const restoreGeneration = options?.expectedGeneration !== undefined
      ? options.expectedGeneration
      : getAccountSessionGeneration();
    const ensureSameAccount = (): boolean => {
      const currentAccountId = accountIdKey(useAppStore.getState().user);
      // 仅比较账号 ID 无法识别「切出后又切回」：会话代次同时校验。
      if (
        currentAccountId !== restoreAccountId
        || getAccountSessionGeneration() !== restoreGeneration
      ) {
        toast(t('useBackupActions.account-changed-during-restore'), 'error');
        return false;
      }
      return true;
    };
    if (!ensureSameAccount()) return;
    const confirmed = await confirm(
      t('useBackupActions.restore-data'),
      t('useBackupActions.restoring-data-will-overwrite-all-current-data-c'),
      { type: 'warning' },
    );
    if (!confirmed) return;
    if (!ensureSameAccount()) return;

    setIsRestoring(true);
    try {
      const service = new WebDAVService(targetConfig);
      // 审计修复（C46）：不再始终下载排序后最新备份——UI 先经 listBackups
      // 列出可恢复备份供用户选择（默认推荐包含当前账号工作区的最新备份），
      // 选中的文件经 backupFile 显式传入；缺省时保持旧行为兼容程序化调用。
      let fileName = backupFile;
      if (!fileName) {
        const files = await service.listFiles();
        if (!ensureSameAccount()) return;
        const backupFiles = files.filter((file) => file.startsWith('github-stars-backup-'));
        if (backupFiles.length === 0) {
          toast(t('useBackupActions.no-backup-files-found'), 'error');
          return;
        }
        fileName = backupFiles.sort().reverse()[0];
      }
      const content = await service.downloadFile(fileName);
      if (!ensureSameAccount()) return;
      if (!content) {
        toast(t('useBackupActions.backup-file-is-empty-cannot-restore'), 'error');
        return;
      }
      const backupData = JSON.parse(content) as Record<string, unknown>;
      const backupIncludedKeys = backupData.includeKeysInBackup ?? true;

      // 审计修复（C47）：repositories 在首次写入 store 前逐项校验 Repository
      // 结构（null/无效字段拒绝）——字段存在但无效时整体拒绝该工作区并提示，
      // 绝不保存部分有效数据；字段缺失保持既有回退语义，显式 [] 清空语义保留。
      let backupRepositories: Repository[] | undefined;
      if (backupData.repositories !== undefined && backupData.repositories !== null) {
        const validatedRepositories = validateBackupRepositories(backupData.repositories);
        if (validatedRepositories === null) {
          toast(`${t('useBackupActions.restore-failed')}: invalid repositories payload`, 'error');
          return;
        }
        backupRepositories = validatedRepositories;
      }

      // ── 多账号恢复（Issue #611）────────────────────────────────────
      // 先合并工作区与账号元数据，再决定顶层恢复目标（防止跨账号错位）。
      // liveAccountId 用发起恢复时记录的账号 ID（等待期间账号可能已切换）。
      const liveAccountId = restoreAccountId;
      const rawActiveAccountId = backupData.activeAccountId;
      if (
        rawActiveAccountId !== undefined
        && rawActiveAccountId !== null
        && (typeof rawActiveAccountId !== 'string' || !/^\d+$/.test(rawActiveAccountId))
      ) {
        toast(t('useBackupActions.backup-failed'), 'error');
        return;
      }
      const backupAccountId = typeof rawActiveAccountId === 'string' ? rawActiveAccountId : null;
      // 备份显式声明了归属账号即以其为准（包括当前未登录 liveAccountId=null）。
      const restoreTargetsOtherAccount = !!backupAccountId && backupAccountId !== liveAccountId;
      // R2-C9：区分备份显式的 `activeAccountId: null`（新版未登录导出）与旧版
      // 缺省字段。显式 null 的顶层数据没有归属账号，不得自动应用到当前已
      // 登录账号；缺省字段保留旧版兼容行为（应用到当前账号）。
      const skipUnboundTopLevelApply = Object.prototype.hasOwnProperty.call(backupData, 'activeAccountId')
        && rawActiveAccountId === null
        && !!liveAccountId;

      const rawBackupWorkspaces = (
        backupData.accountWorkspaces
        && typeof backupData.accountWorkspaces === 'object'
        && !Array.isArray(backupData.accountWorkspaces)
      )
        ? (backupData.accountWorkspaces as Record<string, unknown>)
        : {};
      // 备份实际携带的工作区（规整化后）：判断是否应用当前账号工作区必须以它
      // 为准，不能用合并结果——合并结果含本机旧快照，备份不含当前账号时会
      // 误把旧快照应用回顶层，回滚实时数据。
      const normalizedBackupWorkspaces = backupData.accountWorkspaces
        ? normalizeAccountWorkspaces(backupData.accountWorkspaces)
        : {};
      // R2-C8：登记账号/写入工作区前逐份校验各账号工作区的仓库数据（与顶层
      // 恢复和本地 JSON 导入共用 validateBackupRepositories）。非数组或含无效
      // 条目时整体拒绝恢复，绝不用损坏/部分数据覆盖本机工作区；显式 [] 的
      // 清空语义保留（validated === [] 仍会写入）。
      for (const [workspaceAccountId, rawWorkspace] of Object.entries(rawBackupWorkspaces)) {
        if (!rawWorkspace || typeof rawWorkspace !== 'object' || Array.isArray(rawWorkspace)) continue;
        const validatedWorkspaceRepositories = validateBackupRepositories(
          (rawWorkspace as Record<string, unknown>).repositories,
        );
        if (validatedWorkspaceRepositories === null) {
          toast(
            `${t('useBackupActions.restore-failed')}: invalid repositories payload for account ${workspaceAccountId}`,
            'error',
          );
          return;
        }
        if (validatedWorkspaceRepositories !== undefined) {
          const normalizedWorkspace = normalizedBackupWorkspaces[workspaceAccountId];
          if (normalizedWorkspace) normalizedWorkspace.repositories = validatedWorkspaceRepositories;
        }
      }
      // 防御性复制：备份未携带工作区时避免归档写原地改写当前 state 字典
      const mergedWorkspaces = backupData.accountWorkspaces
        ? mergeAccountWorkspacesForBackup(
            useAppStore.getState().accountWorkspaces,
            backupData.accountWorkspaces as Record<string, unknown>,
            liveAccountId,
            null,
            false,
          )
        : { ...useAppStore.getState().accountWorkspaces };

      // 恢复 savedAccounts：仅当备份包含真实密钥且通过 GitHub 身份归属校验时恢复 Token，
      // 否则保留本地已有 Token 或置空要求重新授权（避免跨账号 PAT 冒用）。
      let ghTokenPersistFailed = false;
      let rejectedBackupTokenCount = 0;
      if (backupData.savedAccounts && typeof backupData.savedAccounts === 'object') {
        const backupAccounts = normalizeSavedAccounts(backupData.savedAccounts);
        const stateBeforeVerify = useAppStore.getState();
        const verifiedBackupTokens = new Map<string, string>();
        for (const [id, account] of Object.entries(backupAccounts)) {
          const local = stateBeforeVerify.savedAccounts[id];
          if (local?.githubToken) continue;
          if (!backupIncludedKeys || !isRealBackupSecret(account.githubToken)) continue;
          try {
            const verifiedUser = await createGitHubApiService(account.githubToken, { direct: true }).getCurrentUser();
            if (accountIdKey(verifiedUser) === id) {
              verifiedBackupTokens.set(id, account.githubToken);
            } else {
              rejectedBackupTokenCount += 1;
            }
          } catch {
            rejectedBackupTokenCount += 1;
          }
        }
        // 异步 PAT 校验期间可能发生账号切换，写回前再次核对会话
        if (!ensureSameAccount()) return;
        const stateNow = useAppStore.getState();
        const mergedSaved = { ...stateNow.savedAccounts };
        for (const [id, account] of Object.entries(backupAccounts)) {
          const local = mergedSaved[id];
          mergedSaved[id] = {
            ...(local ?? account),
            ...account,
            githubToken: local?.githubToken
              ? local.githubToken
              : (verifiedBackupTokens.get(id) ?? ''),
          };
        }
        useAppStore.setState({ savedAccounts: mergedSaved });
        // 桌面端将备份恢复出的真实 GitHub Token 立即持久化到 safeStorage，避免仅留内存重启丢失
        if (hasGhAccountsBridge()) {
          try {
            const persisted = await syncGhAccountTokensFromState(useAppStore.getState());
            if (!persisted) ghTokenPersistFailed = true;
          } catch {
            ghTokenPersistFailed = true;
          }
        }
      }

      const ALL_WORKSPACE_TYPES = ['repositories', 'releases', 'releaseSubscriptions', 'customCategories'];
      const applyPartialLiveWorkspace = (accountId: string): void => {
        if (!normalizedBackupWorkspaces[accountId]) return;
        const rawLive = rawBackupWorkspaces[accountId];
        if (!rawLive || typeof rawLive !== 'object' || Array.isArray(rawLive)) return;
        const liveBase = captureAccountWorkspace(useAppStore.getState());
        const mergedLive = replaceWorkspacesForSelectedTypes(
          { [accountId]: liveBase },
          { [accountId]: rawLive },
          ALL_WORKSPACE_TYPES,
        )[accountId];
        if (mergedLive) {
          useAppStore.setState(applyAccountWorkspace(mergedLive));
        }
      };

      if (restoreTargetsOtherAccount) {
        // 备份顶层归档进其归属账号工作区。归档基座绝不借用当前登录账号的
        // 实时数据（跨账号串号防线）：本机无该账号快照时以空工作区为基座。
        const previous = mergedWorkspaces[backupAccountId!];
        mergedWorkspaces[backupAccountId!] = {
          ...(previous ?? emptyAccountWorkspace()),
          repositories: backupRepositories !== undefined
            ? backupRepositories
            : (previous?.repositories ?? []),
          releases: Array.isArray(backupData.releases)
            ? (backupData.releases as import('../../../types').Release[])
            : (previous?.releases ?? []),
          customCategories: Array.isArray(backupData.customCategories)
            ? (backupData.customCategories as import('../../../types').Category[])
            : (previous?.customCategories ?? []),
          hiddenDefaultCategoryIds: Array.isArray(backupData.hiddenDefaultCategoryIds)
            ? (backupData.hiddenDefaultCategoryIds as string[])
            : (previous?.hiddenDefaultCategoryIds ?? []),
          defaultCategoryOverrides: (backupData.defaultCategoryOverrides && typeof backupData.defaultCategoryOverrides === 'object'
            ? backupData.defaultCategoryOverrides
            : previous?.defaultCategoryOverrides ?? {}) as import('../../../types').AccountWorkspace['defaultCategoryOverrides'],
          categoryOrder: Array.isArray(backupData.categoryOrder)
            ? (backupData.categoryOrder as string[])
            : (previous?.categoryOrder ?? []),
          // 备份实际提供的其余工作区字段：缺失时才沿用该账号原快照。
          ...(Array.isArray(backupData.gists)
            ? { gists: backupData.gists as import('../../../types').Gist[] }
            : {}),
          ...(Array.isArray(backupData.starredGists)
            ? { starredGists: backupData.starredGists as import('../../../types').Gist[] }
            : {}),
          ...(Array.isArray(backupData.forks)
            ? { forks: backupData.forks as import('../../../types').ForkRepo[] }
            : {}),
          ...(Array.isArray(backupData.readForks)
            ? { readForks: backupData.readForks as number[] }
            : {}),
          ...(Array.isArray(backupData.releaseSubscriptions)
            ? { releaseSubscriptions: backupData.releaseSubscriptions as number[] }
            : {}),
          ...(Array.isArray(backupData.readReleases)
            ? { readReleases: backupData.readReleases as number[] }
            : {}),
          ...(backupData.releaseSourceSettings && typeof backupData.releaseSourceSettings === 'object'
            ? { releaseSourceSettings: normalizeReleaseSourceSettings(backupData.releaseSourceSettings) }
            : {}),
          ...(backupData.categoryListIdMap && typeof backupData.categoryListIdMap === 'object'
            ? { categoryListIdMap: backupData.categoryListIdMap as Record<string, string> }
            : {}),
          ...(backupData.syncMode === 'stars' || backupData.syncMode === 'stars-and-lists'
            ? { syncMode: backupData.syncMode }
            : {}),
          ...(typeof backupData.syncModeConfigured === 'boolean'
            ? { syncModeConfigured: backupData.syncModeConfigured }
            : {}),
        };
        // 不覆盖当前登录账号的顶层状态；仅当备份实际包含当前账号工作区时按
        // 备份实际提供的字段部分应用（保留本机实时值，避免规整默认值清空仓库）
        useAppStore.setState({ accountWorkspaces: mergedWorkspaces });
        if (liveAccountId) {
          applyPartialLiveWorkspace(liveAccountId);
        }
      } else if (backupData.accountWorkspaces) {
        useAppStore.setState({ accountWorkspaces: mergedWorkspaces });
        // 同账号恢复：以当前实时工作区为基座，只覆盖备份中实际提供且通过校验的
        // 工作区字段（含 categoryOrder、defaultCategoryOverrides、selectedGistCategory、
        // lastSync 等），随后的旧格式顶层兼容字段按需覆盖，最后统一更新工作区快照。
        if (liveAccountId) {
          applyPartialLiveWorkspace(liveAccountId);
        }
      }

      if (!restoreTargetsOtherAccount && !skipUnboundTopLevelApply) {
        if (backupRepositories !== undefined) state.setRepositories(backupRepositories, { allowEmpty: true });
        if (Array.isArray(backupData.releases)) state.setReleases(backupData.releases as typeof state.releases, { allowEmpty: true });
        // 工作区级数据（Gist / Fork / 同步范围）随 1.3 备份恢复
        if (Array.isArray(backupData.gists)) useAppStore.setState({ gists: backupData.gists as import('../../../types').Gist[] });
        if (Array.isArray(backupData.starredGists)) useAppStore.setState({ starredGists: backupData.starredGists as import('../../../types').Gist[] });
        if (Array.isArray(backupData.forks)) useAppStore.setState({ forks: backupData.forks as import('../../../types').ForkRepo[] });
        if (Array.isArray(backupData.readForks)) {
          useAppStore.setState({ readForks: new Set(backupData.readForks.filter((id): id is number => typeof id === 'number')) });
        }
        if (typeof backupData.categoryListIdMap === 'object' && backupData.categoryListIdMap !== null) {
          useAppStore.setState({ categoryListIdMap: backupData.categoryListIdMap as Record<string, string> });
        }
        if (backupData.syncMode === 'stars' || backupData.syncMode === 'stars-and-lists') {
          useAppStore.setState({ syncMode: backupData.syncMode });
        }
        if (typeof backupData.syncModeConfigured === 'boolean') {
          useAppStore.setState({ syncModeConfigured: backupData.syncModeConfigured });
        }
      }

      // 跨账号恢复时，备份顶层的订阅/已读/分类属于被恢复账号，已随顶层归档进
      // 其工作区；绝不能写入恢复者当前账号的顶层状态（串号防线）。
      if (!restoreTargetsOtherAccount && !skipUnboundTopLevelApply) {
        try {
          if (Array.isArray(backupData.releaseSubscriptions)) {
            const values = backupData.releaseSubscriptions.filter((id): id is number => typeof id === 'number');
            useAppStore.setState({ releaseSubscriptions: new Set(values) });
          }
          if (backupData.releaseSourceSettings) state.setReleaseSourceSettings(backupData.releaseSourceSettings as Parameters<typeof state.setReleaseSourceSettings>[0]);
          if (Array.isArray(backupData.readReleases)) {
            const values = backupData.readReleases.filter((id): id is number => typeof id === 'number');
            useAppStore.setState({ readReleases: new Set(values) });
          }
        } catch (error) {
          console.warn('恢复 Release 订阅与已读状态时发生问题：', error);
        }

        try {
          // 只有备份实际提供该字段时才清空既有数据：缺失字段必须保留已恢复
          // 的工作区状态（显式空数组仍表示清空）。
          if (Array.isArray(backupData.customCategories)) {
            // 整体替换分类定义，而不是 delete+add：deleteCustomCategory 会清除
            // 仓库的 custom_category / category_locked，而仓库刚按备份写入，
            // 逐个删除会把刚恢复的仓库分类抹掉。
            const restoredCategories = backupData.customCategories
              .filter((category) => category && typeof category === 'object' && 'id' in category && 'name' in category)
              .map((category) => ({
                ...(category as Parameters<typeof state.addCustomCategory>[0]),
                isCustom: true,
              }));
            useAppStore.setState((current) => ({
              customCategories: restoredCategories,
              selectedCategory: restoredCategories.some((category) => category.id === current.selectedCategory)
                ? current.selectedCategory
                : 'all',
            }));
          }
          if (Array.isArray(backupData.hiddenDefaultCategoryIds)) {
            for (const categoryId of useAppStore.getState().hiddenDefaultCategoryIds) {
              if (typeof categoryId === 'string') state.showDefaultCategory(categoryId);
            }
            for (const categoryId of backupData.hiddenDefaultCategoryIds) {
              if (typeof categoryId === 'string') state.hideDefaultCategory(categoryId);
            }
          }
        } catch (error) {
          console.warn('恢复自定义分类时发生问题：', error);
        }
      }

      try {
        if (Array.isArray(backupData.aiConfigs)) {
          const currentMap = new Map(useAppStore.getState().aiConfigs.map((config: AIConfig) => [config.id, config]));
          const backupConfigs = backupData.aiConfigs as AIConfig[];
          const backupIds = new Set(backupConfigs.map((config) => config?.id).filter(Boolean));
          for (const [id] of currentMap) if (!backupIds.has(id)) state.deleteAIConfig(id);
          for (const config of backupConfigs) {
            if (!config?.id) continue;
            const existing = currentMap.get(config.id);
            const apiKey = backupIncludedKeys && config.apiKey && config.apiKey !== '***' ? config.apiKey : existing?.apiKey ?? '';
            if (existing) {
              state.updateAIConfig(config.id, { ...config, apiKey, isActive: existing.isActive });
            } else {
              state.addAIConfig({ ...config, apiKey, isActive: config.isActive });
            }
          }
        }
      } catch (error) {
        console.warn('恢复 AI 配置时发生问题：', error);
      }

      try {
        if (Array.isArray(backupData.webdavConfigs)) {
          const currentMap = new Map(useAppStore.getState().webdavConfigs.map((config: WebDAVConfig) => [config.id, config]));
          const backupConfigs = backupData.webdavConfigs as WebDAVConfig[];
          const backupIds = new Set(backupConfigs.map((config) => config?.id).filter(Boolean));
          for (const [id] of currentMap) if (!backupIds.has(id)) state.deleteWebDAVConfig(id);
          for (const config of backupConfigs) {
            if (!config?.id) continue;
            const existing = currentMap.get(config.id);
            const sameWebDAVService = Boolean(existing)
              && (config.url ?? '').trim() === (existing!.url ?? '').trim()
              && (config.username ?? '') === (existing!.username ?? '');
            const password = backupIncludedKeys && isRealBackupSecret(config.password)
              ? config.password
              : (sameWebDAVService ? existing?.password ?? '' : '');
            if (existing) {
              state.updateWebDAVConfig(config.id, { ...config, password, isActive: existing.isActive });
            } else {
              state.addWebDAVConfig({ ...config, password, isActive: false });
            }
          }
        }
      } catch (error) {
        console.warn('恢复 WebDAV 配置时发生问题：', error);
      }

      try {
        if (backupData.proxyConfig && typeof backupData.proxyConfig === 'object') {
          const backupConfig = backupData.proxyConfig as typeof state.proxyConfig;
          const currentProxy = useAppStore.getState().proxyConfig;
          // R2-C10：仅当备份的代理类型/地址/端口/用户名与当前配置完全一致时
          // 才沿用当前密码（同一连接的脱敏备份）；任一不同说明是另一个代理，
          // 沿用旧密码会把错误凭据发给新代理——选择清空。
          const sameProxyConnection = backupConfig.type === currentProxy.type
            && backupConfig.host === currentProxy.host
            && backupConfig.port === currentProxy.port
            && (backupConfig.username ?? '') === (currentProxy.username ?? '');
          state.setProxyConfig({
            ...backupConfig,
            // 备份携带有效密钥时优先使用备份密码；否则仅在连接身份一致时复用。
            password: backupIncludedKeys && isRealBackupSecret(backupConfig.password)
              ? backupConfig.password
              : (sameProxyConnection ? currentProxy.password ?? '' : ''),
          });
        }
      } catch (error) {
        console.warn('恢复代理配置时发生问题：', error);
      }
      try {
        if (backupData.rpcDownloadConfig && typeof backupData.rpcDownloadConfig === 'object') {
          const backupConfig = backupData.rpcDownloadConfig as typeof state.rpcDownloadConfig;
          const currentRpc = useAppStore.getState().rpcDownloadConfig;
          const sameRpcEndpoint = (backupConfig.host ?? '').trim() === (currentRpc.host ?? '').trim()
            && backupConfig.port === currentRpc.port;
          state.setRpcDownloadConfig({
            ...backupConfig,
            secret: backupIncludedKeys && isRealBackupSecret(backupConfig.secret)
              ? backupConfig.secret
              : (sameRpcEndpoint ? currentRpc.secret : ''),
          });
        }
      } catch (error) {
        console.warn('恢复远程下载配置时发生问题：', error);
      }
      // routeMode 是本地偏好：仅接受合法枚举，缺失/非法回退 auto（随 1.2 备份导出）
      try {
        const restored = backupData.routeMode;
        const next: 'auto' | 'backend' | 'browser' = restored === 'backend' || restored === 'browser' || restored === 'auto'
          ? restored
          : 'auto';
        if (useAppStore.getState().routeMode !== next) {
          useAppStore.getState().setRouteMode(next);
        }
      } catch (error) {
        console.warn('恢复网络路由偏好时发生问题：', error);
      }
      try {
        const backupSecret = backupData.backendApiSecret;
        // 显式 null 表示清空；缺失/掩码值保持现有密钥。
        if (backupIncludedKeys && (backupSecret === null || isRealBackupSecret(backupSecret))) {
          state.setBackendApiSecret(typeof backupSecret === 'string' ? backupSecret : null);
        }
      } catch (error) {
        console.warn('恢复后端 API 密钥时发生问题：', error);
      }
      if (!restoreTargetsOtherAccount && liveAccountId) {
        // 同账号恢复：恢复后同步当前账号工作区快照（含旧版单账号备份与 1.3
        // 同账号场景）；其他账号在 accountWorkspaces 中的快照保持原样不动。
        const live = useAppStore.getState();
        useAppStore.setState({
          accountWorkspaces: {
            ...live.accountWorkspaces,
            [liveAccountId]: captureAccountWorkspace(live),
          },
        });
      }
      const workspaceList = Object.values(normalizedBackupWorkspaces);
      const restoredRepoCount = skipUnboundTopLevelApply
        ? workspaceList.reduce((sum, ws) => sum + ws.repositories.length, 0)
        : (backupRepositories?.length ?? 0);
      const restoredReleaseCount = skipUnboundTopLevelApply
        ? workspaceList.reduce((sum, ws) => sum + ws.releases.length, 0)
        : ((backupData.releases as unknown[] | undefined)?.length ?? 0);
      const restoredCategoryCount = skipUnboundTopLevelApply
        ? workspaceList.reduce((sum, ws) => sum + ws.customCategories.length, 0)
        : ((backupData.customCategories as unknown[] | undefined)?.length ?? 0);
      const hasNonEmptyArray = (value: unknown): boolean => Array.isArray(value) && value.length > 0;
      const hasNonEmptyObject = (value: unknown): boolean => (
        Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.keys(value as Record<string, unknown>).length > 0
      );
      const releaseSourceObj = backupData.releaseSourceSettings && typeof backupData.releaseSourceSettings === 'object'
        ? (backupData.releaseSourceSettings as Record<string, unknown>)
        : null;
      const hasSkippedUnboundTopLevelData = skipUnboundTopLevelApply && (
        (backupRepositories?.length ?? 0) > 0
        || hasNonEmptyArray(backupData.releases)
        || hasNonEmptyArray(backupData.gists)
        || hasNonEmptyArray(backupData.starredGists)
        || hasNonEmptyArray(backupData.forks)
        || hasNonEmptyArray(backupData.readForks)
        || hasNonEmptyArray(backupData.releaseSubscriptions)
        || hasNonEmptyArray(backupData.readReleases)
        || hasNonEmptyArray(backupData.customCategories)
        || hasNonEmptyArray(backupData.hiddenDefaultCategoryIds)
        || hasNonEmptyObject(backupData.categoryListIdMap)
        || (Boolean(releaseSourceObj) && (
          hasNonEmptyArray(releaseSourceObj!.enabledSourceIds)
          || hasNonEmptyArray(releaseSourceObj!.watchCustomReleaseRepos)
          || hasNonEmptyArray(releaseSourceObj!.customReleaseRepos)
        ))
        || backupData.syncModeConfigured === true
      );
      const summaryMessage = t('useBackupActions.data-restored-from-backup-repositories-v1-releas', {
        v1: restoredRepoCount,
        v2: restoredReleaseCount,
        v3: restoredCategoryCount,
      });
      const warnings: string[] = [];
      if (ghTokenPersistFailed) {
        warnings.push('GitHub PAT could not be saved to secure storage; please retry or re-authorize');
      }
      if (rejectedBackupTokenCount > 0) {
        warnings.push(`${rejectedBackupTokenCount} backup GitHub PAT(s) could not be verified for their account and require re-authorization`);
      }
      if (hasSkippedUnboundTopLevelData) {
        warnings.push('skipped unbound top-level backup data with activeAccountId=null');
      }
      if (ghTokenPersistFailed || rejectedBackupTokenCount > 0) {
        toast(`${summaryMessage} (${warnings.join('; ')})`, 'warning');
      } else if (hasSkippedUnboundTopLevelData) {
        toast(`${summaryMessage} (${warnings.join('; ')})`, 'info');
      } else {
        toast(summaryMessage, 'success');
      }
    } catch (error) {
      console.error('Restore failed:', error);
      toast(`${t('useBackupActions.restore-failed')}: ${(error as Error).message}`, 'error');
    } finally {
      setIsRestoring(false);
    }
  }, [activeConfig, confirm, state, t, toast]);

  return { activeConfig, isBackingUp, isRestoring, backup, restore, listBackups };
};
