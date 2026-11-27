
import { TranslateFn } from '../../i18n/useT';
import type { AppLanguage } from '../../i18n/languages';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  SettingsCard,
  SettingsDivider,
  SettingsNotice,
  SettingsPageStack,
  SettingsSection,
} from './SettingsPrimitives';
import { weeklyIssuesStorage } from '../../services/weeklyIssuesStorage';
import { xTweetStorage } from '../../services/xTweetStorage';
import { telegramStorage } from '../../services/telegramStorage';
import { abortXTweetSync } from '../../services/xTweetService';
import { abortTelegramSync } from '../../services/telegramService';
import { clearEncryptedXAuthViaDesktop } from '../../services/electronProxy';
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
  Rss,
} from 'lucide-react';
import { Github } from '../ui/brand-icons';
import { useAppStore } from '../../store/useAppStore';
import { removePersistedSnapshot } from '../../store/persistence/storage';
import {
  ACTIVE_PROFILE_ID,
  clearProfileLocalStorage,
  findConflictingWebdavProfile,
  scopedKey,
} from '../../services/profileStorage';
import { normalizePluginCustomIcons } from '../../store/normalizers/persistedState';
import { useShallow } from 'zustand/react/shallow';
import { resolveKnownThemePresetId } from '../../constants/themePresets';
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
  ReleaseSourceSettings
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

const MASKED_SECRET = '***';

const isRealSecret = (value: unknown): value is string => (
  typeof value === 'string' && value.length > 0 && value !== MASKED_SECRET
);

const hasMaskedSecrets = (data: ExportData['data']): boolean => {
  return !!(
    data.aiConfigs?.some(config => config.apiKey === MASKED_SECRET) ||
    data.webdavConfigs?.some(config => config.password === MASKED_SECRET) ||
    data.proxyConfig?.password === MASKED_SECRET ||
    data.rpcDownloadConfig?.secret === MASKED_SECRET ||
    data.backendApiSecret === MASKED_SECRET
  );
};

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
};

