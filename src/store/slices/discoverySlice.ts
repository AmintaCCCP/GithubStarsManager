
import type { AppStoreSlice } from '../types';
import { normalizeXTweetAuth, normalizeXTweetHandleInput } from '../../utils/xTweetFollows';
import { normalizeTelegramChannelInput } from '../../utils/telegramFollows';
import { saveEncryptedXAuthViaDesktop, clearEncryptedXAuthViaDesktop } from '../../services/electronProxy';
import { logger } from '../../services/logger';
import { recordTrendingSnapshot } from '../../utils/trendingSnapshots';

export const createDiscoverySlice: AppStoreSlice<Pick<import('../types').AppActions,
  | 'setSelectedDiscoveryChannel'
  | 'setDiscoveryLoading'
  | 'setDiscoveryLoadingMore'
  | 'setDiscoveryLoadMoreError'
  | 'setDiscoveryRepos'
  | 'setDiscoveryLastRefresh'
  | 'updateDiscoveryRepo'
  | 'toggleDiscoveryChannel'
  | 'setDiscoveryPlatform'
  | 'setDiscoveryLanguage'
  | 'setDiscoverySortBy'
  | 'setDiscoverySortOrder'
  | 'setDiscoverySearchQuery'
  | 'setDiscoverySelectedTopic'
  | 'setDiscoveryHasMore'
  | 'setDiscoveryNextPage'
  | 'setDiscoveryTotalCount'
  | 'setDiscoveryScrollPosition'
  | 'setTrendingTimeRange'
  | 'setWeeklyOnlyCollected'
  | 'setWeeklySyncStatus'
  | 'setXTweetSyncStatus'
  | 'addXTweetFollow'
  | 'removeXTweetFollow'
  | 'setXTweetAuth'
  | 'clearXTweetAuth'
  | 'setTelegramSyncStatus'
  | 'addTelegramFollow'
  | 'removeTelegramFollow'
  | 'appendDiscoveryRepos'
  | 'recordTrendingSnapshot'
