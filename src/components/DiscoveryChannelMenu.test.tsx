import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultDiscoveryChannels } from '../store/schema';
import { useAppStore } from '../store/useAppStore';
import { DiscoveryChannelMenu } from './DiscoveryChannelMenu';

afterEach(() => vi.unstubAllGlobals());

describe('DiscoveryChannelMenu', () => {
  it('lets the user hide an unwanted channel', async () => {
    const onToggleChannel = vi.fn();
    const user = userEvent.setup();
    render(<DiscoveryChannelMenu channels={defaultDiscoveryChannels} language="zh"
      onToggleChannel={onToggleChannel} />);

    await user.click(screen.getByRole('button', { name: '管理发现频道' }));
    const telegram = screen.getByRole('menuitemcheckbox', { name: 'Telegram 频道' });
    expect(telegram).toHaveAttribute('aria-checked', 'true');
    await user.click(telegram);

    expect(onToggleChannel).toHaveBeenCalledWith('telegram');
  });

  it('keeps the last visible channel enabled', async () => {
    const user = userEvent.setup();
    const channels = defaultDiscoveryChannels.map(channel => ({
      ...channel,
      enabled: channel.id === 'trending',
    }));
    render(<DiscoveryChannelMenu channels={channels} language="zh"
      onToggleChannel={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: '管理发现频道' }));
    expect(screen.getByRole('menuitemcheckbox', { name: '趋势' })).toHaveAttribute('data-disabled');
  });

  it('adds a readable JSON feed as a separate discovery channel', async () => {
    const storeMock = vi.mocked(useAppStore);
    const originalImplementation = storeMock.getMockImplementation();
    const addChannel = vi.fn().mockReturnValue('external:example');
    storeMock.mockImplementation((selector) => selector({
      language: 'zh', addExternalDiscoveryChannel: addChannel,
      removeExternalDiscoveryChannel: vi.fn(),
    } as never));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      repositories: ['https://github.com/owner/repo'],
    }), { status: 200 })));
    const user = userEvent.setup();
    try {
      render(<DiscoveryChannelMenu channels={defaultDiscoveryChannels} language="zh" onToggleChannel={vi.fn()} />);
      await user.click(screen.getByRole('button', { name: '管理发现频道' }));
      await user.click(screen.getByRole('menuitem', { name: '外部发现频道' }));
      await user.type(screen.getByRole('textbox', { name: '频道名称' }), '我的来源');
      await user.type(screen.getByRole('textbox', { name: 'HTTPS 地址' }), 'https://example.com/feed.json');
      await user.click(screen.getByRole('button', { name: '添加频道' }));
      await waitFor(() => expect(addChannel).toHaveBeenCalledWith('我的来源', 'https://example.com/feed.json', 'json'));
    } finally {
      storeMock.mockImplementation(originalImplementation!);
    }
  });
});
