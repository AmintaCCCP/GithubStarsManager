import { GENERATED_THEME_PRESETS } from './themePresets.generated';
import type { GeneratedThemePalette } from './themePresets.generated';

/**
 * Curated desktop theme registry.
 *
 * Palettes for non-default presets come from the generated palette registry
 * (see scripts/generate-theme-presets.mjs). The default preset mirrors the
 * base CSS variables in src/index.css so it always matches the stylesheet.
 */

export const DEFAULT_THEME_PRESET_ID = 'default' as const;

export const THEME_PRESET_IDS = [
  DEFAULT_THEME_PRESET_ID,
  'catppuccin',
  'dracula',
  'ghostty',
  'github',
  'gruvbox',
  'haze',
  'night-owl',
  'nord',
  'one-dark-pro',
  'paper',
  'pierre',
  'rose-pine',
  'solarized',
  'tokyo-night',
  'vitesse',
] as const;

export type ThemePresetId = (typeof THEME_PRESET_IDS)[number];

/**
 * Maps removed legacy preset IDs to their closest curated replacement so
 * persisted user selections migrate seamlessly instead of dropping to default.
 */
export const LEGACY_THEME_PRESET_ALIASES: Record<string, ThemePresetId> = {
  'enterprise-mod-2': 'github',
  'light-green': 'vitesse',
  claude: 'paper',
  vercel: 'default',
  't3-chat': 'rose-pine',
  'deep-purple': 'haze',
  openprofile: 'paper',
  autoblog: 'gruvbox',
  'zen-inspired': 'solarized',
  'logistic-one': 'nord',
  whatsapp: 'vitesse',
};

export interface ThemePreset {
  id: ThemePresetId;
  labelZh: string;
  labelEn: string;
  lightColors: GeneratedThemePalette;
  darkColors: GeneratedThemePalette;
  /** Optional per-theme radius override (CSS length). */
  radius?: string;
  fontSans?: string;
  fontMono?: string;
  fontSerif?: string;
  shadowColor?: string;
  shadowOpacity?: number;
  /** Canonical box-shadow shared by subtle/elevated/dialog elevation tokens. */
  shadow?: string;
}

const DEFAULT_LIGHT_COLORS: GeneratedThemePalette = {
  background: '210 10% 95.3%',
  foreground: '210 7.1% 11%',
  card: '210 33.3% 99.2%',
  'card-foreground': '210 7.1% 11%',
  popover: '210 33.3% 99.2%',
  'popover-foreground': '210 7.1% 11%',
  primary: '222.2 47.4% 11.2%',
  'primary-foreground': '210 40% 98%',
  secondary: '210 10% 96.1%',
  'secondary-foreground': '210 7.1% 11%',
  muted: '210 10% 96.1%',
  'muted-foreground': '200 1.6% 37.1%',
  accent: '210 11.1% 92.9%',
  'accent-foreground': '210 7.1% 11%',
  destructive: '0 72% 51%',
  'destructive-foreground': '0 0% 100%',
  border: '210 9% 89%',
  'border-strong': '210 8% 80%',
  input: '210 9% 89%',
  ring: '222.2 84% 4.9%',
  selection: '222.2 42% 64%',
  'selection-foreground': '210 7.1% 11%',
  'search-highlight': '222.2 28.4% 72.8%',
};

const DEFAULT_DARK_COLORS: GeneratedThemePalette = {
  background: '220 10.7% 5.5%',
  foreground: '220 9.1% 93.1%',
  card: '220 6.7% 8.8%',
  'card-foreground': '220 9.1% 93.1%',
  popover: '220 4.5% 12.6%',
  'popover-foreground': '220 9.1% 93.1%',
  primary: '210 40% 98%',
  'primary-foreground': '222.2 47.4% 11.2%',
  secondary: '220 5.5% 10.8%',
  'secondary-foreground': '220 9.1% 93.1%',
  muted: '220 8.1% 7.3%',
  'muted-foreground': '220 2.5% 62.2%',
  accent: '220 5.3% 14.9%',
  'accent-foreground': '220 9.1% 93.1%',
  destructive: '0 63% 44%',
  'destructive-foreground': '220 9.1% 93.1%',
  border: '220 5.3% 15.7%',
  'border-strong': '220 5% 24.5%',
  input: '220 5.3% 15.7%',
  ring: '212.7 26.8% 83.9%',
  selection: '210 40% 40%',
  'selection-foreground': '220 9.1% 93.1%',
  'search-highlight': '210 24% 29.6%',
};

