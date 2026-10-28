import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DiscoverySidebar } from './DiscoverySidebar';
import type { DiscoveryChannel, DiscoveryChannelId } from '../types';

describe('DiscoverySidebar code search count', () => {
  it('does not show the unsupported code-search volume as zero', () => {
    const channels: DiscoveryChannel[] = [{
      id: 'code-search',
      name: '代码搜索',
      nameEn: 'Code Search',
      icon: 'search',
      description: 'Search code',
      enabled: true,
    }];
    const emptyCounts = {
      trending: 0,
      'hot-release': 0,
      'most-popular': 0,
      topic: 0,
      'x-tweet': 0,
      telegram: 0,
      weekly: 0,
      search: 0,
      'code-search': 0,
    } as Record<DiscoveryChannelId, number>;

    render(
      <DiscoverySidebar
        channels={channels}
        selectedChannel="code-search"
        onChannelSelect={vi.fn()}
        onToggleChannel={vi.fn()}
        onRefreshAll={vi.fn()}
        totalCount={emptyCounts}
        isLoading={{} as Record<DiscoveryChannelId, boolean>}
        lastRefresh={{} as Record<DiscoveryChannelId, string | null>}
        isAnalyzing={false}
        language="zh"
      />,
    );

    const channelButton = screen.getByRole('button', { name: '代码搜索' });
    expect(within(channelButton).queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText(/0 条内容/)).not.toBeInTheDocument();
  });
});
