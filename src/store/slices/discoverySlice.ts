
import type { AppStoreSlice } from '../types';

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
  | 'appendDiscoveryRepos'
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
  setDiscoveryScrollPosition: (channel, position) => set((state) => ({
      discoveryScrollPositions: { ...state.discoveryScrollPositions, [channel]: position },
    })),
    appendDiscoveryRepos: (channel, repos) => set((state) => ({
      discoveryRepos: {
        ...state.discoveryRepos,
        [channel]: [...(state.discoveryRepos[channel] || []), ...repos]
      },
    })),
});
