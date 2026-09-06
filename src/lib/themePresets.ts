import { DEFAULT_THEME_PRESET_ID, THEME_PRESETS } from '../constants/themePresets';
import type { ThemePreset, ThemePresetId } from '../constants/themePresets';

export const THEME_STYLE_TAG_ID = 'gsm-theme-presets';

type Palette = ThemePreset['lightColors'];

/**
 * Format a token key as a CSS custom property variable name.
 *
 * @param token The token key name (e.g. "background").
 * @returns The CSS variable name (e.g. "--background").
 */
function cssVarName(token: string): string {
  return `--${token}`;
}

/**
 * Format a preset palette into a block of indented CSS variable declarations.
 *
 * @param palette Record of color token names to HSL triplet values.
 * @returns Formatted CSS declarations string.
 */
function paletteVars(palette: Palette): string {
  return Object.entries(palette)
    .map(([token, value]) => `  ${cssVarName(token)}: ${value};`)
    .join('\n');
}

/**
 * Round a numeric value to at most three decimal places for CSS opacity values.
 *
 * @param value The floating-point number to round.
 * @returns Rounded number.
 */
function roundToThreeDecimals(value: number): number {
  return Math.round(value * 1000) / 1000;
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
    ].filter(Boolean);
    // Elevation tiers derived from the preset's shadow color/opacity so the
    // dialog shadow actually lifts above cards instead of all three tokens
    // sharing one flat recipe.
    const base = preset.shadowOpacity ?? 0.1;
    const elevation = [
      `  --app-shadow-subtle: 0 1px 3px hsl(var(--shadow-color) / var(--shadow-opacity));`,
      `  --app-shadow-elevated: 0 12px 32px hsl(var(--shadow-color) / ${roundToThreeDecimals(Math.min(0.16, base + 0.06))}), 0 2px 6px hsl(var(--shadow-color) / var(--shadow-opacity));`,
      `  --app-shadow-dialog: 0 20px 48px hsl(var(--shadow-color) / ${roundToThreeDecimals(Math.min(0.3, base + 0.14))}), 0 2px 8px hsl(var(--shadow-color) / var(--shadow-opacity));`,
    ];
    blocks.push(`[data-theme='${preset.id}'] {\n${[...identityVars, elevation[0], elevation[1], elevation[2], paletteVars(preset.lightColors)].filter(Boolean).join('\n')}\n}`);
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
