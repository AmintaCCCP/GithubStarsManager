import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PluginIconPickerDialog } from './PluginIconPickerDialog';
import { useAppStore } from '../../store/useAppStore';
import type { InstalledPlugin } from '../../plugins/types';
import type { TranslateFn } from '../../i18n/useT';

const mockUseAppStore = vi.mocked(useAppStore);

const dummyPlugin: InstalledPlugin = {
  directoryName: 'test-plugin',
  manifest: {
    manifestVersion: 1,
    id: 'com.example.test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    apiVersion: '1',
    permissions: [],
    contributes: {},
  },
  enabled: true,
  status: 'active',
  grantedPermissions: [],
};

describe('PluginIconPickerDialog', () => {
  const t: TranslateFn = ((key: string, params?: Record<string, unknown>) => {
    if (key === 'pluginSettingsPanel.customize-icon-title') return `Custom Icon: ${params?.name}`;
    if (key === 'pluginSettingsPanel.search-icons') return 'Search icons…';
    if (key === 'pluginSettingsPanel.select-icon') return 'Select icon';
    if (key === 'pluginSettingsPanel.reset-icon') return 'Reset icon';
    if (key === 'pluginSettingsPanel.no-icons-found') return 'No matching icons found';
    return key;
  }) as unknown as TranslateFn;

  it('renders modal with icon options and allows selecting an icon', async () => {
    const user = userEvent.setup();
    const setPluginCustomIcon = vi.fn();
    const onClose = vi.fn();

    mockUseAppStore.mockImplementation(((selector?: (s: unknown) => unknown) => {
      const state = {
        pluginCustomIcons: {},
        setPluginCustomIcon,
      };
      return selector ? selector(state) : state;
    }) as unknown as typeof useAppStore);

    render(
      <PluginIconPickerDialog
        target={dummyPlugin}
        t={t}
        onClose={onClose}
      />
    );

    expect(screen.getByText('Custom Icon: Test Plugin')).toBeInTheDocument();

    // Find and click the Rocket icon button
    const rocketBtn = screen.getByRole('button', { name: /火箭/i });
    expect(rocketBtn).toBeInTheDocument();

    await user.click(rocketBtn);
    expect(setPluginCustomIcon).toHaveBeenCalledWith('com.example.test-plugin', 'rocket');
    expect(onClose).toHaveBeenCalled();
  });

  it('filters icons via search input', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    mockUseAppStore.mockImplementation(((selector?: (s: unknown) => unknown) => {
      const state = {
        pluginCustomIcons: {},
        setPluginCustomIcon: vi.fn(),
      };
      return selector ? selector(state) : state;
    }) as unknown as typeof useAppStore);

    render(
      <PluginIconPickerDialog
        target={dummyPlugin}
        t={t}
        onClose={onClose}
      />
    );

    const searchInput = screen.getByPlaceholderText('Search icons…');
    await user.type(searchInput, 'rocket');

    expect(screen.getByRole('button', { name: /火箭/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /机器人/i })).not.toBeInTheDocument();
  });

  it('shows reset button when custom icon is configured and restores default', async () => {
    const user = userEvent.setup();
    const setPluginCustomIcon = vi.fn();
    const onClose = vi.fn();

    mockUseAppStore.mockImplementation(((selector?: (s: unknown) => unknown) => {
      const state = {
        pluginCustomIcons: { 'com.example.test-plugin': 'rocket' },
        setPluginCustomIcon,
      };
      return selector ? selector(state) : state;
    }) as unknown as typeof useAppStore);

    render(
      <PluginIconPickerDialog
        target={dummyPlugin}
        t={t}
        onClose={onClose}
      />
    );

    const resetBtn = screen.getByRole('button', { name: 'Reset icon' });
    expect(resetBtn).toBeInTheDocument();

    await user.click(resetBtn);
    expect(setPluginCustomIcon).toHaveBeenCalledWith('com.example.test-plugin', null);
    expect(onClose).toHaveBeenCalled();
  });

  it('resets search query when target changes', async () => {
    const user = userEvent.setup();
    const setPluginCustomIcon = vi.fn();
    const onClose = vi.fn();

    mockUseAppStore.mockImplementation(((selector?: (s: unknown) => unknown) => {
      const state = {
        pluginCustomIcons: {},
        setPluginCustomIcon,
      };
      return selector ? selector(state) : state;
    }) as unknown as typeof useAppStore);

    const { rerender } = render(
      <PluginIconPickerDialog
        target={dummyPlugin}
        t={t}
        onClose={onClose}
      />
    );

    const searchInput = screen.getByPlaceholderText(/search icons/i);
    await user.type(searchInput, 'rocket');
    expect(searchInput).toHaveValue('rocket');

    const anotherPlugin: InstalledPlugin = {
      ...dummyPlugin,
      manifest: { ...dummyPlugin.manifest, id: 'com.example.another' },
    };
    rerender(
      <PluginIconPickerDialog
        target={anotherPlugin}
        t={t}
        onClose={onClose}
      />
    );

    expect(screen.getByPlaceholderText(/search icons/i)).toHaveValue('');
  });
});