const DEFAULT_PRESET: ThemePreset = {
  id: DEFAULT_THEME_PRESET_ID,
  labelZh: '默认',
  labelEn: 'Default',
  lightColors: DEFAULT_LIGHT_COLORS,
  darkColors: DEFAULT_DARK_COLORS,
};

/** Labels for generated presets, keyed by id. */
const GENERATED_LABELS_ZH: Record<string, string> = {
  catppuccin: 'Catppuccin',
  dracula: 'Dracula',
  ghostty: 'Ghostty',
  github: 'GitHub',
  gruvbox: 'Gruvbox',
  haze: 'Haze 雾霭',
  'night-owl': 'Night Owl',
  nord: 'Nord 极光蓝',
  'one-dark-pro': 'One Dark Pro',
  paper: 'Paper 纸墨',
  pierre: 'Pierre',
  'rose-pine': 'Rosé Pine',
  solarized: 'Solarized',
  'tokyo-night': 'Tokyo Night',
  vitesse: 'Vitesse',
};

/**
 * Ordered registry: curated display order, not alphabetical.
 * Generated presets missing from the curated order are appended so data and
 * registry can never drift apart silently.
 */
export const THEME_PRESETS: ThemePreset[] = (() => {
  const byId = new Map(GENERATED_THEME_PRESETS.map((p) => [p.id, p]));
  const ordered: ThemePreset[] = [DEFAULT_PRESET];
  for (const id of THEME_PRESET_IDS) {
    if (id === DEFAULT_THEME_PRESET_ID) continue;
    const generated = byId.get(id);
    if (!generated) {
      throw new Error(`themePresets: generated preset "${id}" is missing — rerun npm run gen:themes`);
    }
    ordered.push({
      id,
      labelZh: GENERATED_LABELS_ZH[id] ?? generated.labelEn,
      labelEn: generated.labelEn,
      lightColors: generated.lightColors,
      darkColors: generated.darkColors,
      radius: generated.radius,
      fontSans: generated.fontSans,
      fontMono: generated.fontMono,
      fontSerif: generated.fontSerif,
      shadowColor: generated.shadowColor,
      shadowOpacity: generated.shadowOpacity,
      shadow: generated.shadow,
    });
    byId.delete(id);
  }
  // Anything generated but not curated still ships (forward compatibility).
  for (const generated of byId.values()) {
    ordered.push({
      id: generated.id as ThemePresetId,
      labelZh: GENERATED_LABELS_ZH[generated.id] ?? generated.labelEn,
      labelEn: generated.labelEn,
      lightColors: generated.lightColors,
      darkColors: generated.darkColors,
      radius: generated.radius,
      fontSans: generated.fontSans,
      fontMono: generated.fontMono,
      fontSerif: generated.fontSerif,
      shadowColor: generated.shadowColor,
      shadowOpacity: generated.shadowOpacity,
      shadow: generated.shadow,
    });
  }
  return ordered;
})();

/**
 * Look up a theme preset by its identifier, falling back to the default preset.
 *
 * @param id The theme preset identifier to look up.
 * @returns The matching ThemePreset or default preset.
 */
export function getThemePreset(id: ThemePresetId): ThemePreset {
  const preset = THEME_PRESETS.find((p) => p.id === id);
  return preset ?? DEFAULT_PRESET;
}

/** Runtime guard based on the live registry (covers forward-added presets). */
export function isThemePresetId(value: unknown): value is ThemePresetId {
  return typeof value === 'string' && THEME_PRESETS.some((p) => p.id === value);
}

/**
 * Resolve a persisted preset identifier, including legacy removed IDs, to a
 * current ThemePresetId. Returns `null` when the value is unknown — use this
 * when "absent" must stay distinct from the default (e.g. backup import).
 */
export function resolveKnownThemePresetId(value: unknown): ThemePresetId | null {
  if (isThemePresetId(value)) return value;
  if (typeof value === 'string' && Object.prototype.hasOwnProperty.call(LEGACY_THEME_PRESET_ALIASES, value)) {
    return LEGACY_THEME_PRESET_ALIASES[value];
  }
  return null;
}

/**
 * Resolve a persisted theme preset identifier (including legacy removed IDs)
 * to a valid current ThemePresetId, falling back when unknown.
 */
export function resolveThemePresetId(
  value: unknown,
  fallback: ThemePresetId = DEFAULT_THEME_PRESET_ID,
): ThemePresetId {
  return resolveKnownThemePresetId(value) ?? fallback;
}
