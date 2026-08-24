import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  THEME_STYLE_TAG_ID,
  applyThemePreset,
  buildThemePresetCss,
  ensureThemeStyleTag,
  getThemeSwatch,
} from './themePresets';
import { DEFAULT_THEME_PRESET_ID, THEME_PRESETS } from '../constants/themePresets';

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

  it('emits radius, font and shadow variables for themed presets', () => {
    const css = buildThemePresetCss();
    expect(css).toContain('--radius:');
    expect(css).toContain('--font-sans:');
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
    applyThemePreset('deep-purple', root);
    expect(root.getAttribute('data-theme')).toBe('deep-purple');
    applyThemePreset(DEFAULT_THEME_PRESET_ID, root);
    expect(root.hasAttribute('data-theme')).toBe(false);
  });

  it('clears data-theme for unknown ids (defensive)', () => {
    const root = document.documentElement;
    root.setAttribute('data-theme', 'deep-purple');
    applyThemePreset('nope' as never, root);
    expect(root.hasAttribute('data-theme')).toBe(false);
  });

  it('resolves swatch colors for the active mode', () => {
    const preset = THEME_PRESETS.find((p) => p.id === 'deep-purple')!;
    const light = getThemeSwatch(preset, false);
    const dark = getThemeSwatch(preset, true);
    expect(light.background).toMatch(/^hsl\(/);
    expect(dark.background).toMatch(/^hsl\(/);
    expect(light.background).not.toBe(dark.background);
  });
});
