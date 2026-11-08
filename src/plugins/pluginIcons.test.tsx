import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Bot, Plug, Rocket, Sparkles } from 'lucide-react';
import {
  PLUGIN_ICON_CHOICES,
  getPluginIcon,
  normalizePluginIconKey,
} from './pluginIcons';
import { PluginIcon } from './PluginIcon';
import { useAppStore } from '../store/useAppStore';

const mockUseAppStore = vi.mocked(useAppStore);

describe('pluginIcons', () => {
  it('normalizes icon keys correctly', () => {
    expect(normalizePluginIconKey('lucide:rocket')).toBe('rocket');
    expect(normalizePluginIconKey('  BOT  ')).toBe('bot');
    expect(normalizePluginIconKey(null)).toBe('');
    expect(normalizePluginIconKey(undefined)).toBe('');
  });

  it('resolves icons by key and falls back to Plug', () => {
    expect(getPluginIcon('rocket')).toBe(Rocket);
    expect(getPluginIcon('lucide:bot')).toBe(Bot);
    expect(getPluginIcon('sparkles')).toBe(Sparkles);
    expect(getPluginIcon('unknown-non-existent')).toBe(Plug);
    expect(getPluginIcon('')).toBe(Plug);
    expect(getPluginIcon(null)).toBe(Plug);
  });

  it('contains expected built-in choices', () => {
    expect(PLUGIN_ICON_CHOICES.length).toBeGreaterThanOrEqual(40);
    const keys = new Set(PLUGIN_ICON_CHOICES.map((c) => c.key));
    expect(keys.has('plug')).toBe(true);
    expect(keys.has('bot')).toBe(true);
    expect(keys.has('rocket')).toBe(true);
    expect(keys.has('sparkles')).toBe(true);
    expect(keys.has('code')).toBe(true);
  });

  it('renders custom icon when configured in app store', () => {
    const pluginId = 'test-plugin-id';
    mockUseAppStore.mockImplementation(((selector?: (s: unknown) => unknown) => {
      const state = {
        pluginCustomIcons: { [pluginId]: 'rocket' },
      };
      return selector ? selector(state) : state;
    }) as unknown as typeof useAppStore);

    const { container } = render(<PluginIcon pluginId={pluginId} data-testid="plugin-icon" />);
    expect(container.querySelector('.lucide-rocket')).toBeInTheDocument();
  });

  it('falls back to default Plug when no custom icon or prop is set', () => {
    mockUseAppStore.mockImplementation(((selector?: (s: unknown) => unknown) => {
      const state = {
        pluginCustomIcons: {},
      };
      return selector ? selector(state) : state;
    }) as unknown as typeof useAppStore);

    const { container } = render(<PluginIcon pluginId="no-custom" data-testid="plugin-icon" />);
    expect(container.querySelector('.lucide-plug')).toBeInTheDocument();
  });

  it('uses icon prop when pluginId has no custom icon in store', () => {
    mockUseAppStore.mockImplementation(((selector?: (s: unknown) => unknown) => {
      const state = {
        pluginCustomIcons: {},
      };
      return selector ? selector(state) : state;
    }) as unknown as typeof useAppStore);

    const { container } = render(<PluginIcon pluginId="no-custom" icon="sparkles" />);
    expect(container.querySelector('.lucide-sparkles')).toBeInTheDocument();
  });
});
