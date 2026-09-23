import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The global test setup mocks the app store module, so this suite installs its
 * own controllable double that mimics the tiny slice of store behavior the
 * card needs (theme/themePreset plus their setters). Real store logic is
 * covered in useAppStore.test.ts.
 */
const mocks = vi.hoisted(() => {
  const state: Record<string, unknown> = {};
  const setState = (partial: Record<string, unknown> | ((s: Record<string, unknown>) => Record<string, unknown>)) => {
    Object.assign(state, typeof partial === 'function' ? partial(state) : partial);
  };
  const useAppStore = Object.assign(
    (selector?: (s: Record<string, unknown>) => unknown) => (selector ? selector(state) : state),
    { getState: () => state, setState },
  );
  return { state, useAppStore };
});

vi.mock('../../store/useAppStore', () => ({ useAppStore: mocks.useAppStore }));

import { makeT } from '../../i18n/useT';
import { ThemeSettingsCard } from './ThemeSettingsCard';
import { THEME_PRESETS } from '../../constants/themePresets';

const t = makeT('zh', 'app');

beforeEach(() => {
  Object.assign(mocks.state, {
    language: 'zh',
    theme: 'dark',
    themePreset: 'default',
    setTheme: vi.fn((mode: 'light' | 'dark') => setStateTheme(mode)),
    setThemePreset: vi.fn((preset: string) => {
      mocks.state.themePreset = preset;
    }),
    // Theme token（开发守则 §14）：局部更新，内部与当前值合并
    themeTokens: { accentColor: null, fontScale: 1, radius: 'default', animation: 'normal' },
    updateThemeTokens: vi.fn((patch: Record<string, unknown>) => {
      mocks.state.themeTokens = { ...(mocks.state.themeTokens as Record<string, unknown>), ...patch };
    }),
  });
});

function setStateTheme(mode: 'light' | 'dark') {
  mocks.state.theme = mode;
}

describe('ThemeSettingsCard', () => {
  it('renders every registered preset as a radio option', () => {
    render(<ThemeSettingsCard t={t} />);
    const presetGroup = screen.getByRole('radiogroup', { name: '主题配色' });
    expect(presetGroup).toBeTruthy();
    expect(within(presetGroup).getAllByRole('radio')).toHaveLength(THEME_PRESETS.length);
  });

  it('keeps a single tab stop inside the preset radiogroup (roving tabindex)', () => {
    render(<ThemeSettingsCard t={t} />);
    const presetGroup = screen.getByRole('radiogroup', { name: '主题配色' });
    const radios = within(presetGroup).getAllByRole('radio');
    expect(radios.filter((el) => el.getAttribute('tabindex') === '0')).toHaveLength(1);
  });

  it('selects the focused preset when navigating with arrow keys', async () => {
    const user = userEvent.setup();
    render(<ThemeSettingsCard t={t} />);
    const presetGroup = screen.getByRole('radiogroup', { name: '主题配色' });
    const radios = within(presetGroup).getAllByRole('radio');
    radios[0].focus();
    await user.keyboard('{ArrowRight}');
    expect(mocks.state.themePreset).toBe(THEME_PRESETS[1].id);
  });

  it('marks exactly one preset active by default', () => {
    render(<ThemeSettingsCard t={t} />);
    const presetGroup = screen.getByRole('radiogroup', { name: '主题配色' });
    const checked = within(presetGroup)
      .getAllByRole('radio')
      .filter((el) => el.getAttribute('aria-checked') === 'true');
    expect(checked).toHaveLength(1);
  });

  it('switches presets on click and persists through the store action', async () => {
    const user = userEvent.setup();
    render(<ThemeSettingsCard t={t} />);
    await user.click(screen.getByRole('radio', { name: /深邃紫/ }));
    expect(mocks.state.themePreset).toBe('deep-purple');
    expect(mocks.state.theme).toBe('dark');
  });

  it('switches display mode through the mode radio group', async () => {
    const user = userEvent.setup();
    render(<ThemeSettingsCard t={t} />);
    await user.click(screen.getByText('浅色'));
    expect(mocks.state.theme).toBe('light');
  });

  it('writes theme tokens through the store action', async () => {
    const user = userEvent.setup();
    render(<ThemeSettingsCard t={t} />);

    await user.click(screen.getByRole('button', { name: '绿色 (#16a34a)' }));
    expect(mocks.state.themeTokens).toMatchObject({ accentColor: '#16a34a', radius: 'default' });

    await user.selectOptions(screen.getByRole('combobox', { name: '圆角' }), 'large');
    expect(mocks.state.themeTokens).toMatchObject({ accentColor: '#16a34a', radius: 'large' });

    await user.selectOptions(screen.getByRole('combobox', { name: '字号' }), '1.25');
    expect(mocks.state.themeTokens).toMatchObject({ fontScale: 1.25 });

    await user.click(screen.getByRole('switch', { name: '减弱动效' }));
    expect(mocks.state.themeTokens).toMatchObject({ animation: 'reduced' });
  });

  it.each([1.5, 1.13])('shows a persisted font scale of %s', (fontScale) => {
    mocks.state.themeTokens = { accentColor: null, fontScale, radius: 'default', animation: 'normal' };
    render(<ThemeSettingsCard t={t} />);

    expect(screen.getByRole('combobox', { name: '字号' })).toHaveValue(String(fontScale));
    expect((screen.getByRole('option', { name: `${Math.round(fontScale * 100)}%` }) as HTMLOptionElement).selected).toBe(true);
  });

  it('labels palette colors and shows the active preset color in the picker', () => {
    render(<ThemeSettingsCard t={t} />);

    expect(screen.getByRole('button', { name: '蓝色 (#2563eb)' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByLabelText('自定义强调色')).toHaveValue('#f8fafc');
  });

  it('resets every token back to the presets', async () => {
    const user = userEvent.setup();
    mocks.state.themeTokens = { accentColor: '#2563eb', fontScale: 1.25, radius: 'large', animation: 'reduced' };
    render(<ThemeSettingsCard t={t} />);

    await user.click(screen.getByRole('button', { name: '恢复默认外观' }));

    expect(mocks.state.themeTokens).toEqual({ accentColor: null, fontScale: 1, radius: 'default', animation: 'normal' });
  });
});
