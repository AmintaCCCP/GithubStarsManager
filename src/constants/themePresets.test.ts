import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME_PRESET_ID,
  THEME_PRESETS,
  getThemePreset,
  isThemePresetId,
} from './themePresets';
import { GENERATED_THEME_PRESETS } from './themePresets.generated';

const TRIPLET_RE = /^\d+(\.\d+)? \d+(\.\d+)?% \d+(\.\d+)?%$/;
const PALETTE_KEYS = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
  'border',
  'border-strong',
  'input',
  'ring',
] as const;

describe('themePresets registry', () => {
  it('starts with the default preset and contains the generated presets', () => {
    expect(THEME_PRESETS[0].id).toBe(DEFAULT_THEME_PRESET_ID);
    const ids = THEME_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const generated of GENERATED_THEME_PRESETS) {
      expect(ids).toContain(generated.id);
    }
  });

  it('provides complete HSL-triplet palettes for every preset and mode', () => {
    for (const preset of THEME_PRESETS) {
      for (const palette of [preset.lightColors, preset.darkColors]) {
        for (const key of PALETTE_KEYS) {
          expect(palette[key], `${preset.id}.${key}`).toMatch(TRIPLET_RE);
        }
      }
    }
  });

  it('keeps light/dark palettes distinct', () => {
    for (const preset of THEME_PRESETS) {
      expect(preset.darkColors.background, preset.id).not.toBe(preset.lightColors.background);
    }
  });

  it('validates ids through isThemePresetId', () => {
    expect(isThemePresetId('twitter')).toBe(true);
    expect(isThemePresetId(DEFAULT_THEME_PRESET_ID)).toBe(true);
    expect(isThemePresetId('does-not-exist')).toBe(false);
    expect(isThemePresetId(42)).toBe(false);
  });

  it('falls back to the default preset in getThemePreset', () => {
    expect(getThemePreset('default').id).toBe('default');
    // Unknown id: runtime guard prevents this, but the helper must stay safe.
    expect(getThemePreset('nope' as never).id).toBe('default');
  });
});
