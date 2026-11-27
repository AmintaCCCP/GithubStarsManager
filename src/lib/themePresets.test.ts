import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  THEME_STYLE_TAG_ID,
  applyThemePreset,
  buildThemePresetCss,
  ensureThemeStyleTag,
  getThemeSwatch,
} from './themePresets';
import { DEFAULT_THEME_PRESET_ID, THEME_PRESETS } from '../constants/themePresets';
import { cn } from './utils';

describe('themePresets injector', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  it('emits light and dark blocks for every non-default preset', () => {
    const css = buildThemePresetCss();
    const presets = THEME_PRESETS.filter((p) => p.id !== DEFAULT_THEME_PRESET_ID);
    for (const preset of presets) {
      expect(css).toContain(`[data-theme='${preset.id}']`);
      expect(css).toContain(`html.dark[data-theme='${preset.id}']`);
    }
    expect(css).not.toContain(`[data-theme='${DEFAULT_THEME_PRESET_ID}']`);
  });

  it('emits radius, all font families and shadow variables for themed presets', () => {
    const css = buildThemePresetCss();
    expect(css).toContain('--radius:');
    expect(css).toContain('--font-sans:');
    expect(css).toContain('--font-mono:');
    expect(css).toContain('--font-serif:');
    expect(css).toContain('--app-shadow-subtle:');
  });

  it('injects the style tag exactly once and keeps its content', () => {
    ensureThemeStyleTag();
    ensureThemeStyleTag();
    const tags = document.querySelectorAll(`style#${THEME_STYLE_TAG_ID}`);
    expect(tags).toHaveLength(1);
    expect(tags[0].textContent).toContain('[data-theme=');
  });

  it('sets data-theme for a known preset and clears it for the default', () => {
    const root = document.documentElement;
    applyThemePreset('tokyo-night', root);
    expect(root.getAttribute('data-theme')).toBe('tokyo-night');
    applyThemePreset(DEFAULT_THEME_PRESET_ID, root);
    expect(root.hasAttribute('data-theme')).toBe(false);
  });

  it('clears data-theme for unknown ids (defensive)', () => {
    const root = document.documentElement;
    root.setAttribute('data-theme', 'tokyo-night');
    applyThemePreset('nope' as never, root);
    expect(root.hasAttribute('data-theme')).toBe(false);
  });

  it('resolves swatch colors for the active mode', () => {
    const preset = THEME_PRESETS.find((p) => p.id === 'tokyo-night')!;
    const light = getThemeSwatch(preset, false);
    const dark = getThemeSwatch(preset, true);
    expect(light.background).toMatch(/^hsl\(/);
    expect(dark.background).toMatch(/^hsl\(/);
    expect(light.background).not.toBe(dark.background);
  });

  it('preserves custom typography classes alongside text color classes in cn()', () => {
    expect(cn('text-label-sm', 'text-secondary')).toBe('text-label-sm text-secondary');
    expect(cn('text-label bg-accent-solid text-on-accent', 'h-control-sm text-label-sm')).toBe(
      'bg-accent-solid text-on-accent h-control-sm text-label-sm',
    );
    expect(cn('h-control px-2.5', 'h-auto min-h-row-sidebar')).toBe('px-2.5 h-auto min-h-row-sidebar');
    expect(cn('size-control', 'size-9')).toBe('size-9');
    expect(cn('h-control', 'h-9')).toBe('h-9');
  });
});
