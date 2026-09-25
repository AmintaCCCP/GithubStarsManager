import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { defaultDiscoveryChannels } from '../store/schema';
import { DiscoveryChannelMenu } from './DiscoveryChannelMenu';

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
});
