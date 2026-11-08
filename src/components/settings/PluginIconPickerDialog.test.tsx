import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
    if (key === 'pluginSettingsPanel.default-icon') return 'Default icon';
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
        language: 'zh',
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
        language: 'zh',
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
        language: 'zh',
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
        language: 'zh',
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

    await user.type(screen.getByPlaceholderText(/search icons/i), 'rocket');
    rerender(<PluginIconPickerDialog target={null} t={t} onClose={onClose} />);
    rerender(<PluginIconPickerDialog target={dummyPlugin} t={t} onClose={onClose} />);
    expect(screen.getByPlaceholderText(/search icons/i)).toHaveValue('');
  });

  it('indicates selected icon via aria-pressed and adapts label according to language', () => {
    mockUseAppStore.mockImplementation(((selector?: (s: unknown) => unknown) => {
      const state = {
        language: 'en',
        pluginCustomIcons: { 'com.example.test-plugin': 'rocket' },
        setPluginCustomIcon: vi.fn(),
      };
      return selector ? selector(state) : state;
    }) as unknown as typeof useAppStore);

    render(
      <PluginIconPickerDialog
        target={dummyPlugin}
        t={t}
        onClose={vi.fn()}
      />
    );

    const rocketBtn = screen.getByRole('button', { name: /Rocket/i });
    expect(rocketBtn).toHaveAttribute('aria-pressed', 'true');
    expect(rocketBtn).toHaveTextContent('Rocket');

    const plugBtn = screen.getByRole('button', { name: /Plug/i });
    expect(plugBtn).toHaveAttribute('aria-pressed', 'false');
    expect(plugBtn).toHaveTextContent('Plug');

    // Both the preview and the grid button label display 'Rocket'
    expect(screen.getAllByText('Rocket')).toHaveLength(2);
    const previewLabel = screen
      .getAllByText('Rocket')
      .find((node) => node.closest('button') === null);
    expect(previewLabel?.parentElement?.querySelector('.lucide-rocket')).toBeInTheDocument();
  });

  it('displays and searches localized Spanish icon names', () => {
    mockUseAppStore.mockImplementation(((selector?: (s: unknown) => unknown) => {
      const state = {
        language: 'es',
        pluginCustomIcons: { 'com.example.test-plugin': 'rocket' },
        setPluginCustomIcon: vi.fn(),
      };
      return selector ? selector(state) : state;
    }) as unknown as typeof useAppStore);

    render(
      <PluginIconPickerDialog
        target={dummyPlugin}
        t={t}
        onClose={vi.fn()}
      />
    );

    expect(screen.getAllByText('Cohete / Publicación')).toHaveLength(2);

    const searchInput = screen.getByPlaceholderText('Search icons…');
    fireEvent.change(searchInput, { target: { value: 'cohete' } });

    expect(screen.getByRole('button', { name: /Cohete/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Bot/i })).not.toBeInTheDocument();
  });

  it('uses the Plug fallback label and selection for unknown icon keys', () => {
    mockUseAppStore.mockImplementation(((selector?: (s: unknown) => unknown) => {
      const state = {
        language: 'en',
        pluginCustomIcons: { 'com.example.test-plugin': 'lucide:unknown-icon' },
        setPluginCustomIcon: vi.fn(),
      };
      return selector ? selector(state) : state;
    }) as unknown as typeof useAppStore);

    render(
      <PluginIconPickerDialog
        target={dummyPlugin}
        t={t}
        onClose={vi.fn()}
      />
    );

    expect(screen.queryByText(/lucide:unknown-icon/)).not.toBeInTheDocument();
    expect(screen.getAllByText('Plug')).toHaveLength(2);

    const plugBtn = screen.getByRole('button', { name: 'Plug' });
    expect(plugBtn).toHaveAttribute('aria-pressed', 'true');
    expect(plugBtn.querySelector('.lucide-plug')).toBeInTheDocument();
    const previewLabel = screen
      .getAllByText('Plug')
      .find((node) => node.closest('button') === null);
    expect(previewLabel?.parentElement?.querySelector('.lucide-plug')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset icon' })).toBeInTheDocument();
  });

  it('treats an empty normalized icon key as the Plug fallback', () => {
    mockUseAppStore.mockImplementation(((selector?: (s: unknown) => unknown) => {
      const state = {
        language: 'en',
        pluginCustomIcons: { 'com.example.test-plugin': 'lucide:' },
        setPluginCustomIcon: vi.fn(),
      };
      return selector ? selector(state) : state;
    }) as unknown as typeof useAppStore);

    render(
      <PluginIconPickerDialog
        target={dummyPlugin}
        t={t}
        onClose={vi.fn()}
      />
    );

    expect(screen.queryByText('Default icon')).not.toBeInTheDocument();
    expect(screen.getAllByText('Plug')).toHaveLength(2);
    const previewLabel = screen
      .getAllByText('Plug')
      .find((node) => node.closest('button') === null);
    expect(previewLabel?.parentElement?.querySelector('.lucide-plug')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Plug' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Reset icon' })).toBeInTheDocument();
  });

  it('shows no selected icon when no custom icon is configured', () => {
    mockUseAppStore.mockImplementation(((selector?: (s: unknown) => unknown) => {
      const state = {
        language: 'en',
        pluginCustomIcons: {},
        setPluginCustomIcon: vi.fn(),
      };
      return selector ? selector(state) : state;
    }) as unknown as typeof useAppStore);

    render(
      <PluginIconPickerDialog
        target={dummyPlugin}
        t={t}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Default icon')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Plug' })).toHaveAttribute('aria-pressed', 'false');
    expect(
      screen.getAllByRole('button').filter((button) => button.getAttribute('aria-pressed') === 'true'),
    ).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Reset icon' })).not.toBeInTheDocument();
  });

  it('displays full Chinese labels and localized preview when language is zh', () => {
    mockUseAppStore.mockImplementation(((selector?: (s: unknown) => unknown) => {
      const state = {
        language: 'zh',
        pluginCustomIcons: { 'com.example.test-plugin': 'rocket' },
        setPluginCustomIcon: vi.fn(),
      };
      return selector ? selector(state) : state;
    }) as unknown as typeof useAppStore);

    render(
      <PluginIconPickerDialog
        target={dummyPlugin}
        t={t}
        onClose={vi.fn()}
      />
    );

    const rocketBtn = screen.getByRole('button', { name: /火箭 \/ 发布/i });
    expect(rocketBtn).toHaveAttribute('aria-pressed', 'true');
    expect(rocketBtn).toHaveTextContent('火箭 / 发布');

    // Both the preview and the grid button label display '火箭 / 发布'
    expect(screen.getAllByText('火箭 / 发布')).toHaveLength(2);
  });
});
