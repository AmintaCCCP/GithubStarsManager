import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DiscoveryView } from './DiscoveryView';

const refreshChannel = vi.fn();
const setSelectedDiscoveryChannel = vi.fn();

vi.mock('../store/useAppStore', () => ({
  useAppStore: Object.assign(vi.fn(), {
    getState: () => ({ discoveryRepos: { search: [] }, discoveryIsLoading: {} }),
  }),
}));

vi.mock('../features/discovery/hooks/useDiscoveryActions', () => ({
  useDiscoveryActions: () => ({
    githubToken: 'token', language: 'en',
    discoveryChannels: [
      { id: 'trending', name: '趋势', nameEn: 'Trending', icon: 'trending', enabled: true },
      { id: 'search', name: '搜索', nameEn: 'Search', icon: 'search', enabled: true },
    ],
    discoveryRepos: { trending: [], search: [] },
    discoveryLastRefresh: {}, discoveryIsLoading: {}, discoveryIsLoadingMore: {}, discoveryLoadMoreError: {},
    selectedDiscoveryChannel: 'search', setSelectedDiscoveryChannel, setDiscoveryScrollPosition: vi.fn(),
    analysisProgress: { current: 0, total: 0 }, discoveryPlatform: 'All', setDiscoveryPlatform: vi.fn(),
    discoveryLanguage: 'All', setDiscoveryLanguage: vi.fn(), discoverySortBy: 'BestMatch', setDiscoverySortBy: vi.fn(),
    discoverySortOrder: 'Descending', setDiscoverySortOrder: vi.fn(), discoverySearchQuery: '', setDiscoverySearchQuery: vi.fn(),
    discoverySelectedTopic: null, setDiscoverySelectedTopic: vi.fn(), discoveryHasMore: {}, discoveryNextPage: {},
    discoveryTotalCount: {}, trendingTimeRange: 'daily', setTrendingTimeRange: vi.fn(), weeklyOnlyCollected: false,
    setWeeklyOnlyCollected: vi.fn(), weeklySyncStatus: null, xTweetFollows: [], xTweetAuth: null, xTweetAuthRevision: 0,
    xTweetSyncStatus: null, telegramFollows: [], telegramSyncStatus: null, t: (_zh: string, en: string) => en,
    isAnalyzing: false, refreshChannel, handleAnalyzePage: vi.fn(), handleAbortAnalysis: vi.fn(),
  }),
}));

vi.mock('./SubscriptionRepoCard', () => ({ SubscriptionRepoCard: () => null }));
vi.mock('./CodeSearchView', () => ({ CodeSearchView: () => null }));
vi.mock('./SortAlgorithmTooltip', () => ({ SortAlgorithmTooltip: () => <button type="button">Help</button> }));
vi.mock('./ScrollToBottom', () => ({ ScrollToBottom: () => null }));
vi.mock('./XTweetSettingsModal', () => ({ XTweetSettingsModal: () => null }));
vi.mock('./TelegramSettingsModal', () => ({ TelegramSettingsModal: () => null }));

describe('DiscoveryView mobile', () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: vi.fn(), writable: true });
  });

  beforeEach(() => {
    refreshChannel.mockClear();
    setSelectedDiscoveryChannel.mockClear();
  });

  it('keeps channel navigation scrollable and search actions touch-sized', () => {
    render(<DiscoveryView />);

    const tabs = screen.getByRole('tablist');
    expect(tabs).toHaveClass('overflow-x-auto');
    expect(screen.getByRole('tab', { name: 'Search' })).toHaveClass('h-11');
    expect(screen.getByLabelText('Search repositories')).toHaveClass('h-11', 'text-base');
    expect(screen.getByLabelText('Refresh')).toHaveClass('h-11', 'w-11');

    fireEvent.click(screen.getByRole('tab', { name: 'Trending' }));
    expect(setSelectedDiscoveryChannel).toHaveBeenCalledWith('trending');
  });
});
