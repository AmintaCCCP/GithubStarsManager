import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BulkActionToolbar } from './BulkActionToolbar';
import { useAppStore } from '../store/useAppStore';

vi.mock('../store/useAppStore', () => ({
  useAppStore: vi.fn(),
}));

const plugins = vi.hoisted(() => ({ actions: [] as Record<string, string>[], exporters: [] }));

vi.mock('../plugins/hooks/usePluginActions', () => ({
  usePluginActions: () => ({ actions: plugins.actions }),
}));

vi.mock('../plugins/hooks/usePluginExporters', () => ({
  usePluginExporters: () => ({ exporters: plugins.exporters }),
}));

vi.mock('../hooks/useDialog', () => ({
  useDialog: () => ({ toast: vi.fn() }),
}));

const mockUseAppStore = vi.mocked(useAppStore);

beforeEach(() => {
  plugins.actions = [];
  mockUseAppStore.mockImplementation(((selector?: (state: { language: 'en' }) => unknown) => {
    const state = { language: 'en' as const };
    return selector ? selector(state) : state;
  }) as typeof useAppStore);
});

describe('BulkActionToolbar mobile layout', () => {
  it('contains its action strip and gives named actions 44px mobile targets', () => {
    const { container } = render(
      <BulkActionToolbar
        selectedCount={1}
        repositories={[]}
        onSelectAll={vi.fn()}
        onDeselectAll={vi.fn()}
        onBulkAction={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
      />,
    );

    expect(container.firstElementChild).toHaveClass('pb-[calc(0.75rem+env(safe-area-inset-bottom))]', 'max-w-full');
    expect(screen.getByTestId('bulk-action-strip')).toHaveClass('w-full', 'max-w-full', 'overflow-x-auto', 'touch-pan-x');
    for (const name of [
      'Select All',
      'Deselect All',
      'Unstar selected repositories',
      'Categorize selected repositories',
      'Generate AI summaries',
      'Subscribe to releases',
      'Unsubscribe from releases',
      'Lock categories',
      'Unlock categories',
      'Bulk Restore',
      'Close toolbar',
    ]) {
      expect(screen.getByRole('button', { name })).toHaveClass('min-h-11', 'min-w-11');
    }
    expect(screen.getByRole('button', { name: 'Unstar selected repositories' })).toHaveClass('sm:h-10', 'sm:w-10');
  });

  it('keeps the upstream plugin action touch-safe and desktop-compact', () => {
    plugins.actions = [{ id: 'action', title: 'Plugin action', pluginId: 'plugin', pluginName: 'Plugin' }];

    render(
      <BulkActionToolbar
        selectedCount={1}
        repositories={[]}
        onSelectAll={vi.fn()}
        onDeselectAll={vi.fn()}
        onBulkAction={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Plugin actions' })).toHaveClass('h-11', 'w-11', 'sm:h-10', 'sm:w-10');
  });
});
