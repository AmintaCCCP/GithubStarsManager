
import type { AppStoreSlice } from '../types';
import { REQUIRED_HEADER_MENU_IDS } from '../schema';
import { normalizeThemeTokens } from '../../utils/themeTokens';
import { normalizeRepositoryCardFields } from '../../utils/repositoryCardFields';
import { normalizeRepositoryCardActions } from '../../utils/repositoryCardActions';
import {
  accountIdKey,
  getAccountSessionGeneration,
} from '../helpers/accountWorkspace';
import { useAppStore } from '../useAppStore';

/**
 * Release 刷新状态的归属会话（审计修复 B4）：set(true) 时捕获发起刷新的
 * 账号 ID + 会话代次；set(false) 时——若调用方传入其发起时的身份——仅当
 * 该身份仍是标志的当前持有者才清除（旧账号 A 的 finally 在 B 已重新发起
 * 刷新后到达时，身份不匹配被忽略）；未传身份时退回「归属会话与当前会话
 * 一致才清除」的判定；两者皆无时保持无条件布尔语义，兼容既有调用点。
 */
let _releaseRefreshOwner: { accountId: string | null; generation: number } | null = null;

export const createPreferenceSlice: AppStoreSlice<Pick<import('../types').AppActions,
  | 'setThemeMode'
  | 'setSystemTheme'
  | 'setThemePresetLight'
  | 'setThemePresetDark'
  | 'updateThemeTokens'
  | 'setCurrentView'
  | 'setSelectedCategory'
  | 'setLanguage'
  | 'setTranslationEngine'
  | 'setAutoTranslateRepoDescription'
  | 'setSidebarCollapsed'
  | 'setReadmeModalOpen'
  | 'setHeaderMenuConfig'
  | 'setHasHydrated'
  | 'setUpdateNotification'
  | 'dismissUpdateNotification'
  | 'setAutoUpdateCheckEnabled'
  | 'setUpdatePromptDismissedVersion'
  | 'setAnalysisProgress'
  | 'setProxyConfig'
  | 'setRouteMode'
  | 'setRpcDownloadConfig'
  | 'setRepositoryViewMode'
  | 'setRepositoryCardField'
  | 'setRepositoryCardActions'
  | 'setPluginCustomIcon'
  | 'setReleaseViewMode'
  | 'setReleaseShowMode'
  | 'setReleaseLatestMode'
  | 'setReleaseSelectedFilters'
  | 'toggleReleaseSelectedFilter'
  | 'clearReleaseSelectedFilters'
  | 'setReleaseSearchQuery'
  | 'toggleReleaseExpandedRepository'
  | 'setReleaseExpandedRepositories'
  | 'setReleaseIsRefreshing'
  | 'setIncludePreRelease'
  | 'setIncludeKeysInBackup'
