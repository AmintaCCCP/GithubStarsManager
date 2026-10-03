import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginRegistrySection } from './PluginRegistrySection';
import { makeT } from '../../i18n/useT';
import type { MarketplaceState } from '../../plugins/types';

const mocks = vi.hoisted(() => ({
  isAvailable: vi.fn(() => true),
  getState: vi.fn(),
  onOpenMarketplace: vi.fn(),
}));

vi.mock('../../services/pluginMarketplaceService', () => ({
  pluginMarketplaceService: {
    isAvailable: mocks.isAvailable,
    getState: mocks.getState,
  },
}));

const t = makeT('zh', 'app');

const marketplaceState = (overrides: Partial<MarketplaceState> = {}): MarketplaceState => ({
  sources: [{ id: 'src-1', url: 'https://github.com/owner/repo/tree/main/plugins', addedAt: '2026-10-01T00:00:00.000Z' }],
  entries: [{
    source: { id: 'src-1', url: 'https://github.com/owner/repo/tree/main/plugins', addedAt: '2026-10-01T00:00:00.000Z' },
    status: 'ok',
    plugins: [{
      directoryName: 'fixture',
      manifest: {
        manifestVersion: 1,
        id: 'com.example.fixture',
        name: 'Fixture',
        version: '1.0.0',
        apiVersion: '1',
        permissions: ['storage'],
        contributes: {},
      },
    }],
    warnings: [],
    error: null,
    fetchedAt: '2026-10-01T00:00:00.000Z',
  }],
  ...overrides,
});

describe('PluginRegistrySection（入口卡片）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAvailable.mockReturnValue(true);
  });

  it('renders nothing when the marketplace bridge is unavailable', () => {
    mocks.isAvailable.mockReturnValue(false);
    const { container } = render(<PluginRegistrySection t={t} onOpenMarketplace={mocks.onOpenMarketplace} />);
    expect(container).toBeEmptyDOMElement();
    expect(mocks.getState).not.toHaveBeenCalled();
  });

  it('shows the source and plugin counts and opens the marketplace', async () => {
    mocks.getState.mockResolvedValue(marketplaceState());
    const user = userEvent.setup();
    render(<PluginRegistrySection t={t} onOpenMarketplace={mocks.onOpenMarketplace} />);

    await vi.waitFor(() => expect(screen.getByTestId('plugin-registry-stats')).toHaveTextContent('1 个插件源'));
    expect(screen.getByTestId('plugin-registry-stats')).toHaveTextContent('1 个可用插件');

    await user.click(screen.getByTestId('plugin-registry-open'));
    expect(mocks.onOpenMarketplace).toHaveBeenCalledOnce();
  });

  it('hides the stats line when no sources have been added', async () => {
    mocks.getState.mockResolvedValue(marketplaceState({ sources: [], entries: [] }));
    render(<PluginRegistrySection t={t} onOpenMarketplace={mocks.onOpenMarketplace} />);

    await vi.waitFor(() => expect(screen.getByTestId('plugin-registry-open')).toBeInTheDocument());
    expect(screen.queryByTestId('plugin-registry-stats')).not.toBeInTheDocument();
  });

  it('keeps rendering the entry card when the state read fails', async () => {
    mocks.getState.mockRejectedValue(new Error('IPC unavailable'));
    render(<PluginRegistrySection t={t} onOpenMarketplace={mocks.onOpenMarketplace} />);

    await vi.waitFor(() => expect(screen.getByTestId('plugin-registry-open')).toBeInTheDocument());
    expect(screen.queryByTestId('plugin-registry-stats')).not.toBeInTheDocument();
  });
});
