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

import { ThemeSettingsCard } from './ThemeSettingsCard';

const t = (zh: string) => zh;

beforeEach(() => {
  Object.assign(mocks.state, {
    theme: 'dark',
    themePreset: 'default',
    setTheme: vi.fn((mode: 'light' | 'dark') => setStateTheme(mode)),
    setThemePreset: vi.fn((preset: string) => {
      mocks.state.themePreset = preset;
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
    expect(within(presetGroup).getAllByRole('radio')).toHaveLength(12);
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
    await user.click(screen.getByRole('radio', { name: /Twitter/ }));
    expect(mocks.state.themePreset).toBe('twitter');
    expect(mocks.state.theme).toBe('dark');
  });

  it('switches display mode through the mode radio group', async () => {
    const user = userEvent.setup();
    render(<ThemeSettingsCard t={t} />);
    await user.click(screen.getByText('浅色'));
    expect(mocks.state.theme).toBe('light');
  });
});
