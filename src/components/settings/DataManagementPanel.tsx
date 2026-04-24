import React, { useState, useCallback, useMemo } from 'react';
import {
  Trash2,
  AlertTriangle,
  Database,
  Github,
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
import { useAppStore } from '../../store/useAppStore';
import { indexedDBStorage } from '../../services/indexedDbStorage';
import type { 
  Repository, 
  Release, 
  AIConfig, 
  WebDAVConfig, 
  Category, 
  AssetFilter,
  DiscoveryRepo,
  SearchFilters 
} from '../../types';

interface DataManagementPanelProps {
  t: (zh: string, en: string) => string;
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
    subscriptionRepos?: Record<string, DiscoveryRepo[]>;
    subscriptionLastRefresh?: Record<string, string | null>;
    subscriptionChannels?: Array<{ id: string; name: string; nameEn: string }>;
    releaseSubscriptions?: number[];
    readReleases?: number[];
    searchFilters?: SearchFilters;
    hiddenDefaultCategoryIds?: string[];
    defaultCategoryOverrides?: Record<string, Partial<Category>>;
    categoryOrder?: string[];
    theme?: 'light' | 'dark';
    language?: 'zh' | 'en';
    isSidebarCollapsed?: boolean;
    releaseViewMode?: 'timeline' | 'repository';
    releaseSelectedFilters?: string[];
    releaseSearchQuery?: string;
    releaseExpandedRepositories?: number[];
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
    readReleases,
    searchFilters,
    language,
    setRepositories,
    setReleases,
    deleteCustomCategory,
    setAssetFilters,
  } = useAppStore();

  const [confirmation, setConfirmation] = useState<DeleteConfirmation>({
    type: null,
    isOpen: false,
    githubUsernameInput: '',
  });
  const [isDeleting, setIsDeleting] = useState(false);
  const [operationLogs, setOperationLogs] = useState<OperationLog[]>([]);
  const [showSuccessMessage, setShowSuccessMessage] = useState<string | null>(null);
  const [showErrorMessage, setShowErrorMessage] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<{
    data: ExportData | null;
    isOpen: boolean;
    fileName: string;
  }>({ data: null, isOpen: false, fileName: '' });

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

    // Clear IndexedDB - only remove the specific database used by this app
    try {
      await indexedDBStorage.removeItem('github-stars-manager');
    } catch (error) {
      console.error('Failed to clear IndexedDB', error);
      throw new Error('IndexedDB clear failed');
    }
  };

  const deleteRepositories = async () => {
    try {
      setRepositories([]);
      addLog(t('删除GitHub Stars仓库数据', 'Delete GitHub Stars repositories'), true);
      showSuccess(t('GitHub Stars仓库数据已删除', 'GitHub Stars repositories deleted'));
    } catch (error) {
      addLog(
        t('删除GitHub Stars仓库数据', 'Delete GitHub Stars repositories'),
        false,
        String(error)
      );
      showError(t('删除失败，请重试', 'Delete failed, please try again'));
      throw error;
    }
  };

  const deleteReleases = async () => {
    try {
      setReleases([]);
      addLog(t('删除Release发布信息数据', 'Delete Release information'), true);
      showSuccess(t('Release发布信息数据已删除', 'Release information deleted'));
    } catch (error) {
      addLog(
        t('删除Release发布信息数据', 'Delete Release information'),
        false,
        String(error)
      );
      showError(t('删除失败，请重试', 'Delete failed, please try again'));
      throw error;
    }
  };

  const deleteAIConfigs = async () => {
    try {
      const store = useAppStore.getState();
      store.setAIConfigs([]);
      store.setActiveAIConfig(null);
      addLog(t('删除AI服务配置数据', 'Delete AI service configurations'), true);
      showSuccess(t('AI服务配置数据已删除', 'AI service configurations deleted'));
    } catch (error) {
      addLog(
        t('删除AI服务配置数据', 'Delete AI service configurations'),
        false,
        String(error)
      );
      showError(t('删除失败，请重试', 'Delete failed, please try again'));
      throw error;
    }
  };

  const deleteWebDAVConfigs = async () => {
    try {
      const store = useAppStore.getState();
      store.setWebDAVConfigs([]);
      store.setActiveWebDAVConfig(null);
      addLog(t('删除WebDAV配置数据', 'Delete WebDAV configurations'), true);
      showSuccess(t('WebDAV配置数据已删除', 'WebDAV configurations deleted'));
    } catch (error) {
      addLog(
        t('删除WebDAV配置数据', 'Delete WebDAV configurations'),
        false,
        String(error)
      );
      showError(t('删除失败，请重试', 'Delete failed, please try again'));
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
      addLog(t('删除分类显示设置数据', 'Delete category display settings'), true);
      showSuccess(t('分类显示设置数据已删除', 'Category display settings deleted'));
    } catch (error) {
      addLog(
        t('删除分类显示设置数据', 'Delete category display settings'),
        false,
        String(error)
      );
      showError(t('删除失败，请重试', 'Delete failed, please try again'));
      throw error;
    }
  };

  const deleteAssetFilters = async () => {
    try {
      setAssetFilters([]);
      addLog(t('删除资源过滤器数据', 'Delete asset filters'), true);
      showSuccess(t('资源过滤器数据已删除', 'Asset filters deleted'));
    } catch (error) {
      addLog(
        t('删除资源过滤器数据', 'Delete asset filters'),
        false,
        String(error)
      );
      showError(t('删除失败，请重试', 'Delete failed, please try again'));
      throw error;
    }
  };

  const deleteDiscoveryData = async () => {
    try {
      const emptyDiscoveryRepos = {
        'trending': [],
        'hot-release': [],
        'most-popular': [],
        'topic': [],
        'search': []
      } as Record<string, DiscoveryRepo[]>;
      useAppStore.setState({ 
        discoveryRepos: emptyDiscoveryRepos,
        discoveryLastRefresh: {
          'trending': null,
          'hot-release': null,
          'most-popular': null,
          'topic': null,
          'search': null
        }
      });
      addLog(t('删除发现页缓存数据', 'Delete discovery cache data'), true);
      showSuccess(t('发现页缓存数据已删除', 'Discovery cache data deleted'));
    } catch (error) {
      addLog(
        t('删除发现页缓存数据', 'Delete discovery cache data'),
        false,
        String(error)
      );
      showError(t('删除失败，请重试', 'Delete failed, please try again'));
      throw error;
    }
  };

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
      addLog(t('删除订阅页数据', 'Delete subscription data'), true);
      showSuccess(t('订阅页数据已删除', 'Subscription data deleted'));
    } catch (error) {
      addLog(
        t('删除订阅页数据', 'Delete subscription data'),
        false,
        String(error)
      );
      showError(t('删除失败，请重试', 'Delete failed, please try again'));
      throw error;
    }
  };

  const deleteReleaseSubscriptions = async () => {
    try {
      useAppStore.setState({ 
        releaseSubscriptions: new Set<number>(),
        readReleases: new Set<number>()
      });
      addLog(t('删除Release订阅数据', 'Delete release subscriptions'), true);
      showSuccess(t('Release订阅数据已删除', 'Release subscriptions deleted'));
    } catch (error) {
      addLog(
        t('删除Release订阅数据', 'Delete release subscriptions'),
        false,
        String(error)
      );
      showError(t('删除失败，请重试', 'Delete failed, please try again'));
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
          sortBy: 'stars',
          sortOrder: 'desc',
          isAnalyzed: undefined,
          isSubscribed: undefined,
        }
      });
      localStorage.removeItem('github-stars-search-history');
      localStorage.removeItem('lastSearchTime');
      addLog(t('删除搜索历史数据', 'Delete search history'), true);
      showSuccess(t('搜索历史数据已删除', 'Search history deleted'));
    } catch (error) {
      addLog(
        t('删除搜索历史数据', 'Delete search history'),
        false,
        String(error)
      );
      showError(t('删除失败，请重试', 'Delete failed, please try again'));
      throw error;
    }
  };

  const exportData = useCallback(async (selectedTypes: string[]) => {
    setIsExporting(true);
    try {
      const store = useAppStore.getState();
      const exportDataObj: ExportData = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        appVersion: '0.4.0',
        data: {}
      };

      if (selectedTypes.includes('repositories')) {
        exportDataObj.data.repositories = store.repositories;
      }
      if (selectedTypes.includes('releases')) {
        exportDataObj.data.releases = store.releases;
      }
      if (selectedTypes.includes('aiConfigs')) {
        exportDataObj.data.aiConfigs = store.aiConfigs;
      }
      if (selectedTypes.includes('webdavConfigs')) {
        exportDataObj.data.webdavConfigs = store.webdavConfigs;
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
        exportDataObj.data.readReleases = Array.from(store.readReleases);
      }
      if (selectedTypes.includes('searchFilters')) {
        exportDataObj.data.searchFilters = store.searchFilters;
      }
      if (selectedTypes.includes('uiSettings')) {
        exportDataObj.data.theme = store.theme;
        exportDataObj.data.language = store.language;
        exportDataObj.data.isSidebarCollapsed = store.isSidebarCollapsed;
        exportDataObj.data.releaseViewMode = store.releaseViewMode;
        exportDataObj.data.releaseSelectedFilters = store.releaseSelectedFilters;
        exportDataObj.data.releaseSearchQuery = store.releaseSearchQuery;
        exportDataObj.data.releaseExpandedRepositories = Array.from(store.releaseExpandedRepositories);
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

      addLog(t('导出数据', 'Export data'), true);
      showSuccess(t('数据导出成功', 'Data exported successfully'));
    } catch (error) {
      addLog(t('导出数据', 'Export data'), false, String(error));
      showError(t('导出失败，请重试', 'Export failed, please try again'));
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
          showError(t('无效的备份文件格式', 'Invalid backup file format'));
          return;
        }

        setImportPreview({ data, isOpen: true, fileName: file.name });
      } catch {
        showError(t('解析文件失败，请确保是有效的JSON文件', 'Failed to parse file, ensure it is a valid JSON file'));
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

      if (mode === 'replace') {
        if (selectedTypes.includes('repositories') && importedData.repositories) {
          store.setRepositories(importedData.repositories);
        }
        if (selectedTypes.includes('releases') && importedData.releases) {
          store.setReleases(importedData.releases);
        }
        if (selectedTypes.includes('aiConfigs') && importedData.aiConfigs) {
          store.setAIConfigs(importedData.aiConfigs);
        }
        if (selectedTypes.includes('webdavConfigs') && importedData.webdavConfigs) {
          store.setWebDAVConfigs(importedData.webdavConfigs);
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
        if (selectedTypes.includes('assetFilters') && importedData.assetFilters) {
          store.setAssetFilters(importedData.assetFilters);
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
          if (importedData.releaseSubscriptions) {
            useAppStore.setState({ releaseSubscriptions: new Set(importedData.releaseSubscriptions) });
          }
          if (importedData.readReleases) {
            useAppStore.setState({ readReleases: new Set(importedData.readReleases) });
          }
        }
        if (selectedTypes.includes('searchFilters') && importedData.searchFilters) {
          useAppStore.setState({ searchFilters: importedData.searchFilters });
        }
        if (selectedTypes.includes('uiSettings')) {
          if (importedData.theme === 'light' || importedData.theme === 'dark') {
            useAppStore.setState({ theme: importedData.theme });
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
          const newConfigs = importedData.aiConfigs.filter(c => !existingIds.has(c.id));
          store.setAIConfigs([...store.aiConfigs, ...newConfigs]);
        }
        if (selectedTypes.includes('webdavConfigs') && importedData.webdavConfigs) {
          const existingIds = new Set(store.webdavConfigs.map(c => c.id));
          const newConfigs = importedData.webdavConfigs.filter(c => !existingIds.has(c.id));
          store.setWebDAVConfigs([...store.webdavConfigs, ...newConfigs]);
        }
        if (selectedTypes.includes('customCategories') && importedData.customCategories) {
          const existingIds = new Set(store.customCategories.map(c => c.id));
          const newCategories = importedData.customCategories.filter(c => !existingIds.has(c.id));
          useAppStore.setState({ 
            customCategories: [...store.customCategories, ...newCategories] 
          });
        }
        if (selectedTypes.includes('assetFilters') && importedData.assetFilters) {
          const existingIds = new Set(store.assetFilters.map(f => f.id));
          const newFilters = importedData.assetFilters.filter(f => !existingIds.has(f.id));
          store.setAssetFilters([...store.assetFilters, ...newFilters]);
        }
        if (selectedTypes.includes('releaseSubscriptions') && importedData.releaseSubscriptions) {
          const existingSubs = store.releaseSubscriptions;
          const newSubs = new Set([...Array.from(existingSubs), ...importedData.releaseSubscriptions]);
          useAppStore.setState({ releaseSubscriptions: newSubs });
        }
      }

      addLog(t('导入数据', 'Import data'), true);
      showSuccess(t('数据导入成功', 'Data imported successfully'));
      setImportPreview({ data: null, isOpen: false, fileName: '' });
    } catch (error) {
      addLog(t('导入数据', 'Import data'), false, String(error));
      showError(t('导入失败，请重试', 'Import failed, please try again'));
    } finally {
      setIsImporting(false);
    }
  }, [importPreview, addLog, showSuccess, showError, t]);

  const cleanupSuggestions = useMemo<DataCleanupSuggestion[]>(() => {
    const suggestions: DataCleanupSuggestion[] = [];
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
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
        color: 'text-gray-700 dark:text-text-secondary',
        bgColor: 'bg-light-surface dark:bg-white/[0.04]'
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
        color: 'text-gray-700 dark:text-text-secondary',
        bgColor: 'bg-light-surface dark:bg-white/[0.04]'
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
        color: 'text-gray-700 dark:text-text-secondary',
        bgColor: 'bg-light-surface dark:bg-white/[0.04]'
      });
    }

    const oldReadReleases = readReleases.size;
    if (oldReadReleases > 50) {
      suggestions.push({
        key: 'readReleases',
        label: '已读Release标记',
        labelEn: 'Read Release Marks',
        description: '已读Release的标记记录',
        descriptionEn: 'Records of read releases',
        count: oldReadReleases,
        icon: <Eye className="w-4 h-4" />,
        color: 'text-gray-700 dark:text-text-secondary',
        bgColor: 'bg-status-emerald '
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
          setReleases(filteredReleases);
          break;
        }
        case 'discoveryCache':
          await deleteDiscoveryData();
          return;
        case 'readReleases':
          useAppStore.setState({ readReleases: new Set<number>() });
          break;
      }
      addLog(t('清理数据', 'Cleanup data'), true);
      showSuccess(t('数据清理成功', 'Data cleanup successful'));
    } catch (error) {
      addLog(t('清理数据', 'Cleanup data'), false, String(error));
      showError(t('清理失败，请重试', 'Cleanup failed, please try again'));
    }
  }, [releases, setReleases, deleteDiscoveryData, addLog, showSuccess, showError, t]);

  const deleteAllData = async () => {
    try {
      // 先清除存储，确保存储清除成功后再重置状态
      // 这样可以避免状态已重置但存储清除失败导致的数据不一致
      await clearAllStorage();

      // 存储清除成功后，重置所有状态到初始值
      useAppStore.setState({
        // 用户和认证
        user: null,
        githubToken: null,
        isAuthenticated: false,

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
          sortBy: 'stars',
          sortOrder: 'desc',
          isAnalyzed: undefined,
          isSubscribed: undefined,
        },
      });

      addLog(t('删除所有数据', 'Delete all data'), true);
      showSuccess(t('所有数据已删除，应用将重新加载', 'All data deleted, app will reload'));

      // Reload page after a short delay
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (error) {
      addLog(t('删除所有数据', 'Delete all data'), false, String(error));
      showError(t('删除失败，请重试', 'Delete failed, please try again'));
      throw error;
    }
  };

  const handleDelete = async () => {
    if (!confirmation.type) return;

    // Verify GitHub username for "delete all" operation
    if (confirmation.type === 'all') {
      if (!user || confirmation.githubUsernameInput !== user.login) {
        showError(t('GitHub用户名验证失败', 'GitHub username verification failed'));
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
        return t(
          '这将删除所有GitHub Stars仓库列表数据，包括仓库信息、AI分析结果和自定义标签。此操作不可恢复。',
          'This will delete all GitHub Stars repository data, including repository info, AI analysis results, and custom tags. This action cannot be undone.'
        );
      case 'releases':
        return t(
          '这将删除所有Release发布信息数据，包括发布说明和资源文件信息。此操作不可恢复。',
          'This will delete all Release information data, including release notes and asset information. This action cannot be undone.'
        );
      case 'aiConfigs':
        return t(
          '这将删除所有AI服务配置数据，包括API密钥和模型设置。此操作不可恢复。',
          'This will delete all AI service configuration data, including API keys and model settings. This action cannot be undone.'
        );
      case 'webdavConfigs':
        return t(
          '这将删除所有WebDAV配置数据，包括服务器地址和认证信息。此操作不可恢复。',
          'This will delete all WebDAV configuration data, including server addresses and authentication info. This action cannot be undone.'
        );
      case 'categorySettings':
        return t(
          '这将删除所有自定义分类和分类显示设置。此操作不可恢复。',
          'This will delete all custom categories and category display settings. This action cannot be undone.'
        );
      case 'assetFilters':
        return t(
          '这将删除所有资源过滤器预设数据。此操作不可恢复。',
          'This will delete all asset filter presets. This action cannot be undone.'
        );
      case 'discoveryData':
        return t(
          '这将删除发现页缓存的仓库数据。此操作不可恢复。',
          'This will delete cached repository data from discovery page. This action cannot be undone.'
        );
      case 'subscriptionData':
        return t(
          '这将删除订阅页的所有仓库数据。此操作不可恢复。',
          'This will delete all repository data from subscription page. This action cannot be undone.'
        );
      case 'releaseSubscriptions':
        return t(
          '这将删除所有Release订阅和已读标记数据。此操作不可恢复。',
          'This will delete all release subscriptions and read marks. This action cannot be undone.'
        );
      case 'searchHistory':
        return t(
          '这将删除搜索历史和搜索过滤器设置。此操作不可恢复。',
          'This will delete search history and filter settings. This action cannot be undone.'
        );
      case 'all':
        return t(
          '这将删除所有应用程序数据，包括所有用户数据、GitHub令牌、配置文件等。此操作将重置应用程序到初始状态，不可恢复！',
          'This will delete ALL application data, including all user data, GitHub tokens, configuration files, etc. This will reset the application to its initial state and cannot be undone!'
        );
      default:
        return '';
    }
  };

  const getDeleteTitle = (type: DeleteOperation): string => {
    switch (type) {
      case 'repositories':
        return t('删除GitHub Stars仓库数据', 'Delete GitHub Stars Repositories');
      case 'releases':
        return t('删除Release发布信息数据', 'Delete Release Information');
      case 'aiConfigs':
        return t('删除AI服务配置数据', 'Delete AI Service Configurations');
      case 'webdavConfigs':
        return t('删除WebDAV配置数据', 'Delete WebDAV Configurations');
      case 'categorySettings':
        return t('删除分类显示设置数据', 'Delete Category Display Settings');
      case 'assetFilters':
        return t('删除资源过滤器数据', 'Delete Asset Filters');
      case 'discoveryData':
        return t('删除发现页缓存数据', 'Delete Discovery Cache');
      case 'subscriptionData':
        return t('删除订阅页数据', 'Delete Subscription Data');
      case 'releaseSubscriptions':
        return t('删除Release订阅数据', 'Delete Release Subscriptions');
      case 'searchHistory':
        return t('删除搜索历史数据', 'Delete Search History');
      case 'all':
        return t('删除所有数据', 'Delete All Data');
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

  const dataStats = [
    {
      key: 'repositories',
      label: t('GitHub Stars仓库', 'GitHub Stars Repositories'),
      count: repositories.length,
      icon: <Github className="w-5 h-5" />,
      color: 'text-gray-700 dark:text-text-secondary',
      bgColor: 'bg-gray-100 dark:bg-white/[0.04]',
    },
    {
      key: 'releases',
      label: t('Release发布信息', 'Release Information'),
      count: releases.length,
      icon: <Tag className="w-5 h-5" />,
      color: 'text-gray-700 dark:text-text-secondary',
      bgColor: 'bg-gray-100 dark:bg-white/[0.04]',
    },
    {
      key: 'aiConfigs',
      label: t('AI服务配置', 'AI Service Configurations'),
      count: aiConfigs.length,
      icon: <Bot className="w-5 h-5" />,
      color: 'text-gray-700 dark:text-text-secondary',
      bgColor: 'bg-gray-100 dark:bg-white/[0.04]',
    },
    {
      key: 'webdavConfigs',
      label: t('WebDAV配置', 'WebDAV Configurations'),
      count: webdavConfigs.length,
      icon: <Cloud className="w-5 h-5" />,
      color: 'text-gray-700 dark:text-text-secondary',
      bgColor: 'bg-gray-100 dark:bg-white/[0.04]',
    },
    {
      key: 'categorySettings',
      label: t('自定义分类', 'Custom Categories'),
      count: customCategories.length + Object.keys(defaultCategoryOverrides).length + hiddenDefaultCategoryIds.length,
      icon: <FolderTree className="w-5 h-5" />,
      color: 'text-gray-700 dark:text-text-secondary',
      bgColor: 'bg-gray-100 dark:bg-white/[0.04]',
    },
    {
      key: 'assetFilters',
      label: t('资源过滤器', 'Asset Filters'),
      count: assetFilters.length,
      icon: <Filter className="w-5 h-5" />,
      color: 'text-gray-700 dark:text-text-secondary',
      bgColor: 'bg-gray-100 dark:bg-white/[0.04]',
    },
    {
      key: 'discoveryData',
      label: t('发现页缓存', 'Discovery Cache'),
      count: totalDiscoveryReposCount,
      icon: <Sparkles className="w-5 h-5" />,
      color: 'text-gray-700 dark:text-text-secondary',
      bgColor: 'bg-gray-100 dark:bg-white/[0.04]',
    },
    {
      key: 'subscriptionData',
      label: t('订阅页数据', 'Subscription Data'),
      count: totalSubscriptionReposCount,
      icon: <Rss className="w-5 h-5" />,
      color: 'text-gray-700 dark:text-text-secondary',
      bgColor: 'bg-gray-100 dark:bg-white/[0.04]',
    },
    {
      key: 'releaseSubscriptions',
      label: t('Release订阅', 'Release Subscriptions'),
      count: releaseSubscriptions.size,
      icon: <Eye className="w-5 h-5" />,
      color: 'text-gray-700 dark:text-text-secondary',
      bgColor: 'bg-gray-100 dark:bg-white/[0.04]',
    },
    {
      key: 'searchHistory',
      label: t('搜索历史', 'Search History'),
      count: searchFilters.query ? 1 : 0,
      icon: <Search className="w-5 h-5" />,
      color: 'text-gray-700 dark:text-text-secondary',
      bgColor: 'bg-gray-100 dark:bg-white/[0.04]',
    },
  ];

  return (
    <div className="space-y-8">
      {/* Success Message */}
      {showSuccessMessage && (
        <div className="fixed top-4 right-4 z-50 flex items-center space-x-2 px-4 py-3 bg-status-emerald text-status-emerald rounded-lg shadow-lg animate-in slide-in-from-top-2">
          <CheckCircle className="w-5 h-5" />
          <span>{showSuccessMessage}</span>
        </div>
      )}

      {/* Error Message */}
      {showErrorMessage && (
        <div className="fixed top-4 right-4 z-50 flex items-center space-x-2 px-4 py-3 bg-status-red/10 dark:bg-status-red/20 text-status-red dark:text-status-red rounded-lg shadow-lg animate-in slide-in-from-top-2">
          <XCircle className="w-5 h-5" />
          <span>{showErrorMessage}</span>
        </div>
      )}

      {/* Data Statistics */}
      <section>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-text-primary mb-4 flex items-center">
          <Database className="w-5 h-5 mr-2 text-brand-violet dark:text-brand-violet" />
          {t('数据概览', 'Data Overview')}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {dataStats.map((stat) => (
            <div
              key={stat.key}
              className="bg-white dark:bg-panel-dark rounded-lg border border-black/[0.06] dark:border-white/[0.04] p-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className={`p-2 rounded-lg ${stat.bgColor} ${stat.color}`}>
                    {stat.icon}
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 dark:text-text-tertiary">{stat.label}</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-text-primary">
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
        <h3 className="text-lg font-semibold text-gray-900 dark:text-text-primary mb-4 flex items-center">
          <HardDrive className="w-5 h-5 mr-2 text-status-emerald " />
          {t('数据导出与导入', 'Data Export & Import')}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Export */}
          <div className="bg-white dark:bg-panel-dark rounded-lg border border-black/[0.06] dark:border-white/[0.04] p-4">
            <div className="flex items-center space-x-3 mb-4">
              <div className="p-2 rounded-lg bg-light-surface dark:bg-white/[0.04] text-brand-violet dark:text-brand-violet">
                <Download className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-medium text-gray-900 dark:text-text-primary">{t('导出数据', 'Export Data')}</h4>
                <p className="text-sm text-gray-500 dark:text-text-tertiary">{t('将数据导出为JSON文件', 'Export data to JSON file')}</p>
              </div>
            </div>
            <div className="space-y-2 mb-4">
              {[
                { key: 'repositories', label: t('仓库数据', 'Repositories') },
                { key: 'releases', label: t('Release数据', 'Releases') },
                { key: 'aiConfigs', label: t('AI配置', 'AI Configs') },
                { key: 'webdavConfigs', label: t('WebDAV配置', 'WebDAV Configs') },
                { key: 'customCategories', label: t('分类设置', 'Categories') },
                { key: 'assetFilters', label: t('资源过滤器', 'Asset Filters') },
                { key: 'discoveryRepos', label: t('发现页数据', 'Discovery Data') },
                { key: 'subscriptionRepos', label: t('订阅页数据', 'Subscription Data') },
                { key: 'releaseSubscriptions', label: t('Release订阅', 'Release Subscriptions') },
                { key: 'searchFilters', label: t('搜索过滤器', 'Search Filters') },
                { key: 'uiSettings', label: t('UI设置', 'UI Settings') },
              ].map((item) => (
                <label key={item.key} className="flex items-center space-x-2 text-sm text-gray-900 dark:text-text-secondary">
                  <input
                    type="checkbox"
                    defaultChecked
                    className="export-checkbox rounded border-black/[0.06] dark:border-white/[0.04] text-brand-violet focus:ring-brand-violet"
                    data-type={item.key}
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>
            <button
              onClick={() => {
                const checkboxes = document.querySelectorAll('.export-checkbox:checked');
                const selectedTypes = Array.from(checkboxes).map((cb) => (cb as HTMLInputElement).dataset.type as string);
                if (selectedTypes.length === 0) {
                  showError(t('请至少选择一项数据类型', 'Please select at least one data type'));
                  return;
                }
                exportData(selectedTypes);
              }}
              disabled={isExporting}
              className="w-full px-4 py-2 bg-brand-indigo hover:bg-brand-hover text-white font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center space-x-2"
            >
              {isExporting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{t('导出中...', 'Exporting...')}</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>{t('导出选中数据', 'Export Selected')}</span>
                </>
              )}
            </button>
          </div>

          {/* Import */}
          <div className="bg-white dark:bg-panel-dark rounded-lg border border-black/[0.06] dark:border-white/[0.04] p-4">
            <div className="flex items-center space-x-3 mb-4">
              <div className="p-2 rounded-lg bg-status-emerald text-status-emerald ">
                <Upload className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-medium text-gray-900 dark:text-text-primary">{t('导入数据', 'Import Data')}</h4>
                <p className="text-sm text-gray-500 dark:text-text-tertiary">{t('从JSON文件导入数据', 'Import data from JSON file')}</p>
              </div>
            </div>
            <div className="border-2 border-dashed border-black/[0.06] dark:border-white/[0.04] rounded-lg p-6 text-center">
              <Upload className="w-8 h-8 text-gray-400 dark:text-text-quaternary mx-auto mb-2" />
              <p className="text-sm text-gray-500 dark:text-text-tertiary mb-2">
                {t('点击选择文件或拖拽文件到此处', 'Click to select or drag file here')}
              </p>
              <input
                type="file"
                accept=".json"
                onChange={handleImportFile}
                className="hidden"
                id="import-file-input"
              />
              <label
                htmlFor="import-file-input"
                className="cursor-pointer px-4 py-2 bg-light-surface dark:bg-white/[0.04] hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-900 dark:text-text-secondary rounded-lg transition-colors inline-block"
              >
                {t('选择文件', 'Select File')}
              </label>
            </div>
          </div>
        </div>
      </section>

      {/* Data Cleanup Suggestions */}
      {cleanupSuggestions.length > 0 && (
        <section>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-text-primary mb-4 flex items-center">
            <RefreshCw className="w-5 h-5 mr-2 text-gray-700 dark:text-text-secondary " />
            {t('数据清理建议', 'Data Cleanup Suggestions')}
          </h3>
          <div className="bg-light-surface dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.04] rounded-lg p-4 mb-4">
            <p className="text-sm text-gray-700 dark:text-text-secondary ">
              {t('以下数据可以安全清理以释放存储空间，不会影响核心功能。', 'The following data can be safely cleaned to free up storage without affecting core functionality.')}
            </p>
          </div>
          <div className="space-y-3">
            {cleanupSuggestions.map((suggestion) => (
              <div
                key={suggestion.key}
                className="bg-white dark:bg-panel-dark rounded-lg border border-black/[0.06] dark:border-white/[0.04] p-4 flex items-center justify-between"
              >
                <div className="flex items-center space-x-3">
                  <div className={`p-2 rounded-lg ${suggestion.bgColor} ${suggestion.color}`}>
                    {suggestion.icon}
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-text-primary">
                      {language === 'zh' ? suggestion.label : suggestion.labelEn}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-text-tertiary">
                      {language === 'zh' ? suggestion.description : suggestion.descriptionEn}
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  <span className="text-sm font-medium text-gray-700 dark:text-text-tertiary">
                    {suggestion.count} {t('条', 'items')}
                  </span>
                  <button
                    onClick={() => handleCleanup(suggestion.key)}
                    className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-text-secondary bg-gray-100 dark:bg-white/[0.04] hover:bg-gray-100 dark:bg-white/[0.04] dark:hover:bg-gray-100 dark:bg-white/[0.04] rounded-lg transition-colors"
                  >
                    {t('清理', 'Clean')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Selective Data Deletion */}
      <section>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-text-primary mb-4 flex items-center">
          <Trash2 className="w-5 h-5 mr-2 text-gray-700 dark:text-text-secondary " />
          {t('选择性删除数据', 'Selective Data Deletion')}
        </h3>
        <div className="bg-white dark:bg-panel-dark rounded-lg border border-black/[0.06] dark:border-white/[0.04] overflow-hidden">
          <div className="divide-y divide-black/[0.06] dark:divide-gray-700">
            {dataStats.map((stat) => (
              <div
                key={stat.key}
                className="flex items-center justify-between px-4 py-4 hover:bg-light-bg dark:hover:bg-white/10/50 transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <div className={`p-2 rounded-lg ${stat.bgColor} ${stat.color}`}>
                    {stat.icon}
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-text-primary">{stat.label}</p>
                    <p className="text-sm text-gray-500 dark:text-text-tertiary">
                      {stat.count} {t('条记录', 'records')}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => openConfirmation(stat.key as DeleteOperation)}
                  disabled={stat.count === 0}
                  className="flex items-center space-x-2 px-4 py-2 text-sm font-medium text-gray-700 dark:text-text-secondary hover:text-gray-700 dark:text-text-secondary dark:hover:text-gray-700 dark:text-text-secondary hover:bg-gray-100 dark:bg-white/[0.04] dark:hover:bg-gray-100 dark:bg-white/[0.04] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>{t('删除', 'Delete')}</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Delete All Data */}
      <section>
        <h3 className="text-lg font-semibold text-gray-700 dark:text-text-secondary mb-4 flex items-center">
          <AlertTriangle className="w-5 h-5 mr-2" />
          {t('危险区域', 'Danger Zone')}
        </h3>
        <div className="bg-light-surface dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.04] rounded-lg p-6">
          <div className="flex items-start space-x-4">
            <div className="p-3 bg-status-red/10 dark:bg-status-red/20 rounded-lg">
              <FileWarning className="w-6 h-6 text-gray-700 dark:text-text-secondary " />
            </div>
            <div className="flex-1">
              <h4 className="text-lg font-semibold text-gray-700 dark:text-text-secondary ">
                {t('删除所有数据', 'Delete All Data')}
              </h4>
              <p className="mt-2 text-gray-700 dark:text-text-secondary ">
                {t(
                  '此操作将永久删除所有应用程序数据，包括所有用户数据、GitHub令牌、配置文件等。应用程序将重置为初始状态。此操作不可恢复！',
                  'This will permanently delete ALL application data, including all user data, GitHub tokens, configuration files, etc. The application will be reset to its initial state. This action cannot be undone!'
                )}
              </p>
              <button
                onClick={() => openConfirmation('all')}
                className="mt-4 px-6 py-3 bg-status-red hover:bg-gray-100 dark:bg-white/[0.04] text-white font-semibold rounded-lg transition-colors flex items-center space-x-2"
              >
                <Trash2 className="w-5 h-5" />
                <span>{t('删除所有数据', 'Delete All Data')}</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Operation Logs */}
      {operationLogs.length > 0 && (
        <section>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-text-primary mb-4">
            {t('操作日志', 'Operation Logs')}
          </h3>
          <div className="bg-white dark:bg-panel-dark rounded-lg border border-black/[0.06] dark:border-white/[0.04] overflow-hidden">
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-light-bg dark:bg-white/[0.04] sticky top-0">
                  <tr>
                    <th className="px-4 py-2 text-left text-gray-700 dark:text-text-secondary">
                      {t('时间', 'Time')}
                    </th>
                    <th className="px-4 py-2 text-left text-gray-700 dark:text-text-secondary">
                      {t('操作', 'Operation')}
                    </th>
                    <th className="px-4 py-2 text-left text-gray-700 dark:text-text-secondary">
                      {t('状态', 'Status')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.06] dark:divide-gray-700">
                  {operationLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-light-bg dark:hover:bg-white/10/50">
                      <td className="px-4 py-2 text-gray-500 dark:text-text-tertiary">
                        {log.timestamp}
                      </td>
                      <td className="px-4 py-2 text-gray-900 dark:text-text-primary">{log.operation}</td>
                      <td className="px-4 py-2">
                        {log.success ? (
                          <span className="inline-flex items-center px-2 py-1 text-xs font-medium text-status-emerald bg-status-emerald rounded-full">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            {t('成功', 'Success')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-1 text-xs font-medium text-gray-700 dark:text-text-secondary bg-status-red/10 dark:bg-status-red/20 rounded-full">
                            <XCircle className="w-3 h-3 mr-1" />
                            {t('失败', 'Failed')}
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
      {confirmation.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md bg-white dark:bg-panel-dark rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-6 py-4 bg-light-surface dark:bg-white/[0.04] border-b border-black/[0.06] dark:border-white/[0.04] dark:border-black/[0.06] dark:border-white/[0.04]">
              <div className="flex items-center space-x-3">
                <AlertTriangle className="w-6 h-6 text-gray-700 dark:text-text-secondary " />
                <h3 className="text-lg font-semibold text-gray-700 dark:text-text-secondary ">
                  {getDeleteTitle(confirmation.type!)}
                </h3>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div className="flex items-start space-x-3 text-gray-700 dark:text-text-secondary bg-light-surface dark:bg-white/[0.04] p-4 rounded-lg">
                <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <p className="text-sm">{getDeleteDescription(confirmation.type!)}</p>
              </div>

              {/* GitHub Username Verification for "Delete All" */}
              {confirmation.type === 'all' && user && (
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-900 dark:text-text-secondary">
                    {t(
                      '请输入您的GitHub用户名以确认此操作：',
                      'Please enter your GitHub username to confirm this action:'
                    )}
                    <span className="ml-2 font-mono text-brand-violet dark:text-brand-violet">
                      {user.login}
                    </span>
                  </label>
                  <input
                    type="text"
                    value={confirmation.githubUsernameInput}
                    onChange={(e) =>
                      setConfirmation((prev) => ({
                        ...prev,
                        githubUsernameInput: e.target.value,
                      }))
                    }
                    placeholder={t('输入GitHub用户名', 'Enter GitHub username')}
                    className="w-full px-4 py-2 border border-black/[0.06] dark:border-white/[0.04] rounded-lg focus:ring-2 focus:ring-red-500 focus:border-black/[0.06] dark:border-white/[0.04] dark:bg-white/[0.04] dark:text-text-primary"
                  />
                </div>
              )}

              <div className="flex space-x-3 pt-4">
                <button
                  onClick={closeConfirmation}
                  disabled={isDeleting}
                  className="flex-1 px-4 py-2 text-gray-900 dark:text-text-secondary bg-light-surface dark:bg-white/[0.04] hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors disabled:opacity-50"
                >
                  {t('取消', 'Cancel')}
                </button>
                <button
                  onClick={handleDelete}
                  disabled={
                    isDeleting ||
                    (confirmation.type === 'all' &&
                      confirmation.githubUsernameInput !== user?.login)
                  }
                  className="flex-1 px-4 py-2 bg-status-red hover:bg-gray-100 dark:bg-white/[0.04] text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{t('删除中...', 'Deleting...')}</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4" />
                      <span>{t('确认删除', 'Confirm Delete')}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Import Preview Modal */}
      {importPreview.isOpen && importPreview.data && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-white dark:bg-panel-dark rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-6 py-4 bg-status-emerald border-b border-black/[0.06] dark:border-white/[0.04] dark:border-black/[0.06] dark:border-white/[0.04]">
              <div className="flex items-center space-x-3">
                <Upload className="w-6 h-6 text-status-emerald " />
                <h3 className="text-lg font-semibold text-gray-700 dark:text-text-secondary ">
                  {t('导入数据预览', 'Import Data Preview')}
                </h3>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div className="text-sm text-gray-700 dark:text-text-tertiary">
                <p><strong>{t('文件名:', 'File:')}</strong> {importPreview.fileName}</p>
                <p><strong>{t('导出日期:', 'Export Date:')}</strong> {new Date(importPreview.data.exportDate).toLocaleString()}</p>
                <p><strong>{t('版本:', 'Version:')}</strong> {importPreview.data.appVersion}</p>
              </div>

              <div className="border-t border-black/[0.06] dark:border-white/[0.04] pt-4">
                <p className="text-sm font-medium text-gray-900 dark:text-text-secondary mb-2">{t('包含的数据:', 'Included Data:')}</p>
                <div className="space-y-1 text-sm">
                  {importPreview.data.data.repositories && (
                    <p className="text-gray-700 dark:text-text-tertiary">
                      • {t('仓库数据', 'Repositories')}: {importPreview.data.data.repositories.length} {t('条', 'items')}
                    </p>
                  )}
                  {importPreview.data.data.releases && (
                    <p className="text-gray-700 dark:text-text-tertiary">
                      • {t('Release数据', 'Releases')}: {importPreview.data.data.releases.length} {t('条', 'items')}
                    </p>
                  )}
                  {importPreview.data.data.aiConfigs && (
                    <p className="text-gray-700 dark:text-text-tertiary">
                      • {t('AI配置', 'AI Configs')}: {importPreview.data.data.aiConfigs.length} {t('条', 'items')}
                    </p>
                  )}
                  {importPreview.data.data.webdavConfigs && (
                    <p className="text-gray-700 dark:text-text-tertiary">
                      • {t('WebDAV配置', 'WebDAV Configs')}: {importPreview.data.data.webdavConfigs.length} {t('条', 'items')}
                    </p>
                  )}
                  {importPreview.data.data.customCategories && (
                    <p className="text-gray-700 dark:text-text-tertiary">
                      • {t('分类设置', 'Categories')}: {importPreview.data.data.customCategories.length} {t('条', 'items')}
                    </p>
                  )}
                  {importPreview.data.data.assetFilters && (
                    <p className="text-gray-700 dark:text-text-tertiary">
                      • {t('资源过滤器', 'Asset Filters')}: {importPreview.data.data.assetFilters.length} {t('条', 'items')}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex space-x-3 pt-4">
                <button
                  onClick={() => setImportPreview({ data: null, isOpen: false, fileName: '' })}
                  disabled={isImporting}
                  className="flex-1 px-4 py-2 text-gray-900 dark:text-text-secondary bg-light-surface dark:bg-white/[0.04] hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors disabled:opacity-50"
                >
                  {t('取消', 'Cancel')}
                </button>
                <button
                  onClick={() => {
                    const types = Object.keys(importPreview.data!.data).filter(k => importPreview.data!.data[k as keyof typeof importPreview.data.data] !== undefined);
                    importData(types, 'merge');
                  }}
                  disabled={isImporting}
                  className="flex-1 px-4 py-2 bg-brand-indigo hover:bg-brand-hover text-white font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center space-x-2"
                >
                  {isImporting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{t('导入中...', 'Importing...')}</span>
                    </>
                  ) : (
                    <span>{t('合并导入', 'Merge Import')}</span>
                  )}
                </button>
                <button
                  onClick={() => {
                    const types = Object.keys(importPreview.data!.data).filter(k => importPreview.data!.data[k as keyof typeof importPreview.data.data] !== undefined);
                    importData(types, 'replace');
                  }}
                  disabled={isImporting}
                  className="flex-1 px-4 py-2 bg-brand-indigo hover:bg-brand-hover text-white font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center space-x-2"
                >
                  {isImporting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{t('导入中...', 'Importing...')}</span>
                    </>
                  ) : (
                    <span>{t('覆盖导入', 'Replace Import')}</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
