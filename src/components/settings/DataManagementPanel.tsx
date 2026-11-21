
import { TranslateFn } from '../../i18n/useT';
import type { AppLanguage } from '../../i18n/languages';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { weeklyIssuesStorage } from '../../services/weeklyIssuesStorage';
import { xTweetStorage } from '../../services/xTweetStorage';
import { telegramStorage } from '../../services/telegramStorage';
import { abortXTweetSync } from '../../services/xTweetService';
import { abortTelegramSync } from '../../services/telegramService';
import { clearEncryptedXAuthViaDesktop } from '../../services/electronProxy';
import { clearGhAccountTokens, syncGhAccountTokensFromState } from '../../store/persistence/ghAccountSecrets';
import { normalizeAssetFilters } from '../../utils/assetFilters';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Checkbox } from '../ui/checkbox';
import React, { useState, useCallback, useMemo } from 'react';
import {
  Trash2,
  AlertTriangle,
  Database,
  Tag,
  Bot,
  Cloud,
  FolderTree,
  CheckCircle,
  XCircle,
  Loader2,
  FileWarning,
  Download,
  Upload,
  Sparkles,
  Filter,
  Search,
  Eye,
  HardDrive,
  RefreshCw,
  Rss,
} from 'lucide-react';
import { Github } from '../ui/brand-icons';
import { useAppStore } from '../../store/useAppStore';
import { removePersistedSnapshot } from '../../store/persistence/storage';
import { useDataResetActions } from '../../features/settings/hooks/useDataResetActions';
import { normalizePluginCustomIcons } from '../../store/normalizers/persistedState';
import {
  accountIdKey,
  captureAccountWorkspace,
  emptyAccountWorkspace,
  getAccountSessionGeneration,
  normalizeAccountWorkspaces,
  normalizeSavedAccounts,
} from '../../store/helpers/accountWorkspace';
import {
  applyAccountWorkspaceForTypes,
  BACKUP_MASKED_SECRET,
  buildFullWorkspaces,
  hasMaskedBackupSecrets,
  isRealBackupSecret,
  maskSavedAccountsForBackup,
  mergeWorkspacesById,
  mergeWorkspaceCategorySettings,
  replaceWorkspacesForSelectedTypes,
  trimWorkspacesForSelectedTypes,
  validateBackupRepositories,
} from '../../utils/backupWorkspace';
import { useShallow } from 'zustand/react/shallow';
import { isThemePresetId } from '../../constants/themePresets';
import type { ThemePresetId } from '../../constants/themePresets';
import { IncludeKeysToggle } from './IncludeKeysToggle';
import type { 
  Repository, 
  Release, 
  AIConfig, 
  WebDAVConfig, 
  Category, 
  AssetFilter,
  DiscoveryRepo,
  SubscriptionRepo,
  SubscriptionChannel,
  SearchFilters,
  ProxyConfig,
  RpcDownloadConfig,
  ReleaseSourceSettings,
  AccountWorkspace,
  SavedAccount,
  SyncMode
} from '../../types';
import {
  mergeReleaseSourceSettings,
  normalizeReleaseSourceSettings,
} from '../../utils/releaseSources';

interface DataManagementPanelProps {
  t: TranslateFn;
}

type DeleteOperation =
  | 'repositories'
  | 'releases'
  | 'aiConfigs'
  | 'webdavConfigs'
  | 'categorySettings'
  | 'assetFilters'
  | 'discoveryData'
  | 'subscriptionData'
  | 'releaseSubscriptions'
  | 'searchHistory'
  | 'all';

interface DeleteConfirmation {
  type: DeleteOperation | null;
  isOpen: boolean;
  githubUsernameInput: string;
}

interface OperationLog {
  id: string;
  operation: string;
  timestamp: string;
  success: boolean;
  details?: string;
}

interface ExportData {
  version: string;
  exportDate: string;
  appVersion: string;
  data: {
    activeAccountId?: string | null;
    savedAccounts?: Record<string, SavedAccount>;
    accountWorkspaces?: Record<string, AccountWorkspace>;
    gists?: import('../../types').Gist[];
    starredGists?: import('../../types').Gist[];
    forks?: import('../../types').ForkRepo[];
    readForks?: number[];
    categoryListIdMap?: Record<string, string>;
    syncMode?: SyncMode;
    syncModeConfigured?: boolean;
    repositories?: Repository[];
    releases?: Release[];
    aiConfigs?: AIConfig[];
    webdavConfigs?: WebDAVConfig[];
    customCategories?: Category[];
    assetFilters?: AssetFilter[];
    discoveryRepos?: Record<string, DiscoveryRepo[]>;
    discoveryTotalCount?: Record<string, number>;
    discoveryHasMore?: Record<string, boolean>;
    discoveryNextPage?: Record<string, number>;
    subscriptionRepos?: Record<string, SubscriptionRepo[]>;
    subscriptionLastRefresh?: Record<string, string | null>;
    subscriptionChannels?: SubscriptionChannel[];
    releaseSubscriptions?: number[];
    releaseSourceSettings?: ReleaseSourceSettings;
    readReleases?: number[];
    searchFilters?: SearchFilters;
    hiddenDefaultCategoryIds?: string[];
    defaultCategoryOverrides?: Record<string, Partial<Category>>;
    categoryOrder?: string[];
    theme?: 'light' | 'dark';
    themeMode?: 'light' | 'dark' | 'system';
    themePreset?: ThemePresetId;
    themePresetLight?: ThemePresetId;
    themePresetDark?: ThemePresetId;
    language?: AppLanguage;
    isSidebarCollapsed?: boolean;
    releaseViewMode?: 'timeline' | 'repository';
    releaseSelectedFilters?: string[];
    releaseSearchQuery?: string;
    releaseExpandedRepositories?: number[];
    pluginCustomIcons?: Record<string, string>;
    proxyConfig?: ProxyConfig;
    rpcDownloadConfig?: RpcDownloadConfig;
    backendApiSecret?: string | null;
    includeKeysInBackup?: boolean;
  };
}

interface DataCleanupSuggestion {
  key: string;
  label: string;
  labelEn: string;
  description: string;
  descriptionEn: string;
  count: number;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
}

// 掩码/真实密钥的判定与导入路径共用同一份规则（backupWorkspace），避免两处
// 规则漂移导致掩码 Token 覆盖可用凭据或真实 Token 被丢弃。
const MASKED_SECRET = BACKUP_MASKED_SECRET;
const isRealSecret = isRealBackupSecret;

const UI_SETTINGS_DATA_KEYS = [
  'theme',
  'themeMode',
  'themePreset',
  'themePresetLight',
  'themePresetDark',
  'language',
  'isSidebarCollapsed',
  'releaseViewMode',
  'releaseSelectedFilters',
  'releaseSearchQuery',
  'releaseExpandedRepositories',
  'pluginCustomIcons',
  'proxyConfig',
  'rpcDownloadConfig',
  'backendApiSecret',
] as const;

const IMPORT_DATA_KEYS = [
  'repositories',
  'releases',
  'aiConfigs',
  'webdavConfigs',
  'customCategories',
  'assetFilters',
  'discoveryRepos',
  'discoveryTotalCount',
  'discoveryHasMore',
  'discoveryNextPage',
  'subscriptionRepos',
  'subscriptionLastRefresh',
  'subscriptionChannels',
  'releaseSubscriptions',
  'releaseSourceSettings',
  'readReleases',
  'searchFilters',
  'hiddenDefaultCategoryIds',
  'defaultCategoryOverrides',
  'categoryOrder',
] as const;

const IMPORT_KEY_ALIASES: Record<string, string> = {
  discoveryTotalCount: 'discoveryRepos',
  discoveryHasMore: 'discoveryRepos',
  discoveryNextPage: 'discoveryRepos',
  subscriptionLastRefresh: 'subscriptionRepos',
  subscriptionChannels: 'subscriptionRepos',
  hiddenDefaultCategoryIds: 'customCategories',
  defaultCategoryOverrides: 'customCategories',
  categoryOrder: 'customCategories',
  releaseSourceSettings: 'releaseSubscriptions',
  readReleases: 'releaseSubscriptions',
  // 审计修复：仓库类型随导出还会写出 Gist/Fork/同步范围（exportData 的
  // repositories 分支），仅含这些顶层字段的备份同样要解析出 repositories 类型
  gists: 'repositories',
  starredGists: 'repositories',
  forks: 'repositories',
  readForks: 'repositories',
  syncMode: 'repositories',
  syncModeConfigured: 'repositories',
  // 审计修复（R12）：分类映射随导出写在顶层（exportData 的 customCategories
  // 分支），仅含顶层 categoryListIdMap 的备份同样要解析出 customCategories 类型
  categoryListIdMap: 'customCategories',
};

// 工作区字段 → 导入类型映射：与导出端 trimWorkspacesForSelectedTypes 的
// 裁剪分组一一对应，用于从部分备份的 accountWorkspaces 推导导入类型。
const WORKSPACE_FIELD_IMPORT_TYPES: Array<[string, string]> = [
  ['repositories', 'repositories'],
  ['gists', 'repositories'],
  ['starredGists', 'repositories'],
  ['forks', 'repositories'],
  ['readForks', 'repositories'],
  ['releases', 'releases'],
  ['releaseSubscriptions', 'releaseSubscriptions'],
  ['readReleases', 'releaseSubscriptions'],
  ['releaseSourceSettings', 'releaseSubscriptions'],
  ['customCategories', 'customCategories'],
  ['hiddenDefaultCategoryIds', 'customCategories'],
  ['defaultCategoryOverrides', 'customCategories'],
  ['categoryOrder', 'customCategories'],
  ['categoryListIdMap', 'customCategories'],
];

// 原始工作区字段是否携带实际数据：空数组/空对象是导出端裁剪与规范化补出的
// 默认占位，绝不据此判定类型（否则裁剪备份会被误判为全类型导入）。
const workspaceFieldCarriesData = (field: string, value: unknown): boolean => {
  if (field === 'releaseSourceSettings') {
    return JSON.stringify(normalizeReleaseSourceSettings(value ?? null))
      !== JSON.stringify(normalizeReleaseSourceSettings(null));
  }
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return false;
};

const resolveImportTypes = (data: ExportData['data']): string[] => {
  // 审计修复（R12）：别名源键（gists/starredGists/forks/readForks/syncMode/
  // syncModeConfigured/categoryListIdMap）不在 IMPORT_DATA_KEYS 中——此前只
  // 遍历 IMPORT_DATA_KEYS，仅含顶层 gists（或仅含 categoryListIdMap）的备份
  // 解析不出任何导入类型，合并与替换都会跳过这些数据却报告成功。改为遍历
  // 备份实际携带的顶层键：命中导入键或别名表即解析出对应类型；缺失字段与
  // 显式空数组的既有语义不变（按字段存在性判定，空数组仍解析出类型）。
  const present = new Set<string>();
  for (const key of Object.keys(data)) {
    if (key in IMPORT_KEY_ALIASES) {
      present.add(IMPORT_KEY_ALIASES[key]);
    } else if ((IMPORT_DATA_KEYS as readonly string[]).includes(key)) {
      present.add(key);
    }
  }
  // 审计修复：部分备份只有 activeAccountId + accountWorkspaces 内嵌字段（顶层
  // 键全缺）——此前返回空类型集合，合并路径会过滤掉该账号仓库却仍报告导入
  // 成功，替换路径同样拿不到类型。按原始（规范化前）工作区对象实际携带数据
  // 的字段补充导入类型；normalizeAccountWorkspaces 会补默认空数组，不得以其
  // 规范化结果为判定依据。
  const rawWorkspaces = data.accountWorkspaces;
  if (rawWorkspaces && typeof rawWorkspaces === 'object' && !Array.isArray(rawWorkspaces)) {
    for (const workspace of Object.values(rawWorkspaces)) {
      if (!workspace || typeof workspace !== 'object' || Array.isArray(workspace)) continue;
      const record = workspace as unknown as Record<string, unknown>;
      // 审计修复（R13 finding 91）：完整占位集（导出器产物）里的空字段一律是
      // 裁剪占位，绝不据此判定类型（既有语义，防止裁剪备份被误判为全类型）；
      // 字段子集（手工构造的部分备份）里显式出现的空数组/空对象视为「明确
      // 提供」——替换模式下清空对应列表，合并模式仍按合并语义保留本机条目。
      const isTrimmedExportWorkspace = ACCOUNT_WORKSPACE_FIELD_KEYS.every((key) =>
        Object.prototype.hasOwnProperty.call(record, key));
      for (const [field, importType] of WORKSPACE_FIELD_IMPORT_TYPES) {
        if (!Object.prototype.hasOwnProperty.call(record, field)) continue;
        if (workspaceFieldCarriesData(field, record[field]) || !isTrimmedExportWorkspace) {
          present.add(importType);
        }
      }
    }
  }
  if (UI_SETTINGS_DATA_KEYS.some((key) => data[key] !== undefined)) {
    present.add('uiSettings');
  }
  return Array.from(present);
};

// 按条目 id 去重合并（与 mergeWorkspacesById 的 mergeList 同一语义：本机已有
// 条目保留，仅追加本地没有的新条目）。同账号 merge 顶层 Gist/Fork 合并使用。
// 审计修复（R12）：接受一条导入记录后必须把其 ID 登记进去重集合——同一份
// 备份含两条相同 ID 的记录时，此前两条都会通过过滤进入实时列表与工作区快照；
// 登记后仅保留第一条（本机已有条目不受影响）。
const mergeListById = <T extends { id: unknown }>(localList: T[], incomingList: T[]): T[] => {
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

/**
 * 导入写入前对 Gist/Fork 对象数组条目的逐项校验（审计修复 R12，与 WebDAV
 * 恢复路径 useBackupActions 的 backupGistEntriesAreValid 同一规则）：null/
 * 非对象条目会在渲染视图时抛 TypeError（消费者直接读取条目属性），且持久化
 * 读取同样不过滤空条目，重启后问题仍会出现。gists / starredGists / forks
 * 共用同一结构校验；缺失字段与显式 [] 的语义由调用方保留。
 */
const importedListEntriesAreValid = (value: unknown): boolean => {
  if (!Array.isArray(value)) return false;
  return value.every((entry) => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry));
};

/**
 * R13 finding 88：Gist 条目必需字段校验（id 为非空字符串、files 为普通对象）
 * ——mergeListById 去重与 gistUtils（gist.id.slice、files 遍历）直接读取这些
 * 字段，`gists: [{}]` 这类空对象此前能通过结构校验写入实时状态与工作区快照。
 * owner 允许为 null（类型即如此），其余展示字段缺失不拒绝。
 */
const importedGistEntriesAreValid = (value: unknown): boolean => {
  if (!Array.isArray(value)) return false;
  return value.every((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const record = entry as { id?: unknown; files?: unknown };
    return typeof record.id === 'string' && record.id.length > 0
      && !!record.files && typeof record.files === 'object' && !Array.isArray(record.files);
  });
};

/**
 * R13 finding 88：Fork 条目必需字段与备份仓库（validateBackupRepositories）
 * 同一规则（id/name/full_name/owner.login）——ForkCard/ForkTimeline 直接读取
 * 这些字段渲染，缺失的空对象写入后会在消费侧抛 TypeError 或渲染脏数据。
 */
const importedForkEntriesAreValid = (value: unknown): boolean => {
  if (!Array.isArray(value)) return false;
  return value.every((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const fork = entry as { id?: unknown; name?: unknown; full_name?: unknown; owner?: { login?: unknown } };
    return typeof fork.id === 'number' && Number.isFinite(fork.id)
      && typeof fork.name === 'string' && fork.name.length > 0
      && typeof fork.full_name === 'string' && fork.full_name.length > 0
      && typeof fork.owner?.login === 'string' && fork.owner.login.length > 0;
  });
};

// 审计修复（R13 finding 91）：导出端裁剪基座的完整字段集——trimWorkspacesFor
// SelectedTypes 以 emptyAccountWorkspace 为基座展开，未选类型的字段以空数组/
// 空对象占位（完整字段集）。工作区对象含全部这些键时视为导出器产物，字段子集
// 视为部分备份明确提供的字段。
const ACCOUNT_WORKSPACE_FIELD_KEYS = Object.keys(emptyAccountWorkspace());