>> = (set) => ({
      // UI actions
      setThemeMode: (themeMode) => set({ themeMode }),
      setSystemTheme: (systemTheme) => set({ systemTheme }),
      setThemePresetLight: (themePresetLight) => set({ themePresetLight }),
      setThemePresetDark: (themePresetDark) => set({ themePresetDark }),
      // Theme token 只存声明式偏好；写 CSS 变量的副作用在 App 的 effect 里。
      // 合并当前值后再 normalize，调用方传局部即可，脏值也进不了根节点。
      updateThemeTokens: (patch) => set((state) => ({
        themeTokens: normalizeThemeTokens({ ...state.themeTokens, ...patch }),
      })),
      setCurrentView: (currentView) => set({ currentView }),
      setSelectedCategory: (selectedCategory) => set({ selectedCategory }),
      setLanguage: (language) => set({ language }),
      setTranslationEngine: (translationEngine) => set({ translationEngine }),
      setAutoTranslateRepoDescription: (autoTranslateRepoDescription) => set({ autoTranslateRepoDescription }),
      setSidebarCollapsed: (isSidebarCollapsed) => set({ isSidebarCollapsed }),
      setReadmeModalOpen: (readmeModalOpen) => set({ readmeModalOpen }),
      setHeaderMenuConfig: (config) => set({
        headerMenuConfig: config.map(item =>
          REQUIRED_HEADER_MENU_IDS.has(item.id) ? { ...item, visible: true } : item
        ),
      }),

      // Hydration state
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),

      // Update actions
      setUpdateNotification: (notification) => set({ updateNotification: notification }),
      dismissUpdateNotification: () => set({ updateNotification: null }),
      setAutoUpdateCheckEnabled: (autoUpdateCheckEnabled) => set({ autoUpdateCheckEnabled }),
      setUpdatePromptDismissedVersion: (updatePromptDismissedVersion) => set({ updatePromptDismissedVersion }),
      setAnalysisProgress: (newProgress) => set({ analysisProgress: newProgress }),
      setProxyConfig: (updates) => set((state) => ({
        proxyConfig: { ...state.proxyConfig, ...updates }
      })),
      setRouteMode: (routeMode) => set({ routeMode }),
      setRpcDownloadConfig: (updates) => set((state) => ({
        rpcDownloadConfig: { ...state.rpcDownloadConfig, ...updates }
      })),

      // Repository list view actions
      // 卡片字段开关：合并当前值后 normalize，缺失字段自动按默认处理
      setRepositoryCardField: (id, visible) => set((state) => ({
        repositoryCardFields: normalizeRepositoryCardFields({ ...state.repositoryCardFields, [id]: visible }),
      })),
      setRepositoryCardActions: (actions) => set({ repositoryCardActions: normalizeRepositoryCardActions(actions) }),
      setPluginCustomIcon: (pluginId, icon) => set((state) => {
        const next = { ...state.pluginCustomIcons };
        if (!icon) {
          delete next[pluginId];
        } else {
          next[pluginId] = icon;
        }
        return { pluginCustomIcons: next };
      }),
      setRepositoryViewMode: (repositoryViewMode) => set({ repositoryViewMode }),

      // Release Timeline View actions
      setReleaseViewMode: (releaseViewMode) => set({ releaseViewMode }),
      setReleaseShowMode: (releaseShowMode) => set({ releaseShowMode }),
      setReleaseLatestMode: (releaseLatestMode) => set({ releaseLatestMode }),
      setReleaseSelectedFilters: (releaseSelectedFilters) => set({ releaseSelectedFilters }),
      toggleReleaseSelectedFilter: (filterId) => set((state) => ({
        releaseSelectedFilters: state.releaseSelectedFilters.includes(filterId)
          ? state.releaseSelectedFilters.filter(id => id !== filterId)
          : [...state.releaseSelectedFilters, filterId]
      })),
      clearReleaseSelectedFilters: () => set({ releaseSelectedFilters: [] }),
      setReleaseSearchQuery: (releaseSearchQuery) => set({ releaseSearchQuery }),
      toggleReleaseExpandedRepository: (repoId) => set((state) => {
        const newSet = new Set(state.releaseExpandedRepositories);
        if (newSet.has(repoId)) {
          newSet.delete(repoId);
        } else {
          newSet.add(repoId);
        }
        return { releaseExpandedRepositories: newSet };
      }),
      setReleaseExpandedRepositories: (releaseExpandedRepositories) => set({ releaseExpandedRepositories }),
      setReleaseIsRefreshing: (releaseIsRefreshing, owner) => set(() => {
        if (releaseIsRefreshing) {
          _releaseRefreshOwner = owner ?? null;
          return { releaseIsRefreshing: true };
        }
        if (owner) {
          // B4：finally 清理携带发起刷新时的身份——仅当该身份仍是标志的当前
          // 持有者才清除；期间切号后 B 已重新发起刷新时，A 的过期 finally
          // 身份不匹配，被忽略。
          if (_releaseRefreshOwner
            && _releaseRefreshOwner.accountId === owner.accountId
            && _releaseRefreshOwner.generation === owner.generation) {
            _releaseRefreshOwner = null;
            return { releaseIsRefreshing: false };
          }
          return {};
        }
        if (_releaseRefreshOwner) {
          let currentUser: { id: number } | null = null;
          try {
            const store = useAppStore as unknown as { getState?: () => { user: { id: number } | null } };
            currentUser = typeof store.getState === 'function' ? (store.getState()?.user ?? null) : null;
          } catch {
            currentUser = null;
          }
          const sameAccount = _releaseRefreshOwner.accountId === accountIdKey(currentUser);
          const sameGeneration = _releaseRefreshOwner.generation === getAccountSessionGeneration();
          if (!sameAccount || !sameGeneration) {
            // 过期清理：发起刷新的账号/会话已被切换，不得清除当前账号的刷新状态
            return {};
          }
          _releaseRefreshOwner = null;
        }
        return { releaseIsRefreshing: false };
      }),
      setIncludePreRelease: (includePreRelease) => set({ includePreRelease }),
      setIncludeKeysInBackup: (includeKeysInBackup) => set({ includeKeysInBackup }),

});