const resolveImportTypes = (data: ExportData['data']): string[] => {
  const present = Array.from(new Set(
    IMPORT_DATA_KEYS
      .filter((key) => data[key] !== undefined)
      .map((key) => IMPORT_KEY_ALIASES[key] ?? key)
  ));
  if (UI_SETTINGS_DATA_KEYS.some((key) => data[key] !== undefined)) {
    present.push('uiSettings');
  }
  return present;
};

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
  const [importPreview, setImportPreview] = useState<{
    data: ExportData | null;
    isOpen: boolean;
    fileName: string;
  }>({ data: null, isOpen: false, fileName: '' });
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

  const clearAllStorage = async () => {
    // Only clear the active profile's scoped localStorage/sessionStorage keys.
    // Never wipe gsm:profiles, gsm:active-profile, gsm:pending-seed,
    // github-stars-manager-backend-url, or other profiles' data.
    clearProfileLocalStorage(ACTIVE_PROFILE_ID);

    // Clear IndexedDB - only remove the active profile's persisted snapshot.
    // 走持久化层的串行删除：除磁盘清扫外，还会在串行写链上取消待写、完成删除并
    // 重置分片判脏簿记——直接调底层 removeItem 会让随后的 store 重置写入以过期
    // 基准判脏，只补写部分分片，而 meta 仍声明全部分片。
    // 必须 await 删除真正落盘（zustand v4 的 clearStorage 不回传 Promise）：
    // 若链上还有排队的大写入，2 秒后的 reload 可能早于删除提交，数据复活。
    try {
      await removePersistedSnapshot(useAppStore.persist.getOptions().name ?? scopedKey('github-stars-manager'));
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
      localStorage.removeItem(scopedKey('github-stars-search-history'));
      localStorage.removeItem(scopedKey('lastSearchTime'));
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
        version: '1.0',
        exportDate: new Date().toISOString(),
        appVersion: '0.4.0',
        data: { includeKeysInBackup: includeKeys }
      };

      if (selectedTypes.includes('repositories')) {
        exportDataObj.data.repositories = store.repositories;
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

        setImportPreview({ data, isOpen: true, fileName: file.name });
      } catch {
        showError(t('dataManagementPanel.failed-to-parse-file-ensure-it-is-a-valid-json-f'));
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }, [showError, t]);

  const importData = useCallback(async (selectedTypes: string[], mode: 'merge' | 'replace') => {
    if (!importPreview.data) return;

    setIsImporting(true);
    try {
      const store = useAppStore.getState();
      const importedData = importPreview.data.data;
      // Legacy compatibility: treat missing flag as true (older exports contained keys)
      const wasIncluded = importedData.includeKeysInBackup ?? true;
      let skippedWebdavConflicts = 0;
      let firstConflictAccount = '';

      if (mode === 'replace') {
        if (selectedTypes.includes('repositories') && importedData.repositories) {
          store.setRepositories(importedData.repositories, { allowEmpty: true });
        }
        if (selectedTypes.includes('releases') && importedData.releases) {
          store.setReleases(importedData.releases, { allowEmpty: true });
        }
        if (selectedTypes.includes('aiConfigs') && importedData.aiConfigs) {
          const restoredConfigs = importedData.aiConfigs.map(cfg => ({
            ...cfg,
            apiKey: wasIncluded && isRealSecret(cfg.apiKey) ? cfg.apiKey : store.aiConfigs.find(c => c.id === cfg.id)?.apiKey || ''
          }));
          store.setAIConfigs(restoredConfigs);
        }
        if (selectedTypes.includes('webdavConfigs') && importedData.webdavConfigs) {
          const restoredConfigs = importedData.webdavConfigs.map(cfg => ({
            ...cfg,
            password: wasIncluded && isRealSecret(cfg.password) ? cfg.password : store.webdavConfigs.find(c => c.id === cfg.id)?.password || ''
          }));
          const nonConflictingConfigs = restoredConfigs.filter(cfg => {
            const conflict = findConflictingWebdavProfile(cfg.url, cfg.path);
            if (conflict) {
              skippedWebdavConflicts += 1;
              if (!firstConflictAccount) firstConflictAccount = conflict.login || conflict.id;
              return false;
            }
            return true;
          });
          store.setWebDAVConfigs(nonConflictingConfigs);
        }
        if (selectedTypes.includes('customCategories')) {
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
          const importedPresetLight = resolveKnownThemePresetId(importedData.themePresetLight)
            ?? resolveKnownThemePresetId(importedData.themePreset);
          const importedPresetDark = resolveKnownThemePresetId(importedData.themePresetDark)
            ?? resolveKnownThemePresetId(importedData.themePreset);
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
        if (selectedTypes.includes('repositories') && importedData.repositories) {
          const existingIds = new Set(store.repositories.map(r => r.id));
          const newRepos = importedData.repositories.filter(r => !existingIds.has(r.id));
          store.setRepositories([...store.repositories, ...newRepos]);
        }
        if (selectedTypes.includes('releases') && importedData.releases) {
          const existingIds = new Set(store.releases.map(r => r.id));
          const newReleases = importedData.releases.filter(r => !existingIds.has(r.id));
          store.setReleases([...store.releases, ...newReleases]);
        }
        if (selectedTypes.includes('aiConfigs') && importedData.aiConfigs) {
          const existingIds = new Set(store.aiConfigs.map(c => c.id));
          const newConfigs = importedData.aiConfigs
            .filter(c => !existingIds.has(c.id))
            .map(cfg => ({
              ...cfg,
              apiKey: wasIncluded && isRealSecret(cfg.apiKey) ? cfg.apiKey : ''
            }));
          store.setAIConfigs([...store.aiConfigs, ...newConfigs]);
        }
        if (selectedTypes.includes('webdavConfigs') && importedData.webdavConfigs) {
          const existingIds = new Set(store.webdavConfigs.map(c => c.id));
          const newConfigs = importedData.webdavConfigs
            .filter(c => !existingIds.has(c.id))
            .filter(cfg => {
              const conflict = findConflictingWebdavProfile(cfg.url, cfg.path);
              if (conflict) {
                skippedWebdavConflicts += 1;
                if (!firstConflictAccount) firstConflictAccount = conflict.login || conflict.id;
                return false;
              }
              return true;
            })
            .map(cfg => ({
              ...cfg,
              password: wasIncluded && isRealSecret(cfg.password) ? cfg.password : ''
            }));
          store.setWebDAVConfigs([...store.webdavConfigs, ...newConfigs]);
        }
        if (selectedTypes.includes('customCategories')) {
          if (importedData.customCategories) {
            const existingIds = new Set(store.customCategories.map(c => c.id));
            const newCategories = importedData.customCategories.filter(c => !existingIds.has(c.id));
            useAppStore.setState({
              customCategories: [...store.customCategories, ...newCategories]
            });
          }
          if (importedData.hiddenDefaultCategoryIds) {
            const current = useAppStore.getState().hiddenDefaultCategoryIds;
            useAppStore.setState({
              hiddenDefaultCategoryIds: Array.from(new Set([...current, ...importedData.hiddenDefaultCategoryIds])),
            });
          }
          if (importedData.defaultCategoryOverrides) {
            useAppStore.setState({
              defaultCategoryOverrides: {
                ...useAppStore.getState().defaultCategoryOverrides,
                ...importedData.defaultCategoryOverrides,
              },
            });
          }
          if (importedData.categoryOrder) {
            const current = useAppStore.getState().categoryOrder;
            useAppStore.setState({
              categoryOrder: Array.from(new Set([...current, ...importedData.categoryOrder])),
            });
          }
        }
        if (selectedTypes.includes('assetFilters') && Array.isArray(importedData.assetFilters)) {
          const existingIds = new Set(store.assetFilters.map(f => f.id));
          const newFilters = normalizeAssetFilters(importedData.assetFilters)
            .filter(f => !existingIds.has(f.id));
          useAppStore.setState({ assetFilters: [...store.assetFilters, ...newFilters] });
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
          if (importedData.releaseSubscriptions) {
            const existingSubs = store.releaseSubscriptions;
            const newSubs = new Set([...Array.from(existingSubs), ...importedData.releaseSubscriptions]);
            useAppStore.setState({ releaseSubscriptions: newSubs });
          }
          if (importedData.releaseSourceSettings) {
            store.setReleaseSourceSettings(mergeReleaseSourceSettings(
              store.releaseSourceSettings,
              normalizeReleaseSourceSettings(importedData.releaseSourceSettings)
            ));
          }
          if (importedData.readReleases) {
            const currentReadReleases = useAppStore.getState().readReleases;
            useAppStore.setState({
              readReleases: new Set([...currentReadReleases, ...importedData.readReleases]),
            });
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
          const importedPresetLight = resolveKnownThemePresetId(importedUiSettings.themePresetLight)
            ?? resolveKnownThemePresetId(importedUiSettings.themePreset);
          const importedPresetDark = resolveKnownThemePresetId(importedUiSettings.themePresetDark)
            ?? resolveKnownThemePresetId(importedUiSettings.themePreset);
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

      if (skippedWebdavConflicts > 0) {
        showError(
          t('dataManagementPanel.webdav-import-conflict-skipped', {
            count: skippedWebdavConflicts,
            account: firstConflictAccount,
          }),
        );
      }

      // 如果导入的数据包含屏蔽的密钥，提示用户
      if (hasMaskedSecrets(importedData)) {
        showSuccess(t('dataManagementPanel.data-imported-successfully-some-secrets-were-mas'));
      } else {
        showSuccess(t('dataManagementPanel.data-imported-successfully'));
      }

      addLog(t('dataManagementPanel.import-data'), true);
      setImportPreview({ data: null, isOpen: false, fileName: '' });
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
    try {
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

      // 存储清除成功后，重置所有状态到初始值
      useAppStore.setState({
        // 用户和认证
        user: null,
        githubToken: null,
        isAuthenticated: false,
        accountWorkspaces: {},
        xTweetAuth: null,
        xTweetAuthRevision: 0,

        // 仓库数据
        repositories: [],
        searchResults: [],
        lastSync: null,

        // Release 数据
        releases: [],
        releaseSubscriptions: new Set<number>(),
        readReleases: new Set<number>(),

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
      const saved = localStorage.getItem(scopedKey('github-stars-search-history'));
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
    <SettingsPageStack>
      {showSuccessMessage && (
        <div className="fixed right-4 top-4 z-dropdown flex items-center gap-2 rounded-lg bg-floating px-3.5 py-2.5 text-label text-foreground shadow-elev-2 animate-in slide-in-from-top-2">
          <CheckCircle className="size-4 text-status-green" />
          <span>{showSuccessMessage}</span>
        </div>
      )}

      {showErrorMessage && (
        <div className="fixed right-4 top-4 z-dropdown flex items-center gap-2 rounded-lg bg-floating px-3.5 py-2.5 text-label text-destructive shadow-elev-2 animate-in slide-in-from-top-2">
          <XCircle className="size-4 text-destructive" />
          <span>{showErrorMessage}</span>
        </div>
      )}

      <SettingsSection title={t('dataManagementPanel.data-overview')}>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {dataStats.map((stat) => (
            <SettingsCard key={stat.key} className="flex items-center gap-3 px-3.5 py-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sunken text-tertiary [&_svg]:size-4">
                {stat.icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-label-sm text-secondary">{stat.label}</p>
                <p className="text-title font-semibold text-foreground tabular-nums">
                  {stat.count}
                </p>
              </div>
            </SettingsCard>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title={t('dataManagementPanel.data-export-import')}>
        <IncludeKeysToggle t={t} />

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <SettingsCard className="flex flex-col p-3.5">
            <div className="mb-3 flex items-center gap-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sunken text-tertiary">
                <Download className="size-4" />
              </span>
              <div className="min-w-0">
                <h4 className="text-label font-medium text-foreground">{t('dataManagementPanel.export-data-2')}</h4>
                <p className="text-label-sm text-secondary">{t('dataManagementPanel.export-data-to-json-file')}</p>
              </div>
            </div>

            <div className="mb-4 flex-1 space-y-1.5">
              {exportItems.map((item) => (
                <div key={item.key} className="flex items-center gap-2 text-label text-foreground">
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
                  <label htmlFor={`export-type-${item.key}`} className="cursor-pointer select-none">
                    {item.label}
                  </label>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={() => {
                if (selectedExportTypes.length === 0) {
                  showError(t('dataManagementPanel.please-select-at-least-one-data-type'));
                  return;
                }
                exportData(selectedExportTypes);
              }}
              disabled={isExporting}
              className="w-full"
            >
              {isExporting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  <span>{t('dataManagementPanel.exporting')}</span>
                </>
              ) : (
                <>
                  <Download className="size-4" />
                  <span>{t('dataManagementPanel.export-selected')}</span>
                </>
              )}
            </Button>
          </SettingsCard>

          <SettingsCard className="flex flex-col p-3.5">
            <div className="mb-3 flex items-center gap-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sunken text-tertiary">
                <Upload className="size-4" />
              </span>
              <div className="min-w-0">
                <h4 className="text-label font-medium text-foreground">{t('dataManagementPanel.import-data-2')}</h4>
                <p className="text-label-sm text-secondary">{t('dataManagementPanel.import-data-from-json-file')}</p>
              </div>
            </div>
            <div className="flex flex-1 flex-col items-center justify-center rounded-md border border-dashed border-default bg-sunken/50 p-6 text-center">
              <Upload className="mx-auto mb-2 size-7 text-tertiary stroke-[1.5]" />
              <p className="mb-3 text-label-sm text-secondary">
                {t('dataManagementPanel.click-to-select-or-drag-file-here')}
              </p>
              <Input type="file" accept=".json" onChange={handleImportFile} className="peer sr-only" id="import-file-input" />
              <label
                htmlFor="import-file-input"
                className="motion-press inline-flex h-control cursor-pointer items-center justify-center rounded-md bg-raised px-3 text-label font-medium text-foreground shadow-elev-1 hover:bg-fill-hover peer-focus-visible:ring-2 peer-focus-visible:ring-ring/50"
              >
                {t('dataManagementPanel.select-file')}
              </label>
            </div>
          </SettingsCard>
        </div>
      </SettingsSection>

      {cleanupSuggestions.length > 0 && (
        <SettingsSection
          title={t('dataManagementPanel.data-cleanup-suggestions')}
          description={t('dataManagementPanel.the-following-data-can-be-safely-cleaned-to-free')}
        >
          <SettingsCard>
            {cleanupSuggestions.map((suggestion, index) => (
              <React.Fragment key={suggestion.key}>
                {index > 0 && <SettingsDivider />}
                <div className="flex min-h-14 items-center justify-between gap-4 px-3.5 py-2.5">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="flex size-4 shrink-0 items-center justify-center text-tertiary [&_svg]:size-4">
                      {suggestion.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-label font-medium text-foreground">
                        {language === 'zh' ? suggestion.label : suggestion.labelEn}
                      </p>
                      <p className="mt-px text-label-sm text-secondary">
                        {language === 'zh' ? suggestion.description : suggestion.descriptionEn}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-label-sm text-tertiary tabular-nums">
                      {suggestion.count} {t('dataManagementPanel.items')}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleCleanup(suggestion.key)}
                    >
                      {t('dataManagementPanel.clean')}
                    </Button>
                  </div>
                </div>
              </React.Fragment>
            ))}
          </SettingsCard>
        </SettingsSection>
      )}

      <SettingsSection title={t('dataManagementPanel.selective-data-deletion')}>
        <SettingsCard>
          {dataStats.map((stat, index) => (
            <React.Fragment key={stat.key}>
              {index > 0 && <SettingsDivider />}
              <div className="flex min-h-14 items-center justify-between gap-4 px-3.5 py-2.5 transition-[background-color] duration-micro ease-out-subtle hover:bg-fill-hover hover:duration-instant">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-tertiary [&_svg]:size-4">
                    {stat.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-label font-medium text-foreground">{stat.label}</p>
                      <span className="text-label-sm text-tertiary tabular-nums">
                        {stat.count} {t('dataManagementPanel.records')}
                      </span>
                    </div>
                    <p className="mt-px text-label-sm leading-[18px] text-secondary">
                      {stat.description}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={() => openConfirmation(stat.key as DeleteOperation)}
                  disabled={stat.key !== 'discoveryData' && stat.count === 0}
                >
                  <Trash2 className="size-3.5" />
                  <span>{t('dataManagementPanel.delete')}</span>
                </Button>
              </div>
            </React.Fragment>
          ))}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title={(
          <span className="inline-flex items-center gap-1.5 text-destructive">
            <AlertTriangle className="size-3.5" />
            <span>{t('dataManagementPanel.danger-zone')}</span>
          </span>
        )}
      >
        <SettingsCard className="ring-1 ring-destructive/25">
          <div className="flex flex-col gap-3 px-3.5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-destructive-tint text-destructive">
                <FileWarning className="size-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h4 className="text-label font-medium text-foreground">
                  {t('dataManagementPanel.delete-all-data-2')}
                </h4>
                <p className="mt-px text-label-sm leading-[18px] text-secondary">
                  {t('dataManagementPanel.this-will-permanently-delete-all-application-dat')}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="danger-solid"
              size="sm"
              onClick={() => openConfirmation('all')}
              className="shrink-0 self-start sm:self-center"
            >
              <Trash2 className="size-3.5" />
              <span>{t('dataManagementPanel.delete-all-data-2')}</span>
            </Button>
          </div>
        </SettingsCard>
      </SettingsSection>

      {operationLogs.length > 0 && (
        <SettingsSection title={t('dataManagementPanel.operation-logs')}>
          <SettingsCard>
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-label-sm">
                <thead className="sticky top-0 border-b border-subtle bg-sunken">
                  <tr>
                    <th className="px-3.5 py-2 text-left font-medium text-tertiary">
                      {t('dataManagementPanel.time')}
                    </th>
                    <th className="px-3.5 py-2 text-left font-medium text-tertiary">
                      {t('dataManagementPanel.operation')}
                    </th>
                    <th className="px-3.5 py-2 text-left font-medium text-tertiary">
                      {t('dataManagementPanel.status')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-subtle">
                  {operationLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-fill-hover">
                      <td className="px-3.5 py-2 text-tertiary tabular-nums">
                        {log.timestamp}
                      </td>
                      <td className="px-3.5 py-2 text-foreground">{log.operation}</td>
                      <td className="px-3.5 py-2">
                        {log.success ? (
                          <Badge variant="success">
                            <CheckCircle className="mr-1 size-3" />
                            {t('dataManagementPanel.success')}
                          </Badge>
                        ) : (
                          <Badge variant="destructive">
                            <XCircle className="mr-1 size-3" />
                            {t('dataManagementPanel.failed')}
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SettingsCard>
        </SettingsSection>
      )}

      <AlertDialog
        open={confirmation.isOpen}
        onOpenChange={(open) => {
          if (!open && !isDeleting) closeConfirmation();
        }}
      >
        {confirmation.type && (
          <AlertDialogContent className="max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="size-4 shrink-0" />
                <span>{getDeleteTitle(confirmation.type)}</span>
              </AlertDialogTitle>
            </AlertDialogHeader>

            <div className="space-y-4">
              <AlertDialogDescription asChild>
                <div>
                  <SettingsNotice tone="destructive" icon={<AlertTriangle />}>
                    {getDeleteDescription(confirmation.type)}
                  </SettingsNotice>
                </div>
              </AlertDialogDescription>

              {confirmation.type === 'all' && user && (
                <div className="space-y-1.5">
                  <label htmlFor="delete-all-github-username" className="block text-label font-medium text-foreground">
                    {t('dataManagementPanel.please-enter-your-github-username-to-confirm-thi')}
                    <span className="ml-2 font-mono text-secondary">
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
                  />
                </div>
              )}

              <AlertDialogFooter className="pt-2">
                <AlertDialogCancel
                  onClick={closeConfirmation}
                  disabled={isDeleting}
                  className="flex-1"
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
                  className="flex-1 bg-destructive-solid text-on-destructive hover:opacity-95"
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      <span>{t('dataManagementPanel.deleting')}</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="size-4" />
                      <span>{t('dataManagementPanel.confirm-delete')}</span>
                    </>
                  )}
                </AlertDialogAction>
              </AlertDialogFooter>
            </div>
          </AlertDialogContent>
        )}
      </AlertDialog>

      {importPreview.isOpen && importPreview.data && (
        <Dialog
          open={importPreview.isOpen}
          onOpenChange={(open) => {
            if (!open && !isImporting) {
              setImportPreview({ data: null, isOpen: false, fileName: '' });
            }
          }}
        >
          <DialogContent className="max-w-lg" closeLabel={t('dataManagementPanel.close')}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Upload className="size-4 text-tertiary" />
                <span>{t('dataManagementPanel.import-data-preview')}</span>
              </DialogTitle>
              <DialogDescription>
                {t('dataManagementPanel.review-the-backup-contents-before-choosing-an-im')}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-1 rounded-md bg-sunken px-3 py-2.5 text-label-sm text-secondary shadow-elev-0">
                <p><strong className="font-medium text-foreground">{t('dataManagementPanel.file')}</strong> {importPreview.fileName}</p>
                <p><strong className="font-medium text-foreground">{t('dataManagementPanel.export-date')}</strong> {new Date(importPreview.data.exportDate).toLocaleString()}</p>
                <p><strong className="font-medium text-foreground">{t('dataManagementPanel.version')}</strong> {importPreview.data.appVersion}</p>
              </div>

              <div className="border-t border-subtle pt-3">
                <p className="mb-1.5 text-label font-medium text-foreground">{t('dataManagementPanel.included-data')}</p>
                <div className="space-y-1 text-label-sm text-secondary tabular-nums">
                  {importPreview.data.data.repositories && (
                    <p>• {t('dataManagementPanel.repositories')}: {importPreview.data.data.repositories.length} {t('dataManagementPanel.items')}</p>
                  )}
                  {importPreview.data.data.releases && (
                    <p>• {t('dataManagementPanel.releases')}: {importPreview.data.data.releases.length} {t('dataManagementPanel.items')}</p>
                  )}
                  {importPreview.data.data.aiConfigs && (
                    <p>• {t('dataManagementPanel.ai-configs')}: {importPreview.data.data.aiConfigs.length} {t('dataManagementPanel.items')}</p>
                  )}
                  {importPreview.data.data.webdavConfigs && (
                    <p>• {t('dataManagementPanel.webdav-configs')}: {importPreview.data.data.webdavConfigs.length} {t('dataManagementPanel.items')}</p>
                  )}
                  {importPreview.data.data.customCategories && (
                    <p>• {t('dataManagementPanel.categories')}: {importPreview.data.data.customCategories.length} {t('dataManagementPanel.items')}</p>
                  )}
                  {importPreview.data.data.assetFilters && (
                    <p>• {t('dataManagementPanel.asset-filters')}: {importPreview.data.data.assetFilters.length} {t('dataManagementPanel.items')}</p>
                  )}
                </div>
              </div>

              {hasMaskedSecrets(importPreview.data.data) && (
                <SettingsNotice tone="warning" icon={<AlertTriangle />}>
                  {t('dataManagementPanel.warning-some-secrets-in-this-backup-are-masked-p')}
                </SettingsNotice>
              )}

              <DialogFooter className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setImportPreview({ data: null, isOpen: false, fileName: '' })}
                  disabled={isImporting}
                  className="flex-1"
                >
                  {t('dataManagementPanel.cancel')}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => {
                    importData(resolveImportTypes(importPreview.data!.data), 'merge');
                  }}
                  disabled={isImporting}
                  className="flex-1"
                >
                  {isImporting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      <span>{t('dataManagementPanel.importing')}</span>
                    </>
                  ) : (
                    <span>{t('dataManagementPanel.merge-import')}</span>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="danger-solid"
                  onClick={() => {
                    importData(resolveImportTypes(importPreview.data!.data), 'replace');
                  }}
                  disabled={isImporting}
                  className="flex-1"
                >
                  {isImporting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
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
    </SettingsPageStack>
  );
};
