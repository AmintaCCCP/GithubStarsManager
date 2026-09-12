import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME_PRESET_ID,
  THEME_PRESETS,
  getThemePreset,
  isThemePresetId,
} from './themePresets';
import { GENERATED_THEME_PRESETS } from './themePresets.generated';
import { buildThemePresetCss } from '../lib/themePresets';

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
  'selection',
  'selection-foreground',
  'search-highlight',
] as const;

/** HSL triplet ("H S% L%") to sRGB channels in [0, 255]. */
function tripletToRgb(triplet: string): [number, number, number] {
  const [h, s, l] = triplet.split(/\s+/).map((part) => Number.parseFloat(part) / (part.includes('%') ? 100 : 360));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hue = h * 360;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const rgb: [number, number, number] =
    hue < 60 ? [c, x, 0]
    : hue < 120 ? [x, c, 0]
    : hue < 180 ? [0, c, x]
    : hue < 240 ? [0, x, c]
    : hue < 300 ? [x, 0, c]
    : [c, 0, x];
  return rgb.map((channel) => (channel + m) * 255) as [number, number, number];
}

/** WCAG 2.1 relative luminance of an sRGB color. */
function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((channel) => {
    const v = channel / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [l1, l2] = [relativeLuminance(tripletToRgb(a)), relativeLuminance(tripletToRgb(b))].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

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
    expect(isThemePresetId('deep-purple')).toBe(true);
    expect(isThemePresetId(DEFAULT_THEME_PRESET_ID)).toBe(true);
    expect(isThemePresetId('does-not-exist')).toBe(false);
    expect(isThemePresetId(42)).toBe(false);
  });

  it('derives selection fills visible on every text surface with readable text on top', () => {
    // Guards issue #348: zen-inspired light shipped accent ≈ card, rendering
    // ::selection invisible. The generated fills must keep clearing these
    // invariants for every preset and mode.
    const surfaces = ['background', 'card', 'popover', 'secondary', 'muted'] as const;
    for (const preset of THEME_PRESETS) {
      for (const [mode, palette] of [
        ['light', preset.lightColors],
        ['dark', preset.darkColors],
      ] as const) {
        for (const surface of surfaces) {
          expect(
            contrast(palette.selection, palette[surface]),
            `${preset.id}/${mode}: selection vs ${surface}`,
          ).toBeGreaterThanOrEqual(1.5);
        }
        expect(
          contrast(palette['selection-foreground'], palette.selection),
          `${preset.id}/${mode}: text on selection`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('derives search highlights visible on card and canvas with readable text', () => {
    for (const preset of THEME_PRESETS) {
      for (const [mode, palette] of [
        ['light', preset.lightColors],
        ['dark', preset.darkColors],
      ] as const) {
        for (const surface of ['card', 'background'] as const) {
          expect(
            contrast(palette['search-highlight'], palette[surface]),
            `${preset.id}/${mode}: highlight vs ${surface}`,
          ).toBeGreaterThanOrEqual(1.25);
        }
        expect(
          contrast(palette.foreground, palette['search-highlight']),
          `${preset.id}/${mode}: text on highlight`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('falls back to the default preset in getThemePreset', () => {
    expect(getThemePreset('default').id).toBe('default');
    // Unknown id: runtime guard prevents this, but the helper must stay safe.
    expect(getThemePreset('nope' as never).id).toBe('default');
  });

  it('generates strictly increasing shadow elevation tiers for all presets', () => {
    const css = buildThemePresetCss();
    for (const preset of THEME_PRESETS) {
      if (preset.id === DEFAULT_THEME_PRESET_ID) continue;
      const subtleMatch = css.match(new RegExp(`\\[data-theme='${preset.id}'\\][\\s\\S]*?--shadow-opacity: ([0-9.]+);`));
      const elevatedMatch = css.match(new RegExp(`\\[data-theme='${preset.id}'\\][\\s\\S]*?--app-shadow-elevated: 0 12px 32px hsl\\(var\\(--shadow-color\\) / ([0-9.]+)\\)`));
      const dialogMatch = css.match(new RegExp(`\\[data-theme='${preset.id}'\\][\\s\\S]*?--app-shadow-dialog: 0 20px 48px hsl\\(var\\(--shadow-color\\) / ([0-9.]+)\\)`));
      expect(subtleMatch, `subtle opacity for ${preset.id}`).not.toBeNull();
      expect(elevatedMatch, `elevated opacity for ${preset.id}`).not.toBeNull();
      expect(dialogMatch, `dialog opacity for ${preset.id}`).not.toBeNull();
      const subtle = parseFloat(subtleMatch![1]);
      const elevated = parseFloat(elevatedMatch![1]);
      const dialog = parseFloat(dialogMatch![1]);
      expect(subtle, `subtle < elevated for ${preset.id}`).toBeLessThan(elevated);
      expect(elevated, `elevated < dialog for ${preset.id}`).toBeLessThan(dialog);
    }
  });
});
