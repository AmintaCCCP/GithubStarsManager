import type { Repository } from '../../types';
import type { AppActions, AppStoreSlice } from '../types';
import { recordRecentlyViewed } from '../../utils/recentlyViewed';

/**
 * 「最近浏览」（开发守则 §9）。
 *
 * 只做本地记录：不写远端、不进插件快照；条数与时间上限由 utils 里的纯函数负责，
 * 这里只负责开关与状态迁移。
 */
export const createRecentlyViewedSlice: AppStoreSlice<Pick<AppActions,
  | 'recordRepositoryView'
  | 'clearRecentlyViewed'
  | 'setRecentlyViewedEnabled'
  | 'setDiscoveryHideSeen'
>> = (set, get) => ({
  recordRepositoryView: (repository: Repository) => {
    // 用户关掉记录后不再写入；已有记录保留，直到用户主动清空。
    if (!get().recentlyViewedEnabled) return;
    set({ recentlyViewed: recordRecentlyViewed(get().recentlyViewed, repository) });
  },
  clearRecentlyViewed: () => set({ recentlyViewed: [] }),
  setRecentlyViewedEnabled: (enabled) => set({ recentlyViewedEnabled: enabled }),
  setDiscoveryHideSeen: (enabled) => set({ discoveryHideSeen: enabled }),
});
