import { GENERATED_THEME_PRESETS } from './themePresets.generated';
import type { GeneratedThemePalette } from './themePresets.generated';

/**
 * Curated theme registry.
 *
 * Palettes for non-default presets come from the generated tweakcn subset
 * (see scripts/generate-theme-presets.mjs). The default preset mirrors the
 * shadcn variables in src/index.css so it always matches the stylesheet.
 */

export const DEFAULT_THEME_PRESET_ID = 'default' as const;

export const THEME_PRESET_IDS = [
  DEFAULT_THEME_PRESET_ID,
  'enterprise-mod-2',
  'light-green',
  'claude',
  'vercel',
  't3-chat',
  'deep-purple',
  'openprofile',
  'autoblog',
  'zen-inspired',
  'logistic-one',
  'whatsapp',
] as const;

export type ThemePresetId = (typeof THEME_PRESET_IDS)[number];

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
  background: '0 0% 100%',
  foreground: '222.2 84% 4.9%',
  card: '0 0% 100%',
  'card-foreground': '222.2 84% 4.9%',
  popover: '0 0% 100%',
  'popover-foreground': '222.2 84% 4.9%',
  primary: '222.2 47.4% 11.2%',
  'primary-foreground': '210 40% 98%',
  secondary: '210 40% 96.1%',
  'secondary-foreground': '222.2 47.4% 11.2%',
  muted: '210 40% 96.1%',
  'muted-foreground': '215.4 16.3% 46.9%',
  accent: '210 40% 92%',
  'accent-foreground': '222.2 47.4% 11.2%',
  destructive: '0 84.2% 60.2%',
  'destructive-foreground': '210 40% 98%',
  border: '214.3 31.8% 91.4%',
  'border-strong': '214.3 25% 80%',
  input: '214.3 31.8% 91.4%',
  ring: '222.2 84% 4.9%',
};

const DEFAULT_DARK_COLORS: GeneratedThemePalette = {
  background: '222.2 84% 4.9%',
  foreground: '210 40% 98%',
  card: '222.2 47.4% 11.2%',
  'card-foreground': '210 40% 98%',
  popover: '222.2 47.4% 11.2%',
  'popover-foreground': '210 40% 98%',
  primary: '210 40% 98%',
  'primary-foreground': '222.2 47.4% 11.2%',
  secondary: '217.2 32.6% 17.5%',
  'secondary-foreground': '210 40% 98%',
  muted: '217.2 32.6% 17.5%',
  'muted-foreground': '215 20.2% 65.1%',
  accent: '217.2 32.6% 21%',
  'accent-foreground': '210 40% 98%',
  destructive: '0 62.8% 30.6%',
  'destructive-foreground': '210 40% 98%',
  border: '217.2 32.6% 17.5%',
  'border-strong': '217.2 32.6% 28%',
  input: '217.2 32.6% 17.5%',
  ring: '212.7 26.8% 83.9%',
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
  'enterprise-mod-2': 'Enterprise 靛蓝',
  'light-green': '清新绿',
  claude: 'Claude 暖橘',
  vercel: 'Vercel 极简',
  't3-chat': 'T3 Chat',
  'deep-purple': '深邃紫',
  openprofile: 'openprofile 杏黄',
  autoblog: 'autoblog 暖橙',
  'zen-inspired': 'Zen 素雅',
  'logistic-one': 'LogisticOne 藏蓝',
  whatsapp: 'WhatsApp 青绿',
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

export function getThemePreset(id: ThemePresetId): ThemePreset {
  const preset = THEME_PRESETS.find((p) => p.id === id);
  return preset ?? DEFAULT_PRESET;
}

/** Runtime guard based on the live registry (covers forward-added presets). */
export function isThemePresetId(value: unknown): value is ThemePresetId {
  return typeof value === 'string' && THEME_PRESETS.some((p) => p.id === value);
}