export const DataManagementPanel: React.FC<DataManagementPanelProps> = ({ t }) => {
  const {
    user,
    repositories,
    releases,
    aiConfigs,
    webdavConfigs,
    customCategories,
    defaultCategoryOverrides,
    hiddenDefaultCategoryIds,
    assetFilters,
    discoveryRepos,
    subscriptionRepos,
    releaseSubscriptions,
    releaseSourceSettings,
    readReleases,
    language,
    setRepositories,
    setReleases,
    setBackendApiSecret,
  } = useAppStore(useShallow((state) => ({
    user: state.user,
    repositories: state.repositories,
    releases: state.releases,
    aiConfigs: state.aiConfigs,
    webdavConfigs: state.webdavConfigs,
    customCategories: state.customCategories,
    defaultCategoryOverrides: state.defaultCategoryOverrides,
    hiddenDefaultCategoryIds: state.hiddenDefaultCategoryIds,
    assetFilters: state.assetFilters,
    discoveryRepos: state.discoveryRepos,
    subscriptionRepos: state.subscriptionRepos,
    releaseSubscriptions: state.releaseSubscriptions,
    releaseSourceSettings: state.releaseSourceSettings,
    readReleases: state.readReleases,
    language: state.language,
    setRepositories: state.setRepositories,
    setReleases: state.setReleases,
    setBackendApiSecret: state.setBackendApiSecret,
  })));

  const [confirmation, setConfirmation] = useState<DeleteConfirmation>({
    type: null,
    isOpen: false,
    githubUsernameInput: '',
  });
  const [isDeleting, setIsDeleting] = useState(false);
  const [operationLogs, setOperationLogs] = useState<OperationLog[]>([]);
  const [showSuccessMessage, setShowSuccessMessage] = useState<string | null>(null);
  const [, setSearchHistoryVersion] = useState(0);
  const [showErrorMessage, setShowErrorMessage] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  // 审计修复（R13 finding 53）：GitHub PAT 导出需要独立于 includeKeysInBackup
  // 的逐次明确授权（升级保留的旧开关不得视为授权）——导出将包含非空 PAT 时
  // 先请用户确认；未授权时 savedAccounts 的 Token 一律脱敏。
  const [patExportConfirmation, setPatExportConfirmation] = useState<{
    isOpen: boolean;
    resolve: ((includePATs: boolean) => void) | null;
  }>({ isOpen: false, resolve: null });

  const resolvePatExportConfirmation = (includePATs: boolean) => {
    setPatExportConfirmation((current) => {
      current.resolve?.(includePATs);
      return { isOpen: false, resolve: null };
    });
  };
  const [importPreview, setImportPreview] = useState<{
    data: ExportData | null;
    isOpen: boolean;
    fileName: string;
    openedAccountId: string | null;
    // 审计修复（R12）：打开预览时的会话代次——同账号更换凭据（切出又切回、
    // 同账号换证）只递增代次不改账号 ID，仅核对账号 ID 拦不住旧预览继续导入。
    openedSessionGeneration: number | null;
  }>({ data: null, isOpen: false, fileName: '', openedAccountId: null, openedSessionGeneration: null });
  const exportItems = useMemo(() => [
    { key: 'repositories', label: t('dataManagementPanel.repositories') },
    { key: 'releases', label: t('dataManagementPanel.releases') },
    { key: 'aiConfigs', label: t('dataManagementPanel.ai-configs') },
    { key: 'webdavConfigs', label: t('dataManagementPanel.webdav-configs') },
    { key: 'customCategories', label: t('dataManagementPanel.categories') },
    { key: 'assetFilters', label: t('dataManagementPanel.asset-filters') },
    { key: 'discoveryRepos', label: t('dataManagementPanel.discovery-data') },
    { key: 'subscriptionRepos', label: t('dataManagementPanel.subscription-data') },
    { key: 'releaseSubscriptions', label: t('dataManagementPanel.release-subscriptions') },
    { key: 'searchFilters', label: t('dataManagementPanel.search-filters') },
    { key: 'uiSettings', label: t('dataManagementPanel.ui-settings') },
  ], [t]);
  const [selectedExportTypes, setSelectedExportTypes] = useState<string[]>(() => exportItems.map((item) => item.key));

  const addLog = useCallback((operation: string, success: boolean, details?: string) => {
    const newLog: OperationLog = {
      id: Date.now().toString(),
      operation,
      timestamp: new Date().toLocaleString(),
      success,
      details,
    };
    setOperationLogs((prev) => [newLog, ...prev].slice(0, 50));
  }, []);

  const showSuccess = useCallback((message: string) => {
    setShowSuccessMessage(message);
    setTimeout(() => setShowSuccessMessage(null), 3000);
  }, []);

  const showError = useCallback((message: string) => {
    setShowErrorMessage(message);
    setTimeout(() => setShowErrorMessage(null), 5000);
  }, []);

  // 审计修复（C51）：账号级待推状态清理经 features hook 转出口（分层守则）。
  const { clearPendingSyncState } = useDataResetActions();

  const clearAllStorage = async () => {
    // App-owned localStorage keys and prefixes
    const APP_LOCALSTORAGE_KEYS = [
      'github-stars-search-history',
      'lastSearchTime',
    ];
    const APP_LOCALSTORAGE_PREFIXES = [
      'github-stars-manager',
    ];

    // Clear localStorage - only remove app-owned keys
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        const isExactMatch = APP_LOCALSTORAGE_KEYS.includes(key);
        const isPrefixMatch = APP_LOCALSTORAGE_PREFIXES.some(prefix => key.startsWith(prefix));
        if (isExactMatch || isPrefixMatch) {
          keysToRemove.push(key);
        }
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));

    // App-owned sessionStorage keys
    const APP_SESSIONSTORAGE_KEYS = [
      'github-stars-manager-backend-secret',
    ];

    // Clear sessionStorage - only remove app-owned keys
    APP_SESSIONSTORAGE_KEYS.forEach((key) => sessionStorage.removeItem(key));

    // Clear IndexedDB - only remove the specific database used by this app.
    // 走持久化层的串行删除：除磁盘清扫外，还会在串行写链上取消待写、完成删除并
    // 重置分片判脏簿记——直接调底层 removeItem 会让随后的 store 重置写入以过期
    // 基准判脏，只补写部分分片，而 meta 仍声明全部分片。
    // 必须 await 删除真正落盘（zustand v4 的 clearStorage 不回传 Promise）：
    // 若链上还有排队的大写入，2 秒后的 reload 可能早于删除提交，数据复活。
    try {
      await removePersistedSnapshot(useAppStore.persist.getOptions().name ?? 'github-stars-manager');
    } catch (error) {
      console.error('Failed to clear IndexedDB', error);
      throw new Error('IndexedDB clear failed');
    }
  };

  const deleteRepositories = async () => {
    try {
      setRepositories([], { allowEmpty: true });
      addLog(t('dataManagementPanel.delete-stars-repositories'), true);
      showSuccess(t('dataManagementPanel.stars-repositories-deleted'));
    } catch (error) {
      addLog(
        t('dataManagementPanel.delete-stars-repositories'),
        false,
        String(error)
      );
      showError(t('dataManagementPanel.delete-failed-please-try-again'));
      throw error;
    }
  };

  const deleteReleases = async () => {
    try {
      setReleases([], { allowEmpty: true });
      addLog(t('dataManagementPanel.delete-release-records'), true);
      showSuccess(t('dataManagementPanel.release-records-deleted'));
    } catch (error) {
      addLog(
        t('dataManagementPanel.delete-release-records'),
        false,
        String(error)
      );
      showError(t('dataManagementPanel.delete-failed-please-try-again'));
      throw error;
    }
  };

  const deleteAIConfigs = async () => {
    try {
      const store = useAppStore.getState();
      store.setAIConfigs([]);
      store.setActiveAIConfig(null);
      addLog(t('dataManagementPanel.delete-ai-service-configs'), true);
      showSuccess(t('dataManagementPanel.ai-service-configs-deleted'));
    } catch (error) {
      addLog(
        t('dataManagementPanel.delete-ai-service-configs'),
        false,
        String(error)
      );
      showError(t('dataManagementPanel.delete-failed-please-try-again'));
      throw error;
    }
  };

  const deleteWebDAVConfigs = async () => {
    try {
      const store = useAppStore.getState();
      store.setWebDAVConfigs([]);
      store.setActiveWebDAVConfig(null);
      addLog(t('dataManagementPanel.delete-webdav-sync-configs'), true);
      showSuccess(t('dataManagementPanel.webdav-sync-configs-deleted'));
    } catch (error) {
      addLog(
        t('dataManagementPanel.delete-webdav-sync-configs'),
        false,
        String(error)
      );
      showError(t('dataManagementPanel.delete-failed-please-try-again'));
      throw error;
    }
  };

  const deleteCategorySettings = async () => {
    try {
      const store = useAppStore.getState();
      // 先复制分类数组，避免在迭代过程中修改原数组
      const categoriesToDelete = [...store.customCategories];
      // Reset category-related state
      for (const cat of categoriesToDelete) {
        store.deleteCustomCategory(cat.id);
      }
      // Clear hidden default categories and reset category-related settings
      useAppStore.setState({ 
        hiddenDefaultCategoryIds: [],
        defaultCategoryOverrides: {},
        categoryOrder: [],
        collapsedSidebarCategoryCount: 20,
        isSidebarCollapsed: false
      });
      addLog(t('dataManagementPanel.delete-category-display-settings'), true);
      showSuccess(t('dataManagementPanel.category-display-settings-deleted'));
    } catch (error) {
      addLog(
        t('dataManagementPanel.delete-category-display-settings'),
        false,
        String(error)
      );
      showError(t('dataManagementPanel.delete-failed-please-try-again'));
      throw error;
    }
  };

  const deleteAssetFilters = async () => {
    try {
      useAppStore.setState({ assetFilters: [] });
      addLog(t('dataManagementPanel.delete-asset-filter-presets'), true);
      showSuccess(t('dataManagementPanel.asset-filter-presets-deleted'));
    } catch (error) {
      addLog(
        t('dataManagementPanel.delete-asset-filter-presets'),
        false,
        String(error)
      );
      showError(t('dataManagementPanel.delete-failed-please-try-again'));
      throw error;
    }
  };

  const deleteDiscoveryData = useCallback(async () => {
    try {
      // 在清理前先中止并等待进行中的推文与 Telegram 同步，防止并发写入导致清理后脏数据写回
      await abortXTweetSync();
      await abortTelegramSync();
      // 周刊/推文/Telegram 频道数据在独立 IndexedDB，一并清空
      await weeklyIssuesStorage.clearAll();
      await xTweetStorage.clearAll();
      await telegramStorage.clearAll();
      const emptyDiscoveryRepos = {
        'trending': [],
        'hot-release': [],
        'most-popular': [],
        'topic': [],
        'x-tweet': [],
        'telegram': [],
        'weekly': [],
        'search': [],
        'code-search': []
      } as Record<string, DiscoveryRepo[]>;
      useAppStore.setState({
        discoveryRepos: emptyDiscoveryRepos,
        discoveryLastRefresh: {
          'trending': null,
          'hot-release': null,
          'most-popular': null,
          'topic': null,
          'x-tweet': null,
          'telegram': null,
          'weekly': null,
          'search': null,
          'code-search': null
        },
        discoveryNextPage: { 'trending': 1, 'hot-release': 1, 'most-popular': 1, 'topic': 1, 'x-tweet': 1, 'telegram': 1, 'weekly': 1, 'search': 1, 'code-search': 1 },
        discoveryTotalCount: { 'trending': 0, 'hot-release': 0, 'most-popular': 0, 'topic': 0, 'x-tweet': 0, 'telegram': 0, 'weekly': 0, 'search': 0, 'code-search': 0 },
        discoveryHasMore: { 'trending': false, 'hot-release': false, 'most-popular': false, 'topic': false, 'x-tweet': false, 'telegram': false, 'weekly': false, 'search': false, 'code-search': false },
        discoveryIsLoadingMore: { 'trending': false, 'hot-release': false, 'most-popular': false, 'topic': false, 'x-tweet': false, 'telegram': false, 'weekly': false, 'search': false, 'code-search': false },
        discoveryLoadMoreError: { 'trending': null, 'hot-release': null, 'most-popular': null, 'topic': null, 'x-tweet': null, 'telegram': null, 'weekly': null, 'search': null, 'code-search': null },
      });
      addLog(t('dataManagementPanel.delete-discovery-cache-data'), true);
      showSuccess(t('dataManagementPanel.discovery-cache-data-deleted'));
    } catch (error) {
      addLog(
        t('dataManagementPanel.delete-discovery-cache-data'),
        false,
        String(error)
      );
      showError(t('dataManagementPanel.delete-failed-please-try-again'));
      throw error;
    }
  }, [addLog, showSuccess, showError, t]);

  const deleteSubscriptionData = async () => {
    try {
      useAppStore.setState({
        subscriptionRepos: {
          'most-stars': [],
          'most-forks': [],
          'most-dev': [],
          'trending': [],
        },
      });
      addLog(t('dataManagementPanel.delete-subscription-feed-cache'), true);
      showSuccess(t('dataManagementPanel.subscription-feed-cache-deleted'));
    } catch (error) {
      addLog(
        t('dataManagementPanel.delete-subscription-feed-cache'),
        false,
        String(error)
      );
      showError(t('dataManagementPanel.delete-failed-please-try-again'));
      throw error;
    }
  };

  const deleteReleaseSubscriptions = async () => {
    try {
      useAppStore.setState({
        releaseSubscriptions: new Set<number>(),
        releaseSourceSettings: normalizeReleaseSourceSettings(null),
        readReleases: new Set<number>()
      });
      addLog(t('dataManagementPanel.delete-release-subscriptions-read'), true);
      showSuccess(t('dataManagementPanel.release-subscriptions-read-deleted'));
    } catch (error) {
      addLog(
        t('dataManagementPanel.delete-release-subscriptions-read'),
        false,
        String(error)
      );
      showError(t('dataManagementPanel.delete-failed-please-try-again'));
      throw error;
    }
  };

  const deleteSearchHistory = async () => {
    try {
      useAppStore.setState({ 
        searchFilters: {
          query: '',
          tags: [],
          languages: [],
          platforms: [],
          licenses: [],
          sortBy: 'stars',
          sortOrder: 'desc',
          isAnalyzed: undefined,
          isSubscribed: undefined,
        }
      });
      localStorage.removeItem('github-stars-search-history');
      localStorage.removeItem('lastSearchTime');
      setSearchHistoryVersion(v => v + 1);
      addLog(t('dataManagementPanel.delete-search-history'), true);
      showSuccess(t('dataManagementPanel.search-history-deleted'));
    } catch (error) {
      addLog(
        t('dataManagementPanel.delete-search-history'),
        false,
        String(error)
      );
      showError(t('dataManagementPanel.delete-failed-please-try-again'));
      throw error;
    }
  };

  const exportData = useCallback(async (selectedTypes: string[]) => {
    setIsExporting(true);
    try {
      const store = useAppStore.getState();
      const includeKeys = store.includeKeysInBackup;

      const exportDataObj: ExportData = {
        version: '1.1',
        exportDate: new Date().toISOString(),
        appVersion: '0.4.0',
        data: { includeKeysInBackup: includeKeys }
      };

      // 多账号备份（Issue #611）：勾选核心数据时一并导出活跃账号 ID、
      // 全账号工作区字典与已保存账号列表（Token 按 includeKeysInBackup 脱敏）。
      // releaseSubscriptions 也属于账号归属数据：仅导出订阅时若缺少
      // activeAccountId/accountWorkspaces，导入端无法识别跨账号备份，
      // 会把备份账号的订阅/已读状态当成恢复者账号的数据恢复（串号）。
      const exportCoreWorkspaces = selectedTypes.includes('repositories')
        || selectedTypes.includes('releases')
        || selectedTypes.includes('customCategories')
        || selectedTypes.includes('releaseSubscriptions');
      // 审计修复（R13 finding 53）：includeKeysInBackup 为 true（含升级保留的
      // 旧设置）不等于授权上传 GitHub PAT——导出将包含非空 PAT 时逐次请用户
      // 明确授权；未授权时 savedAccounts 的 Token 一律脱敏，绝不默认明文导出。
      let patAuthorized = false;
      if (exportCoreWorkspaces
        && includeKeys
        && Object.values(store.savedAccounts ?? {}).some((account) => !!account?.githubToken?.trim())) {
        patAuthorized = await new Promise<boolean>((resolve) => {
          setPatExportConfirmation({ isOpen: true, resolve });
        });
      }
      if (exportCoreWorkspaces) {
        exportDataObj.data.activeAccountId = accountIdKey(store.user);
        // 工作区字段按 selectedTypes 裁剪（隐私边界）：只选 customCategories 时
        // 绝不导出其他账号的仓库/Release/Gist/Fork 等未勾选数据
        exportDataObj.data.accountWorkspaces = trimWorkspacesForSelectedTypes(
          buildFullWorkspaces(store),
          selectedTypes,
        );
        exportDataObj.data.savedAccounts = maskSavedAccountsForBackup(store.savedAccounts, patAuthorized);
      }

      if (selectedTypes.includes('repositories')) {
        exportDataObj.data.repositories = store.repositories;
        exportDataObj.data.gists = store.gists;
        exportDataObj.data.starredGists = store.starredGists;
        exportDataObj.data.forks = store.forks;
        exportDataObj.data.readForks = Array.from(store.readForks);
        exportDataObj.data.syncMode = store.syncMode;
        exportDataObj.data.syncModeConfigured = store.syncModeConfigured;
      }
      if (selectedTypes.includes('releases')) {
        exportDataObj.data.releases = store.releases;
      }
      if (selectedTypes.includes('aiConfigs')) {
        exportDataObj.data.aiConfigs = includeKeys
          ? store.aiConfigs
          : store.aiConfigs.map(cfg => ({ ...cfg, apiKey: cfg.apiKey ? MASKED_SECRET : '' }));
      }
      if (selectedTypes.includes('webdavConfigs')) {
        exportDataObj.data.webdavConfigs = includeKeys
          ? store.webdavConfigs
          : store.webdavConfigs.map(cfg => ({ ...cfg, password: cfg.password ? MASKED_SECRET : '' }));
      }
      if (selectedTypes.includes('customCategories')) {
        exportDataObj.data.customCategories = store.customCategories;
        exportDataObj.data.hiddenDefaultCategoryIds = store.hiddenDefaultCategoryIds;
        exportDataObj.data.defaultCategoryOverrides = store.defaultCategoryOverrides;
        exportDataObj.data.categoryOrder = store.categoryOrder;
        exportDataObj.data.categoryListIdMap = store.categoryListIdMap;
      }
      if (selectedTypes.includes('assetFilters')) {
        exportDataObj.data.assetFilters = store.assetFilters;
      }
      if (selectedTypes.includes('discoveryRepos')) {
        exportDataObj.data.discoveryRepos = store.discoveryRepos;
        exportDataObj.data.discoveryTotalCount = store.discoveryTotalCount;
        exportDataObj.data.discoveryHasMore = store.discoveryHasMore;
        exportDataObj.data.discoveryNextPage = store.discoveryNextPage;
      }
      if (selectedTypes.includes('subscriptionRepos')) {
        exportDataObj.data.subscriptionRepos = store.subscriptionRepos;
        exportDataObj.data.subscriptionLastRefresh = store.subscriptionLastRefresh;
        exportDataObj.data.subscriptionChannels = store.subscriptionChannels;
      }
      if (selectedTypes.includes('releaseSubscriptions')) {
        exportDataObj.data.releaseSubscriptions = Array.from(store.releaseSubscriptions);
        exportDataObj.data.releaseSourceSettings = store.releaseSourceSettings;
        exportDataObj.data.readReleases = Array.from(store.readReleases);
      }
      if (selectedTypes.includes('searchFilters')) {
        exportDataObj.data.searchFilters = store.searchFilters;
      }
      if (selectedTypes.includes('uiSettings')) {
        exportDataObj.data.themeMode = store.themeMode;
        exportDataObj.data.themePresetLight = store.themePresetLight;
        exportDataObj.data.themePresetDark = store.themePresetDark;
        exportDataObj.data.language = store.language;
        exportDataObj.data.isSidebarCollapsed = store.isSidebarCollapsed;
        exportDataObj.data.releaseViewMode = store.releaseViewMode;
        exportDataObj.data.releaseSelectedFilters = store.releaseSelectedFilters;
        exportDataObj.data.releaseSearchQuery = store.releaseSearchQuery;
        exportDataObj.data.releaseExpandedRepositories = Array.from(store.releaseExpandedRepositories);
        exportDataObj.data.pluginCustomIcons = store.pluginCustomIcons;
      }

      // Export special configs (proxy, RPC, backend secret) only when uiSettings is selected
      if (selectedTypes.includes('uiSettings')) {
        exportDataObj.data.proxyConfig = includeKeys
          ? store.proxyConfig
          : { ...store.proxyConfig, password: store.proxyConfig.password ? MASKED_SECRET : '' };

        exportDataObj.data.rpcDownloadConfig = includeKeys
          ? store.rpcDownloadConfig
          : { ...store.rpcDownloadConfig, secret: store.rpcDownloadConfig.secret ? MASKED_SECRET : '' };

        exportDataObj.data.backendApiSecret = includeKeys
          ? store.backendApiSecret
          : (store.backendApiSecret ? MASKED_SECRET : null);
      }

      const blob = new Blob([JSON.stringify(exportDataObj, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `github-stars-manager-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      addLog(t('dataManagementPanel.export-data'), true);
      showSuccess(t('dataManagementPanel.data-exported-successfully'));
    } catch (error) {
      addLog(t('dataManagementPanel.export-data'), false, String(error));
      showError(t('dataManagementPanel.export-failed-please-try-again'));
    } finally {
      setIsExporting(false);
    }
  }, [addLog, showSuccess, showError, t]);

  const handleImportFile = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const data = JSON.parse(content) as ExportData;
        
        if (!data.version || !data.data) {
          showError(t('dataManagementPanel.invalid-backup-file-format'));
          return;
        }

        setImportPreview({
          data,
          isOpen: true,
          fileName: file.name,
          openedAccountId: accountIdKey(useAppStore.getState().user),
          openedSessionGeneration: getAccountSessionGeneration(),
        });
      } catch {
        showError(t('dataManagementPanel.failed-to-parse-file-ensure-it-is-a-valid-json-f'));
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }, [showError, t]);

  const importData = useCallback(async (selectedTypes: string[], mode: 'merge' | 'replace') => {
    if (!importPreview.data) return;

    // 审计修复（R12）：确认导入时除账号 ID 外一并复核打开预览时的会话代次
    // ——同账号更换凭据（切出又切回、同账号换证）只递增代次不改账号 ID，
    // 仅核对账号 ID 会放行旧预览的替换导入，覆盖重新激活账号的工作区。
    const openedSessionGeneration = importPreview.openedSessionGeneration;
    const currentAccountIdAtImport = accountIdKey(useAppStore.getState().user);
    if (importPreview.openedAccountId !== currentAccountIdAtImport
      || getAccountSessionGeneration() !== openedSessionGeneration) {
      addLog(t('dataManagementPanel.import-data'), false, 'session changed while import preview was open');
      showError(t('useBackupActions.account-changed-during-restore'));
      setImportPreview({ data: null, isOpen: false, fileName: '', openedAccountId: null, openedSessionGeneration: null });
      return;
    }

    setIsImporting(true);
    try {
      const store = useAppStore.getState();
      const importedData = importPreview.data.data;
      // Legacy compatibility: treat missing flag as true (older exports contained keys)
      const wasIncluded = importedData.includeKeysInBackup ?? true;

      // R2-C7：本地 JSON 导入与备份恢复共用同一校验——repositories 缺失/null
      // 视为未提供（保留本机值），非数组或含无效条目整体拒绝导入，绝不写入
      // 部分有效数据；显式 [] 保留清空语义。
      const validatedImportRepositories = validateBackupRepositories(importedData.repositories);
      if (validatedImportRepositories === null) {
        addLog(t('dataManagementPanel.import-data'), false, 'invalid repositories');
        showError(t('dataManagementPanel.invalid-backup-file-format'));
        return;
      }

      // 审计修复（C54）：activeAccountId 用于决定恢复目标/写 store 前先验证
      // 类型与有效性（字符串、数值 ID 形态；拒绝数值 2 等）——无效载荷整体
      // 拒绝导入，避免恢复目标错位；旧文件缺该字段的兼容路径保留。
      const rawActiveAccountId = importedData.activeAccountId;
      if (
        rawActiveAccountId !== undefined
        && rawActiveAccountId !== null
        && (typeof rawActiveAccountId !== 'string' || !/^\d+$/.test(rawActiveAccountId))
      ) {
        addLog(t('dataManagementPanel.import-data'), false, 'invalid activeAccountId');
        showError(t('dataManagementPanel.invalid-backup-file-format'));
        return;
      }
      // 审计修复（C52 / R11）：在提交任何变更前统一校验所有会被展开或迭代的数组字段
      // （缺失字段保留现值，显式 [] 仍允许清空；非数组载荷整体拒绝，防止部分写入）。
      const arrayImportFields: Array<keyof ExportData['data']> = [
        'releaseSubscriptions',
        'readReleases',
        'releases',
        'gists',
        'starredGists',
        'forks',
        'readForks',
        'customCategories',
        'hiddenDefaultCategoryIds',
        'categoryOrder',
        'aiConfigs',
        'webdavConfigs',
        'assetFilters',
        'subscriptionChannels',
      ];
      for (const field of arrayImportFields) {
        const value = importedData[field];
        if (value !== undefined && !Array.isArray(value)) {
          addLog(t('dataManagementPanel.import-data'), false, `invalid ${String(field)}`);
          showError(t('dataManagementPanel.invalid-backup-file-format'));
          return;
        }
      }
      // 审计修复：discoveryRepos / subscriptionRepos 由导出器写成按频道分组的
      // 映射对象（Record<channel, repos[]>）——按数组校验会把含这两个缓存的
      // 备份（含默认全选导出）整体拒绝。改为分别校验映射对象与其中的仓库数组；
      // 真正的数组字段仍走上面的检查。
      const channelMapImportFields: Array<keyof ExportData['data']> = [
        'discoveryRepos',
        'subscriptionRepos',
      ];
      for (const field of channelMapImportFields) {
        const value = importedData[field];
        if (value === undefined) continue;
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          addLog(t('dataManagementPanel.import-data'), false, `invalid ${String(field)}`);
          showError(t('dataManagementPanel.invalid-backup-file-format'));
          return;
        }
        for (const channelRepos of Object.values(value as Record<string, unknown>)) {
          if (!Array.isArray(channelRepos)) {
            addLog(t('dataManagementPanel.import-data'), false, `invalid ${String(field)} channel entry`);
            showError(t('dataManagementPanel.invalid-backup-file-format'));
            return;
          }
        }
      }
      // 审计修复：aiConfigs/webdavConfigs 的条目会在替换/合并路径被逐个读取
      //（cfg.apiKey / cfg.password）——含 null 条目的数组此前能通过数组校验，
      // 替换模式先写仓库再在读取时抛错，界面报告失败但原仓库已被替换。
      // 在首次写入前逐项校验条目结构。
      const configArrayImportFields: Array<keyof ExportData['data']> = [
        'aiConfigs',
        'webdavConfigs',
      ];
      for (const field of configArrayImportFields) {
        const value = importedData[field];
        if (value === undefined) continue;
        if ((value as unknown[]).some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
          addLog(t('dataManagementPanel.import-data'), false, `invalid ${String(field)} entry`);
          showError(t('dataManagementPanel.invalid-backup-file-format'));
          return;
        }
      }
      // 审计修复（R12）：Gist/Fork 列表条目会在替换/合并路径被整体写入实时
      // 状态与工作区快照——含 null 条目的数组此前能通过数组校验，替换模式先
      // 写入仓库，再把 null 写进 gists/gistSearchResults，消费者（gistUtils 等）
      // 直接读取条目属性时抛 TypeError。在首次写入前逐项校验条目结构（非空
      // 对象，与 WebDAV 恢复路径同一规则）；缺失字段与显式 [] 语义不变。
      // 审计修复（R13 finding 37）：releases 条目同样会在合并路径被逐个读取
      //（r.id）并整表写入实时状态——含 null 条目的数组此前能通过数组校验，
      // 合并模式先写入仓库再在读取 null.id 时抛错，界面报告导入失败但原仓库
      // 已被替换。与 Gist/Fork 同一结构校验（非空对象），显式 [] 语义不变。
      // 审计修复（R13 finding 88）：Gist/Fork 条目进一步按类型必需字段校验——
      // `gists: [{}]` 这类缺少 id/files 等必需字段的空对象此前能通过结构校验
      // 原样写进实时状态与工作区快照，消费者读取必需字段时抛 TypeError。
      const objectListImportFields: Array<keyof ExportData['data']> = [
        'releases',
        'gists',
        'starredGists',
        'forks',
      ];
      for (const field of objectListImportFields) {
        const value = importedData[field];
        if (value === undefined) continue;
        const entriesAreValid = field === 'gists' || field === 'starredGists'
          ? importedGistEntriesAreValid(value)
          : field === 'forks'
            ? importedForkEntriesAreValid(value)
            : importedListEntriesAreValid(value);
        if (!entriesAreValid) {
          addLog(t('dataManagementPanel.import-data'), false, `invalid ${String(field)} entry`);
          showError(t('dataManagementPanel.invalid-backup-file-format'));
          return;
        }
      }
      // 审计修复（R13 finding 57）：合并模式同样必须在任何写入（含凭据）之前
      // 校验备份账号工作区的 repositories——mergeWorkspacesById 的 mergeList
      // 不检查 null 条目，`[null]` 会进入本机 accountWorkspaces 并写入实时
      // 仓库。任一账号校验失败即整体拒绝导入；替换模式已由
      // replaceWorkspacesForSelectedTypes 先于任何写入抛出错误，行为不变。
      if (mode === 'merge' && selectedTypes.includes('repositories')) {
        const rawImportedWorkspaces = importedData.accountWorkspaces as Record<string, unknown> | undefined;
        for (const rawAccount of Object.values(rawImportedWorkspaces ?? {})) {
          if (validateBackupRepositories(
            (rawAccount as Record<string, unknown> | null | undefined)?.repositories,
          ) === null) {
            addLog(t('dataManagementPanel.import-data'), false, 'invalid repositories');
            showError(t('dataManagementPanel.invalid-backup-file-format'));
            return;
          }
        }
      }

      // ── 多账号恢复（Issue #611）───────────────────────────────────────
      // 绝不丢失其他账号工作区：备份中的工作区合并进本机 accountWorkspaces，
      // 本机独有的其他账号快照原样保留。
      const currentAccountId = accountIdKey(store.user);
      const hasImportedWorkspaces = !!importedData.accountWorkspaces;
      const importedWorkspaces = hasImportedWorkspaces
        ? normalizeAccountWorkspaces(importedData.accountWorkspaces)
        : {};
      // 备份顶层属于另一个账号（跨账号恢复）：顶层导入结果归档进备份账号工作区，
      // 当前账号的备份工作区（若存在）应用到顶层，绝不张冠李戴。
      // 归属判断只看备份显式声明的 activeAccountId：只要与当前账号不同
      //（含当前未登录），顶层数据就必须归档进备份账号，绝不能写入当前账号。
      const backupTargetsOtherAccount = !!importedData.activeAccountId
        && importedData.activeAccountId !== currentAccountId;
      // 审计修复（R13 finding 40）：区分显式 activeAccountId: null 与旧版文件
      // 缺少该字段——导出器在未登录时写出显式 null，顶层账号数据不属于任何
      // 账号，绝不写入 currentAccountId 对应的账号；跳过未归属的顶层账号数据
      // 并提示用户。accountWorkspaces 中已归属的工作区仍按各自 ID 恢复。
      const backupActiveAccountUnattributed = importedData.activeAccountId === null;

      const archiveTopLevelToBackupAccount = (archiveMode: 'merge' | 'replace'): void => {
        if (!importedData.activeAccountId) return;
        const workspaces = useAppStore.getState().accountWorkspaces;
        const previous = workspaces[importedData.activeAccountId];
        // 归档基座绝不借用当前登录账号的实时数据（跨账号串号防线）：
        // 本机无该账号快照时以空工作区为基座
        const base = previous ?? emptyAccountWorkspace();
        const empty = emptyAccountWorkspace();
        const includeRepos = selectedTypes.includes('repositories');
        const includeReleases = selectedTypes.includes('releases');
        const includeCategories = selectedTypes.includes('customCategories');
        const includeReleaseSubs = selectedTypes.includes('releaseSubscriptions');
        const archived: AccountWorkspace = archiveMode === 'merge'
          ? {
              // merge：只按本次恢复所选类型并入备份顶层数据，保留未选类型的本机数据
              ...mergeWorkspacesById(base, {
                ...empty,
                repositories: includeRepos ? (validatedImportRepositories ?? []) : [],
                releases: includeReleases ? (importedData.releases ?? []) : [],
                gists: includeRepos ? (importedData.gists ?? []) : [],
                starredGists: includeRepos ? (importedData.starredGists ?? []) : [],
                forks: includeRepos ? (importedData.forks ?? []) : [],
                customCategories: includeCategories ? (importedData.customCategories ?? []) : [],
                readForks: includeRepos ? (importedData.readForks ?? []) : [],
                releaseSubscriptions: includeReleaseSubs ? (importedData.releaseSubscriptions ?? []) : [],
                readReleases: includeReleaseSubs ? (importedData.readReleases ?? []) : [],
              }),
              ...(includeCategories ? mergeWorkspaceCategorySettings(base, importedData) : {}),
            }
          : {
              // replace：仅替换本次恢复所选类型的字段，未选类型保留本机快照值
              ...base,
              ...(includeRepos ? {
                repositories: validatedImportRepositories ?? previous?.repositories ?? [],
                gists: importedData.gists ?? previous?.gists ?? [],
                starredGists: importedData.starredGists ?? previous?.starredGists ?? [],
                forks: importedData.forks ?? previous?.forks ?? [],
                readForks: importedData.readForks ?? previous?.readForks ?? [],
                syncMode: importedData.syncMode ?? previous?.syncMode ?? base.syncMode,
                syncModeConfigured: importedData.syncModeConfigured ?? previous?.syncModeConfigured ?? base.syncModeConfigured,
              } : {}),
              ...(includeReleases ? {
                releases: importedData.releases ?? previous?.releases ?? [],
              } : {}),
              ...(includeReleaseSubs ? {
                releaseSubscriptions: importedData.releaseSubscriptions ?? previous?.releaseSubscriptions ?? [],
                readReleases: importedData.readReleases ?? previous?.readReleases ?? [],
                releaseSourceSettings: importedData.releaseSourceSettings !== undefined
                  ? normalizeReleaseSourceSettings(importedData.releaseSourceSettings)
                  : (previous?.releaseSourceSettings ?? base.releaseSourceSettings),
              } : {}),
              ...(includeCategories ? {
                categoryListIdMap: importedData.categoryListIdMap ?? previous?.categoryListIdMap ?? {},
                customCategories: importedData.customCategories ?? previous?.customCategories ?? [],
                hiddenDefaultCategoryIds: importedData.hiddenDefaultCategoryIds ?? previous?.hiddenDefaultCategoryIds ?? [],
                defaultCategoryOverrides: importedData.defaultCategoryOverrides ?? previous?.defaultCategoryOverrides ?? {},
                categoryOrder: importedData.categoryOrder ?? previous?.categoryOrder ?? [],
              } : {}),
            };
        useAppStore.setState({
          accountWorkspaces: {
            ...workspaces,
            [importedData.activeAccountId]: archived,
          },
        });
      };

      const applyCurrentAccountBackupWorkspace = (restoreMode: 'merge' | 'replace'): void => {
        if (!currentAccountId) return;
        const backupWorkspace = importedWorkspaces[currentAccountId];
        if (backupWorkspace) {
          // 备份确实包含当前账号工作区：按导入类型应用其字段（类型过滤确保
          // 裁剪备份的空字段不会回滚未选类型的实时数据）。
          // merge 模式必须以当前实时快照为基座按 id 合并后再应用：备份中的
          // 当前账号快照可能早于实时数据，直接应用会用备份旧快照覆盖实时
          // 状态（本地新增仓库丢失）。
          const localWorkspace = captureAccountWorkspace(useAppStore.getState());
          // R4 审计修复：mergeWorkspacesById 只合并列表与 ID 集合（其余字段
          // 取本机基座），releaseSourceSettings 会整段保留本机值——备份当前
          // 账号工作区里的自定义发布来源会被丢弃。必须按并集合并本机与备份
          // 的来源设置（与列表合并同一语义：备份新增来源不丢失）。
          // R5 审计修复（CodeRabbit 发现 3）：分类显示/映射设置同理——
          // hiddenDefaultCategoryIds、defaultCategoryOverrides、categoryOrder、
          // categoryListIdMap 必须按分类合并分支的规则合并（保留本机 + 恢复
          // 备份新增），否则备份当前账号工作区里新增的分类设置会被丢弃。
          const effective = restoreMode === 'merge'
            ? {
              ...mergeWorkspacesById(localWorkspace, backupWorkspace),
              releaseSourceSettings: mergeReleaseSourceSettings(
                localWorkspace.releaseSourceSettings,
                backupWorkspace.releaseSourceSettings,
              ),
              ...mergeWorkspaceCategorySettings(localWorkspace, backupWorkspace),
            }
            : backupWorkspace;
          const rawCurrentAccountWorkspace = (
            importedData.accountWorkspaces as Record<string, Record<string, unknown>> | undefined
          )?.[currentAccountId];
          useAppStore.setState(
            applyAccountWorkspaceForTypes(
              effective,
              selectedTypes,
              restoreMode === 'replace' ? rawCurrentAccountWorkspace : undefined,
            ),
          );
          // 应用后以恢复后的实时状态为准同步当前账号工作区快照，
          // 避免字典中残留备份旧快照与实时状态不一致
          const restored = useAppStore.getState();
          useAppStore.setState({
            accountWorkspaces: {
              ...restored.accountWorkspaces,
              [currentAccountId]: captureAccountWorkspace(restored),
            },
          });
          return;
        }
        // 备份不含当前账号工作区：先把实时数据快照保存进工作区字典，
        // 绝不用本机旧快照回滚顶层实时状态（防止恢复期间新增数据被回滚丢失）
        const live = useAppStore.getState();
        useAppStore.setState({
          accountWorkspaces: {
            ...live.accountWorkspaces,
            [currentAccountId]: captureAccountWorkspace(live),
          },
        });
      };

      let hasArchivedTopLevel = false;
      const archiveTopLevelToBackupAccountOnce = (archiveMode: 'merge' | 'replace'): void => {
        if (hasArchivedTopLevel) return;
        hasArchivedTopLevel = true;
        archiveTopLevelToBackupAccount(archiveMode);
      };

      // 跨账号恢复订阅/已读状态：这组账号字段属于备份账号（如 A 导入 B 的
      // 备份，B 的订阅/来源设置/已读状态归档进 B 的工作区），绝不写入当前
      // 账号实时状态——否则收尾的实时快照会把它们保存进当前账号工作区。
      const archiveSubscriptionsToBackupAccount = (archiveMode: 'merge' | 'replace'): void => {
        if (!importedData.activeAccountId) return;
        const workspaces = useAppStore.getState().accountWorkspaces;
        const base = workspaces[importedData.activeAccountId] ?? emptyAccountWorkspace();
        const importedSubs = importedData.releaseSubscriptions;
        const importedReadReleases = importedData.readReleases;
        const importedSourceSettings = importedData.releaseSourceSettings;
        const archived: AccountWorkspace = {
          ...base,
          releaseSubscriptions: archiveMode === 'replace'
            ? (importedSubs !== undefined
              ? Array.from(new Set(importedSubs || []))
              : base.releaseSubscriptions)
            : (importedSubs
              ? Array.from(new Set([...base.releaseSubscriptions, ...importedSubs]))
              : base.releaseSubscriptions),
          readReleases: archiveMode === 'replace'
            ? (importedReadReleases !== undefined
              ? Array.from(new Set(importedReadReleases || []))
              : base.readReleases)
            : (importedReadReleases
              ? Array.from(new Set([...base.readReleases, ...importedReadReleases]))
              : base.readReleases),
          releaseSourceSettings: archiveMode === 'replace'
            ? (importedSourceSettings !== undefined
              ? normalizeReleaseSourceSettings(importedSourceSettings || null)
              : base.releaseSourceSettings)
            : (importedSourceSettings
              ? mergeReleaseSourceSettings(base.releaseSourceSettings, normalizeReleaseSourceSettings(importedSourceSettings))
              : base.releaseSourceSettings),
        };
        useAppStore.setState({
          accountWorkspaces: {
            ...workspaces,
            [importedData.activeAccountId]: archived,
          },
        });
      };

      // 审计修复（R2 安全审计）：备份中的账号键与 user 信息都来自备份文件，
      // 未与 GitHub 身份对照。本机没有该账号凭证时拟采用的备份 PAT 必须先
      // 直连 /user 核对真实身份与目标账号一致后才可写入 savedAccounts——
      // 不一致（或网络失败无法确认）时拒绝该凭据，条目保留为「需重新授权」
      // 的元数据，绝不写入未经验证的 PAT，更不能让它成为活动会话凭据。
      const verifyBackupPATIdentity = async (token: string, expectedAccountId: string): Promise<boolean> => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        try {
          const res = await fetch('https://api.github.com/user', {
            headers: {
              Authorization: `token ${token}`,
              Accept: 'application/vnd.github+json',
            },
            signal: controller.signal,
          });
          if (!res.ok) return false;
          const user = await res.json() as { id?: unknown };
          return typeof user?.id === 'number'
            && Number.isFinite(user.id)
            && String(user.id) === expectedAccountId;
        } catch {
          return false;
        } finally {
          clearTimeout(timeoutId);
        }
      };

      // savedAccounts 合并：仅当本机无凭证且备份包含非空白真实密钥时采用导入 Token，
      // 绝不用未验证或空白的备份 PAT 覆盖本机已有的有效凭证；先计算并校验工作区后再提交。
      // 审计修复（R12）：备份 PAT 身份核对需要等待网络（每账号最长 15s），等待
      // 期间本机可能新增/更新同账号凭据。核对阶段只收集「已通过身份核对的备份
      // PAT」，不基于核对前的 savedAccounts 构造待提交映射；提交时基于最新的
      // savedAccounts 重新合并（mergeVerifiedSavedAccounts）：本机已有凭据（含
      // 核对等待期间新增）一律保留，仅在本机无凭据时采用已验证的备份 PAT。
      const hasImportedSavedAccounts = !!importedData.savedAccounts
        && typeof importedData.savedAccounts === 'object';
      const importedSavedAccounts = hasImportedSavedAccounts
        ? normalizeSavedAccounts(importedData.savedAccounts)
        : null;
      const verifiedBackupTokens: Record<string, string> = {};
      // 审计修复（R13 finding 90）：备份 PAT 身份核对失败（GitHub 用户 ID 不
      // 匹配或网络失败）且提交时刻没有本机凭据可用的账号单独记录——其余数据
      // 导入完成后提示这些账号需要重新授权；身份匹配或已有本机凭据的账号
      // 不触发提示，与掩码提示 / 持久化失败提示相互独立。
      const unverifiedBackupAccountIds: string[] = [];
      if (importedSavedAccounts) {
        const preVerificationSaved = useAppStore.getState().savedAccounts;
        for (const [id, account] of Object.entries(importedSavedAccounts)) {
          const hasRealBackupToken = wasIncluded
            && isRealSecret(account.githubToken)
            && account.githubToken.trim().length > 0;
          if (!preVerificationSaved[id]?.githubToken && hasRealBackupToken) {
            const identityVerified = await verifyBackupPATIdentity(account.githubToken, id);
            // 审计修复（R13 finding 38）：每个核对请求返回后复核账号会话——
            // 会话已变（切号/同账号换凭据递增代次）时立即结束核对循环，不再
            // 发起下一次 PAT 验证请求（每个请求最长等待 15s，最终结果注定被
            // 会话检查丢弃）；会话未变时继续核对剩余凭据。会话变化后的放弃
            // 交由循环后的 abortIfSessionChangedDuringImport 统一处理。
            if (accountIdKey(useAppStore.getState().user) !== currentAccountIdAtImport
              || getAccountSessionGeneration() !== openedSessionGeneration) {
              break;
            }
            if (identityVerified) {
              verifiedBackupTokens[id] = account.githubToken;
            } else {
              unverifiedBackupAccountIds.push(id);
            }
          }
        }
      }
      // 提交时刻基于最新 savedAccounts 合并：本机凭据优先，其次已验证的备份 PAT。
      const mergeVerifiedSavedAccounts = (): Record<string, SavedAccount> | null => {
        if (!importedSavedAccounts) return null;
        const latestSaved = { ...useAppStore.getState().savedAccounts };
        for (const [id, account] of Object.entries(importedSavedAccounts)) {
          const local = latestSaved[id];
          latestSaved[id] = {
            ...(local ?? account),
            ...account,
            githubToken: local?.githubToken || verifiedBackupTokens[id] || '',
          };
        }
        return latestSaved;
      };
      const abortIfSessionChangedDuringImport = (reason: string): boolean => {
        if (accountIdKey(useAppStore.getState().user) === currentAccountIdAtImport
          && getAccountSessionGeneration() === openedSessionGeneration) {
          return false;
        }
        addLog(t('dataManagementPanel.import-data'), false, reason);
        showError(t('useBackupActions.account-changed-during-restore'));
        setImportPreview({ data: null, isOpen: false, fileName: '', openedAccountId: null, openedSessionGeneration: null });
        return true;
      };
      if (hasImportedSavedAccounts
        && abortIfSessionChangedDuringImport('session changed during import')) {
        // 核对备份 PAT 身份期间账号已切换或会话代次变化（切出又切回同一账号、
        // 同账号更换凭据）：放弃本次导入，避免把备份凭据与数据写进新会话上下文。
        return;
      }

      // 审计修复（R12）：gh-accounts.enc 写入失败时不报告导入成功——savedAccounts
      // 的持久化分片剥除 githubToken，导入的已验证 PAT 重启后会丢失；已写入
      // 内存的数据保留，向用户显示失败提示（详见末尾结果处理）。
      let ghAccountPersistFailed = false;

      if (mode === 'replace') {
        // 工作区字典合并（replace）：预检先于凭据写入——含无效 repositories 的
        // 备份工作区必须在任何提交（含 savedAccounts / 凭据落盘）之前整体拒绝；
        // 正式写入在凭据写入与会话复核之后基于最新状态重新计算（见下）。
        if (hasImportedWorkspaces) {
          replaceWorkspacesForSelectedTypes(
            useAppStore.getState().accountWorkspaces,
            importedData.accountWorkspaces as Record<string, unknown>,
            selectedTypes,
          );
        }
        const committedSavedAccounts = mergeVerifiedSavedAccounts();
        if (committedSavedAccounts) {
          useAppStore.setState({ savedAccounts: committedSavedAccounts });
          // 审计修复（R12）：等待加密凭据文件写入完成（幂等同步全量 Token 映射），
          // 失败时按 false 记录并在导入结束处拒绝报告成功。
          ghAccountPersistFailed = !(await syncGhAccountTokensFromState(useAppStore.getState()));
          // 审计补强（R12 竞态）：等待安全存储写入期间同样可能切号——复核会话后
          // 再执行后续工作区/实时状态写入，绝不把备份数据写进新会话上下文。
          if (abortIfSessionChangedDuringImport('session changed while persisting imported credentials')) return;
        }
        // 审计修复（R13 finding 41）：nextReplacedWorkspaces 移到凭据加密写入的
        // await 与会话复核之后基于最新 accountWorkspaces 计算——等待期间其他
        // 账号（如 Bob）的工作区可能更新（当前账号与代次不变，现有守卫拦不住），
        // 凭据写入前计算的旧快照会覆盖这些更新。重新读取最新状态再应用所选
        // 字段：分类仍被替换，未选仓库与新加入的账号工作区保留。
        const nextReplacedWorkspaces = hasImportedWorkspaces
          ? replaceWorkspacesForSelectedTypes(
              useAppStore.getState().accountWorkspaces,
              importedData.accountWorkspaces as Record<string, unknown>,
              selectedTypes,
            )
          : null;
        if (nextReplacedWorkspaces) {
          useAppStore.setState({ accountWorkspaces: nextReplacedWorkspaces });
        }
        const hasRepoScopedTopLevelData = validatedImportRepositories !== undefined
          || importedData.gists !== undefined
          || importedData.starredGists !== undefined
          || importedData.forks !== undefined
          || importedData.readForks !== undefined
          || importedData.syncMode !== undefined
          || importedData.syncModeConfigured !== undefined;
        if (selectedTypes.includes('repositories') && hasRepoScopedTopLevelData) {
          if (backupTargetsOtherAccount) {
            // 顶层仓库/Gist/Fork 等属于备份账号：归档而非覆盖当前登录账号视图（每个目标账号仅提交一次）
            archiveTopLevelToBackupAccountOnce('replace');
          } else if (!backupActiveAccountUnattributed && validatedImportRepositories !== undefined) {
            // 审计修复（R13 finding 40）：显式 activeAccountId: null 的未归属顶层
            // 账号数据不写入当前账号（跨账号归档同样不适用——无归属目标）
            store.setRepositories(validatedImportRepositories, { allowEmpty: true });
          }
        }
        if (selectedTypes.includes('repositories') && !backupTargetsOtherAccount && !backupActiveAccountUnattributed) {
          // 工作区级数据（Gist/Fork/同步范围）随仓库选择一并恢复
          if (importedData.gists || importedData.starredGists) {
            useAppStore.setState({
              gists: importedData.gists ?? useAppStore.getState().gists,
              starredGists: importedData.starredGists ?? useAppStore.getState().starredGists,
              gistSearchResults: importedData.gists ?? useAppStore.getState().gistSearchResults,
            });
          }
          if (importedData.forks || importedData.readForks) {
            useAppStore.setState({
              forks: importedData.forks ?? useAppStore.getState().forks,
              readForks: new Set(importedData.readForks ?? Array.from(useAppStore.getState().readForks)),
            });
          }
        }
        if (selectedTypes.includes('releases') && importedData.releases) {
          if (backupTargetsOtherAccount) {
            archiveTopLevelToBackupAccountOnce('replace');
          } else if (!backupActiveAccountUnattributed) {
            // 审计修复（R13 finding 40）：显式 null 的未归属顶层发布列表不写入当前账号
            store.setReleases(importedData.releases, { allowEmpty: true });
          }
        }
        if (selectedTypes.includes('aiConfigs') && importedData.aiConfigs) {
          // 审计修复（R13 finding 39）：掩码/缺失备份密钥的本机回退值必须读取
          // 所有等待（PAT 核对、凭据写入）结束后的实时凭据——回退到导入开始时
          // 捕获的旧快照会把等待期间轮换的新 AI 密钥回滚成旧值。备份明确包含
          // 的真实密钥仍优先采用。
          const liveAiConfigs = useAppStore.getState().aiConfigs;
          const restoredConfigs = importedData.aiConfigs.map(cfg => ({
            ...cfg,
            apiKey: wasIncluded && isRealSecret(cfg.apiKey) ? cfg.apiKey : liveAiConfigs.find(c => c.id === cfg.id)?.apiKey || ''
          }));
          store.setAIConfigs(restoredConfigs);
        }
        if (selectedTypes.includes('webdavConfigs') && importedData.webdavConfigs) {
          // 审计修复（R13 finding 39）：同 AI 密钥——WebDAV 密码的本机回退值
          // 读取等待结束后的实时凭据，绝不用旧快照覆盖等待期间轮换的新密码。
          const liveWebdavConfigs = useAppStore.getState().webdavConfigs;
          const restoredConfigs = importedData.webdavConfigs.map(cfg => ({
            ...cfg,
            password: wasIncluded && isRealSecret(cfg.password) ? cfg.password : liveWebdavConfigs.find(c => c.id === cfg.id)?.password || ''
          }));
          store.setWebDAVConfigs(restoredConfigs);
        }
        if (selectedTypes.includes('customCategories')) {
          if (backupTargetsOtherAccount) {
            archiveTopLevelToBackupAccountOnce('replace');
          } else if (!backupActiveAccountUnattributed) {
            // 审计修复（R13 finding 40）：显式 null 的未归属顶层分类数据不写入当前账号
            if (importedData.customCategories) {
              useAppStore.setState({ customCategories: importedData.customCategories });
            }
            if (importedData.hiddenDefaultCategoryIds) {
              useAppStore.setState({ hiddenDefaultCategoryIds: importedData.hiddenDefaultCategoryIds });
            }
            if (importedData.defaultCategoryOverrides) {
              useAppStore.setState({ defaultCategoryOverrides: importedData.defaultCategoryOverrides });
            }
            if (importedData.categoryOrder) {
              useAppStore.setState({ categoryOrder: importedData.categoryOrder });
            }
          }
          // 跨账号时备份顶层的分类映射属于备份账号，只随归档进入其工作区，
          // 不写入当前账号顶层；显式 null 的未归属顶层映射同样跳过（finding 40）
          if (!backupTargetsOtherAccount && !backupActiveAccountUnattributed && importedData.categoryListIdMap) {
            useAppStore.setState({ categoryListIdMap: importedData.categoryListIdMap });
          }
        }
        if (selectedTypes.includes('assetFilters') && Array.isArray(importedData.assetFilters)) {
          useAppStore.setState({ assetFilters: normalizeAssetFilters(importedData.assetFilters) });
        }
        if (selectedTypes.includes('discoveryRepos')) {
          if (importedData.discoveryRepos) {
            useAppStore.setState({ discoveryRepos: importedData.discoveryRepos });
          }
          if (importedData.discoveryTotalCount) {
            useAppStore.setState({ discoveryTotalCount: importedData.discoveryTotalCount });
          }
          if (importedData.discoveryHasMore) {
            useAppStore.setState({ discoveryHasMore: importedData.discoveryHasMore });
          }
          if (importedData.discoveryNextPage) {
            useAppStore.setState({ discoveryNextPage: importedData.discoveryNextPage });
          }
        }
        if (selectedTypes.includes('subscriptionRepos')) {
          if (importedData.subscriptionRepos) {
            useAppStore.setState({ subscriptionRepos: importedData.subscriptionRepos });
          }
          if (importedData.subscriptionLastRefresh) {
            useAppStore.setState({ subscriptionLastRefresh: importedData.subscriptionLastRefresh });
          }
          if (importedData.subscriptionChannels) {
            useAppStore.setState({ subscriptionChannels: importedData.subscriptionChannels });
          }
        }
        if (selectedTypes.includes('releaseSubscriptions')) {
          if (backupTargetsOtherAccount) {
            // 跨账号：订阅/来源设置/已读状态归档进备份账号工作区，
            // 不改写当前账号实时状态（避免实时快照把它们存进当前账号工作区）
            archiveSubscriptionsToBackupAccount('replace');
          } else if (!backupActiveAccountUnattributed) {
            // 审计修复（R13 finding 40）：显式 null 的未归属顶层订阅数据不写入当前账号
            if (importedData.releaseSubscriptions !== undefined) {
              useAppStore.setState({ releaseSubscriptions: new Set(importedData.releaseSubscriptions || []) });
            }
            if (importedData.releaseSourceSettings !== undefined) {
              store.setReleaseSourceSettings(normalizeReleaseSourceSettings(importedData.releaseSourceSettings || null));
            }
            if (importedData.readReleases !== undefined) {
              useAppStore.setState({ readReleases: new Set(importedData.readReleases || []) });
            }
          }
        }
        if (selectedTypes.includes('searchFilters') && importedData.searchFilters) {
          // 旧备份可能缺少新增的 licenses 字段，导入时默认 [] 保持 SearchFilters 契约
          const importedFilters = importedData.searchFilters;
          useAppStore.setState({
            searchFilters: {
              ...importedFilters,
              licenses: importedFilters.licenses ?? [],
            },
          });
        }
        if (selectedTypes.includes('uiSettings')) {
          const importedMode = importedData.themeMode === 'light' || importedData.themeMode === 'dark' || importedData.themeMode === 'system'
            ? importedData.themeMode
            : (importedData.theme === 'light' || importedData.theme === 'dark' ? importedData.theme : null);
          if (importedMode) {
            useAppStore.getState().setThemeMode(importedMode);
          }
          const importedPresetLight = isThemePresetId(importedData.themePresetLight)
            ? importedData.themePresetLight
            : (isThemePresetId(importedData.themePreset) ? importedData.themePreset : null);
          const importedPresetDark = isThemePresetId(importedData.themePresetDark)
            ? importedData.themePresetDark
            : (isThemePresetId(importedData.themePreset) ? importedData.themePreset : null);
          if (importedPresetLight) {
            useAppStore.getState().setThemePresetLight(importedPresetLight);
          }
          if (importedPresetDark) {
            useAppStore.getState().setThemePresetDark(importedPresetDark);
          }
          if (importedData.language) {
            useAppStore.setState({ language: importedData.language });
          }
          if (typeof importedData.isSidebarCollapsed === 'boolean') {
            useAppStore.setState({ isSidebarCollapsed: importedData.isSidebarCollapsed });
          }
          if (importedData.releaseViewMode === 'timeline' || importedData.releaseViewMode === 'repository') {
            useAppStore.setState({ releaseViewMode: importedData.releaseViewMode });
          }
          if (importedData.releaseSelectedFilters) {
            useAppStore.setState({ releaseSelectedFilters: importedData.releaseSelectedFilters });
          }
          if (importedData.releaseSearchQuery !== undefined) {
            useAppStore.setState({ releaseSearchQuery: importedData.releaseSearchQuery });
          }
          if (importedData.releaseExpandedRepositories) {
            useAppStore.setState({ releaseExpandedRepositories: new Set(importedData.releaseExpandedRepositories) });
          }
          if (importedData.pluginCustomIcons !== undefined) {
            useAppStore.setState({
              pluginCustomIcons: normalizePluginCustomIcons(importedData.pluginCustomIcons),
            });
          }
        }

        // Import special configs (proxy, RPC, backend secret) only if they exist in backup
        if (importedData.proxyConfig) {
          const restoredProxy = {
            ...importedData.proxyConfig,
            password: wasIncluded && isRealSecret(importedData.proxyConfig.password)
              ? importedData.proxyConfig.password
              : store.proxyConfig.password
          };
          useAppStore.setState({ proxyConfig: restoredProxy });
        }

        if (importedData.rpcDownloadConfig) {
          const restoredRpc = {
            ...importedData.rpcDownloadConfig,
            secret: wasIncluded && isRealSecret(importedData.rpcDownloadConfig.secret)
              ? importedData.rpcDownloadConfig.secret
              : store.rpcDownloadConfig.secret
          };
          useAppStore.setState({ rpcDownloadConfig: restoredRpc });
        }

        if (wasIncluded && importedData.backendApiSecret !== undefined && isRealSecret(importedData.backendApiSecret)) {
          setBackendApiSecret(importedData.backendApiSecret);
        }
      } else {
        const committedSavedAccounts = mergeVerifiedSavedAccounts();
        if (committedSavedAccounts) {
          useAppStore.setState({ savedAccounts: committedSavedAccounts });
          // 审计修复（R12）：同替换模式——等待 gh-accounts.enc 写入完成，失败时
          // 不报告导入成功。
          ghAccountPersistFailed = !(await syncGhAccountTokensFromState(useAppStore.getState()));
          if (abortIfSessionChangedDuringImport('session changed while persisting imported credentials')) return;
        }
        // 工作区字典合并（merge）：逐账号按所选类型过滤并按 id 去重合并，保留本机独有账号与未选字段
        if (hasImportedWorkspaces) {
          const merged = { ...useAppStore.getState().accountWorkspaces };
          const empty = emptyAccountWorkspace();
          const includeRepos = selectedTypes.includes('repositories');
          const includeReleases = selectedTypes.includes('releases');
          const includeCategories = selectedTypes.includes('customCategories');
          const includeReleaseSubs = selectedTypes.includes('releaseSubscriptions');
          for (const [accountId, incoming] of Object.entries(importedWorkspaces)) {
            const local = merged[accountId];
            const filteredIncoming: AccountWorkspace = {
              ...empty,
              repositories: includeRepos ? incoming.repositories : [],
              // 审计修复（C55）：合并导入时新工作区从 incoming 复制 lastSync 与
              // selectedGistCategory（与裁剪导出时两字段随 repositories 类型
              // 一同导出的语义一致）；已有工作区在 mergeWorkspacesById 的
              // 本机基座展开下保留本机这两字段值。
              ...(includeRepos ? { lastSync: incoming.lastSync, selectedGistCategory: incoming.selectedGistCategory } : {}),
              releases: includeReleases ? incoming.releases : [],
              gists: includeRepos ? incoming.gists : [],
              starredGists: includeRepos ? incoming.starredGists : [],
              forks: includeRepos ? incoming.forks : [],
              readForks: includeRepos ? incoming.readForks : [],
              syncMode: includeRepos ? incoming.syncMode : empty.syncMode,
              syncModeConfigured: includeRepos ? incoming.syncModeConfigured : empty.syncModeConfigured,
              customCategories: includeCategories ? incoming.customCategories : [],
              hiddenDefaultCategoryIds: includeCategories ? incoming.hiddenDefaultCategoryIds : [],
              defaultCategoryOverrides: includeCategories ? incoming.defaultCategoryOverrides : {},
              categoryOrder: includeCategories ? incoming.categoryOrder : [],
              categoryListIdMap: includeCategories ? incoming.categoryListIdMap : {},
              releaseSubscriptions: includeReleaseSubs ? incoming.releaseSubscriptions : [],
              readReleases: includeReleaseSubs ? incoming.readReleases : [],
              releaseSourceSettings: includeReleaseSubs ? incoming.releaseSourceSettings : empty.releaseSourceSettings,
            };
            merged[accountId] = local
              ? {
                  ...mergeWorkspacesById(local, filteredIncoming),
                  ...(includeReleaseSubs
                    ? {
                        releaseSourceSettings: mergeReleaseSourceSettings(
                          local.releaseSourceSettings,
                          filteredIncoming.releaseSourceSettings,
                        ),
                      }
                    : {}),
                  ...(includeCategories ? mergeWorkspaceCategorySettings(local, filteredIncoming) : {}),
                }
              : filteredIncoming;
          }
          useAppStore.setState({ accountWorkspaces: merged });
        }
        const hasRepoScopedTopLevelData = validatedImportRepositories !== undefined
          || importedData.gists !== undefined
          || importedData.starredGists !== undefined
          || importedData.forks !== undefined
          || importedData.readForks !== undefined
          || importedData.syncMode !== undefined
          || importedData.syncModeConfigured !== undefined;
        if (selectedTypes.includes('repositories') && hasRepoScopedTopLevelData) {
          if (backupTargetsOtherAccount) {
            // merge：备份顶层按 id 并入备份账号工作区，保留已合并的本机条目（每个目标账号仅合并一次）
            archiveTopLevelToBackupAccountOnce('merge');
          } else if (!backupActiveAccountUnattributed) {
            // 审计修复（R13 finding 40）：显式 activeAccountId: null 的未归属顶层
            // 账号数据不并入当前账号（跨账号归档同样不适用——无归属目标）
            if (validatedImportRepositories !== undefined) {
              // 审计修复（R12）：合并基于 PAT 核对等待后的实时状态——核对期间
              // 本机新增的仓库不得被核对前的旧快照覆盖；用实时值保留本机新增
              // 条目，仅追加备份中的新条目。
              const liveForRepoMerge = useAppStore.getState();
              const existingIds = new Set(liveForRepoMerge.repositories.map(r => r.id));
              const newRepos = validatedImportRepositories.filter(r => !existingIds.has(r.id));
              store.setRepositories([...liveForRepoMerge.repositories, ...newRepos]);
            }
            // 审计修复：旧版单账号备份没有 accountWorkspaces，Gist/Fork 等只
            // 存在于顶层——此前同账号 merge 分支只合并仓库，收尾只保存实时
            // 快照，备份新增 Gist/Fork 未恢复却报告导入成功。按各记录 ID 与
            // 本机数据合并；仅处理备份实际提供的字段，缺失字段保留本机值。
            if ((importedData.gists?.length ?? 0) > 0 || (importedData.starredGists?.length ?? 0) > 0) {
              const live = useAppStore.getState();
              useAppStore.setState({
                gists: mergeListById(live.gists, importedData.gists ?? []),
                gistSearchResults: mergeListById(live.gistSearchResults, importedData.gists ?? []),
                starredGists: mergeListById(live.starredGists, importedData.starredGists ?? []),
              });
            }
            if ((importedData.forks?.length ?? 0) > 0 || (importedData.readForks?.length ?? 0) > 0) {
              const live = useAppStore.getState();
              useAppStore.setState({
                forks: mergeListById(live.forks, importedData.forks ?? []),
                readForks: new Set([...Array.from(live.readForks), ...(importedData.readForks ?? [])]),
              });
            }
          }
        }
        if (selectedTypes.includes('releases') && importedData.releases) {
          if (backupTargetsOtherAccount) {
            archiveTopLevelToBackupAccountOnce('merge');
          } else if (!backupActiveAccountUnattributed) {
            // 审计修复（R13 finding 40）：显式 null 的未归属顶层发布列表不并入当前账号
            // 审计修复（R12）：同仓库合并——基于核对等待后的实时状态合并，
            // 保留等待期间本机新增的 Release。
            const liveForReleaseMerge = useAppStore.getState();
            const existingIds = new Set(liveForReleaseMerge.releases.map(r => r.id));
            const newReleases = importedData.releases.filter(r => !existingIds.has(r.id));
            store.setReleases([...liveForReleaseMerge.releases, ...newReleases]);
          }
        }
        if (selectedTypes.includes('aiConfigs') && importedData.aiConfigs) {
          // 审计修复（R12 ISSUE-2）：合并基于 PAT 核对等待后的实时状态——等待
          // 期间本机新增的 AI 配置不得被核对前的旧快照覆盖。
          const liveForAiConfigMerge = useAppStore.getState();
          const existingIds = new Set(liveForAiConfigMerge.aiConfigs.map(c => c.id));
          const newConfigs = importedData.aiConfigs
            .filter(c => !existingIds.has(c.id))
            .map(cfg => ({
              ...cfg,
              apiKey: wasIncluded && isRealSecret(cfg.apiKey) ? cfg.apiKey : ''
            }));
          liveForAiConfigMerge.setAIConfigs([...liveForAiConfigMerge.aiConfigs, ...newConfigs]);
        }
        if (selectedTypes.includes('webdavConfigs') && importedData.webdavConfigs) {
          // 审计修复（R12 ISSUE-2）：同 AI 配置——合并基底必须是提交时刻的实时值。
          const liveForWebdavMerge = useAppStore.getState();
          const existingIds = new Set(liveForWebdavMerge.webdavConfigs.map(c => c.id));
          const newConfigs = importedData.webdavConfigs
            .filter(c => !existingIds.has(c.id))
            .map(cfg => ({
              ...cfg,
              password: wasIncluded && isRealSecret(cfg.password) ? cfg.password : ''
            }));
          liveForWebdavMerge.setWebDAVConfigs([...liveForWebdavMerge.webdavConfigs, ...newConfigs]);
        }
        if (selectedTypes.includes('customCategories')) {
          if (backupTargetsOtherAccount) {
            archiveTopLevelToBackupAccountOnce('merge');
          } else if (!backupActiveAccountUnattributed && importedData.customCategories) {
            // 审计修复（R13 finding 40）：显式 null 的未归属顶层分类数据不并入当前
            // 账号；审计修复（R12 ISSUE-2）：分类合并同样读取实时状态，保留核对
            // 期间本机新增的分类。
            const liveForCategoryMerge = useAppStore.getState();
            const existingIds = new Set(liveForCategoryMerge.customCategories.map(c => c.id));
            const newCategories = importedData.customCategories.filter(c => !existingIds.has(c.id));
            useAppStore.setState({
              customCategories: [...liveForCategoryMerge.customCategories, ...newCategories]
            });
          }
          // 显式 null 的未归属顶层分类映射/显示设置同样跳过（finding 40）
          if (!backupTargetsOtherAccount && !backupActiveAccountUnattributed && importedData.categoryListIdMap) {
            const current = useAppStore.getState().categoryListIdMap;
            useAppStore.setState({
              categoryListIdMap: { ...current, ...importedData.categoryListIdMap },
            });
          }
          // 跨账号合并时，分类显示设置也只写入备份所属账号工作区（随归档），
          // 不修改当前账号的分类显示设置
          if (!backupTargetsOtherAccount && !backupActiveAccountUnattributed && importedData.hiddenDefaultCategoryIds) {
            const current = useAppStore.getState().hiddenDefaultCategoryIds;
            useAppStore.setState({
              hiddenDefaultCategoryIds: Array.from(new Set([...current, ...importedData.hiddenDefaultCategoryIds])),
            });
          }
          if (!backupTargetsOtherAccount && !backupActiveAccountUnattributed && importedData.defaultCategoryOverrides) {
            useAppStore.setState({
              defaultCategoryOverrides: {
                ...useAppStore.getState().defaultCategoryOverrides,
                ...importedData.defaultCategoryOverrides,
              },
            });
          }
          if (!backupTargetsOtherAccount && !backupActiveAccountUnattributed && importedData.categoryOrder) {
            const current = useAppStore.getState().categoryOrder;
            useAppStore.setState({
              categoryOrder: Array.from(new Set([...current, ...importedData.categoryOrder])),
            });
          }
        }
        if (selectedTypes.includes('assetFilters') && Array.isArray(importedData.assetFilters)) {
          // 审计修复（R12 ISSUE-2）：资产筛选合并读取实时状态，保留等待期间
          // 本机新增的筛选器。
          const liveForAssetFilterMerge = useAppStore.getState();
          const existingIds = new Set(liveForAssetFilterMerge.assetFilters.map(f => f.id));
          const newFilters = normalizeAssetFilters(importedData.assetFilters)
            .filter(f => !existingIds.has(f.id));
          useAppStore.setState({ assetFilters: [...liveForAssetFilterMerge.assetFilters, ...newFilters] });
        }
        if (selectedTypes.includes('discoveryRepos')) {
          const currentStore = useAppStore.getState();
          if (importedData.discoveryRepos) {
            const mergedDiscoveryRepos = { ...currentStore.discoveryRepos };
            Object.entries(importedData.discoveryRepos).forEach(([channel, repos]) => {
              const typedChannel = channel as keyof typeof currentStore.discoveryRepos;
              const existingIds = new Set((currentStore.discoveryRepos[typedChannel] || []).map(repo => repo.id));
              mergedDiscoveryRepos[typedChannel] = [
                ...(currentStore.discoveryRepos[typedChannel] || []),
                ...repos.filter(repo => !existingIds.has(repo.id)),
              ];
            });
            useAppStore.setState({ discoveryRepos: mergedDiscoveryRepos });
          }
          if (importedData.discoveryTotalCount) {
            useAppStore.setState({ discoveryTotalCount: {
              ...useAppStore.getState().discoveryTotalCount,
              ...importedData.discoveryTotalCount,
            } });
          }
          if (importedData.discoveryHasMore) {
            useAppStore.setState({ discoveryHasMore: {
              ...useAppStore.getState().discoveryHasMore,
              ...importedData.discoveryHasMore,
            } });
          }
          if (importedData.discoveryNextPage) {
            useAppStore.setState({ discoveryNextPage: {
              ...useAppStore.getState().discoveryNextPage,
              ...importedData.discoveryNextPage,
            } });
          }
        }
        if (selectedTypes.includes('subscriptionRepos')) {
          const currentStore = useAppStore.getState();
          if (importedData.subscriptionRepos) {
            const mergedSubscriptionRepos = { ...currentStore.subscriptionRepos };
            Object.entries(importedData.subscriptionRepos).forEach(([channel, repos]) => {
              const existingIds = new Set((currentStore.subscriptionRepos[channel] || []).map(repo => repo.id));
              mergedSubscriptionRepos[channel] = [
                ...(currentStore.subscriptionRepos[channel] || []),
                ...repos.filter(repo => !existingIds.has(repo.id)),
              ];
            });
            useAppStore.setState({ subscriptionRepos: mergedSubscriptionRepos });
          }
          if (importedData.subscriptionLastRefresh) {
            useAppStore.setState({ subscriptionLastRefresh: {
              ...useAppStore.getState().subscriptionLastRefresh,
              ...importedData.subscriptionLastRefresh,
            } });
          }
          if (importedData.subscriptionChannels) {
            const existingChannels = useAppStore.getState().subscriptionChannels;
            const existingIds = new Set(existingChannels.map(channel => channel.id));
            const newChannels = importedData.subscriptionChannels.filter(channel => !existingIds.has(channel.id));
            useAppStore.setState({ subscriptionChannels: [...existingChannels, ...newChannels] });
          }
        }
        if (selectedTypes.includes('releaseSubscriptions')) {
          if (backupTargetsOtherAccount) {
            // 跨账号：订阅/来源设置/已读状态按并集归档进备份账号工作区，
            // 不改写当前账号实时状态（避免实时快照把它们存进当前账号工作区）
            archiveSubscriptionsToBackupAccount('merge');
          } else if (!backupActiveAccountUnattributed) {
            // 审计修复（R13 finding 40）：显式 null 的未归属顶层订阅数据不并入当前账号
            // 审计修复（R12）：Release 合并所用的列表与设置基于核对等待后的
            // 实时状态——等待期间本机新增的订阅/来源/已读状态不得被旧快照覆盖。
            const liveForSubsMerge = useAppStore.getState();
            if (importedData.releaseSubscriptions) {
              const existingSubs = liveForSubsMerge.releaseSubscriptions;
              const newSubs = new Set([...Array.from(existingSubs), ...importedData.releaseSubscriptions]);
              useAppStore.setState({ releaseSubscriptions: newSubs });
            }
            if (importedData.releaseSourceSettings) {
              store.setReleaseSourceSettings(mergeReleaseSourceSettings(
                liveForSubsMerge.releaseSourceSettings,
                normalizeReleaseSourceSettings(importedData.releaseSourceSettings)
              ));
            }
            if (importedData.readReleases) {
              useAppStore.setState({
                readReleases: new Set([...Array.from(liveForSubsMerge.readReleases), ...importedData.readReleases]),
              });
            }
          }
        }
        if (selectedTypes.includes('searchFilters') && importedData.searchFilters) {
          const currentFilters = useAppStore.getState().searchFilters;
          useAppStore.setState({ searchFilters: {
            ...currentFilters,
            ...importedData.searchFilters,
            licenses: importedData.searchFilters.licenses ?? currentFilters.licenses ?? [],
          } });
        }
        if (selectedTypes.includes('uiSettings')) {
          const importedUiSettings = importedData;
          const currentStore = useAppStore.getState();
          const importedMode = importedUiSettings.themeMode === 'light' || importedUiSettings.themeMode === 'dark' || importedUiSettings.themeMode === 'system'
            ? importedUiSettings.themeMode
            : (importedUiSettings.theme === 'light' || importedUiSettings.theme === 'dark' ? importedUiSettings.theme : null);
          const importedPresetLight = isThemePresetId(importedUiSettings.themePresetLight)
            ? importedUiSettings.themePresetLight
            : (isThemePresetId(importedUiSettings.themePreset) ? importedUiSettings.themePreset : null);
          const importedPresetDark = isThemePresetId(importedUiSettings.themePresetDark)
            ? importedUiSettings.themePresetDark
            : (isThemePresetId(importedUiSettings.themePreset) ? importedUiSettings.themePreset : null);
          useAppStore.setState({
            ...(importedMode
              ? { themeMode: importedMode }
              : {}),
            ...(importedPresetLight
              ? { themePresetLight: importedPresetLight }
              : {}),
            ...(importedPresetDark
              ? { themePresetDark: importedPresetDark }
              : {}),
            ...(importedUiSettings.language ? { language: importedUiSettings.language } : {}),
            ...(typeof importedUiSettings.isSidebarCollapsed === 'boolean'
              ? { isSidebarCollapsed: importedUiSettings.isSidebarCollapsed }
              : {}),
            ...(importedUiSettings.releaseViewMode === 'timeline' || importedUiSettings.releaseViewMode === 'repository'
              ? { releaseViewMode: importedUiSettings.releaseViewMode }
              : {}),
            ...(importedUiSettings.releaseSelectedFilters
              ? { releaseSelectedFilters: importedUiSettings.releaseSelectedFilters }
              : {}),
            ...(importedUiSettings.releaseSearchQuery !== undefined
              ? { releaseSearchQuery: importedUiSettings.releaseSearchQuery }
              : {}),
            ...(importedUiSettings.releaseExpandedRepositories
              ? { releaseExpandedRepositories: new Set(importedUiSettings.releaseExpandedRepositories) }
              : {}),
            ...(importedUiSettings.pluginCustomIcons !== undefined
              ? {
                  pluginCustomIcons: {
                    ...currentStore.pluginCustomIcons,
                    ...normalizePluginCustomIcons(importedUiSettings.pluginCustomIcons),
                  },
                }
              : {}),
          });
          if (importedUiSettings.proxyConfig) {
            const restoredProxy = {
              ...importedUiSettings.proxyConfig,
              password: wasIncluded && isRealSecret(importedUiSettings.proxyConfig.password)
                ? importedUiSettings.proxyConfig.password
                : currentStore.proxyConfig.password,
            };
            useAppStore.setState({ proxyConfig: restoredProxy });
          }
          if (importedUiSettings.rpcDownloadConfig) {
            const restoredRpc = {
              ...importedUiSettings.rpcDownloadConfig,
              secret: wasIncluded && isRealSecret(importedUiSettings.rpcDownloadConfig.secret)
                ? importedUiSettings.rpcDownloadConfig.secret
                : currentStore.rpcDownloadConfig.secret,
            };
            useAppStore.setState({ rpcDownloadConfig: restoredRpc });
          }
          if (wasIncluded && importedUiSettings.backendApiSecret !== undefined && isRealSecret(importedUiSettings.backendApiSecret)) {
            setBackendApiSecret(importedUiSettings.backendApiSecret);
          }
        }
      }

      // ── 多账号恢复收尾（Issue #611）─────────────────────────────────
      if (backupTargetsOtherAccount) {
        // 把当前登录账号的备份工作区应用到顶层；备份不含当前账号工作区时
        // 保存实时数据快照，绝不回滚实时状态
        applyCurrentAccountBackupWorkspace(mode);
      } else if (currentAccountId && (mode === 'replace' || !hasImportedWorkspaces)) {
        // 同账号替换恢复：先应用备份中当前账号工作区的所选类型字段
        // （syncMode、syncModeConfigured、lastSync、selectedGistCategory 等
        // 仅存在于工作区的设置由此真正恢复）。最后同步当前账号工作区快照：
        // 以恢复后的实时状态为准（旧版单账号备份路径保持原有行为）。
        const backupWorkspace = importedWorkspaces[currentAccountId];
        if (hasImportedWorkspaces && backupWorkspace) {
          // 审计修复（C57）：实时应用与目标账号快照替换共用同一补丁语义——
          // 依据原始备份工作区实际存在的字段生成补丁（缺失字段保留实时值，
          // 显式 [] 清空），区分「未导出字段」与「导出为空」。
          const rawCurrentAccountWorkspace = (importedData.accountWorkspaces as Record<string, Record<string, unknown>> | undefined)?.[currentAccountId];
          useAppStore.setState(applyAccountWorkspaceForTypes(backupWorkspace, selectedTypes, rawCurrentAccountWorkspace));
          // 审计修复（R13 finding 89）：当前账号快照存在但未提供 syncMode/
          // syncModeConfigured 时，已验证的同账号顶层值按字段回退——绝不因
          // accountWorkspaces 字典存在（可能为空）就整体跳过顶层设置；快照
          // 提供的字段保持优先（上面的补丁未含该字段即视为未提供）。
          const rawWorkspaceHas = (key: string): boolean => !!rawCurrentAccountWorkspace
            && Object.prototype.hasOwnProperty.call(rawCurrentAccountWorkspace, key);
          if (!rawWorkspaceHas('syncMode')
            && (importedData.syncMode === 'stars' || importedData.syncMode === 'stars-and-lists')) {
            useAppStore.setState({ syncMode: importedData.syncMode });
          }
          if (!rawWorkspaceHas('syncModeConfigured') && typeof importedData.syncModeConfigured === 'boolean') {
            useAppStore.setState({ syncModeConfigured: importedData.syncModeConfigured });
          }
        } else if (!backupActiveAccountUnattributed) {
          // 无当前账号快照（旧版单账号备份没有工作区快照，或 accountWorkspaces
          // 为空/不含当前账号）：顶层 syncMode 是唯一来源。
          // 审计修复（R13 finding 89）：accountWorkspaces 存在但为空时同样应用
          // 顶层设置——按字段判断「当前账号快照是否提供」，而不是检查整个字典
          // 是否存在；快照存在时走上方分支保持其优先级。
          // 审计修复（R13 finding 40）：显式 activeAccountId: null 的顶层账号
          // 数据未归属任何账号，不应用到当前账号。
          if (importedData.syncMode === 'stars' || importedData.syncMode === 'stars-and-lists') {
            useAppStore.setState({ syncMode: importedData.syncMode });
          }
          if (typeof importedData.syncModeConfigured === 'boolean') {
            useAppStore.setState({ syncModeConfigured: importedData.syncModeConfigured });
          }
        }
        const live = useAppStore.getState();
        useAppStore.setState({
          accountWorkspaces: {
            ...live.accountWorkspaces,
            [currentAccountId]: captureAccountWorkspace(live),
          },
        });
      } else if (currentAccountId && hasImportedWorkspaces && importedWorkspaces[currentAccountId]) {
        // 同账号 merge：以当前实时快照为基座按 id 合并备份工作区并应用所选
        // 字段。merge 分支只合并了顶层 repositories/releases/订阅，Gist/Fork
        // 等仅存在于工作区字段中的备份新增条目若不在此落回实时状态，下一次
        // 导出的 buildFullWorkspaces 会用实时状态覆盖工作区，刚导入的条目
        // 随之丢失。本地同 ID 条目保留，备份新增条目并入。
        const liveWorkspace = captureAccountWorkspace(useAppStore.getState());
        const importedWorkspace = importedWorkspaces[currentAccountId];
        const effective = {
          ...mergeWorkspacesById(liveWorkspace, importedWorkspace),
          ...(selectedTypes.includes('releaseSubscriptions')
            ? {
                releaseSourceSettings: mergeReleaseSourceSettings(
                  liveWorkspace.releaseSourceSettings,
                  importedWorkspace.releaseSourceSettings,
                ),
              }
            : {}),
          ...(selectedTypes.includes('customCategories')
            ? mergeWorkspaceCategorySettings(liveWorkspace, importedWorkspace)
            : {}),
        };
        useAppStore.setState(applyAccountWorkspaceForTypes(effective, selectedTypes));
        const live = useAppStore.getState();
        useAppStore.setState({
          accountWorkspaces: {
            ...live.accountWorkspaces,
            [currentAccountId]: captureAccountWorkspace(live),
          },
        });
      }

      // 审计修复（R12）：gh-accounts.enc 写入失败时不报告导入成功（导入的已验证
      // PAT 只存在于内存会话，重启后丢失）；已写入内存的数据保留，改为失败提示
      // 并允许用户重新导入触发幂等重试。
      if (ghAccountPersistFailed) {
        addLog(t('dataManagementPanel.import-data'), false, 'gh-accounts credential persistence failed');
        showError(t('dataManagementPanel.import-failed-please-try-again'));
        setImportPreview({ data: null, isOpen: false, fileName: '', openedAccountId: null, openedSessionGeneration: null });
        return;
      }

      // 审计修复（R13 finding 90）：因 GitHub 身份验证失败而未采用、且提交时刻
      // 没有本机凭据可用的账号，单独提示用户为其重新授权——身份匹配或已有本机
      // 凭据的账号不触发提示；与掩码提示 / gh-accounts 持久化失败提示相互独立。
      const accountsNeedingReauth = unverifiedBackupAccountIds.filter((id) => {
        const localAccount = useAppStore.getState().savedAccounts[id];
        return !localAccount?.githubToken?.trim();
      });
      if (accountsNeedingReauth.length > 0) {
        showSuccess(t('dataManagementPanel.import-accounts-need-reauth', {
          accounts: accountsNeedingReauth.join(', '),
        }));
      } else if (backupActiveAccountUnattributed) {
        // 审计修复（R13 finding 40）：备份显式声明 activeAccountId: null——未归属
        // 任何账号的顶层账号数据已跳过（绝不写入当前账号），提示用户；已归属的
        // 工作区仍按各自 ID 恢复。
        addLog(t('dataManagementPanel.import-data'), true, 'unattributed top-level account data skipped (activeAccountId: null)');
        showSuccess(t('dataManagementPanel.import-skipped-unattributed-top-level'));
      } else if (hasMaskedBackupSecrets(importedData)) {
        // 如果导入的数据包含屏蔽的密钥，提示用户
        showSuccess(t('dataManagementPanel.data-imported-successfully-some-secrets-were-mas'));
      } else {
        showSuccess(t('dataManagementPanel.data-imported-successfully'));
      }

      addLog(
        t('dataManagementPanel.import-data'),
        true,
        accountsNeedingReauth.length > 0
          ? `accounts need re-authorization: ${accountsNeedingReauth.join(', ')}`
          : undefined,
      );
      setImportPreview({ data: null, isOpen: false, fileName: '', openedAccountId: null, openedSessionGeneration: null });
    } catch (error) {
      addLog(t('dataManagementPanel.import-data'), false, String(error));
      showError(t('dataManagementPanel.import-failed-please-try-again'));
    } finally {
      setIsImporting(false);
    }
  }, [importPreview, addLog, showSuccess, showError, t, setBackendApiSecret]);

  const cleanupSuggestions = useMemo<DataCleanupSuggestion[]>(() => {
    const suggestions: DataCleanupSuggestion[] = [];
    const now = Date.now();
    const ninetyDaysAgo = now - 90 * 24 * 60 * 60 * 1000;

    const oldReleases = releases.filter(r => 
      new Date(r.published_at).getTime() < ninetyDaysAgo
    );
    if (oldReleases.length > 0) {
      suggestions.push({
        key: 'oldReleases',
        label: '过期的Release记录',
        labelEn: 'Outdated Release Records',
        description: '超过90天未更新的Release记录',
        descriptionEn: 'Release records not updated in over 90 days',
        count: oldReleases.length,
        icon: <Tag className="w-4 h-4" />,
        color: 'text-muted-foreground dark:text-muted-foreground',
        bgColor: 'bg-muted dark:bg-muted/40'
      });
    }

    const totalDiscoveryRepos = Object.values(discoveryRepos || {}).flat().length;
    if (totalDiscoveryRepos > 100) {
      suggestions.push({
        key: 'discoveryCache',
        label: '发现页缓存数据',
        labelEn: 'Discovery Page Cache',
        description: '发现页缓存的仓库数据，可安全清理',
        descriptionEn: 'Cached repository data from discovery page, safe to clean',
        count: totalDiscoveryRepos,
        icon: <Sparkles className="w-4 h-4" />,
        color: 'text-muted-foreground dark:text-muted-foreground',
        bgColor: 'bg-muted dark:bg-muted/40'
      });
    }

    const unanalyzedRepos = repositories.filter(r => !r.analyzed_at).length;
    if (unanalyzedRepos > 10) {
      suggestions.push({
        key: 'unanalyzedRepos',
        label: '未分析的仓库',
        labelEn: 'Unanalyzed Repositories',
        description: '尚未进行AI分析的仓库数量',
        descriptionEn: 'Repositories that have not been analyzed by AI',
        count: unanalyzedRepos,
        icon: <Bot className="w-4 h-4" />,
        color: 'text-muted-foreground dark:text-muted-foreground',
        bgColor: 'bg-muted dark:bg-muted/40'
      });
    }

    const releaseIds = new Set(releases.map(r => r.id));
    let staleReadReleases = 0;
    for (const id of readReleases) {
      if (!releaseIds.has(id)) {
        staleReadReleases++;
      }
    }
    if (staleReadReleases > 0) {
      suggestions.push({
        key: 'readReleases',
        label: '已读Release标记',
        labelEn: 'Read Release Marks',
        description: '已不存在的Release的已读标记，可安全清理',
        descriptionEn: 'Read markers for releases that no longer exist, safe to clean',
        count: staleReadReleases,
        icon: <Eye className="w-4 h-4" />,
        color: 'text-muted-foreground dark:text-muted-foreground',
        bgColor: 'bg-muted dark:bg-muted/40'
      });
    }

    return suggestions;
  }, [releases, discoveryRepos, repositories, readReleases]);

  const handleCleanup = useCallback(async (key: string) => {
    try {
      switch (key) {
        case 'oldReleases': {
          const now = Date.now();
          const ninetyDaysAgo = now - 90 * 24 * 60 * 60 * 1000;
          const filteredReleases = releases.filter(r =>
            new Date(r.published_at).getTime() >= ninetyDaysAgo
          );
          const remainingIds = new Set(filteredReleases.map(r => r.id));
          const cleanedReadReleases = new Set<number>();
          for (const id of readReleases) {
            if (remainingIds.has(id)) {
              cleanedReadReleases.add(id);
            }
          }
          useAppStore.setState({ releases: filteredReleases, readReleases: cleanedReadReleases });
          break;
        }
        case 'discoveryCache':
          await deleteDiscoveryData();
          return;
        case 'readReleases': {
          const validReleaseIds = new Set(releases.map(r => r.id));
          const cleanedReadReleases = new Set<number>();
          for (const id of readReleases) {
            if (validReleaseIds.has(id)) {
              cleanedReadReleases.add(id);
            }
          }
          useAppStore.setState({ readReleases: cleanedReadReleases });
          break;
        }
        case 'unanalyzedRepos':
          showSuccess(t('dataManagementPanel.unanalyzed-repos-cannot-be-cleaned-directly-use'));
          return;
      }
      addLog(t('dataManagementPanel.cleanup-data'), true);
      showSuccess(t('dataManagementPanel.data-cleanup-successful'));
    } catch (error) {
      addLog(t('dataManagementPanel.cleanup-data'), false, String(error));
      showError(t('dataManagementPanel.cleanup-failed-please-try-again'));
    }
  }, [releases, readReleases, deleteDiscoveryData, addLog, showSuccess, showError, t]);

  const deleteAllData = async () => {
    // 分步跟踪未完成的存储：失败时记录哪一步未完成并保留失败状态（不重置内存、
    // 不提示成功），用户重试时清理幂等重跑即可续清残留
    const pendingStorages: string[] = [];
    // 审计修复（R13 finding 92）：凭据清理是否已落定——后续步骤失败时据此决定
    // 是否把内存凭据重新落盘（声明在 try 外供 catch 读取）
    let deviceCredentialsCleared = false;
    try {
      // 审计修复（R12）：桌面端加密凭据文件（gh-accounts.enc）必须最先清理——
      // 此前它在应用快照与独立缓存全部删除之后执行，一旦失败，持久化数据已被
      // 删除而页面仍显示旧的内存状态，只提示重试；用户此时关闭应用将无法找回
      // 已删除的快照。前置后失败即「尚未删除任何数据」，重试天然幂等；后续
      // 步骤的部分失败仍经 pendingStorages 记录剩余待清项（已完成步骤不再
      // 重跑），继续支持幂等续清。
      try {
        await clearGhAccountTokens();
        deviceCredentialsCleared = true;
      } catch (e) {
        pendingStorages.push('GitHub account credentials');
        throw e;
      }
      // 先清除存储，确保存储清除成功后再重置状态
      // 这样可以避免状态已重置但存储清除失败导致的数据不一致
      try {
        await clearAllStorage();
      } catch (e) {
        pendingStorages.push(t('dataManagementPanel.app-storage'));
        throw e;
      }
      // 周刊/推文频道数据在独立 IndexedDB，一并清空
      try {
        await weeklyIssuesStorage.clearAll();
      } catch (e) {
        pendingStorages.push(t('dataManagementPanel.weekly-data'));
        throw e;
      }
      try {
        await abortXTweetSync();
        await xTweetStorage.clearAll();
      } catch (e) {
        pendingStorages.push(t('dataManagementPanel.x-tweet-data'));
        throw e;
      }
      try {
        await abortTelegramSync();
        await telegramStorage.clearAll();
      } catch (e) {
        pendingStorages.push(t('dataManagementPanel.telegram-channel-data'));
        throw e;
      }

      // 清除 Electron 桌面端独立保存的加密凭据文件（x-auth.enc）
      try {
        await clearEncryptedXAuthViaDesktop();
      } catch {
        // 忽略桌面端清理失败
      }

      // 审计修复（C51）：清除账号级待推状态——gsm.pendingSyncAccounts /
      // gsm.pushedRepoIds 的持久化与内存记录、会话删除集合、在途退避重试与
      // 待推防抖。这些键不属于 clearAllStorage 的清理前缀，只清空 savedAccounts
      // 会残留待推标记并在重启后触发对已清空分区的补推。
      clearPendingSyncState();

      // 存储清除成功后，重置所有状态到初始值
      useAppStore.setState({
        // 用户和认证
        user: null,
        githubToken: null,
        isAuthenticated: false,
        // savedAccounts 与 user/githubToken 同属 core 持久化分片：不清空的话
        // 已保存账号及其 Token 会随本次 setState 被重新持久化，重置形同虚设
        savedAccounts: {},
        accountWorkspaces: {},
        xTweetAuth: null,
        xTweetAuthRevision: 0,

        // 仓库数据
        repositories: [],
        searchResults: [],
        lastSync: null,

        // Gist / Fork 数据（审计修复 C53：同一补丁清空实时工作区数据，
        // 避免被持久化层写回）
        gists: [],
        starredGists: [],
        forks: [],
        readForks: new Set<number>(),

        // Release 数据
        releases: [],
        releaseSubscriptions: new Set<number>(),
        readReleases: new Set<number>(),
        releaseSourceSettings: normalizeReleaseSourceSettings(null),

        // AI 配置
        aiConfigs: [],
        activeAIConfig: null,

        // WebDAV 配置
        webdavConfigs: [],
        activeWebDAVConfig: null,
        lastBackup: null,

        // 分类设置
        customCategories: [],
        hiddenDefaultCategoryIds: [],
        categoryOrder: [],
        collapsedSidebarCategoryCount: 20,
        defaultCategoryOverrides: {},

        // 资源过滤器
        assetFilters: [],

        // UI 设置
        selectedCategory: 'all',
        isSidebarCollapsed: false,
        searchFilters: {
          query: '',
          tags: [],
          languages: [],
          platforms: [],
          licenses: [],
          sortBy: 'stars',
          sortOrder: 'desc',
          isAnalyzed: undefined,
          isSubscribed: undefined,
        },
      });

      addLog(t('dataManagementPanel.delete-all-data'), true);
      showSuccess(t('dataManagementPanel.all-data-deleted-app-will-reload'));

      // Reload page after a short delay
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (error) {
      // 审计修复（R13 finding 92）：凭据已从磁盘删除而后续任一步骤失败时，
      // 内存仍保留账号与运行时 Token（快照不保存运行时 Token，重启后无可
      // 回填来源）——必须复用现有的幂等凭据同步把内存凭据重新落盘，保证
      // 失败路径结束时磁盘凭据与保留在内存中的账号一致。恢复写入失败时
      // 继续按待清项提示用户重试，不掩盖原错误。
      if (deviceCredentialsCleared) {
        const credentialsRestored = await syncGhAccountTokensFromState(useAppStore.getState());
        if (!credentialsRestored) {
          pendingStorages.push('GitHub account credentials');
        }
      }
      addLog(
        pendingStorages.length > 0
          ? `${t('dataManagementPanel.delete-all-data')} (${t('dataManagementPanel.pending')}: ${pendingStorages.join(', ')})`
          : t('dataManagementPanel.delete-all-data'),
        false,
        String(error)
      );
      showError(t('dataManagementPanel.delete-failed-please-try-again'));
      throw error;
    }
  };

  const handleDelete = async () => {
    if (!confirmation.type) return;

    // Verify GitHub username for "delete all" operation
    if (confirmation.type === 'all') {
      if (!user || confirmation.githubUsernameInput !== user.login) {
        showError(t('dataManagementPanel.github-username-verification-failed'));
        return;
      }
    }

    setIsDeleting(true);
    try {
      switch (confirmation.type) {
        case 'repositories':
          await deleteRepositories();
          break;
        case 'releases':
          await deleteReleases();
          break;
        case 'aiConfigs':
          await deleteAIConfigs();
          break;
        case 'webdavConfigs':
          await deleteWebDAVConfigs();
          break;
        case 'categorySettings':
          await deleteCategorySettings();
          break;
        case 'assetFilters':
          await deleteAssetFilters();
          break;
        case 'discoveryData':
          await deleteDiscoveryData();
          break;
        case 'subscriptionData':
          await deleteSubscriptionData();
          break;
        case 'releaseSubscriptions':
          await deleteReleaseSubscriptions();
          break;
        case 'searchHistory':
          await deleteSearchHistory();
          break;
        case 'all':
          await deleteAllData();
          break;
      }
      setConfirmation({ type: null, isOpen: false, githubUsernameInput: '' });
    } catch {
      // Error already handled in individual delete functions
    } finally {
      setIsDeleting(false);
    }
  };

  const openConfirmation = (type: DeleteOperation) => {
    setConfirmation({
      type,
      isOpen: true,
      githubUsernameInput: '',
    });
  };

  const closeConfirmation = () => {
    setConfirmation({ type: null, isOpen: false, githubUsernameInput: '' });
  };

  const getDeleteDescription = (type: DeleteOperation): string => {
    switch (type) {
      case 'repositories':
        return t('dataManagementPanel.this-will-delete-all-stars-repository-data-inclu');
      case 'releases':
        return t('dataManagementPanel.this-will-delete-all-release-records-including-r');
      case 'aiConfigs':
        return t('dataManagementPanel.this-will-delete-all-ai-service-configs-includin');
      case 'webdavConfigs':
        return t('dataManagementPanel.this-will-delete-all-webdav-sync-configs-includi');
      case 'categorySettings':
        return t('dataManagementPanel.this-will-delete-all-category-display-settings-i');
      case 'assetFilters':
        return t('dataManagementPanel.this-will-delete-all-asset-filter-presets-re-cre');
      case 'discoveryData':
        return t('dataManagementPanel.this-will-delete-cached-repos-from-discovery-cha');
      case 'subscriptionData':
        return t('dataManagementPanel.this-will-delete-cached-repos-from-subscription');
      case 'releaseSubscriptions':
        return t('dataManagementPanel.this-will-delete-all-release-subscriptions-and-r');
      case 'searchHistory':
        return t('dataManagementPanel.this-will-delete-search-history-and-current-filt');
      case 'all':
        return t('dataManagementPanel.this-will-delete-all-application-data-including');
      default:
        return '';
    }
  };

  const getDeleteTitle = (type: DeleteOperation): string => {
    switch (type) {
      case 'repositories':
        return t('dataManagementPanel.delete-stars-repositories-2');
      case 'releases':
        return t('dataManagementPanel.delete-release-records-2');
      case 'aiConfigs':
        return t('dataManagementPanel.delete-ai-service-configs-2');
      case 'webdavConfigs':
        return t('dataManagementPanel.delete-webdav-sync-configs-2');
      case 'categorySettings':
        return t('dataManagementPanel.delete-category-display-settings-2');
      case 'assetFilters':
        return t('dataManagementPanel.delete-asset-filter-presets-2');
      case 'discoveryData':
        return t('dataManagementPanel.delete-discovery-cache');
      case 'subscriptionData':
        return t('dataManagementPanel.delete-subscription-feed-cache-2');
      case 'releaseSubscriptions':
        return t('dataManagementPanel.delete-release-subscriptions-read-2');
      case 'searchHistory':
        return t('dataManagementPanel.delete-search-history-2');
      case 'all':
        return t('dataManagementPanel.delete-all-data-2');
      default:
        return '';
    }
  };

  const totalDiscoveryReposCount = useMemo(() => {
    return Object.values(discoveryRepos || {}).flat().length;
  }, [discoveryRepos]);

  const totalSubscriptionReposCount = useMemo(() => {
    return Object.values(subscriptionRepos || {}).flat().length;
  }, [subscriptionRepos]);

  const searchHistoryCount = (() => {
    try {
      const saved = localStorage.getItem('github-stars-search-history');
      if (saved) {
        const parsed = JSON.parse(saved);
        return Array.isArray(parsed) ? parsed.length : 0;
      }
    } catch { /* ignore */ }
    return 0;
  })();

  const dataStats = [
    {
      key: 'repositories',
      label: t('dataManagementPanel.stars-repositories'),
      description: t('dataManagementPanel.github-stars-repositories-with-ai-summaries-tags'),
      count: repositories.length,
      icon: <Github className="w-5 h-5" />,
      color: 'text-muted-foreground dark:text-muted-foreground',
      bgColor: 'bg-muted dark:bg-muted/40',
    },
    {
      key: 'releases',
      label: t('dataManagementPanel.release-records'),
      description: t('dataManagementPanel.release-version-info-for-subscribed-repos-includ'),
      count: releases.length,
      icon: <Tag className="w-5 h-5" />,
      color: 'text-muted-foreground dark:text-muted-foreground',
      bgColor: 'bg-muted dark:bg-muted/40',
    },
    {
      key: 'aiConfigs',
      label: t('dataManagementPanel.ai-service-configs'),
      description: t('dataManagementPanel.ai-analysis-service-configs-including-api-keys-m'),
      count: aiConfigs.length,
      icon: <Bot className="w-5 h-5" />,
      color: 'text-muted-foreground dark:text-muted-foreground',
      bgColor: 'bg-muted dark:bg-muted/40',
    },
    {
      key: 'webdavConfigs',
      label: t('dataManagementPanel.webdav-sync-configs'),
      description: t('dataManagementPanel.webdav-server-addresses-and-credentials-cloud-ba'),
      count: webdavConfigs.length,
      icon: <Cloud className="w-5 h-5" />,
      color: 'text-muted-foreground dark:text-muted-foreground',
      bgColor: 'bg-muted dark:bg-muted/40',
    },
    {
      key: 'categorySettings',
      label: t('dataManagementPanel.category-display-settings'),
      description: t('dataManagementPanel.custom-categories-default-category-overrides-and'),
      count: customCategories.length + Object.keys(defaultCategoryOverrides).length + hiddenDefaultCategoryIds.length,
      icon: <FolderTree className="w-5 h-5" />,
      color: 'text-muted-foreground dark:text-muted-foreground',
      bgColor: 'bg-muted dark:bg-muted/40',
    },
    {
      key: 'assetFilters',
      label: t('dataManagementPanel.asset-filter-presets'),
      description: t('dataManagementPanel.release-asset-filtering-rule-presets-re-create-f'),
      count: assetFilters.length,
      icon: <Filter className="w-5 h-5" />,
      color: 'text-muted-foreground dark:text-muted-foreground',
      bgColor: 'bg-muted dark:bg-muted/40',
    },
    {
      key: 'discoveryData',
      label: t('dataManagementPanel.discovery-cache'),
      description: t('dataManagementPanel.cached-repos-from-discovery-channels-safe-to-cle'),
      count: totalDiscoveryReposCount,
      icon: <Sparkles className="w-5 h-5" />,
      color: 'text-muted-foreground dark:text-muted-foreground',
      bgColor: 'bg-muted dark:bg-muted/40',
    },
    {
      key: 'subscriptionData',
      label: t('dataManagementPanel.subscription-feed-cache'),
      description: t('dataManagementPanel.cached-repos-from-subscription-feeds-safe-to-cle'),
      count: totalSubscriptionReposCount,
      icon: <Rss className="w-5 h-5" />,
      color: 'text-muted-foreground dark:text-muted-foreground',
      bgColor: 'bg-muted dark:bg-muted/40',
    },
    {
      key: 'releaseSubscriptions',
      label: t('dataManagementPanel.release-subscriptions-read'),
      description: t('dataManagementPanel.subscribed-repo-list-source-settings-and-read-ma'),
      count: releaseSubscriptions.size + releaseSourceSettings.watchCustomReleaseRepos.length + releaseSourceSettings.customReleaseRepos.length,
      icon: <Eye className="w-5 h-5" />,
      color: 'text-muted-foreground dark:text-muted-foreground',
      bgColor: 'bg-muted dark:bg-muted/40',
    },
    {
      key: 'searchHistory',
      label: t('dataManagementPanel.search-history'),
      description: t('dataManagementPanel.search-bar-history-and-current-filter-settings-s'),
      count: searchHistoryCount,
      icon: <Search className="w-5 h-5" />,
      color: 'text-muted-foreground dark:text-muted-foreground',
      bgColor: 'bg-muted dark:bg-muted/40',
    },
  ];

  return (
    <div className="space-y-8">
      {/* Success Message */}
      {showSuccessMessage && (
        <div className="fixed top-4 right-4 z-50 flex items-center space-x-2 px-4 py-3 bg-popover text-popover-foreground border border-border rounded-lg shadow-lg animate-in slide-in-from-top-2">
          <CheckCircle className="w-5 h-5" />
          <span>{showSuccessMessage}</span>
        </div>
      )}

      {/* Error Message */}
      {showErrorMessage && (
        <div className="fixed top-4 right-4 z-50 flex items-center space-x-2 px-4 py-3 bg-destructive/10 dark:bg-destructive/20 text-destructive dark:text-destructive rounded-lg shadow-lg animate-in slide-in-from-top-2">
          <XCircle className="w-5 h-5" />
          <span>{showErrorMessage}</span>
        </div>
      )}

      {/* Data Statistics */}
      <section>
        <h3 className="text-lg font-semibold text-foreground dark:text-foreground mb-4 flex items-center">
          <Database className="w-5 h-5 mr-2 text-muted-foreground dark:text-muted-foreground" />
          {t('dataManagementPanel.data-overview')}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {dataStats.map((stat) => (
            <div
              key={stat.key}
              className="bg-card dark:bg-card rounded-lg border border-border dark:border-border p-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className={`p-2 rounded-lg ${stat.bgColor} ${stat.color}`}>
                    {stat.icon}
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground dark:text-muted-foreground">{stat.label}</p>
                    <p className="text-2xl font-bold text-foreground dark:text-foreground">
                      {stat.count}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Data Export/Import */}
      <section>
        <h3 className="text-lg font-semibold text-foreground dark:text-foreground mb-4 flex items-center">
          <HardDrive className="w-5 h-5 mr-2 text-muted-foreground dark:text-muted-foreground" />
          {t('dataManagementPanel.data-export-import')}
        </h3>

        <div className="mb-4">
          <IncludeKeysToggle t={t} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Export */}
          <div className="bg-card dark:bg-card rounded-lg border border-border dark:border-border p-4">
            <div className="flex items-center space-x-3 mb-4">
              <div className="p-2 rounded-lg bg-muted dark:bg-muted/40 text-muted-foreground dark:text-muted-foreground">
                <Download className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-medium text-foreground dark:text-foreground">{t('dataManagementPanel.export-data-2')}</h4>
                <p className="text-sm text-muted-foreground dark:text-muted-foreground">{t('dataManagementPanel.export-data-to-json-file')}</p>
              </div>
            </div>

            <div className="space-y-2 mb-4">
              {exportItems.map((item) => (
                <div key={item.key} className="flex items-center space-x-2 text-sm text-foreground dark:text-muted-foreground">
                  <Checkbox
                    id={`export-type-${item.key}`}
                    checked={selectedExportTypes.includes(item.key)}
                    onCheckedChange={(checked) => {
                      setSelectedExportTypes((prev) => (
                        checked === true
                          ? prev.includes(item.key) ? prev : [...prev, item.key]
                          : prev.filter((key) => key !== item.key)
                      ));
                    }}
                  />
                  <label htmlFor={`export-type-${item.key}`}>{item.label}</label>
                </div>
              ))}
            </div>
            <Button
              onClick={() => {
                if (selectedExportTypes.length === 0) {
                  showError(t('dataManagementPanel.please-select-at-least-one-data-type'));
                  return;
                }
                exportData(selectedExportTypes);
              }}
              disabled={isExporting}
              className="w-full gap-2"
            >
              {isExporting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{t('dataManagementPanel.exporting')}</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>{t('dataManagementPanel.export-selected')}</span>
                </>
              )}
            </Button>
          </div>

          {/* Import */}
          <div className="bg-card dark:bg-card rounded-lg border border-border dark:border-border p-4">
            <div className="flex items-center space-x-3 mb-4">
              <div className="p-2 rounded-lg bg-muted dark:bg-muted/40 text-muted-foreground dark:text-muted-foreground">
                <Upload className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-medium text-foreground dark:text-foreground">{t('dataManagementPanel.import-data-2')}</h4>
                <p className="text-sm text-muted-foreground dark:text-muted-foreground">{t('dataManagementPanel.import-data-from-json-file')}</p>
              </div>
            </div>
            <div className="border-2 border-dashed border-border dark:border-border rounded-lg p-6 text-center">
              <Upload className="w-8 h-8 text-muted-foreground dark:text-muted-foreground/70 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground dark:text-muted-foreground mb-2">
                {t('dataManagementPanel.click-to-select-or-drag-file-here')}
              </p>
              <Input type="file" accept=".json" onChange={handleImportFile} className="peer sr-only" id="import-file-input" />
              <label
                htmlFor="import-file-input"
                className="cursor-pointer px-4 py-2 bg-muted dark:bg-muted/40 hover:bg-accent dark:hover:bg-accent text-foreground dark:text-muted-foreground rounded-lg transition-colors inline-block peer-focus-visible:ring-2 peer-focus-visible:ring-(--ui-focus-ring) peer-focus-visible:ring-offset-2"
              >
                {t('dataManagementPanel.select-file')}
              </label>
            </div>
          </div>
        </div>
      </section>

      {/* Data Cleanup Suggestions */}
      {cleanupSuggestions.length > 0 && (
        <section>
          <h3 className="text-lg font-semibold text-foreground dark:text-foreground mb-4 flex items-center">
            <RefreshCw className="w-5 h-5 mr-2 text-muted-foreground dark:text-muted-foreground " />
            {t('dataManagementPanel.data-cleanup-suggestions')}
          </h3>
          <div className="bg-muted dark:bg-muted/40 border border-border dark:border-border rounded-lg p-4 mb-4">
            <p className="text-sm text-muted-foreground dark:text-muted-foreground ">
              {t('dataManagementPanel.the-following-data-can-be-safely-cleaned-to-free')}
            </p>
          </div>
          <div className="space-y-3">
            {cleanupSuggestions.map((suggestion) => (
              <div
                key={suggestion.key}
                className="bg-card dark:bg-card rounded-lg border border-border dark:border-border p-4 flex items-center justify-between hover:bg-background dark:hover:bg-accent transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <div className={`p-2 rounded-lg ${suggestion.bgColor} ${suggestion.color}`}>
                    {suggestion.icon}
                  </div>
                  <div>
                    <p className="font-medium text-foreground dark:text-foreground">
                      {language === 'zh' ? suggestion.label : suggestion.labelEn}
                    </p>
                    <p className="text-sm text-muted-foreground dark:text-muted-foreground">
                      {language === 'zh' ? suggestion.description : suggestion.descriptionEn}
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  <span className="text-sm font-medium text-muted-foreground dark:text-muted-foreground">
                    {suggestion.count} {t('dataManagementPanel.items')}
                  </span>
                  <Button
                    onClick={() => handleCleanup(suggestion.key)}
                    className="px-3 py-1.5 text-sm font-medium text-muted-foreground dark:text-muted-foreground bg-muted dark:bg-muted/40 hover:bg-accent dark:hover:bg-accent rounded-lg transition-colors"
                  >
                    {t('dataManagementPanel.clean')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Selective Data Deletion */}
      <section>
        <h3 className="text-lg font-semibold text-foreground dark:text-foreground mb-4 flex items-center">
          <Trash2 className="w-5 h-5 mr-2 text-muted-foreground dark:text-muted-foreground " />
          {t('dataManagementPanel.selective-data-deletion')}
        </h3>
        <div className="bg-card dark:bg-card rounded-lg border border-border dark:border-border overflow-hidden">
          <div className="divide-y divide-border/60 dark:divide-border">
            {dataStats.map((stat) => (
              <div
                key={stat.key}
                className="flex items-center justify-between px-4 py-4 hover:bg-background dark:hover:bg-accent transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <div className={`p-2 rounded-lg ${stat.bgColor} ${stat.color}`}>
                    {stat.icon}
                  </div>
                  <div>
                    <p className="font-medium text-foreground dark:text-foreground">{stat.label}</p>
                    <p className="text-sm text-muted-foreground dark:text-muted-foreground mt-0.5">
                      {stat.description}
                    </p>
                    <p className="text-xs text-muted-foreground dark:text-muted-foreground/70 mt-1">
                      {stat.count} {t('dataManagementPanel.records')}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  onClick={() => openConfirmation(stat.key as DeleteOperation)}
                  disabled={stat.key !== 'discoveryData' && stat.count === 0}
                  className="flex items-center space-x-2 px-4 py-2 text-sm font-medium text-muted-foreground dark:text-muted-foreground hover:text-foreground dark:hover:text-foreground hover:bg-accent dark:hover:bg-accent rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>{t('dataManagementPanel.delete')}</span>
                </Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Delete All Data */}
      <section>
        <h3 className="text-lg font-semibold text-destructive mb-4 flex items-center">
          <AlertTriangle className="w-5 h-5 mr-2" />
          {t('dataManagementPanel.danger-zone')}
        </h3>
        <Card className="border-destructive/40 py-5">
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-destructive/10 text-destructive">
              <FileWarning className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="text-base font-semibold text-foreground dark:text-foreground">
                {t('dataManagementPanel.delete-all-data-2')}
              </h4>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground dark:text-muted-foreground">
                {t('dataManagementPanel.this-will-permanently-delete-all-application-dat')}
              </p>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => openConfirmation('all')}
                className="mt-4"
              >
                <Trash2 />
                <span>{t('dataManagementPanel.delete-all-data-2')}</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Operation Logs */}
      {operationLogs.length > 0 && (
        <section>
          <h3 className="text-lg font-semibold text-foreground dark:text-foreground mb-4">
            {t('dataManagementPanel.operation-logs')}
          </h3>
          <div className="bg-card dark:bg-card rounded-lg border border-border dark:border-border overflow-hidden">
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-background dark:bg-muted/40 sticky top-0">
                  <tr>
                    <th className="px-4 py-2 text-left text-muted-foreground dark:text-muted-foreground">
                      {t('dataManagementPanel.time')}
                    </th>
                    <th className="px-4 py-2 text-left text-muted-foreground dark:text-muted-foreground">
                      {t('dataManagementPanel.operation')}
                    </th>
                    <th className="px-4 py-2 text-left text-muted-foreground dark:text-muted-foreground">
                      {t('dataManagementPanel.status')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60 dark:divide-border">
                  {operationLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-background dark:hover:bg-accent">
                      <td className="px-4 py-2 text-muted-foreground dark:text-muted-foreground">
                        {log.timestamp}
                      </td>
                      <td className="px-4 py-2 text-foreground dark:text-foreground">{log.operation}</td>
                      <td className="px-4 py-2">
                        {log.success ? (
                          <span className="inline-flex items-center px-2 py-1 text-xs font-medium text-muted-foreground dark:text-muted-foreground bg-muted dark:bg-muted/40 rounded-full">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            {t('dataManagementPanel.success')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-1 text-xs font-medium text-muted-foreground dark:text-muted-foreground bg-destructive/10 dark:bg-destructive/20 rounded-full">
                            <XCircle className="w-3 h-3 mr-1" />
                            {t('dataManagementPanel.failed')}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* Confirmation Modal */}
      <AlertDialog
        open={confirmation.isOpen}
        onOpenChange={(open) => {
          if (!open && !isDeleting) closeConfirmation();
        }}
      >
        {confirmation.type && (
          <AlertDialogContent className="max-w-md">

          <AlertDialogHeader className="rounded-lg bg-muted p-4 dark:bg-muted/40">
            <AlertDialogTitle className="flex items-center gap-3 text-muted-foreground">
              <AlertTriangle className="h-6 w-6" />
              {getDeleteTitle(confirmation.type)}
            </AlertDialogTitle>
          </AlertDialogHeader>

          <div className="space-y-4">
            <AlertDialogDescription asChild>
              <div className="flex items-start space-x-3 rounded-lg bg-muted p-4 text-muted-foreground dark:bg-muted/40">
                <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />
                <p className="text-sm">{getDeleteDescription(confirmation.type)}</p>
              </div>
            </AlertDialogDescription>

              {/* GitHub Username Verification for "Delete All" */}
              {confirmation.type === 'all' && user && (
                <div className="space-y-2">
                  <label htmlFor="delete-all-github-username" className="block text-sm font-medium text-foreground dark:text-muted-foreground">
                    {t('dataManagementPanel.please-enter-your-github-username-to-confirm-thi')}
                    <span className="ml-2 font-mono text-muted-foreground dark:text-muted-foreground">
                      {user.login}
                    </span>
                  </label>
                  <Input
                    id="delete-all-github-username"
                    type="text"
                    value={confirmation.githubUsernameInput}
                    onChange={(e) =>
                      setConfirmation((prev) => ({
                        ...prev,
                        githubUsernameInput: e.target.value,
                      }))
                    }
                    placeholder={t('dataManagementPanel.enter-github-username')}
                    className="w-full px-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-(--ui-focus-ring) dark:bg-muted/40 dark:text-foreground"
                  />
                </div>
              )}

            <AlertDialogFooter className="pt-4">
              <AlertDialogCancel
                onClick={closeConfirmation}
                disabled={isDeleting}
                className="flex-1 bg-muted text-foreground hover:bg-accent dark:bg-muted/40 dark:text-muted-foreground dark:hover:bg-accent"
              >
                {t('dataManagementPanel.cancel')}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault();
                  void handleDelete();
                }}
                disabled={
                  isDeleting ||
                  (confirmation.type === 'all' &&
                    confirmation.githubUsernameInput !== user?.login)
                }
                className="flex-1 bg-destructive font-medium text-destructive-foreground hover:bg-destructive/90"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>{t('dataManagementPanel.deleting')}</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4" />
                    <span>{t('dataManagementPanel.confirm-delete')}</span>
                  </>
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </div>
          </AlertDialogContent>
        )}
      </AlertDialog>

      {/* Import Preview Modal */}
      {importPreview.isOpen && importPreview.data && (
        <Dialog
          open={importPreview.isOpen}
          onOpenChange={(open) => {
            if (!open && !isImporting) {
              setImportPreview({ data: null, isOpen: false, fileName: '', openedAccountId: null, openedSessionGeneration: null });
            }
          }}
        >
          <DialogContent className="max-w-lg" closeLabel={t('dataManagementPanel.close')}>
            <DialogHeader className="rounded-lg bg-background dark:bg-card">
              <DialogTitle className="flex items-center gap-3 text-muted-foreground">
                <Upload className="h-6 w-6" />
                {t('dataManagementPanel.import-data-preview')}
              </DialogTitle>
              <DialogDescription>
                {t('dataManagementPanel.review-the-backup-contents-before-choosing-an-im')}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="text-sm text-muted-foreground dark:text-muted-foreground">
                <p><strong>{t('dataManagementPanel.file')}</strong> {importPreview.fileName}</p>
                <p><strong>{t('dataManagementPanel.export-date')}</strong> {new Date(importPreview.data.exportDate).toLocaleString()}</p>
                <p><strong>{t('dataManagementPanel.version')}</strong> {importPreview.data.appVersion}</p>
              </div>

              <div className="border-t border-border dark:border-border pt-4">
                <p className="text-sm font-medium text-foreground dark:text-muted-foreground mb-2">{t('dataManagementPanel.included-data')}</p>
                <div className="space-y-1 text-sm">
                  {importPreview.data.data.repositories && (
                    <p className="text-muted-foreground dark:text-muted-foreground">
                      • {t('dataManagementPanel.repositories')}: {importPreview.data.data.repositories.length} {t('dataManagementPanel.items')}
                    </p>
                  )}
                  {importPreview.data.data.releases && (
                    <p className="text-muted-foreground dark:text-muted-foreground">
                      • {t('dataManagementPanel.releases')}: {importPreview.data.data.releases.length} {t('dataManagementPanel.items')}
                    </p>
                  )}
                  {importPreview.data.data.aiConfigs && (
                    <p className="text-muted-foreground dark:text-muted-foreground">
                      • {t('dataManagementPanel.ai-configs')}: {importPreview.data.data.aiConfigs.length} {t('dataManagementPanel.items')}
                    </p>
                  )}
                  {importPreview.data.data.webdavConfigs && (
                    <p className="text-muted-foreground dark:text-muted-foreground">
                      • {t('dataManagementPanel.webdav-configs')}: {importPreview.data.data.webdavConfigs.length} {t('dataManagementPanel.items')}
                    </p>
                  )}
                  {importPreview.data.data.customCategories && (
                    <p className="text-muted-foreground dark:text-muted-foreground">
                      • {t('dataManagementPanel.categories')}: {importPreview.data.data.customCategories.length} {t('dataManagementPanel.items')}
                    </p>
                  )}
                  {importPreview.data.data.assetFilters && (
                    <p className="text-muted-foreground dark:text-muted-foreground">
                      • {t('dataManagementPanel.asset-filters')}: {importPreview.data.data.assetFilters.length} {t('dataManagementPanel.items')}
                    </p>
                  )}
                </div>
              </div>

              {/* Warning for masked secrets */}
              {hasMaskedBackupSecrets(importPreview.data.data) && (
                <div className="flex items-start space-x-3 text-warning bg-warning/10 p-4 rounded-lg border border-warning/30">
                  <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <p className="text-sm">
                    {t('dataManagementPanel.warning-some-secrets-in-this-backup-are-masked-p')}
                  </p>
                </div>
              )}

              <DialogFooter className="pt-4">
                <Button
                  variant="outline"
                  onClick={() => setImportPreview({ data: null, isOpen: false, fileName: '', openedAccountId: null, openedSessionGeneration: null })}
                  disabled={isImporting}
                  className="flex-1 px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
                >
                  {t('dataManagementPanel.cancel')}
                </Button>
                <Button
                  onClick={() => {
                    importData(resolveImportTypes(importPreview.data!.data), 'merge');
                  }}
                  disabled={isImporting}
                  className="flex-1 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center space-x-2"
                >
                  {isImporting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{t('dataManagementPanel.importing')}</span>
                    </>
                  ) : (
                    <span>{t('dataManagementPanel.merge-import')}</span>
                  )}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    importData(resolveImportTypes(importPreview.data!.data), 'replace');
                  }}
                  disabled={isImporting}
                  className="flex-1 px-4 py-2 font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center space-x-2"
                >
                  {isImporting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{t('dataManagementPanel.importing')}</span>
                    </>
                  ) : (
                    <span>{t('dataManagementPanel.replace-import')}</span>
                  )}
                </Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* GitHub PAT 导出授权确认（审计修复 R13 finding 53） */}
      <AlertDialog
        open={patExportConfirmation.isOpen}
        onOpenChange={(open) => {
          if (!open) resolvePatExportConfirmation(false);
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader className="rounded-lg bg-muted p-4 dark:bg-muted/40">
            <AlertDialogTitle className="flex items-center gap-3 text-muted-foreground">
              <AlertTriangle className="h-6 w-6" />
              {t('dataManagementPanel.pat-export-authorization-title')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('dataManagementPanel.pat-export-authorization-desc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="pt-4">
            <AlertDialogCancel
              onClick={() => resolvePatExportConfirmation(false)}
              className="flex-1 bg-muted text-foreground hover:bg-accent dark:bg-muted/40 dark:text-muted-foreground dark:hover:bg-accent"
            >
              {t('dataManagementPanel.pat-export-deny')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => resolvePatExportConfirmation(true)}
              className="flex-1 bg-destructive font-medium text-destructive-foreground hover:bg-destructive/90"
            >
              {t('dataManagementPanel.pat-export-authorize')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