>> = (set) => ({
    // Discovery actions
    setSelectedDiscoveryChannel: (selectedDiscoveryChannel) => set((state) => ({
      selectedDiscoveryChannel,
      discoveryRepos: {
        ...state.discoveryRepos,
        [selectedDiscoveryChannel]: []
      },
      discoveryNextPage: {
        ...state.discoveryNextPage,
        [selectedDiscoveryChannel]: 1
      },
      discoveryHasMore: {
        ...state.discoveryHasMore,
        [selectedDiscoveryChannel]: false
      },
      discoveryTotalCount: {
        ...state.discoveryTotalCount,
        [selectedDiscoveryChannel]: 0
      },
      discoveryIsLoadingMore: {
        ...state.discoveryIsLoadingMore,
        [selectedDiscoveryChannel]: false
      },
      discoveryLoadMoreError: {
        ...state.discoveryLoadMoreError,
        [selectedDiscoveryChannel]: null
      }
    })),
    setDiscoveryLoading: (channel, loading) => set((state) => ({
      discoveryIsLoading: { ...state.discoveryIsLoading, [channel]: loading },
    })),
    setDiscoveryLoadingMore: (channel, loading) => set((state) => ({
      discoveryIsLoadingMore: { ...state.discoveryIsLoadingMore, [channel]: loading },
    })),
    setDiscoveryLoadMoreError: (channel, error) => set((state) => ({
      discoveryLoadMoreError: { ...state.discoveryLoadMoreError, [channel]: error },
    })),
    setDiscoveryRepos: (channel, repos, append = false) => set((state) => ({
      discoveryRepos: {
        ...state.discoveryRepos,
        [channel]: append ? [...(state.discoveryRepos[channel] || []), ...repos] : repos
      },
    })),
    setDiscoveryLastRefresh: (channel, timestamp) => set((state) => ({
      discoveryLastRefresh: { ...state.discoveryLastRefresh, [channel]: timestamp },
    })),
    updateDiscoveryRepo: (repo) => set((state) => {
      const channel = repo.channel;
      const channelRepos = state.discoveryRepos[channel] || [];
      return {
        discoveryRepos: {
          ...state.discoveryRepos,
          [channel]: channelRepos.map(r => r.id === repo.id ? repo : r),
        },
      };
    }),
    toggleDiscoveryChannel: (channelId) => set((state) => ({
      discoveryChannels: state.discoveryChannels.map(ch =>
        ch.id === channelId ? { ...ch, enabled: !ch.enabled } : ch
      ),
    })),
    setDiscoveryPlatform: (discoveryPlatform) => set({ discoveryPlatform }),
    setDiscoveryLanguage: (discoveryLanguage) => set({ discoveryLanguage }),
    setDiscoverySortBy: (discoverySortBy) => set({ discoverySortBy }),
    setDiscoverySortOrder: (discoverySortOrder) => set({ discoverySortOrder }),
    setDiscoverySearchQuery: (discoverySearchQuery) => set({ discoverySearchQuery }),
    setDiscoverySelectedTopic: (discoverySelectedTopic) => set({ discoverySelectedTopic }),
    setDiscoveryHasMore: (channel, hasMore) => set((state) => ({
      discoveryHasMore: { ...state.discoveryHasMore, [channel]: hasMore },
    })),
    setDiscoveryNextPage: (channel, page) => set((state) => ({
      discoveryNextPage: { ...state.discoveryNextPage, [channel]: page },
    })),
    setDiscoveryTotalCount: (channel, count) => set((state) => ({
      discoveryTotalCount: { ...state.discoveryTotalCount, [channel]: count },
    })),
    setTrendingTimeRange: (range) => set({ trendingTimeRange: range }),
    setWeeklyOnlyCollected: (only) => set({ weeklyOnlyCollected: only }),
    setWeeklySyncStatus: (status) => set({ weeklySyncStatus: status }),
    setXTweetSyncStatus: (status) => set({ xTweetSyncStatus: status }),
    addXTweetFollow: (handle) => set((state) => {
      const normalized = normalizeXTweetHandleInput(handle);
      if (!normalized) return {};
      const exists = state.xTweetFollows.some(
        (follow) => follow.handle.toLowerCase() === normalized.toLowerCase(),
      );
      if (exists) return {};
      return {
        xTweetFollows: [...state.xTweetFollows, { handle: normalized, addedAt: new Date().toISOString() }],
      };
    }),
    removeXTweetFollow: (handle) => set((state) => ({
      xTweetFollows: state.xTweetFollows.filter(
        (follow) => follow.handle.toLowerCase() !== handle.toLowerCase(),
      ),
    })),
    setXTweetAuth: (auth) => {
      const sanitized = normalizeXTweetAuth(auth);
      if (!sanitized) {
        clearEncryptedXAuthViaDesktop().catch((err: unknown) => {
          logger.errorFromError('xAuth', 'Failed to clear encrypted X auth', err);
        });
        set((state) => ({
          xTweetAuth: null,
          xTweetAuthRevision: (state.xTweetAuthRevision ?? 0) + 1,
        }));
        return;
      }
      saveEncryptedXAuthViaDesktop(sanitized).catch((err: unknown) => {
        logger.errorFromError('xAuth', 'Failed to persist encrypted X auth to disk — auth will be lost on restart', err);
      });
      set((state) => ({
        xTweetAuth: sanitized,
        xTweetAuthRevision: (state.xTweetAuthRevision ?? 0) + 1,
      }));
    },
    clearXTweetAuth: () => {
      clearEncryptedXAuthViaDesktop().catch((err: unknown) => {
        logger.errorFromError('xAuth', 'Failed to clear encrypted X auth', err);
      });
      set((state) => ({
        xTweetAuth: null,
        xTweetAuthRevision: (state.xTweetAuthRevision ?? 0) + 1,
      }));
    },
    setTelegramSyncStatus: (status) => set({ telegramSyncStatus: status }),
    addTelegramFollow: (channel) => set((state) => {
      const normalized = normalizeTelegramChannelInput(channel);
      if (!normalized) return {};
      const exists = state.telegramFollows.some(
        (follow) => follow.channel.toLowerCase() === normalized.toLowerCase(),
      );
      if (exists) return {};
      return {
        telegramFollows: [...state.telegramFollows, { channel: normalized, addedAt: new Date().toISOString() }],
      };
    }),
    removeTelegramFollow: (channel) => set((state) => ({
      telegramFollows: state.telegramFollows.filter(
        (follow) => follow.channel.toLowerCase() !== channel.toLowerCase(),
      ),
    })),
  setDiscoveryScrollPosition: (channel, position) => set((state) => ({
      discoveryScrollPositions: { ...state.discoveryScrollPositions, [channel]: position },
    })),
    appendDiscoveryRepos: (channel, repos) => set((state) => ({
      discoveryRepos: {
        ...state.discoveryRepos,
        [channel]: [...(state.discoveryRepos[channel] || []), ...repos]
      },
    })),
    // Trending 快照（开发守则 §7）：去重、上限与超期清理都在 utils 的纯函数里，
    // 这里只负责把结果写回 Store。
    recordTrendingSnapshot: (snapshot) => set((state) => ({
      trendingSnapshots: recordTrendingSnapshot(state.trendingSnapshots, snapshot),
    })),
});
