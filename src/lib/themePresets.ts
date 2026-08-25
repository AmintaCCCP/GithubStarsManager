import { DEFAULT_THEME_PRESET_ID, THEME_PRESETS } from '../constants/themePresets';
import type { ThemePreset, ThemePresetId } from '../constants/themePresets';

export const THEME_STYLE_TAG_ID = 'gsm-theme-presets';

type Palette = ThemePreset['lightColors'];

function cssVarName(token: string): string {
  return `--${token}`;
}

function paletteVars(palette: Palette): string {
  return Object.entries(palette)
    .map(([token, value]) => `  ${cssVarName(token)}: ${value};`)
    .join('\n');
}

/**
 * Builds the CSS text for every non-default preset. Rules are scoped to
 * `[data-theme]` / `html.dark[data-theme]` so they override the base
 * `:root` / `html.dark` blocks in index.css purely by specificity and stay
 * inactive until the attribute is set on <html>.
 */
export function buildThemePresetCss(): string {
  const blocks: string[] = [];
  for (const preset of THEME_PRESETS) {
    if (preset.id === DEFAULT_THEME_PRESET_ID) continue;
    const identityVars = [
      preset.radius ? `  --radius: ${preset.radius};` : '',
      preset.fontSans ? `  --font-sans: ${preset.fontSans};` : '',
      preset.fontMono ? `  --font-mono: ${preset.fontMono};` : '',
      preset.fontSerif ? `  --font-serif: ${preset.fontSerif};` : '',
      ...(preset.shadowColor
        ? [
            `  --shadow-color: ${preset.shadowColor};`,
            ...(preset.shadowOpacity !== undefined
              ? [`  --shadow-opacity: ${preset.shadowOpacity};`]
              : []),
          ]
        : []),
      ...(preset.shadow
        ? [
            `  --app-shadow-subtle: ${preset.shadow};`,
            `  --app-shadow-elevated: ${preset.shadow};`,
            `  --app-shadow-dialog: ${preset.shadow};`,
          ]
        : []),
    ].filter(Boolean);
    blocks.push(`[data-theme='${preset.id}'] {\n${[...identityVars, paletteVars(preset.lightColors)].filter(Boolean).join('\n')}\n}`);
    blocks.push(`html.dark[data-theme='${preset.id}'] {\n${paletteVars(preset.darkColors)}\n}`);
  }
  return `${blocks.join('\n\n')}\n`;
}

/** Idempotently injects the preset stylesheet once at startup. */
export function ensureThemeStyleTag(doc: Document = document): void {
  let tag = doc.getElementById(THEME_STYLE_TAG_ID) as HTMLStyleElement | null;
  if (!tag) {
    tag = doc.createElement('style');
    tag.id = THEME_STYLE_TAG_ID;
    doc.head.appendChild(tag);
  }
  if (!tag.textContent) {
    tag.textContent = buildThemePresetCss();
  }
}

/**
 * Activates a preset via the data-theme attribute. The default preset clears
 * the attribute so the base stylesheet applies unchanged.
 */
export function applyThemePreset(id: ThemePresetId, root: HTMLElement = document.documentElement): void {
  const known = THEME_PRESETS.some((p) => p.id === id);
  if (!known || id === DEFAULT_THEME_PRESET_ID) {
    delete root.dataset.theme;
    return;
  }
  root.dataset.theme = id;
}

export interface ThemeSwatchColors {
  background: string;
  card: string;
  primary: string;
  accent: string;
  foreground: string;
}

/** Preview colors for the settings picker, resolved for the active mode. */
export function getThemeSwatch(preset: ThemePreset, isDark: boolean): ThemeSwatchColors {
  const colors = isDark ? preset.darkColors : preset.lightColors;
  return {
    background: `hsl(${colors.background})`,
    card: `hsl(${colors.card})`,
    primary: `hsl(${colors.primary})`,
    accent: `hsl(${colors.accent})`,
    foreground: `hsl(${colors.foreground})`,
  };
}
